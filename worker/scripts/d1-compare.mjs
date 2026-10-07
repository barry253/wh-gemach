// Checks that D1 holds the same data as Airtable and that the worker gives the same answers on both:
//   node scripts/d1-compare.mjs
//
// 1. Data: every record and field of every table, including what each side computes itself
//    (item status, Gemach Slug, Loan Statuses, Request Note, reverse links).
// 2. Answers: runs the worker itself twice — once on Airtable, once on D1 — and calls every
//    read-only route (public pages, and every admin tab for every gemach as a Network Admin),
//    then diffs the JSON. Each engine runs in its own process so no in-memory cache is shared.
//    Writes are blocked in both runs (Airtable writes, D1 writes, emails).
//
// Prints where things differ, never borrowers' details (public repo = public workflow log):
// values are shown only for fields that hold no personal information.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TABLES, viewName } from "../src/dbschema.js";
import { toRecord } from "../src/d1.js";
import { airtableAll, d1Query, need, readOnlyD1Binding } from "./lib.mjs";

const SAFE = new Set(["Status", "Slug", "Gemach Slug", "Item ID", "Active", "Tracking", "Mode", "Coming Soon", "Request Type",
  "Event Type", "Role", "Display Order", "Quantity", "Quantity Owned", "Out of Service", "Package Size", "Loan Statuses",
  "status", "slug", "mode", "count", "active", "tracking", "itemId", "units", "available", "requests"]);
const MAX_EXAMPLES = 5;

const show = (key, v) => {
  if (SAFE.has(key) || typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) return JSON.stringify(v);
  if (Array.isArray(v)) return `[array of ${v.length}]`;
  if (typeof v === "object") return `{object, ${Object.keys(v).length} keys}`;
  return `(text, ${String(v).length} chars)`;
};

// ─── 1. Data ───────────────────────────────────────────────────────────────────

function norm(f, v) {
  if (v === undefined || v === null || v === false || v === "") return undefined;
  if (Array.isArray(v)) {
    let a = v.filter(x => x !== null && x !== "" && x !== undefined);
    if (!a.length) return undefined;
    // reverse links and lookups: order isn't meaningful
    if (f.kind === "calc") a = [...a].map(String).sort();
    return a;
  }
  if (f.kind === "datetime" || (f.kind === "calc" && f.col === "received_at")) return new Date(v).toISOString();
  if (f.kind === "num") return Number(v);
  return v;
}

async function compareData() {
  let bad = 0;
  for (const spec of Object.values(TABLES)) {
    const at = await airtableAll((spec.airtableIds || [])[0] || spec.name);
    const names = Object.keys(spec.fields);
    const rows = (await d1Query(`SELECT * FROM ${viewName(spec)} ORDER BY _seq`)).results;
    const d1 = new Map(rows.map(r => [r.id, toRecord(spec, r, names)]));
    const diffs = new Map(); // field -> [ids]
    const note = (k, id) => { if (!diffs.has(k)) diffs.set(k, []); diffs.get(k).push(id); };
    for (const a of at) {
      const d = d1.get(a.id);
      if (!d) { note("(missing in D1)", a.id); continue; }
      if (new Date(a.createdTime).toISOString() !== new Date(d.createdTime).toISOString()) note("(created time)", a.id);
      for (const n of names) {
        const x = norm(spec.fields[n], a.fields[n]), y = norm(spec.fields[n], d.fields[n]);
        if (JSON.stringify(x) !== JSON.stringify(y)) note(n, `${a.id} Airtable ${show(n, x)} / D1 ${show(n, y)}`);
      }
      d1.delete(a.id);
    }
    for (const id of d1.keys()) note("(extra in D1)", id);
    const total = [...diffs.values()].reduce((s, l) => s + l.length, 0);
    bad += total;
    console.log(`${total ? "✗" : "✓"} ${spec.name}: ${at.length} records${total ? `, ${total} difference(s)` : ""}`);
    for (const [k, list] of diffs) {
      console.log(`    ${k}: ${list.length}`);
      for (const e of list.slice(0, MAX_EXAMPLES)) console.log(`      ${e}`);
    }
  }
  return bad;
}

// ─── 2. Answers ────────────────────────────────────────────────────────────────

const b64u = bytes => Buffer.from(bytes).toString("base64url");
async function sign(secret, payload) {
  const h = b64u(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const b = b64u(new TextEncoder().encode(JSON.stringify({ iat: Date.now(), ...payload, exp: Date.now() + 3600e3 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${b}`));
  return `${h}.${b}.${b64u(new Uint8Array(sig))}`;
}

const ADMIN_ROUTES = ["/admin/dashboard", "/admin/stats?days=90&fresh=1", "/admin/stats?days=365&fresh=1", "/admin/gemach", "/admin/appointments",
  "/admin/requests", "/admin/loans", "/admin/reservations", "/admin/inventory", "/admin/catalog/item-types", "/admin/catalog/categories",
  "/admin/catalog/items", "/admin/history"];
const NETWORK_ROUTES = ["/admin/network/overview", "/admin/network/searches?days=365"];

/** Child process: run every route on one engine and save the answers. */
async function runEngine(engine, outFile, adminEmail, slugs) {
  const secret = "compare-" + Math.random().toString(36).slice(2);
  const env = { AIRTABLE_TOKEN: need("AIRTABLE_TOKEN"), AIRTABLE_BASE_ID: need("AIRTABLE_BASE_ID"), GEMACH_JWT: secret,
    ASSETS_URL: process.env.ASSETS_URL || "", NOTIFY_EMAIL: "", ALERT_EMAIL: "" };
  if (engine === "d1") Object.assign(env, { DB_BACKEND: "d1", DB: readOnlyD1Binding() });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    if (url.startsWith("https://api.airtable.com/")) {
      if (engine === "d1") throw new Error("D1 run called Airtable: " + method + " " + url.split("?")[0]);
      const read = method === "GET" || (method === "POST" && url.split("?")[0].endsWith("/listRecords"));
      if (!read) throw new Error("compare run: Airtable writes are blocked");
    } else if (!url.startsWith("https://api.cloudflare.com/")) {
      throw new Error("compare run: blocked " + method + " " + url.split("?")[0]);
    }
    return realFetch(input, init);
  };
  const { default: worker } = await import("../src/index.js");
  const token = await sign(secret, { email: adminEmail, name: "Compare", role: "Network Admin", gemachs: [] });
  const waits = [];
  const ctx = { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} };
  const results = {};
  const get = async (route, headers = {}) => {
    const res = await worker.fetch(new Request("https://compare.invalid" + route, { headers }), env, ctx);
    let body = await res.text();
    try { body = JSON.parse(body); } catch { /* keep text */ }
    return { status: res.status, body };
  };
  results["GET /inventory"] = await get("/inventory");
  results["GET /public/directory"] = await get("/public/directory");
  for (const s of slugs) results[`GET /public/gemach/${s}`] = await get(`/public/gemach/${s}`);
  const auth = { Authorization: `Bearer ${token}` };
  for (const r of NETWORK_ROUTES) results[`GET ${r}`] = await get(r, auth);
  for (const s of slugs) for (const r of ADMIN_ROUTES) results[`GET ${r} [${s}]`] = await get(r, { ...auth, "X-Gemach": s });
  await Promise.all(waits);
  writeFileSync(outFile, JSON.stringify(results));
}

// Fields whose values legitimately differ by engine.
function scrub(v, key) {
  if (Array.isArray(v)) return v.map(x => scrub(x));
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (k === "offset") { o[k] = v[k] ? "(more)" : null; continue; } // paging tokens look different
      o[k] = scrub(v[k], k);
    }
    return o;
  }
  return v;
}

function diff(a, b, at, out) {
  if (out.length >= MAX_EXAMPLES) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) { out.push(`${at}: Airtable ${a.length} entries / D1 ${b.length}`); return; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${at}.${k}`, out);
    return;
  }
  const key = at.split(".").pop();
  out.push(`${at}: Airtable ${show(key, a)} / D1 ${show(key, b)}`);
}

async function compareAnswers() {
  const admins = await airtableAll("Admins");
  const net = admins.find(a => a.fields.Active && a.fields.Role === "Network Admin" && a.fields.Email);
  if (!net) throw new Error("no active Network Admin to sign in as");
  const gemachs = await airtableAll("Gemachs");
  const slugs = gemachs.map(g => g.fields.Slug).filter(Boolean).sort();
  const dir = mkdtempSync(path.join(tmpdir(), "d1cmp-"));
  const me = fileURLToPath(import.meta.url);
  for (const engine of ["airtable", "d1"]) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["--no-warnings", me, "--engine", engine, path.join(dir, engine + ".json"), net.fields.Email, slugs.join(",")],
      { stdio: "inherit", env: process.env });
    if (r.status !== 0) throw new Error(`${engine} run failed`);
    console.log(`  ${engine}: answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  const A = JSON.parse(readFileSync(path.join(dir, "airtable.json"), "utf8"));
  const D = JSON.parse(readFileSync(path.join(dir, "d1.json"), "utf8"));
  let bad = 0;
  for (const route of Object.keys(A)) {
    const out = [];
    if (A[route].status !== D[route].status) out.push(`status: Airtable ${A[route].status} / D1 ${D[route].status}`);
    else diff(scrub(A[route].body), scrub(D[route].body), "body", out);
    if (out.length) { bad++; console.log(`✗ ${route}`); for (const o of out) console.log("    " + o); }
  }
  console.log(`${Object.keys(A).length - bad} of ${Object.keys(A).length} answers identical`);
  return bad;
}

// ─── main ──────────────────────────────────────────────────────────────────────

if (process.argv[2] === "--engine") {
  const [, , , engine, outFile, email, slugs] = process.argv;
  await runEngine(engine, outFile, email, slugs.split(","));
} else {
  console.log("── Data ──");
  const dataBad = await compareData();
  let answersBad = 0;
  if (!process.argv.includes("--data-only")) {
    console.log("\n── Worker answers ──");
    answersBad = await compareAnswers();
  }
  console.log(`\n${dataBad || answersBad ? "DIFFERENCES FOUND" : "D1 matches Airtable"}: ${dataBad} data difference(s), ${answersBad} route(s) differ`);
  process.exit(dataBad || answersBad ? 1 : 0);
}
