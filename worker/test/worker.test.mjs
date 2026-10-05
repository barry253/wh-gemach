import assert from "node:assert/strict";
globalThis.__WHG_TEST__ = {};
const { default: worker } = await import("../src/index.js");
const SOON = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

const A = { id: "recWnYrL9z2mnhs2u", slug: "wh-medical" };
const B = { id: "recBBBBBBBBBBBBBB", slug: "other-gemach" };
const C = { id: "recDIRECTORY00001", slug: "dir-only" };
const rec = (id, fields) => ({ id, createdTime: "2026-01-01T00:00:00.000Z", fields });

const DB = {
  "Gemachs": [
    rec(A.id, { Name: "West Hempstead Medical Gemach", Slug: A.slug, Active: true, Email: "wh@example.com", Phone: "(718) 986-7345", "Pickup Address": "SECRET ADDR", "Pickup Instructions": "SECRET INSTR", "Pickup Message": "SECRET TPL {first_name}", Tagline: "Mobility equipment", "Display Order": 10, Mode: "Full", Community: ["recCCCCCCCCCCCCC1"] }),
    rec(B.id, { Name: "Other Gemach", Slug: B.slug, Active: true, Email: "b@example.com" }),
    rec(C.id, { Name: "Aardvark Directory Gemach", Slug: C.slug, Active: true, Phone: "516-555-0000", Mode: "Directory", "Display Order": 20 }),
  ],
  "Communities": [rec("recCCCCCCCCCCCCC1", { Name: "West Hempstead" })],
  "Product Categories": [
    rec("recCAT0000000000B", { Name: "Walkers", Icon: "🚶", Keywords: "rollator, walking frame,", "Display Order": 20, Active: true }),
    rec("recCAT0000000000A", { Name: "Wheelchairs", Icon: "🦽", Keywords: "wheel chair,transport chair", "Display Order": 10, Active: true }),
    rec("recCAT0000000000C", { Name: "Zebra", Active: true }),
    rec("recCAT0000000000D", { Name: "Hidden", Active: false, "Display Order": 1 }),
  ],
  "Admins": [rec("recADMIN000000001", { Name: "Bárry ✡", Email: "barry@example.com", Active: true, Role: "Owner", Gemachs: [A.id] }),
             rec("recADMINNX0000001", { Name: "N", Email: "n@x", Active: true, Role: "Network Admin", Gemachs: [] }),
             // Gemach admins are re-checked live, so every test token's email has a row.
             rec("recADMINV00000001", { Name: "Vol", Email: "v@example.com", Active: true, Role: "Volunteer", Gemachs: [A.id] }),
             rec("recADMINB00000001", { Name: "Bee", Email: "b@example.com", Active: true, Role: "Manager", Gemachs: [B.id] }),
             rec("recADMINVB0000001", { Name: "V", Email: "v@b", Active: true, Role: "Volunteer", Gemachs: [B.id] }),
             rec("recADMINB20000001", { Name: "B2", Email: "b2@example.com", Active: true, Role: "Manager", Gemachs: [B.id] })],
  "Item Types": [
    rec("recTYPEA000000001", { Name: "Wheelchair", Active: true, "Product Category": ["recCAT0000000000A"], Items: ["recITEMA000000001", "recITEMA000000002"], Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recTYPEA000000002", { Name: "Walker", Active: true, Items: [], Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recTYPEA000000003", { Name: "Shower Chair", Active: true, Items: [], Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recTYPEB000000001", { Name: "Crib", Active: true, Items: ["recITEMB000000001"], Gemach: [B.id], "Gemach Slug": [B.slug] }),
  ],
  "Items": [
    rec("recITEMA000000001", { "Item ID": "WC-001", "Item Type": ["recTYPEA000000001"], Active: true, Status: "Available", Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recITEMA000000002", { "Item ID": "WC-002", "Item Type": ["recTYPEA000000001"], Active: true, Status: "On Loan", Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recITEMB000000001", { "Item ID": "CR-001", "Item Type": ["recTYPEB000000001"], Active: true, Status: "Available", Gemach: [B.id], "Gemach Slug": [B.slug] }),
  ],
  "Requests": [
    rec("recREQ00000000001", { "Request ID": "R-007", Gemach: [B.id], "Gemach Slug": [B.slug] }),
    rec("recREQA0000000002", { "Request ID": "R-004", Name: "Barry R", Phone: "+17189867345", Status: "New", "Items Requested": ["recTYPEA000000001", "recTYPEA000000002"], "Needed From": "2027-01-01", "Needed Until": "2027-02-01", Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recREQA0000000001", { "Request ID": "R-006", Name: "Sarah", Email: "sarah@example.com", Status: "New", "Items Requested": ["recTYPEA000000001"], Gemach: [A.id], "Gemach Slug": [A.slug] }),
  ],
  "Loans": [], "Borrowers": [], "tblC3PY7f5sXQDMJK": [], "tblpy91cyNSkKx1NL": [],
};

const calls = [];
let resendFail = false, airtableFail = null;
let fail429Once = false;
let stallOnce = null; // (method, table, id) => ms: that call hangs for ms (or until aborted)
const PAGE = 2; // small page size to exercise offset paging

function evalFilter(table, f, r) {
  if (!f) return true;
  let m;
  if ((m = f.match(/ARRAYJOIN\(\{Gemach Slug\}\)="([^"]+)"/)) && (r.fields["Gemach Slug"] || []).join(", ") !== m[1]) return false;
  const ids = [...f.matchAll(/RECORD_ID\(\)="(rec\w+)"/g)].map(x => x[1]);
  if (ids.length && !ids.includes(r.id)) return false;
  if ((m = f.match(/(?<!LOWER\()\{Slug\}="([^"]+)"/)) && r.fields.Slug !== m[1]) return false;
  if ((m = f.match(/LOWER\(\{Slug\}\)="([^"]*)"/)) && String(r.fields.Slug || "").toLowerCase() !== m[1]) return false;
  if ((m = f.match(/LOWER\(\{Name\}\)="([^"]*)"/)) && String(r.fields.Name || "").toLowerCase() !== m[1]) return false;
  if (/\{Slug\}!=""/.test(f) && !r.fields.Slug) return false;
  if ((m = f.match(/LOWER\(\{Email\}\)="([^"]+)"/)) && (r.fields.Email || "").toLowerCase() !== m[1]) return false;
  if (/\{Active\}=1/.test(f) && !r.fields.Active) return false;
  if (/AND\(\{Active\},/.test(f) && !r.fields.Active) return false;
  if (/\{Auto Reminders\}/.test(f) && !r.fields["Auto Reminders"]) return false;
  if (/NOT\(\{Expected Return\}=BLANK\(\)\)/.test(f) && !r.fields["Expected Return"]) return false;
  if (/\{Status\}="Available"/.test(f) && r.fields.Status !== "Available") return false;
  if (/\{Status\}="New"/.test(f) && r.fields.Status !== "New") return false;
  if (/\{Status\}="Returned"/.test(f) && r.fields.Status !== "Returned") return false;
  if (/\{Status\}="Active"/.test(f) && !/OR\(\{Status\}/.test(f) && r.fields.Status !== "Active") return false;
  if (/OR\(\{Status\}="Active",\{Status\}="Reserved"\)/.test(f) && !["Active", "Reserved"].includes(r.fields.Status)) return false;
  if ((m = f.match(/\{Query\}="([^"]*)"/)) && r.fields.Query !== m[1]) return false;
  const evs = [...f.matchAll(/\{Event Type\}="([^"]+)"/g)].map(x => x[1]);
  if (evs.length && !evs.includes(r.fields["Event Type"])) return false;
  if (/\{Request Type\}="Appointment"/.test(f) && r.fields["Request Type"] !== "Appointment") return false;
  if (/\{Status\}!="Declined"/.test(f) && r.fields.Status === "Declined") return false;
  if (/\{Status\}!="Cancelled"/.test(f) && r.fields.Status === "Cancelled") return false;
  if ((m = f.match(/NOT\(IS_BEFORE\(\{Appointment At\},"([^"]+)"\)\)/)) && !(r.fields["Appointment At"] && r.fields["Appointment At"] >= m[1])) return false;
  return true;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method || "GET";
  calls.push({ url, method, body: init.body });
  if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
    return new Response(JSON.stringify({ email: "Barry@Example.com", email_verified: "true", aud: "802083328700-pa13f067g5lsf1uijm4nqp40ptivjbti.apps.googleusercontent.com" }));
  }
  if (url.startsWith("https://api.resend.com")) {
    const to = JSON.parse(init.body).to?.[0];
    if (resendFail && to !== "alerts@example.com") return new Response('{"message":"boom"}', { status: 500 });
    return new Response("{}");
  }
  if (url === "https://api.airtable.com/v0/meta/whoami") return new Response('{"id":"usrTEST"}');
  const m = url.match(/^https:\/\/api\.airtable\.com\/v0\/appTEST\/([^/?]+)(?:\/([^/?]+))?/);
  if (!m) throw new Error("unexpected fetch " + url);
  if (airtableFail && airtableFail(method, decodeURIComponent(m[1]), m[2])) return new Response('{"error":{"type":"TEST_FAIL"}}', { status: 422 });
  if (stallOnce && stallOnce(method, decodeURIComponent(m[1]), m[2])) {
    const ms = stallOnce(method, decodeURIComponent(m[1]), m[2]); stallOnce = null;
    await new Promise((res, rej) => { const t = setTimeout(res, ms); init.signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); });
  }
  if (fail429Once) { fail429Once = false; return new Response("{}", { status: 429, headers: { "Retry-After": "0" } }); }
  const table = decodeURIComponent(m[1]);
  const rows = DB[table];
  assert.ok(rows, "unknown table " + table);
  if (m[2] === "listRecords") {
    const b = JSON.parse(init.body || "{}");
    const all = rows.filter(r => evalFilter(table, b.filterByFormula, r));
    const start = Number(b.offset || 0);
    const size = Math.min(PAGE, b.maxRecords || PAGE);
    const page = all.slice(start, start + size);
    const next = start + size < all.length && !(b.maxRecords && start + size >= b.maxRecords) ? String(start + size) : undefined;
    return new Response(JSON.stringify({ records: page, offset: next }));
  }
  if (!m[2] && method === "GET") return new Response(JSON.stringify({ records: rows.slice(0, 1) })); // GET list (health probe)
  if (m[2]) {
    const r = rows.find(x => x.id === m[2]);
    if (!r) return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 });
    if (method === "PATCH") { Object.assign(r.fields, JSON.parse(init.body).fields); }
    return new Response(JSON.stringify(r));
  }
  if (method === "POST") {
    const r = rec("recNEW" + String(rows.length).padStart(11, "0"), JSON.parse(init.body).fields);
    if (Array.isArray(r.fields.Gemach) && !r.fields["Gemach Slug"]) r.fields["Gemach Slug"] = r.fields.Gemach.map(id => DB.Gemachs.find(g => g.id === id)?.fields.Slug); // lookup field
    rows.push(r);
    return new Response(JSON.stringify(r));
  }
  throw new Error("unhandled " + method + " " + url);
};

const R2 = [];
const env = { AIRTABLE_BASE_ID: "appTEST", AIRTABLE_TOKEN: "x", GEMACH_JWT: "test-secret", RESEND_API_KEY: "k", ALERT_EMAIL: "alerts@example.com", ASSETS_URL: "https://assets",
  ASSETS_BUCKET: { put: async (key, body, opts) => { R2.push({ key, size: body.byteLength, opts }); } } };
const waits = [];
const ctx = { waitUntil: p => waits.push(p) };
const call = (path, init = {}) => worker.fetch(new Request("https://wh-gemach.example.workers.dev" + path, init), env, ctx);

// Independent JWT signer (same algorithm) to prove compatibility with the worker's verifier
const b64u = bytes => Buffer.from(bytes).toString("base64url");
async function sign(payload) {
  const h = b64u(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const b = b64u(new TextEncoder().encode(JSON.stringify({ iat: Date.now(), ...payload, exp: Date.now() + 60000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GEMACH_JWT), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${b}`));
  return `${h}.${b}.${b64u(new Uint8Array(sig))}`;
}
const tokenA = await sign({ email: "barry@example.com", name: "Bárry ✡", role: "Owner", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }] });
const auth = t => ({ Authorization: `Bearer ${t}` });

let pass = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("PASS", name); } catch (e) { console.log("FAIL", name, "-", e.message); process.exitCode = 1; } }

await t("OPTIONS returns CORS (allowlisted origin echoed)", async () => {
  const r = await call("/api/admin/dashboard", { method: "OPTIONS", headers: { Origin: "https://whgemachs.org" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://whgemachs.org");
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /PATCH/);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /X-Gemach/);
});

await t("OPTIONS from unknown origin on admin route gets no ACAO", async () => {
  const r = await call("/admin/dashboard", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
});

await t("/inventory legacy returns array (paged, scoped to wh-medical)", async () => {
  const r = await call("/inventory");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  const data = await r.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 3, "3 wh-medical types across 2 pages");
  assert.deepEqual(Object.keys(data[0]), ["id", "name", "description", "totalUnits", "availableCount", "hasPhoto", "photoUrl"]);
  assert.equal(data[0].totalUnits, 2);
  assert.equal(data[0].availableCount, 1);
});

await t("/api prefix stripping works", async () => {
  const r = await call("/api/inventory");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await r.json()));
});

await t("admin JWT for gemach A requesting ?g=B -> 403 (only the Gemachs + live Admins lookups, no scoped data read)", async () => {
  const before = calls.length;
  const r = await call(`/api/admin/dashboard?g=${B.slug}`, { headers: auth(tokenA) });
  assert.equal(r.status, 403);
  assert.ok(calls.slice(before).every(c => c.url.includes("/Gemachs/") || c.url.includes("/Admins/")), "only gemach + admin lookups");
  const r2 = await call(`/admin/dashboard`, { headers: { ...auth(tokenA), "X-Gemach": B.slug } });
  assert.equal(r2.status, 403);
});

await t("admin without g defaults to single gemach; formulas scoped", async () => {
  const before = calls.length;
  const r = await call(`/admin/dashboard`, { headers: auth(tokenA) });
  assert.equal(r.status, 200);
  const lists = calls.slice(before).filter(c => c.url.endsWith("/listRecords") && !c.url.includes("Gemachs"));
  assert.ok(lists.length >= 3);
  for (const c of lists) assert.match(JSON.parse(c.body).filterByFormula, /ARRAYJOIN\(\{Gemach Slug\}\)="wh-medical"/);
});

await t("no token -> 401; tampered token -> 401", async () => {
  assert.equal((await call(`/admin/dashboard`)).status, 401);
  assert.equal((await call(`/admin/dashboard`, { headers: auth(tokenA.slice(0, -2) + "xx") })).status, 401);
});

await t("cross-tenant record id -> 404 (PATCH item of gemach B)", async () => {
  const r = await call(`/admin/catalog/items/recITEMB000000001`, { method: "PATCH", headers: { ...auth(tokenA), "Content-Type": "application/json" }, body: JSON.stringify({ notes: "hack" }) });
  assert.equal(r.status, 404);
  assert.equal(DB.Items[2].fields.Notes, undefined);
});

await t("cross-tenant request confirm -> 404", async () => {
  const r = await call(`/admin/requests/recREQ00000000001/confirm`, { method: "POST", headers: auth(tokenA), body: "{}" });
  assert.equal(r.status, 404);
});

await t("create item with foreign itemTypeId -> 404; own type -> stamps Gemach + scoped ID", async () => {
  const bad = await call(`/admin/catalog/items`, { method: "POST", headers: auth(tokenA), body: JSON.stringify({ itemTypeId: "recTYPEB000000001" }) });
  assert.equal(bad.status, 404);
  const ok = await call(`/admin/catalog/items`, { method: "POST", headers: auth(tokenA), body: JSON.stringify({ itemTypeId: "recTYPEA000000001" }) });
  assert.equal(ok.status, 200);
  const d = await ok.json();
  assert.equal(d.generatedId, "WC-003");
  assert.deepEqual(d.fields.Gemach, [A.id]);
});

await t("submit-request rejects item type from another gemach", async () => {
  const r = await call(`/submit-request`, { method: "POST", headers: { Origin: "https://barry253.github.io" }, body: JSON.stringify({ name: "X", phone: "5165551234", preferredContact: "SMS", neededFrom: SOON, itemsRequested: ["recTYPEB000000001"] }) });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://barry253.github.io");
});

await t("submit-request ok stamps Gemach and numbers globally (R-008)", async () => {
  const r = await call(`/submit-request`, { method: "POST", body: JSON.stringify({ name: "X", phone: "5165551234", preferredContact: "SMS", neededFrom: SOON, itemsRequested: ["recTYPEA000000002"] }) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.requestId, "R-008");
  const created = DB.Requests.at(-1);
  assert.deepEqual(created.fields.Gemach, [A.id]);
  const resend = calls.filter(c => c.url.startsWith("https://api.resend.com")).at(-1);
  const p = JSON.parse(resend.body);
  assert.deepEqual(p.to, ["wh@example.com"]);
  assert.match(p.from, /West Hempstead Medical Gemach/);
});

await t("public directory: no pickup address, items grouped per gemach", async () => {
  const r = await call(`/api/public/directory`);
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.ok(!txt.includes("SECRET ADDR"));
  const d = JSON.parse(txt);
  const a = d.gemachs.find(g => g.slug === A.slug);
  assert.equal(a.items.length, 3);
  assert.equal(a.communityName, "West Hempstead");
  assert.equal(a.items[0].categoryId, "recCAT0000000000A");
  assert.equal(a.items[1].categoryId, null);
  assert.ok(!("category" in a.items[0]));
  assert.equal(d.gemachs.find(g => g.slug === B.slug).items.length, 1);
});

await t("public gemach page + 404 for unknown", async () => {
  const r = await call(`/public/gemach/other-gemach`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.gemach.slug, B.slug);
  assert.equal(d.items.length, 1);
  assert.equal((await call(`/public/gemach/nope`)).status, 404);
});

await t("login flow issues working JWT with gemachs; unicode name", async () => {
  const r = await call(`/admin/login`, { method: "POST", body: JSON.stringify({ googleToken: "abc" }) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.role, "Owner");
  assert.deepEqual(d.gemachs.map(g => g.slug), [A.slug]);
  const me = await (await call(`/api/admin/me`, { headers: auth(d.token) })).json();
  assert.equal(me.name, "Bárry ✡");
  assert.equal(me.gemachs[0].id, A.id);
  const adminCall = calls.find(c => c.url.includes("/Admins/listRecords"));
  assert.match(JSON.parse(adminCall.body).filterByFormula, /LOWER\(\{Email\}\)="barry@example.com"/);
});

await t("Network Admin may access any real gemach; unknown slug 404", async () => {
  const tok = await sign({ email: "n@x", name: "N", role: "Network Admin", gemachs: [] });
  assert.equal((await call(`/admin/dashboard?g=${B.slug}`, { headers: auth(tok) })).status, 200);
  assert.equal((await call(`/admin/dashboard?g=ghost`, { headers: auth(tok) })).status, 404);
});


await t("sliding session: stale token refreshed with 14-day X-Session-Token", async () => {
  const old = await sign({ email: "barry@example.com", name: "Bárry ✡", role: "Owner", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }], iat: Date.now() - 13 * 3600000 });
  const r = await call(`/admin/dashboard`, { headers: { ...auth(old), Origin: "https://whgemachs.org" } });
  assert.equal(r.status, 200);
  const fresh = r.headers.get("X-Session-Token");
  assert.ok(fresh, "no refreshed token");
  assert.match(r.headers.get("Access-Control-Expose-Headers") || "", /X-Session-Token/);
  const p = JSON.parse(Buffer.from(fresh.split(".")[1], "base64url").toString());
  const days = (p.exp - p.iat) / 86400000;
  assert.ok(Math.abs(days - 14) < 0.01, "ttl " + days);
  assert.equal((await call(`/admin/dashboard`, { headers: auth(fresh) })).status, 200);
});

await t("sliding session: recent token not refreshed", async () => {
  const r = await call(`/admin/dashboard`, { headers: auth(tokenA) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Session-Token"), null);
});

await t("sliding session: removed admin rejected at refresh", async () => {
  const old = await sign({ email: "gone@example.com", name: "Gone", role: "Owner", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }], iat: Date.now() - 13 * 3600000 });
  assert.equal((await call(`/admin/dashboard`, { headers: auth(old) })).status, 401);
});

await t("confirm creates one reservation per item type, once", async () => {
  const before = DB["Loans"].length;
  const r = await call(`/admin/requests/recREQA0000000002/confirm`, { method: "POST", headers: auth(tokenA), body: JSON.stringify({ sendMessage: false }) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.reservations.length, 2);
  const made = DB["Loans"].slice(before);
  assert.equal(made.length, 2);
  for (const l of made) {
    assert.equal(l.fields.Status, "Reserved");
    assert.deepEqual(l.fields.Gemach, [A.id]);
    assert.deepEqual(l.fields["Source Request"], ["recREQA0000000002"]);
    assert.equal(l.fields["Reservation Start"], "2027-01-01");
    assert.equal(l.fields["Reservation End"], "2027-02-01");
    assert.ok(Array.isArray(l.fields.Borrower) && l.fields.Borrower.length === 1);
    assert.ok(!l.fields.Item);
  }
  assert.deepEqual(made.map(l => l.fields["Item to Reserve"][0]).sort(), ["recTYPEA000000001", "recTYPEA000000002"]);
  assert.notEqual(made[0].fields["Loan ID"], made[1].fields["Loan ID"]);
  const req = DB["Requests"].find(x => x.id === "recREQA0000000002");
  assert.equal(req.fields.Status, "Converted");
  const again = await call(`/admin/requests/recREQA0000000002/confirm`, { method: "POST", headers: auth(tokenA), body: "{}" });
  assert.equal(again.status, 200);
  assert.equal(DB["Loans"].length, before + 2, "no duplicate reservations");
  // pickup needs a unit when none assigned
  const loanId = made[0].id;
  assert.equal((await call(`/admin/loans/${loanId}/pickup`, { method: "POST", headers: auth(tokenA), body: "{}" })).status, 400);
  assert.equal((await call(`/admin/loans/${loanId}/pickup`, { method: "POST", headers: auth(tokenA), body: JSON.stringify({ itemId: "recITEMB000000001" }) })).status, 404);
  assert.equal((await call(`/admin/loans/${loanId}/pickup`, { method: "POST", headers: auth(tokenA), body: JSON.stringify({ itemId: "recITEMA000000001" }) })).status, 200);
  const l = DB["Loans"].find(x => x.id === loanId);
  assert.equal(l.fields.Status, "Active");
  assert.deepEqual(l.fields.Item, ["recITEMA000000001"]);
});

await t("borrower reuse requires matching name (shared phone -> new borrower)", async () => {
  DB["Borrowers"].push(rec("recBORRSHARED0001", { Name: "Barry Test5", Phone: "(718) 555-0101", Gemach: [A.id], "Gemach Slug": [A.slug] }));
  DB["Requests"].push(rec("recREQSHARE000001", { "Request ID": "R-090", Name: "Binyamin", Phone: "718-555-0101", Status: "New", "Items Requested": ["recTYPEA000000002"], Gemach: [A.id], "Gemach Slug": [A.slug] }));
  DB["Requests"].push(rec("recREQSHARE000002", { "Request ID": "R-091", Name: "  barry  TEST5. ", Phone: "7185550101", Status: "New", "Items Requested": ["recTYPEA000000002"], Gemach: [A.id], "Gemach Slug": [A.slug] }));
  const before = DB["Borrowers"].length;
  assert.equal((await call(`/admin/requests/recREQSHARE000001/confirm`, { method: "POST", headers: auth(tokenA), body: "{}" })).status, 200);
  assert.equal(DB["Borrowers"].length, before + 1, "different name on shared phone creates a new borrower");
  const nb = DB["Borrowers"][DB["Borrowers"].length - 1];
  assert.equal(nb.fields.Name, "Binyamin");
  const loan1 = DB["Loans"].find(l => (l.fields["Source Request"] || [])[0] === "recREQSHARE000001");
  assert.deepEqual(loan1.fields.Borrower, [nb.id]);
  assert.equal((await call(`/admin/requests/recREQSHARE000002/confirm`, { method: "POST", headers: auth(tokenA), body: "{}" })).status, 200);
  assert.equal(DB["Borrowers"].length, before + 1, "same name (case/spacing/punctuation) reuses the existing borrower");
  const loan2 = DB["Loans"].find(l => (l.fields["Source Request"] || [])[0] === "recREQSHARE000002");
  assert.deepEqual(loan2.fields.Borrower, ["recBORRSHARED0001"]);
});

await t("429 is retried", async () => {
  fail429Once = true;
  const r = await call(`/inventory`);
  assert.equal(r.status, 200);
});


// ─── v2 contract tests ───────────────────────────────────────────────────────
const tokenVol = await sign({ email: "v@example.com", name: "Vol", role: "Volunteer", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }] });
const jsonH = t => ({ ...auth(t), "Content-Type": "application/json", "X-Gemach": A.slug });

await t("v2 directory: categories (active, sorted, keywords), gemach order, mode, profile fields, no secrets", async () => {
  const r = await call(`/public/directory`);
  const txt = await r.text();
  for (const secret of ["SECRET ADDR", "SECRET INSTR", "SECRET TPL", "pickupAddress", "pickupInstructions", "templates"]) assert.ok(!txt.includes(secret), secret);
  const d = JSON.parse(txt);
  assert.deepEqual(d.categories.map(c => c.name), ["Wheelchairs", "Walkers", "Zebra"]);
  assert.deepEqual(d.categories[0], { id: "recCAT0000000000A", name: "Wheelchairs", icon: "🦽", keywords: ["wheel chair", "transport chair"], displayOrder: 10 });
  assert.deepEqual(d.categories[1].keywords, ["rollator", "walking frame"]);
  assert.equal(d.categories[2].displayOrder, null);
  assert.deepEqual(d.gemachs.map(g => g.slug), [A.slug, C.slug, B.slug], "displayOrder then blank last");
  const a = d.gemachs[0];
  assert.equal(a.mode, "Full"); assert.equal(a.tagline, "Mobility equipment"); assert.equal(a.displayOrder, 10);
  for (const k of ["website", "donationUrl", "hours", "logoUrl", "whatsapp"]) assert.ok(k in a && a[k] === null, k);
  assert.equal(d.gemachs[1].mode, "Directory");
  assert.equal(d.gemachs[2].mode, "Full", "blank mode defaults to Full");
  assert.ok(d.generatedAt);
});

await t("v2 public gemach: includes categories, profile, no secrets", async () => {
  const r = await call(`/api/public/gemach/wh-medical`);
  const txt = await r.text();
  assert.ok(!txt.includes("SECRET"));
  const d = JSON.parse(txt);
  assert.equal(d.categories.length, 3);
  assert.equal(d.gemach.mode, "Full");
  assert.ok(!("items" in d.gemach));
  assert.equal(d.items[0].categoryId, "recCAT0000000000A");
});

await t("v2 submit-request to Directory gemach -> 400 friendly", async () => {
  const before = DB.Requests.length;
  const r = await call(`/submit-request`, { method: "POST", headers: { Origin: "https://random-site.example" }, body: JSON.stringify({ gemach: C.slug, name: "X", phone: "5165551234", preferredContact: "WhatsApp", itemsRequested: ["recTYPEA000000001"] }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /doesn't take online requests.*516-555-0000/);
  assert.equal(DB.Requests.length, before);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*", "submit-request is CORS-public");
});

await t("v2 CORS: pages.dev + previews allowlisted; lookalikes not; submit-request preflight public", async () => {
  for (const o of ["https://whgemachs.pages.dev", "https://abc123.whgemachs.pages.dev", "https://feature-x.whgemachs.pages.dev"]) {
    const r = await call(`/admin/gemach`, { method: "OPTIONS", headers: { Origin: o } });
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), o, o);
  }
  for (const o of ["https://whgemachs.pages.dev.evil.com", "https://evil.com/.whgemachs.pages.dev", "http://abc.whgemachs.pages.dev", "https://a.b.whgemachs.pages.dev"]) {
    const r = await call(`/admin/gemach`, { method: "OPTIONS", headers: { Origin: o } });
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), null, o);
  }
  const p = await call(`/api/submit-request`, { method: "OPTIONS", headers: { Origin: "https://someone.example" } });
  assert.equal(p.headers.get("Access-Control-Allow-Origin"), "*");
  const adminFromEvil = await call(`/admin/gemach`, { headers: { ...auth(tokenA), Origin: "https://someone.example" } });
  assert.equal(adminFromEvil.headers.get("Access-Control-Allow-Origin"), null);
});

await t("v2 GET /admin/gemach: private fields, default templates, placeholders, canEdit", async () => {
  const r = await call(`/api/admin/gemach`, { headers: { ...auth(tokenA), "X-Gemach": A.slug } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.slug, A.slug); assert.equal(d.communityName, "West Hempstead");
  assert.equal(d.pickupAddress, "SECRET ADDR"); assert.equal(d.pickupInstructions, "SECRET INSTR");
  assert.match(d.templates.confirm, /^Hi \{first_name\}, great news/);
  assert.match(d.templates.confirm, /Pickup is at \{pickup_address\}\. \{pickup_instructions\}/);
  assert.equal(d.templates.pickup, "SECRET TPL {first_name}");
  assert.deepEqual(d.rawTemplates, { confirm: null, decline: null, pickup: "SECRET TPL {first_name}", appointment: null, returnReminder: null });
  assert.deepEqual(d.placeholders, ["first_name", "items", "gemach", "pickup_address", "pickup_instructions", "hours", "phone", "email", "appointment_time", "deposit_info", "event_date", "manage_link", "borrowed_date", "due_back", "days_out"]);
  assert.match(d.templates.returnReminder, /^Hi \{first_name\}, a friendly reminder .*\{due_back\}/);
  assert.equal(d.canEdit, true);
  const v = await (await call(`/admin/gemach`, { headers: { ...auth(tokenVol), "X-Gemach": A.slug } })).json();
  assert.equal(v.canEdit, false);
  assert.equal((await call(`/admin/gemach`, { headers: { ...auth(tokenA), "X-Gemach": B.slug } })).status, 403);
});

await t("v2 GET /admin/gemach: confirm default omits pickup sentence without address", async () => {
  const net = await sign({ email: "n@x", name: "N", role: "Network Admin", gemachs: [] });
  const d = await (await call(`/admin/gemach?g=${B.slug}`, { headers: auth(net) })).json();
  assert.ok(!d.templates.confirm.includes("Pickup is at"));
  assert.match(d.templates.confirm, /pickup details\.\n\nManage or cancel: \{manage_link\}\n\nThank you!$/);
  assert.ok(!d.templates.pickup.includes("{pickup_address}"));
  assert.match(d.templates.pickup, /ready for pickup\. \{pickup_instructions\}/);
  assert.equal(d.canEdit, true, "Network Admin can edit");
});

await t("v2 PATCH /admin/gemach: Volunteer 403, nothing written", async () => {
  const before = calls.length;
  const r = await call(`/admin/gemach`, { method: "PATCH", headers: jsonH(tokenVol), body: JSON.stringify({ tagline: "x" }) });
  assert.equal(r.status, 403);
  assert.ok(!calls.slice(before).some(c => c.method === "PATCH"));
});

await t("v2 PATCH /admin/gemach: validation", async () => {
  const bad = [
    { email: "not-an-email" }, { website: "javascript:alert(1)" }, { donationUrl: "ftp://x.com" }, { website: "example.com" }, { website: "https://user:pw@evil.example.com" }, { donationUrl: "https://user@x.com" },
    { tagline: "x".repeat(201) }, { confirmMessage: "x".repeat(2001) }, { phone: 5 }, {}, { name: "" }, { mode: "Directory" },
  ];
  for (const b of bad) {
    const r = await call(`/admin/gemach`, { method: "PATCH", headers: jsonH(tokenA), body: JSON.stringify(b) });
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 60));
    assert.ok((await r.json()).error);
  }
  assert.equal(DB.Gemachs[0].fields.Name, "West Hempstead Medical Gemach");
});

await t("v2 PATCH /admin/gemach: writes only own record, clears with '', purges caches", async () => {
  const deleted = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async req => { deleted.push(req.url); return true; } } };
  try {
    const before = calls.length;
    const r = await call(`/api/admin/gemach`, { method: "PATCH", headers: jsonH(tokenA), body: JSON.stringify({
      tagline: "  New tagline\nline2 ", website: "HTTPS://WH.Example.org", email: "new@example.com", hours: "Sun–Thu\nevenings",
      pickupMessage: "", confirmMessage: "Hi {first_name}! {items} at {pickup_address}.", slug: "ignored", mode: "Directory",
    }) });
    assert.equal(r.status, 200);
    const d = await r.json();
    const patches = calls.slice(before).filter(c => c.method === "PATCH");
    assert.equal(patches.length, 1);
    assert.ok(patches[0].url.endsWith(`/Gemachs/${A.id}`));
    const f = JSON.parse(patches[0].body).fields;
    assert.deepEqual(Object.keys(f).sort(), ["Confirm Message", "Email", "Hours", "Pickup Message", "Tagline", "Website"]);
    assert.equal(f.Tagline, "New tagline line2");
    assert.equal(f.Website, "https://wh.example.org/", "URL normalized");
    assert.equal(f["Pickup Message"], null);
    assert.equal(d.tagline, "New tagline line2");
    assert.equal(d.hours, "Sun–Thu\nevenings");
    assert.equal(d.mode, "Full"); assert.equal(d.name, "West Hempstead Medical Gemach");
    assert.equal(d.rawTemplates.pickup, null);
    assert.match(d.templates.pickup, /^Hi \{first_name\}, your \{items\} is ready/);
    assert.equal(d.templates.confirm, "Hi {first_name}! {items} at {pickup_address}.");
    assert.equal(DB.Gemachs[1].fields.Tagline, undefined);
    await Promise.allSettled(waits);
    assert.ok(deleted.some(u => u.endsWith("/__cache/v1/directory")));
    assert.ok(deleted.some(u => u.endsWith("/__cache/v1/gemach/wh-medical")));
    // subsequent GET reflects the change (memo invalidated / fresh read)
    const g2 = await (await call(`/admin/gemach`, { headers: { ...auth(tokenA), "X-Gemach": A.slug } })).json();
    assert.equal(g2.email, "new@example.com");
  } finally { delete globalThis.caches; }
});

await t("v2 confirm email: signature footer appended, subject unchanged", async () => {
  const r = await call(`/admin/requests/recREQA0000000001/confirm`, { method: "POST", headers: jsonH(tokenA), body: JSON.stringify({ message: "Hi Sarah, yes.", sendMessage: true }) });
  assert.equal(r.status, 200);
  const p = JSON.parse(calls.filter(c => c.url.startsWith("https://api.resend.com")).at(-1).body);
  assert.deepEqual(p.to, ["sarah@example.com"]);
  assert.equal(p.subject, "Your West Hempstead Medical Gemach Request — Confirmed");
  assert.equal(p.text, "Hi Sarah, yes.\n\n—\nWest Hempstead Medical Gemach\n(718) 986-7345 · new@example.com");
});

// ─── v3 contract tests ───────────────────────────────────────────────────────
const X = globalThis.__WHG_TEST__;
const resendCalls = () => calls.filter(c => c.url.startsWith("https://api.resend.com")).map(c => JSON.parse(c.body));
const setG = (id, f) => { Object.assign(DB.Gemachs.find(r => r.id === id).fields, f); X.clearMemo(); };
const post = (path, body, headers = {}) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
const ymd = d => d.toISOString().slice(0, 10);
const todayNy = X.nyToday();
const plusDays = n => { const [y, m, d] = todayNy.split("-").map(Number); return ymd(new Date(Date.UTC(y, m - 1, d + n))); };

await t("v3 unit: event-date rule — weekdays, Shabbos pickup→Fri, Shabbos return→Sun", async () => {
  const E = (d, o) => X.eventDates(d, o);
  // 2026-10-18 is a Sunday
  assert.deepEqual(E("2026-10-18", { pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false }), { pickup: "2026-10-17", return: "2026-10-19" });
  assert.deepEqual(E("2026-10-18", { pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: true }), { pickup: "2026-10-16", return: "2026-10-19" }, "Sat pickup -> Fri");
  // Thursday event, return 2 days after = Saturday -> Sunday
  assert.deepEqual(E("2026-10-15", { pickupDaysBefore: 1, returnDaysAfter: 2, shabbosAdjust: true }), { pickup: "2026-10-14", return: "2026-10-18" }, "Sat return -> Sun");
  assert.deepEqual(E("2026-10-15", { pickupDaysBefore: 1, returnDaysAfter: 2, shabbosAdjust: false }), { pickup: "2026-10-14", return: "2026-10-17" });
  // plain weekday, 0 days
  assert.deepEqual(E("2026-10-14", { pickupDaysBefore: 0, returnDaysAfter: 0, shabbosAdjust: true }), { pickup: "2026-10-14", return: "2026-10-14" });
  // Saturday event itself with 0/0 + adjust -> Fri / Sun
  assert.deepEqual(E("2026-10-17", { pickupDaysBefore: 0, returnDaysAfter: 0, shabbosAdjust: true }), { pickup: "2026-10-16", return: "2026-10-18" });
});

await t("v3 unit: event-date rule — month/year boundaries, leap day, DST boundary, clamp, invalid", async () => {
  const E = (d, o) => X.eventDates(d, o);
  assert.deepEqual(E("2026-03-01", { pickupDaysBefore: 1, returnDaysAfter: 1 }), { pickup: "2026-02-28", return: "2026-03-02" });
  assert.deepEqual(E("2028-03-01", { pickupDaysBefore: 1, returnDaysAfter: 1 }), { pickup: "2028-02-29", return: "2028-03-02" }, "leap year");
  assert.deepEqual(E("2027-01-01", { pickupDaysBefore: 2, returnDaysAfter: 1, shabbosAdjust: true }), { pickup: "2026-12-30", return: "2027-01-03" }, "Sat Jan 2 return -> Sun Jan 3");
  assert.deepEqual(E("2026-12-31", { pickupDaysBefore: 1, returnDaysAfter: 3 }), { pickup: "2026-12-30", return: "2027-01-03" });
  // DST: US clocks change Sun 2026-03-08 and Sun 2026-11-01 — pure date math must not drift
  assert.deepEqual(E("2026-03-08", { pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: true }), { pickup: "2026-03-06", return: "2026-03-09" });
  assert.deepEqual(E("2026-11-01", { pickupDaysBefore: 7, returnDaysAfter: 7 }), { pickup: "2026-10-25", return: "2026-11-08" });
  assert.deepEqual(E("2026-10-18", { pickupDaysBefore: 99, returnDaysAfter: -5 }), { pickup: "2026-10-04", return: "2026-10-18" }, "clamped 0..14");
  assert.equal(E("2026-02-30", {}), null);
  assert.equal(E("nope", {}), null);
});

await t("v3 unit: NY time conversion across DST + formatting", async () => {
  assert.equal(new Date(X.nyLocalToUtc("2026-10-12", "20:00")).toISOString(), "2026-10-13T00:00:00.000Z", "EDT -4");
  assert.equal(new Date(X.nyLocalToUtc("2026-12-01", "09:30")).toISOString(), "2026-12-01T14:30:00.000Z", "EST -5");
  assert.equal(new Date(X.nyLocalToUtc("2026-03-08", "12:00")).toISOString(), "2026-03-08T16:00:00.000Z", "DST start day");
  assert.equal(new Date(X.nyLocalToUtc("2026-11-01", "12:00")).toISOString(), "2026-11-01T17:00:00.000Z", "DST end day");
  assert.equal(X.formatNy(Date.parse("2026-10-13T00:00:00Z")), "Mon, Oct 12 at 8:00 PM");
  assert.equal(X.nyToday(Date.parse("2026-10-13T02:00:00Z")), "2026-10-12", "NY date lags UTC at night");
});

await t("v3 unit: ICS output (CRLF, UID, DTSTAMP, UTC times, escaping, folding)", async () => {
  const ics = X.buildIcs({ uid: "R-9-recX@whgemachs.org", startMs: Date.parse("2026-10-13T00:00:00Z"), durationMin: 60,
    title: "Kallah Gemach, Inc; appointment", description: "Line1\nLine2 \\ end", location: "12 Main St, West Hempstead",
    now: Date.parse("2026-09-28T12:34:56.789Z") });
  assert.ok(ics.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "only CRLF line endings");
  const lines = ics.split("\r\n");
  for (const l of lines) assert.ok(new TextEncoder().encode(l).length <= 75, "folded: " + l);
  const unfolded = ics.replace(/\r\n /g, "");
  for (const want of ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:R-9-recX@whgemachs.org", "DTSTAMP:20260928T123456Z",
    "DTSTART:20261013T000000Z", "DTEND:20261013T010000Z", "SUMMARY:Kallah Gemach\\, Inc\\; appointment",
    "DESCRIPTION:Line1\\nLine2 \\\\ end", "LOCATION:12 Main St\\, West Hempstead", "END:VEVENT", "END:VCALENDAR"]) {
    assert.ok(unfolded.split("\r\n").includes(want), "missing " + want);
  }
  const long = X.buildIcs({ uid: "u", startMs: 0, title: "é".repeat(80), now: 0 });
  for (const l of long.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75);
  assert.equal(long.replace(/\r\n /g, "").split("\r\n").find(l => l.startsWith("SUMMARY:")), "SUMMARY:" + "é".repeat(80));
});

await t("v3 unit: contrast-picked header text + HTML email escaping", async () => {
  assert.equal(X.textColorFor("#1B3A4B"), "#FFFFFF");
  assert.equal(X.textColorFor("#F5E6A8"), "#111111");
  assert.equal(X.textColorFor("#FFFFFF"), "#111111");
  assert.ok(X.contrastRatio("#000000", "#FFFFFF") > 20.9);
  const html = X.buildEmailHtml({ name: `A&B <script>`, themeColor: "#F5E6A8", logoUrl: `https://assets/x/logo/1.png"onerror=`, phone: "1", email: "e@x.co" }, `Hi <b>you</b>\nline2 & "q"`);
  assert.ok(!html.includes("<script>") && !html.includes("<b>you"));
  assert.ok(html.includes("Hi &lt;b&gt;you&lt;/b&gt;<br>line2 &amp; &quot;q&quot;"));
  assert.ok(html.includes("A&amp;B &lt;script&gt;"));
  assert.ok(html.includes('src="https://assets/x/logo/1.png&quot;onerror="'));
  assert.ok(html.includes("background:#F5E6A8;color:#111111"));
  assert.ok(html.includes("1 · e@x.co"));
  assert.ok(!/<link|<style|https?:\/\/(?!assets)/i.test(html.replace(/src="[^"]*"/g, "")), "no external css/links");
  assert.ok(!X.buildEmailHtml({ name: "x", logoUrl: "javascript:alert(1)" }, "m").includes("<img"));
});

await t("v3 public profile: new fields with defaults; Logo URL preferred", async () => {
  const d = await (await call(`/public/directory`)).json();
  const b = d.gemachs.find(g => g.slug === B.slug);
  assert.deepEqual({ primaryContact: b.primaryContact, secondaryContact: b.secondaryContact, themeColor: b.themeColor, accentColor: b.accentColor,
    depositRequired: b.depositRequired, depositInfo: b.depositInfo, gemachInfo: b.gemachInfo, requestStyle: b.requestStyle, eventLabel: b.eventLabel,
    pickupDaysBefore: b.pickupDaysBefore, returnDaysAfter: b.returnDaysAfter, shabbosAdjust: b.shabbosAdjust, logoUrl: b.logoUrl },
    { primaryContact: null, secondaryContact: null, themeColor: "#1B3A4B", accentColor: null, depositRequired: false, depositInfo: null, gemachInfo: null,
      requestStyle: "Dates", eventLabel: "Event date", pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false, logoUrl: null });
  setG(B.id, { "Theme Color": "#abcdef", "Accent Color": "bad", "Pickup Days Before": 40, "Return Days After": 0, "Request Style": "Event",
    "Primary Contact": "Email", Logo: [{ url: "https://att/1.png" }], "Logo URL": "https://assets/other-gemach/logo/1.png" });
  const g = (await (await call(`/public/gemach/${B.slug}`)).json()).gemach;
  assert.equal(g.themeColor, "#ABCDEF"); assert.equal(g.accentColor, null);
  assert.equal(g.pickupDaysBefore, 14); assert.equal(g.returnDaysAfter, 0);
  assert.equal(g.requestStyle, "Event"); assert.equal(g.primaryContact, "Email");
  assert.equal(g.logoUrl, "https://assets/other-gemach/logo/1.png");
  assert.ok(!("logoUrlField" in g) && !("rawTemplates" in g));
});

// Gemach B: Event style (pickup 1 before / return 1 after, Shabbos adjust), deposit required
const E_SLUG = B.slug;
await t("v3 submit Event: server computes dates (ignores client), stores Event Date/Type/deposit", async () => {
  setG(B.id, { "Request Style": "Event", "Pickup Days Before": 1, "Return Days After": 1, "Shabbos Adjust": true, "Deposit Required": true, "Deposit Info": "$50 check" });
  // find a Sunday at least 7 days out
  let n = 7; while (new Date(plusDays(n) + "T12:00:00Z").getUTCDay() !== 0) n++;
  const sunday = plusDays(n), friday = plusDays(n - 2), monday = plusDays(n + 1);
  const noAck = await post(`/submit-request`, { gemach: E_SLUG, name: "Kal", phone: "5165551234", preferredContact: "WhatsApp", itemsRequested: ["recTYPEB000000001"], eventDate: sunday });
  assert.equal(noAck.status, 400); assert.match((await noAck.json()).error, /deposit/i);
  const r = await post(`/submit-request`, { gemach: E_SLUG, name: "Kal", phone: "5165551234", preferredContact: "WhatsApp", itemsRequested: ["recTYPEB000000001"], eventDate: sunday, depositAck: true,
    neededFrom: "2020-01-01", neededUntil: "2020-01-02", openEnded: true });
  assert.equal(r.status, 200);
  const f = DB.Requests.at(-1).fields;
  assert.equal(f["Event Date"], sunday);
  assert.equal(f["Needed From"], friday, "Shabbos pickup -> Friday");
  assert.equal(f["Needed Until"], monday);
  assert.equal(f["Open-ended duration"], false);
  assert.equal(f["Request Type"], "Loan");
  assert.equal(f["Deposit Acknowledged"], true);
  const mail = resendCalls().at(-1);
  assert.match(mail.text, new RegExp(`Event date: ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(sunday + "T00:00:00Z"))}`));
  assert.match(mail.text, /Deposit acknowledged: yes/);
  assert.ok(mail.html && mail.html.includes("<table"));
});

await t("v3 submit Event: missing / past / >2y / invalid event date -> 400", async () => {
  const base = { gemach: E_SLUG, name: "K", phone: "5165551234", preferredContact: "WhatsApp", itemsRequested: ["recTYPEB000000001"], depositAck: true };
  const before = DB.Requests.length;
  for (const eventDate of [undefined, plusDays(-1), plusDays(800), "2026-02-30", "10/18/2026"]) {
    const r = await post(`/submit-request`, { ...base, eventDate });
    assert.equal(r.status, 400, String(eventDate));
  }
  assert.equal((await post(`/submit-request`, { ...base, eventDate: todayNy })).status, 200, "today (NY) allowed");
  assert.equal(DB.Requests.length, before + 1);
});

await t("v3 submit Appointment: items optional, preferred times required, party size 1..20", async () => {
  setG(B.id, { "Request Style": "Appointment", "Deposit Required": false });
  const base = { gemach: E_SLUG, name: "Chana Levi", phone: "5165551111", email: "chana@example.com", preferredContact: "Email" };
  assert.equal((await post(`/submit-request`, { ...base })).status, 400, "preferred times required");
  assert.equal((await post(`/submit-request`, { ...base, preferredTimes: "x".repeat(1001) })).status, 400);
  for (const partySize of [0, 21, 2.5, "abc"]) assert.equal((await post(`/submit-request`, { ...base, preferredTimes: "Sun eve", partySize })).status, 400, String(partySize));
  assert.equal((await post(`/submit-request`, { ...base, preferredTimes: "Sun eve", itemsRequested: ["recTYPEA000000001"] })).status, 400, "foreign item still validated");
  assert.equal((await post(`/submit-request`, { ...base, preferredTimes: "Sun eve", eventDate: plusDays(-3) })).status, 400, "optional event date validated");
  const r = await post(`/submit-request`, { ...base, preferredTimes: "  Sun or Mon evening ", partySize: 3, eventDate: plusDays(30), itemsRequested: [] });
  assert.equal(r.status, 200);
  const f = DB.Requests.at(-1).fields;
  assert.equal(f["Request Type"], "Appointment");
  assert.equal(f["Preferred Times"], "Sun or Mon evening");
  assert.equal(f["Party Size"], 3);
  assert.equal(f["Event Date"], plusDays(30));
  assert.ok(!("Items Requested" in f) && !("Needed From" in f) && !("Needed Until" in f));
  const mail = resendCalls().filter(x => x.to[0] !== "chana@example.com").at(-1); // the borrower also gets a receipt
  assert.match(mail.subject, /New appointment request/);
  assert.match(mail.text, /^New appointment request — R-/);
  assert.match(mail.text, /Preferred times: Sun or Mon evening/);
  assert.match(mail.text, /Party size: 3/);
  globalThis.__apptReq = DB.Requests.at(-1);
});

await t("v3 submit Dates style unchanged (Request Type Loan, client dates kept)", async () => {
  const r = await post(`/submit-request`, { gemach: A.slug, name: "D", phone: "5165551234", preferredContact: "WhatsApp", itemsRequested: ["recTYPEA000000002"], neededFrom: "2027-05-01", neededUntil: "2027-05-09" });
  assert.equal(r.status, 200);
  const f = DB.Requests.at(-1).fields;
  assert.equal(f["Request Type"], "Loan"); assert.equal(f["Needed From"], "2027-05-01"); assert.equal(f["Needed Until"], "2027-05-09");
  assert.ok(!("Deposit Acknowledged" in f));
});

const tokenB = await sign({ email: "b@example.com", name: "Bee", role: "Manager", gemachs: [{ id: B.id, slug: B.slug, name: "Other" }] });
const jsonB = { ...auth(tokenB), "Content-Type": "application/json", "X-Gemach": B.slug };

await t("v3 GET /admin/requests: requestType, eventDate, preferredTimes, partySize, depositAcknowledged, appointmentAt", async () => {
  const d = await (await call(`/admin/requests`, { headers: jsonB })).json();
  const appt = d.find(x => x.id === globalThis.__apptReq.id);
  assert.equal(appt.requestType, "Appointment"); assert.equal(appt.preferredTimes, "Sun or Mon evening");
  assert.equal(appt.partySize, 3); assert.equal(appt.depositAcknowledged, false); assert.equal(appt.appointmentAt, null);
  assert.deepEqual(appt.itemNames, []);
  const ev = d.find(x => x.eventDate && x.requestType === "Loan");
  assert.ok(ev && ev.depositAcknowledged === true);
});

await t("v3 appointment confirm: requires appointmentAt; stores UTC; no reservations; email html + .ics", async () => {
  const id = globalThis.__apptReq.id;
  setG(B.id, { "Pickup Address": "5 Elm St, Apt 2", Phone: "516-555-2222", "Theme Color": "#1B3A4B" });
  const loansBefore = DB.Loans.length;
  for (const appointmentAt of [undefined, "2026-10-12", "2026-10-12T25:00", "2026-02-30T10:00", "2026-10-12 20:00"]) {
    const r = await call(`/admin/requests/${id}/confirm`, { method: "POST", headers: jsonB, body: JSON.stringify({ appointmentAt, message: "m", sendMessage: true }) });
    assert.equal(r.status, 400, String(appointmentAt));
  }
  const at = plusDays(10) + "T20:00";
  const r = await call(`/admin/requests/${id}/confirm`, { method: "POST", headers: jsonB, body: JSON.stringify({ appointmentAt: at, message: "Hi Chana, see you then.", sendMessage: true }) });
  assert.equal(r.status, 200);
  const d = await r.json();
  const expected = new Date(X.nyLocalToUtc(plusDays(10), "20:00")).toISOString();
  assert.equal(d.appointmentAt, expected);
  assert.deepEqual(d.reservations, []);
  assert.equal(DB.Loans.length, loansBefore, "no reservations for appointments");
  const f = DB.Requests.find(x => x.id === id).fields;
  assert.equal(f.Status, "Converted"); assert.equal(f["Appointment At"], expected);
  const mail = resendCalls().at(-1);
  assert.deepEqual(mail.to, ["chana@example.com"]);
  assert.match(mail.text, /^Hi Chana, see you then\.\n\n—\nOther Gemach/);
  assert.ok(mail.html.includes("Hi Chana, see you then."));
  assert.equal(mail.attachments.length, 1);
  assert.equal(mail.attachments[0].filename, "appointment.ics");
  const ics = Buffer.from(mail.attachments[0].content, "base64").toString("utf8").replace(/\r\n /g, "");
  assert.ok(ics.includes(`DTSTART:${expected.replace(/[-:]/g, "").replace(".000", "")}`));
  assert.ok(ics.includes("SUMMARY:Other Gemach appointment"));
  assert.ok(ics.includes("LOCATION:5 Elm St\\, Apt 2"));
  assert.match(ics, /UID:R-\d+-rec\w+@whgemachs\.org/);
  await Promise.allSettled(waits);
  const log = DB["tblC3PY7f5sXQDMJK"].at(-1).fields;
  assert.equal(log["Event Type"], "Request Confirmed");
  assert.match(log.Notes, /^Appointment \w{3}, \w{3} \d{1,2} at 8:00 PM$/);
});

await t("v3 GET /admin/appointments: upcoming only, sorted, scoped", async () => {
  DB.Requests.push(
    rec("recAPPTPAST000001", { "Request ID": "R-900", Name: "Past", "Request Type": "Appointment", Status: "Converted", "Appointment At": new Date(X.nyLocalToUtc(plusDays(-1), "10:00")).toISOString(), Gemach: [B.id], "Gemach Slug": [B.slug] }),
    rec("recAPPTSOON00001", { "Request ID": "R-901", Name: "Soon", "Request Type": "Appointment", Status: "Converted", "Appointment At": new Date(X.nyLocalToUtc(plusDays(2), "10:00")).toISOString(), "Party Size": 2, Gemach: [B.id], "Gemach Slug": [B.slug] }),
    rec("recAPPTOTHER0001", { "Request ID": "R-902", Name: "OtherG", "Request Type": "Appointment", Status: "Converted", "Appointment At": new Date(X.nyLocalToUtc(plusDays(2), "11:00")).toISOString(), Gemach: [A.id], "Gemach Slug": [A.slug] }),
  );
  const d = await (await call(`/admin/appointments`, { headers: jsonB })).json();
  assert.deepEqual(d.map(x => x.name), ["Soon", "Chana Levi"]);
  assert.deepEqual(Object.keys(d[0]).sort(), ["appointmentAt", "email", "eventDate", "id", "itemNames", "manageUrl", "name", "notes", "partySize", "phone", "preferredContact", "requestId"].sort());
  assert.equal(d[0].partySize, 2);
});

await t("v3 GET /admin/gemach: appointment template (+ no-address variant), new placeholders, profile fields", async () => {
  const d = await (await call(`/admin/gemach`, { headers: jsonB })).json();
  assert.equal(d.templates.appointment, "Hi {first_name}, your appointment at the {gemach} is set for {appointment_time}. The address is {pickup_address}. {pickup_instructions} Please let us know if you need to reschedule. Thank you!\n\nManage or cancel: {manage_link}");
  assert.equal(d.rawTemplates.appointment, null);
  assert.ok(d.placeholders.includes("appointment_time") && d.placeholders.includes("deposit_info") && d.placeholders.includes("event_date"));
  assert.equal(d.requestStyle, "Appointment"); assert.equal(d.depositInfo, "$50 check");
  setG(B.id, { "Pickup Address": "" });
  const d2 = await (await call(`/admin/gemach`, { headers: jsonB })).json();
  assert.ok(!d2.templates.appointment.includes("{pickup_address}"));
});

await t("v3 PATCH validation: contacts, colors, days, bools, style, label, logoUrl prefix", async () => {
  setG(B.id, { Phone: "516-555-2222", Email: "b@example.com", WhatsApp: "", "Primary Contact": "Email", "Secondary Contact": null });
  const bad = [
    [{ primaryContact: "" }, /Primary contact is required/],
    [{ primaryContact: "Fax" }, /must be one of/],
    [{ secondaryContact: "Email" }, /different from the primary/],
    [{ primaryContact: "Call", phone: "" }, /needs a phone number/],
    [{ email: "" }, /Primary contact is “Email”, which needs an email address/],
    [{ themeColor: "red" }, /hex color/], [{ accentColor: "#12345" }, /hex color/],
    [{ pickupDaysBefore: 15 }, /0 to 14/], [{ returnDaysAfter: -1 }, /0 to 14/], [{ pickupDaysBefore: 1.5 }, /0 to 14/],
    [{ depositRequired: "yes" }, /true or false/], [{ shabbosAdjust: 1 }, /true or false/],
    [{ requestStyle: "Rental" }, /must be one of/], [{ eventLabel: "x".repeat(61) }, /max 60/],
    [{ gemachInfo: "x".repeat(2001) }, /max 2000/], [{ appointmentMessage: "x".repeat(2001) }, /max 2000/],
    [{ logoUrl: "https://evil.example/other-gemach/logo/1.png" }, /Upload logo/],
    [{ logoUrl: "https://assets/wh-medical/logo/1.png" }, /Upload logo/],
    [{ logoUrl: "https://assets/other-gemach/logo/../x.png" }, /Upload logo/],
  ];
  for (const [b, re] of bad) {
    const r = await call(`/admin/gemach`, { method: "PATCH", headers: jsonB, body: JSON.stringify(b) });
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.match((await r.json()).error, re, JSON.stringify(b));
  }
  // WhatsApp falls back to phone
  const ok = await call(`/admin/gemach`, { method: "PATCH", headers: jsonB, body: JSON.stringify({
    primaryContact: "WhatsApp", secondaryContact: "Email", themeColor: "#f5e6a8", accentColor: "", depositRequired: true, depositInfo: "Refundable $50",
    gemachInfo: "Closed Chol Hamoed", requestStyle: "Event", eventLabel: "Wedding date", pickupDaysBefore: "2", returnDaysAfter: 3, shabbosAdjust: true,
    appointmentMessage: "Custom {appointment_time}", logoUrl: "https://assets/other-gemach/logo/123.webp" }) });
  assert.equal(ok.status, 200);
  const d = await ok.json();
  assert.equal(d.primaryContact, "WhatsApp"); assert.equal(d.secondaryContact, "Email");
  assert.equal(d.themeColor, "#F5E6A8"); assert.equal(d.accentColor, null);
  assert.equal(d.depositRequired, true); assert.equal(d.requestStyle, "Event"); assert.equal(d.eventLabel, "Wedding date");
  assert.equal(d.pickupDaysBefore, 2); assert.equal(d.returnDaysAfter, 3); assert.equal(d.shabbosAdjust, true);
  assert.equal(d.templates.appointment, "Custom {appointment_time}");
  assert.equal(d.logoUrl, "https://assets/other-gemach/logo/123.webp");
  // clearing secondary + logo
  const clr = await (await call(`/admin/gemach`, { method: "PATCH", headers: jsonB, body: JSON.stringify({ secondaryContact: "", logoUrl: "" }) })).json();
  assert.equal(clr.secondaryContact, null);
  assert.equal(clr.logoUrl, "https://att/1.png", "falls back to Logo attachment");
  assert.equal(DB.Gemachs.find(r => r.id === B.id).fields["Logo URL"], null);
});

function multipart(field, bytes, type, filename = "logo.bin") {
  const fd = new FormData();
  fd.append(field, new Blob([bytes], { type }), filename);
  return fd;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

await t("v3 POST /admin/gemach/logo: type/magic/size checks, Volunteer 403, stores + sets Logo URL", async () => {
  const H = { ...auth(tokenB), "X-Gemach": B.slug };
  const up = fd => call(`/admin/gemach/logo`, { method: "POST", headers: H, body: fd });
  assert.equal((await up(multipart("logo", PNG, "image/gif"))).status, 400, "gif rejected");
  assert.equal((await up(multipart("logo", PNG, "image/webp"))).status, 400, "magic mismatch");
  assert.equal((await up(multipart("logo", new TextEncoder().encode("<svg/>"), "image/png"))).status, 400, "svg disguised");
  assert.equal((await up(multipart("photo", PNG, "image/png"))).status, 400, "wrong field");
  const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(PNG);
  assert.equal((await up(multipart("logo", big, "image/png"))).status, 413);
  const vol = await sign({ email: "v@b", name: "V", role: "Volunteer", gemachs: [{ id: B.id, slug: B.slug, name: "Other" }] });
  assert.equal((await call(`/admin/gemach/logo`, { method: "POST", headers: { ...auth(vol), "X-Gemach": B.slug }, body: multipart("logo", PNG, "image/png") })).status, 403);
  assert.equal(R2.length, 0);
  const r = await up(multipart("logo", WEBP, "image/webp"));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(R2.length, 1);
  assert.match(R2[0].key, /^other-gemach\/logo\/\d+\.webp$/);
  assert.equal(R2[0].opts.httpMetadata.contentType, "image/webp");
  assert.equal(d.logoUrl, `https://assets/${R2[0].key}`);
  assert.equal(DB.Gemachs.find(r => r.id === B.id).fields["Logo URL"], d.logoUrl);
  // the uploaded URL passes the PATCH prefix check
  assert.equal((await call(`/admin/gemach`, { method: "PATCH", headers: jsonB, body: JSON.stringify({ logoUrl: d.logoUrl }) })).status, 200);
});

await t("v3 borrower emails: HTML with theme band, logo, contrast text; text part unchanged", async () => {
  const r = await call(`/admin/requests/recREQA0000000002/decline`, { method: "POST", headers: jsonH(tokenA), body: JSON.stringify({ message: "Sorry <b>Barry</b>", sendMessage: true }) });
  assert.equal(r.status, 200);
  // R-004 has no email -> no mail; use a fresh request with email on gemach B
  DB.Requests.push(rec("recREQB0000000009", { "Request ID": "R-990", Name: "Z", Email: "z@example.com", Status: "New", "Items Requested": ["recTYPEB000000001"], Gemach: [B.id], "Gemach Slug": [B.slug] }));
  await call(`/admin/requests/recREQB0000000009/decline`, { method: "POST", headers: jsonB, body: JSON.stringify({ message: "Sorry <b>Z</b>", sendMessage: true }) });
  const mail = resendCalls().at(-1);
  assert.deepEqual(mail.to, ["z@example.com"]);
  assert.equal(mail.text, "Sorry <b>Z</b>\n\n—\nOther Gemach\n516-555-2222 · b@example.com");
  assert.ok(mail.html.includes("Sorry &lt;b&gt;Z&lt;/b&gt;"));
  assert.ok(mail.html.includes("background:#F5E6A8;color:#111111"), "light theme -> dark text");
  assert.ok(mail.html.includes(`<img src="https://assets/other-gemach/logo/`));
  assert.ok(mail.html.includes("max-width:600px"));
});

// ─── Round 4: network admin, condition, names, loan logging, categories ──────
DB.Admins.push(
  rec("recADMINNET000001", { Name: "Net Admin", Email: "Net@Example.com", Active: true, Role: "Network Admin", Gemachs: [] }),
  rec("recADMINDEMOTED01", { Name: "Demoted", Email: "demoted@example.com", Active: true, Role: "Owner", Gemachs: [A.id] }),
  rec("recADMINVOL000001", { Name: "Vol", Email: "vol@example.com", Active: true, Role: "Volunteer", Gemachs: [A.id] }),
);
DB.Gemachs.push(rec("recHIDDENGEMACH01", { Name: "Hidden Gemach", Slug: "hidden-one", Active: false, Mode: "Full", Category: "Baby", "Display Order": 90 }));
const tokNet = await sign({ email: "net@example.com", name: "Net Admin", role: "Network Admin", gemachs: [] });
const tokDemoted = await sign({ email: "demoted@example.com", name: "Demoted", role: "Network Admin", gemachs: [] }); // stale JWT, Airtable says Owner
const tokVol = await sign({ email: "vol@example.com", name: "Vol", role: "Volunteer", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }] });
const J = (t, extra = {}) => ({ ...auth(t), "Content-Type": "application/json", ...extra });
const req = (t, method, path, body) => call(path, { method, headers: J(t), body: body === undefined ? undefined : JSON.stringify(body) });

const NET_ROUTES = [
  ["GET", "/admin/network/gemachs"], ["POST", "/admin/network/gemachs", { name: "X", category: "Other", mode: "Full" }],
  ["PATCH", `/admin/network/gemachs/${A.id}`, { name: "Hacked" }],
  ["GET", "/admin/network/admins"], ["POST", "/admin/network/admins", { name: "E", email: "e@x.com", role: "Owner", gemachIds: [A.id] }],
  ["PATCH", "/admin/network/admins/recADMIN000000001", { role: "Volunteer" }],
  ["GET", "/admin/network/categories"], ["POST", "/admin/network/categories", { name: "Evil" }],
  ["PATCH", "/admin/network/categories/recCAT0000000000A", { name: "Evil" }],
];

await t("r4 network routes: Owner, Volunteer and stale-JWT (demoted) Network Admin all get 403; nothing written", async () => {
  const snap = JSON.stringify([DB.Gemachs, DB.Admins, DB["Product Categories"]]);
  for (const [tok, who] of [[tokenA, "owner"], [tokVol, "volunteer"], [tokDemoted, "demoted network admin"]]) {
    for (const [m, path, body] of NET_ROUTES) {
      const r = await req(tok, m, "/api" + path, body);
      assert.equal(r.status, 403, `${who} ${m} ${path}`);
    }
  }
  assert.equal(JSON.stringify([DB.Gemachs, DB.Admins, DB["Product Categories"]]), snap);
  assert.equal((await call("/admin/network/gemachs")).status, 401, "no token");
});

await t("r4 Network Admin: /admin/me lists ALL gemachs incl. hidden with active flag; can open a hidden gemach; public stays active-only", async () => {
  const me = await (await call("/admin/me", { headers: auth(tokNet) })).json();
  const hidden = me.gemachs.find(g => g.slug === "hidden-one");
  assert.deepEqual(hidden, { id: "recHIDDENGEMACH01", slug: "hidden-one", name: "Hidden Gemach", active: false });
  assert.ok(me.gemachs.every(g => typeof g.active === "boolean"));
  assert.equal((await call("/admin/gemach?g=hidden-one", { headers: auth(tokNet) })).status, 200);
  assert.equal((await call("/admin/gemach?g=hidden-one", { headers: auth(tokenA) })).status, 403);
  assert.equal((await call("/public/gemach/hidden-one")).status, 404);
  const dir = await (await call("/public/directory")).json();
  assert.ok(!dir.gemachs.some(g => g.slug === "hidden-one"));
  // login + session refresh also carry all gemachs for network admins
  const r = await call(`/admin/login`, { method: "POST", body: JSON.stringify({ googleToken: "abc" }) });
  assert.equal(r.status, 200); // (Barry is an Owner in the mock) — network variant covered via /admin/me
});

await t("r4 GET /admin/network/gemachs: all gemachs sorted by name with counts", async () => {
  const d = await (await req(tokNet, "GET", "/admin/network/gemachs")).json();
  assert.deepEqual(d.map(g => g.name), [...d.map(g => g.name)].sort((a, b) => a.localeCompare(b)));
  const a = d.find(g => g.id === A.id);
  assert.deepEqual(Object.keys(a).sort(), ["active", "adminCount", "category", "comingSoon", "displayOrder", "email", "id", "itemCount", "mode", "name", "phone", "slug"]);
  assert.equal(a.adminCount, 4, "Barry + v@ + Demoted + Vol are active admins of A");
  assert.ok(d.some(g => g.slug === "hidden-one" && g.active === false && g.category === "Baby"));
});

let createdG;
await t("r4 POST /admin/network/gemachs: validation, auto slug uniqueness, defaults", async () => {
  assert.equal((await req(tokNet, "POST", "/admin/network/gemachs", { name: "", category: "Other" })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/gemachs", { name: "Z", category: "Toys" })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/gemachs", { name: "Z", category: "Other", mode: "Shop" })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/gemachs", { name: "Z", category: "Other", email: "nope" })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/gemachs", { name: "Z", category: "Other", slug: "Bad Slug" })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/gemachs", { name: "Z", category: "Other", slug: "wh-medical" })).status, 409);
  const dupName = await req(tokNet, "POST", "/admin/network/gemachs", { name: "  other   GEMACH ", category: "Other" });
  assert.equal(dupName.status, 409);
  assert.equal((await dupName.json()).error, "Another gemach already uses that name.");
  const r = await req(tokNet, "POST", "/admin/network/gemachs", { name: "  Other   Gemach! ", category: "Wedding & Events", mode: "Directory", email: "og@example.com" });
  assert.equal(r.status, 201);
  createdG = await r.json();
  assert.equal(createdG.slug, "other-gemach-2", "suffix when taken");
  assert.equal(createdG.active, false);
  const f = DB.Gemachs.find(x => x.id === createdG.id).fields;
  assert.equal(f.Name, "Other Gemach!");
  assert.deepEqual(f.Community, ["recCCCCCCCCCCCCC1"], "same community as wh-medical");
  assert.equal(f["Request Style"], "Dates"); assert.equal(f["Primary Contact"], "Email"); assert.equal(f["Theme Color"], "#1B3A4B");
  assert.equal(f["Display Order"], 100, "max (90) + 10");
  assert.equal(f.Mode, "Directory"); assert.equal(f.Category, "Wedding & Events");
  const r3 = await (await req(tokNet, "POST", "/admin/network/gemachs", { name: "Other Gemach?", category: "Other", phone: "516-555-1212", email: "x@y.co" })).json();
  assert.equal(r3.slug, "other-gemach-3");
  assert.equal(DB.Gemachs.find(x => x.id === r3.id).fields["Primary Contact"], "Call");
  const r4 = await (await req(tokNet, "POST", "/admin/network/gemachs", { name: "Ohel Chésed & Co!", category: "Food" })).json();
  assert.equal(r4.slug, "ohel-chesed-and-co");
});

await t("r4 PATCH /admin/network/gemachs: slug only while inactive, unique & valid; other fields validated", async () => {
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${A.id}`, { slug: "new-wh" })).status, 400, "active gemach slug locked");
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { slug: "wh-medical" })).status, 409);
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { slug: "-bad" })).status, 400);
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { category: "Toys" })).status, 400);
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { active: "yes" })).status, 400);
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/recNOPENOPENOPE01`, { name: "x" })).status, 404);
  const r = await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { slug: "kallah-gowns", name: "Kallah Gowns", displayOrder: 5, mode: "Full" });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.slug, "kallah-gowns"); assert.equal(d.name, "Kallah Gowns"); assert.equal(d.displayOrder, 5); assert.equal(d.mode, "Full");
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { active: true })).status, 200);
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${createdG.id}`, { slug: "kallah-2" })).status, 400, "locked once active");
  assert.equal((await call("/public/gemach/kallah-gowns")).status, 200, "now public");
});

await t("r4 admins: list, create (dup 409, bad gemach 400), invite email content", async () => {
  const list = await (await req(tokNet, "GET", "/admin/network/admins")).json();
  const barry = list.find(a => a.email === "barry@example.com");
  assert.deepEqual(barry.gemachs, [{ id: A.id, slug: A.slug, name: "West Hempstead Medical Gemach" }]);
  assert.equal(barry.role, "Owner"); assert.equal(barry.active, true);
  assert.equal((await req(tokNet, "POST", "/admin/network/admins", { name: "Dup", email: "BARRY@example.com", role: "Owner", gemachIds: [A.id] })).status, 409);
  assert.equal((await req(tokNet, "POST", "/admin/network/admins", { name: "N", email: "n1@example.com", role: "Owner", gemachIds: ["recNOPENOPENOPE01"] })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/admins", { name: "N", email: "n1@example.com", role: "Boss", gemachIds: [A.id] })).status, 400);
  assert.equal((await req(tokNet, "POST", "/admin/network/admins", { name: "N", email: "n1@example.com", role: "Owner", gemachIds: [] })).status, 400, "needs a gemach");
  assert.equal((await req(tokNet, "POST", "/admin/network/admins", { name: "N", email: "bad", role: "Owner", gemachIds: [A.id] })).status, 400);
  const mailsBefore = resendCalls().length;
  const r = await req(tokNet, "POST", "/admin/network/admins", { name: "Rivka", email: "Rivka@Example.com", role: "Manager", gemachIds: [A.id, createdG.id], sendInvite: true });
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.equal(d.email, "rivka@example.com"); assert.equal(d.active, true); assert.equal(d.invited, true);
  assert.deepEqual(d.gemachs.map(g => g.slug), [A.slug, "kallah-gowns"]);
  const mail = resendCalls().at(-1);
  assert.equal(resendCalls().length, mailsBefore + 1);
  assert.deepEqual(mail.to, ["rivka@example.com"]);
  assert.ok(mail.text.includes("You've been added as an admin of West Hempstead Medical Gemach and Kallah Gowns on whgemachs.org. Sign in with this Google account at https://whgemachs.org/admin"), mail.text);
  assert.ok(mail.html.includes("You&#39;ve been added as an admin"));
  const r2 = await req(tokNet, "POST", "/admin/network/admins", { name: "Quiet", email: "quiet@example.com", role: "Volunteer", gemachIds: [A.id] });
  assert.equal(r2.status, 201);
  assert.equal(resendCalls().length, mailsBefore + 1, "no invite unless asked");
});

await t("r4 admins PATCH: self-demotion/deactivation blocked; others editable", async () => {
  assert.equal((await req(tokNet, "PATCH", "/admin/network/admins/recADMINNET000001", { role: "Owner", gemachIds: [A.id] })).status, 400);
  assert.equal((await req(tokNet, "PATCH", "/admin/network/admins/recADMINNET000001", { active: false })).status, 400);
  assert.equal((await req(tokNet, "PATCH", "/admin/network/admins/recADMINNET000001", { name: "Net A." })).status, 200, "self rename ok");
  const r = await req(tokNet, "PATCH", "/admin/network/admins/recADMINVOL000001", { role: "Manager", gemachIds: [A.id, B.id], active: false });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.role, "Manager"); assert.equal(d.active, false); assert.equal(d.gemachs.length, 2);
  assert.equal((await req(tokNet, "PATCH", "/admin/network/admins/recADMINVOL000001", { gemachIds: [] })).status, 400, "non-network needs a gemach");
  // deactivated volunteer loses access at next session check
  const stale = await sign({ email: "vol@example.com", name: "Vol", role: "Volunteer", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }], iat: Date.now() - 13 * 3600000 });
  assert.equal((await call(`/admin/dashboard`, { headers: auth(stale) })).status, 401);
});

await t("r4 categories: list/create/patch with validation and cache purge", async () => {
  const deleted = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async rq => { deleted.push(rq.url); return true; } } };
  try {
    const list = await (await req(tokNet, "GET", "/admin/network/categories")).json();
    assert.ok(list.some(c => c.name === "Hidden" && c.active === false), "includes inactive");
    assert.equal((await req(tokNet, "POST", "/admin/network/categories", { name: "" })).status, 400);
    assert.equal((await req(tokNet, "POST", "/admin/network/categories", { name: "wheelchairs" })).status, 409, "case-insensitive dup");
    assert.equal((await req(tokNet, "POST", "/admin/network/categories", { name: "Cribs", icon: "not an emoji at all" })).status, 400);
    assert.equal((await req(tokNet, "POST", "/admin/network/categories", { name: "Cribs", displayOrder: "abc" })).status, 400);
    const r = await req(tokNet, "POST", "/admin/network/categories", { name: " Cribs ", icon: "🛏️", keywords: "crib, bassinet,, pack n play", displayOrder: 30 });
    assert.equal(r.status, 201);
    const cat = await r.json();
    assert.deepEqual({ name: cat.name, icon: cat.icon, keywords: cat.keywords, displayOrder: cat.displayOrder, active: cat.active },
      { name: "Cribs", icon: "🛏️", keywords: ["crib", "bassinet", "pack n play"], displayOrder: 30, active: true });
    await Promise.allSettled(waits);
    assert.ok(deleted.some(u => u.endsWith("/directory")) && deleted.some(u => u.endsWith("/gemach/wh-medical")));
    const p = await (await req(tokNet, "PATCH", `/admin/network/categories/${cat.id}`, { active: false, keywords: ["cot"] })).json();
    assert.equal(p.active, false); assert.deepEqual(p.keywords, ["cot"]);
    assert.equal((await req(tokNet, "PATCH", `/admin/network/categories/${cat.id}`, { name: "Walkers" })).status, 409);
    assert.equal((await req(tokNet, "PATCH", `/admin/network/categories/recCAT0000000000A`, { name: "Wheelchairs" })).status, 200, "same name on self ok");
    globalThis.__catCribs = cat.id;
  } finally { delete globalThis.caches; }
});

await t("r4 item types: categoryId in GET, validated on POST/PATCH ('' clears, inactive/unknown 400), cross-gemach 404", async () => {
  const H = J(tokenA, { "X-Gemach": A.slug });
  const types = await (await call("/admin/catalog/item-types", { headers: H })).json();
  assert.equal(types.find(x => x.id === "recTYPEA000000001").categoryId, "recCAT0000000000A");
  assert.equal(types.find(x => x.id === "recTYPEA000000002").categoryId, null);
  const cats = await (await call("/admin/catalog/categories", { headers: H })).json();
  assert.deepEqual(cats.map(c => c.name), ["Wheelchairs", "Walkers", "Zebra"], "active only, sorted (Cribs deactivated)");
  const patch = (id, b, h = H) => call(`/admin/catalog/item-types/${id}`, { method: "PATCH", headers: h, body: JSON.stringify(b) });
  assert.equal((await patch("recTYPEA000000002", { categoryId: "recCAT0000000000D" })).status, 400, "inactive");
  assert.equal((await patch("recTYPEA000000002", { categoryId: globalThis.__catCribs })).status, 400, "deactivated");
  assert.equal((await patch("recTYPEA000000002", { categoryId: "recNOPENOPENOPE01" })).status, 400, "unknown");
  assert.equal((await patch("recTYPEA000000002", { categoryId: "junk" })).status, 400);
  assert.equal((await patch("recTYPEA000000002", { categoryId: "recCAT0000000000B" })).status, 200);
  assert.deepEqual(DB["Item Types"].find(x => x.id === "recTYPEA000000002").fields["Product Category"], ["recCAT0000000000B"]);
  assert.equal((await patch("recTYPEA000000001", { categoryId: "" })).status, 200);
  assert.deepEqual(DB["Item Types"].find(x => x.id === "recTYPEA000000001").fields["Product Category"], []);
  assert.equal((await patch("recTYPEB000000001", { categoryId: "recCAT0000000000A" })).status, 404, "other gemach's type");
  assert.equal(DB["Item Types"].find(x => x.id === "recTYPEB000000001").fields["Product Category"], undefined);
  const c1 = await call("/admin/catalog/item-types", { method: "POST", headers: H, body: JSON.stringify({ name: "Rollator", categoryId: "recCAT0000000000D" }) });
  assert.equal(c1.status, 400);
  const c2 = await call("/admin/catalog/item-types", { method: "POST", headers: H, body: JSON.stringify({ name: "Rollator", categoryId: "recCAT0000000000B" }) });
  assert.equal(c2.status, 200);
  assert.deepEqual((await c2.json()).fields["Product Category"], ["recCAT0000000000B"]);
});

await t("r4 item condition validated on create/update", async () => {
  const H = J(tokenA, { "X-Gemach": A.slug });
  assert.equal((await call("/admin/catalog/items/recITEMA000000001", { method: "PATCH", headers: H, body: JSON.stringify({ condition: "Fair" }) })).status, 400);
  assert.equal((await call("/admin/catalog/items/recITEMA000000001", { method: "PATCH", headers: H, body: JSON.stringify({ condition: "" }) })).status, 400);
  assert.equal((await call("/admin/catalog/items/recITEMA000000001", { method: "PATCH", headers: H, body: JSON.stringify({ condition: "Needs Repair" }) })).status, 200);
  assert.equal(DB.Items.find(x => x.id === "recITEMA000000001").fields.Condition, "Needs Repair");
  assert.equal((await call("/admin/catalog/items", { method: "POST", headers: H, body: JSON.stringify({ itemTypeId: "recTYPEA000000001", condition: "Out of Service" }) })).status, 400);
  const ok = await call("/admin/catalog/items", { method: "POST", headers: H, body: JSON.stringify({ itemTypeId: "recTYPEA000000001", condition: "Needs Repair" }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).fields.Condition, "Needs Repair");
});

await t("r4 gemach name editable via PATCH /admin/gemach (1..100, trimmed); slug unchanged", async () => {
  const H = J(tokenA, { "X-Gemach": A.slug });
  const p = b => call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify(b) });
  assert.equal((await p({ name: "   " })).status, 400);
  assert.equal((await p({ name: "x".repeat(101) })).status, 400);
  const d = await (await p({ name: "  West Hempstead   Medical Gemach  " })).json();
  assert.equal(d.name, "West Hempstead Medical Gemach"); assert.equal(d.slug, A.slug);
  assert.equal((await p({ name: 5 })).status, 400);
});

await t("r4 history from loan record: cancel (empty body), return, pickup log borrower/itemType/itemCode/loanId", async () => {
  DB.Borrowers.push(rec("recBORROWER000001", { Name: "Leah Stern", Gemach: [A.id], "Gemach Slug": [A.slug] }));
  DB.Loans.push(
    rec("recLOANRES0000001", { "Loan ID": "L-501", Status: "Reserved", Borrower: ["recBORROWER000001"], "Item to Reserve": ["recTYPEA000000003"], Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recLOANACT0000001", { "Loan ID": "L-502", Status: "Active", Borrower: ["recBORROWER000001"], Item: ["recITEMA000000002"], Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recLOANRES0000002", { "Loan ID": "L-503", Status: "Reserved", Borrower: ["recBORROWER000001"], "Item to Reserve": ["recTYPEA000000001"], Gemach: [A.id], "Gemach Slug": [A.slug] }),
  );
  const H = J(tokenA, { "X-Gemach": A.slug });
  const logs = DB["tblC3PY7f5sXQDMJK"];
  const lastLog = async type => { await Promise.allSettled(waits); return [...logs].reverse().find(l => l.fields["Event Type"] === type).fields; };
  assert.equal((await call("/admin/reservations/recLOANRES0000001/cancel", { method: "POST", headers: H })).status, 200);
  let l = await lastLog("Reservation Cancelled");
  assert.equal(l.Borrower, "Leah Stern"); assert.equal(l["Item Type"], "Shower Chair"); assert.equal(l["Loan ID"], "L-501");
  assert.equal(l.Admin, "Bárry ✡");
  await call("/admin/loans/recLOANACT0000001/return", { method: "POST", headers: H, body: JSON.stringify({ borrower: "SPOOF", loanId: "L-999" }) });
  l = await lastLog("Item Returned");
  assert.equal(l.Borrower, "Leah Stern", "record wins over body"); assert.equal(l["Loan ID"], "L-502");
  assert.equal(l["Item Code"], "WC-002"); assert.equal(l["Item Type"], "Wheelchair");
  await call("/admin/loans/recLOANRES0000002/pickup", { method: "POST", headers: H, body: JSON.stringify({ itemId: "recITEMA000000001" }) });
  l = await lastLog("Loan Created");
  assert.equal(l.Borrower, "Leah Stern"); assert.equal(l["Item Code"], "WC-001"); assert.equal(l["Item Type"], "Wheelchair"); assert.equal(l["Loan ID"], "L-503");
  // cross-gemach loan still 404
  const tB = await sign({ email: "b@example.com", name: "Bee", role: "Manager", gemachs: [{ id: B.id, slug: B.slug, name: "Other" }] });
  assert.equal((await call("/admin/reservations/recLOANRES0000001/cancel", { method: "POST", headers: J(tB, { "X-Gemach": B.slug }) })).status, 404);
});

// ─── Round 5: live NA check, unique names, legacy inventory when inactive, id-based gemach match ──
await t("r5 stale Network Admin JWT: after downgrade cannot reach another gemach; after deactivation 401", async () => {
  DB.Admins.push(
    rec("recADMINNADOWN001", { Name: "Down", Email: "down@example.com", Active: true, Role: "Network Admin", Gemachs: [] }),
    rec("recADMINNAOFF0001", { Name: "Off", Email: "off@example.com", Active: true, Role: "Network Admin", Gemachs: [] }),
  );
  X.clearMemo();
  const tDown = await sign({ email: "down@example.com", name: "Down", role: "Network Admin", gemachs: [] });
  const tOff = await sign({ email: "off@example.com", name: "Off", role: "Network Admin", gemachs: [] });
  assert.equal((await call(`/admin/dashboard?g=${B.slug}`, { headers: auth(tDown) })).status, 200, "live NA ok");
  assert.equal((await call(`/admin/dashboard?g=${B.slug}`, { headers: auth(tOff) })).status, 200, "live NA ok");
  Object.assign(DB.Admins.find(r => r.id === "recADMINNADOWN001").fields, { Role: "Owner", Gemachs: [A.id] });
  DB.Admins.find(r => r.id === "recADMINNAOFF0001").fields.Active = false;
  X.clearMemo(); // simulate the 60s memo expiring
  const r1 = await call(`/admin/dashboard?g=${B.slug}`, { headers: auth(tDown) });
  assert.notEqual(r1.status, 200); assert.equal(r1.status, 401);
  assert.equal((await call(`/admin/gemach?g=${A.slug}`, { headers: auth(tDown) })).status, 401);
  assert.equal((await call(`/admin/dashboard?g=${B.slug}`, { headers: auth(tOff) })).status, 401);
  // /admin/me returns the live role/gemachs + a fresh token for the downgraded admin; deactivated -> 401
  const me = await call(`/admin/me`, { headers: auth(tDown) });
  const md = await me.json();
  assert.equal(md.role, "Owner"); assert.deepEqual(md.gemachs.map(g => g.slug), [A.slug]);
  const fresh = me.headers.get("X-Session-Token");
  assert.ok(fresh);
  assert.equal((await call(`/admin/dashboard?g=${A.slug}`, { headers: auth(fresh) })).status, 200);
  assert.equal((await call(`/admin/dashboard?g=${B.slug}`, { headers: auth(fresh) })).status, 403);
  assert.equal((await call(`/admin/me`, { headers: auth(tOff) })).status, 401);
});

await t("r5 /admin/me picks up a promotion to Network Admin without re-login (fresh token)", async () => {
  DB.Admins.push(rec("recADMINPROMO0001", { Name: "Promo", Email: "promo@example.com", Active: true, Role: "Manager", Gemachs: [A.id] }));
  const tP = await sign({ email: "promo@example.com", name: "Promo", role: "Manager", gemachs: [{ id: A.id, slug: A.slug, name: "West Hempstead Medical Gemach", active: true }] });
  assert.equal((await req(tP, "GET", "/admin/network/gemachs")).status, 403);
  DB.Admins.at(-1).fields.Role = "Network Admin";
  const me = await call(`/admin/me`, { headers: auth(tP) });
  assert.equal((await me.json()).role, "Network Admin");
  const fresh = me.headers.get("X-Session-Token");
  assert.ok(fresh);
  assert.equal((await req(fresh, "GET", "/admin/network/gemachs")).status, 200);
  DB.Admins.at(-1).fields.Active = false;
});

await t("r5 gemach names unique (case/space-insensitive): PATCH /admin/gemach and network PATCH -> 409; own name ok", async () => {
  const tA = await sign({ email: "barry@example.com", name: "Bárry ✡", role: "Owner", gemachs: [{ id: A.id, slug: A.slug, name: "WH" }] });
  const other = DB.Gemachs.find(r => r.id === B.id).fields.Name;
  const r = await call("/admin/gemach", { method: "PATCH", headers: J(tA, { "X-Gemach": A.slug }), body: JSON.stringify({ name: "  " + other.toUpperCase() + " " }) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "Another gemach already uses that name.");
  const own = DB.Gemachs.find(x => x.id === A.id).fields.Name;
  assert.equal((await call("/admin/gemach", { method: "PATCH", headers: J(tA, { "X-Gemach": A.slug }), body: JSON.stringify({ name: own.toLowerCase() }) })).status, 200, "case change of own name ok");
  DB.Gemachs.find(x => x.id === A.id).fields.Name = own; X.clearMemo();
  const n = await req(tokNet, "PATCH", `/admin/network/gemachs/${B.id}`, { name: own });
  assert.equal(n.status, 409);
  assert.equal(DB.Gemachs.find(x => x.id === B.id).fields.Name, other);
  assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${B.id}`, { name: other })).status, 200, "own name ok");
});

await t("r5 slug rename: admin whose JWT has the old slug can use the new slug (matched by id)", async () => {
  const tB2 = await sign({ email: "b2@example.com", name: "B2", role: "Manager", gemachs: [{ id: B.id, slug: "old-b-slug", name: "Other" }] });
  const r = await call("/admin/dashboard", { headers: J(tB2, { "X-Gemach": B.slug }) });
  assert.equal(r.status, 200);
  assert.equal((await call("/admin/dashboard", { headers: J(tB2, { "X-Gemach": "old-b-slug" }) })).status, 403, "old slug no longer resolves");
  assert.equal((await call("/admin/dashboard", { headers: J(tB2, { "X-Gemach": A.slug }) })).status, 403, "other gemach still forbidden");
});

await t("r5 legacy /inventory returns [] when wh-medical is inactive", async () => {
  const f = DB.Gemachs.find(x => x.id === A.id).fields;
  f.Active = false; X.clearMemo();
  const r = await call("/inventory");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);
  f.Active = true; X.clearMemo();
  assert.ok((await (await call("/inventory")).json()).length > 0);
});

// ─── round 5: submit-request validation ─────────────────────────────────────
{
  const base = { gemach: A.slug, name: "Rivka", phone: "516-555-1234", preferredContact: "WhatsApp", itemsRequested: ["recTYPEA000000002"], neededFrom: plusDays(2) };
  const err = async (body, re, label) => {
    const before = DB.Requests.length;
    const r = await post(`/submit-request`, body);
    assert.equal(r.status, 400, label);
    const e = (await r.json()).error;
    if (re) assert.match(e, re, label);
    assert.equal(DB.Requests.length, before, label + ": nothing written");
  };
  await t("r5 submit: preferredContact required and one of WhatsApp/Phone/SMS/Email (never '' to Airtable)", async () => {
    for (const pc of [undefined, "", "  ", "Facebook", "Text", "whatsapp", 5]) await err({ ...base, preferredContact: pc }, /^Please choose the best way to reach you\.$/, `pc=${JSON.stringify(pc)}`);
    for (const pc of ["WhatsApp", "Phone", "SMS"]) {
      const r = await post(`/submit-request`, { ...base, preferredContact: pc });
      assert.equal(r.status, 200, pc);
      assert.equal(DB.Requests.at(-1).fields["Preferred Contact"], pc);
    }
  });
  await t("r5 submit: Email preference requires a (valid) email", async () => {
    await err({ ...base, preferredContact: "Email" }, /email/i, "missing email");
    await err({ ...base, preferredContact: "Email", email: "   " }, /email/i, "blank email");
    await err({ ...base, preferredContact: "Email", email: "not-an-email" }, /valid email/i, "bad email");
    await err({ ...base, email: "nope@" }, /valid email/i, "bad optional email");
    const r = await post(`/submit-request`, { ...base, preferredContact: "Email", email: " r@example.com " });
    assert.equal(r.status, 200);
    const f = DB.Requests.at(-1).fields;
    assert.equal(f["Preferred Contact"], "Email"); assert.equal(f.Email, "r@example.com");
  });
  await t("r5 submit Dates: neededFrom required, >= today (NY), <= 2y; return strictly after; open-ended ignores return", async () => {
    await err({ ...base, neededFrom: undefined }, /^Please choose the date you need it from\.$/, "missing from");
    await err({ ...base, neededFrom: "" }, /^Please choose the date you need it from\.$/, "empty from");
    await err({ ...base, neededFrom: "2027-02-30" }, null, "impossible date");
    await err({ ...base, neededFrom: "10/18/2026" }, null, "bad format");
    await err({ ...base, neededFrom: plusDays(-1) }, /past/, "yesterday");
    await err({ ...base, neededFrom: plusDays(800) }, /2 years/, ">2y");
    await err({ ...base, neededUntil: base.neededFrom }, /^The approximate return date must be after the date you need it from\.$/, "same day");
    await err({ ...base, neededUntil: plusDays(1) }, /must be after/, "before from");
    await err({ ...base, neededUntil: "garbage" }, null, "bad until");
    let r = await post(`/submit-request`, { ...base, neededFrom: todayNy, neededUntil: "" });
    assert.equal(r.status, 200, "today allowed, return optional");
    let f = DB.Requests.at(-1).fields;
    assert.equal(f["Needed From"], todayNy); assert.ok(!("Needed Until" in f)); assert.equal(f["Open-ended duration"], false);
    r = await post(`/submit-request`, { ...base, neededUntil: plusDays(9) });
    assert.equal(r.status, 200);
    assert.equal(DB.Requests.at(-1).fields["Needed Until"], plusDays(9));
    r = await post(`/submit-request`, { ...base, openEnded: true, neededUntil: plusDays(-5) });
    assert.equal(r.status, 200, "open-ended ignores neededUntil");
    f = DB.Requests.at(-1).fields;
    assert.equal(f["Open-ended duration"], true); assert.ok(!("Needed Until" in f));
  });
  await t("r5 submit: phone formatting and minimum digits; no empty strings written to typed fields", async () => {
    const cases = [["5165551234", "(516) 555-1234"], [" 516.555.1234 ", "(516) 555-1234"], ["1-516-555-1234", "(516) 555-1234"],
                   ["+1 (516) 555 1234", "(516) 555-1234"], ["+44 20 7946 0958", "+44 20 7946 0958"], ["555-1234", "555-1234"], [" 011 972 2 555 1234 ", "011 972 2 555 1234"]];
    for (const [inp, want] of cases) {
      const r = await post(`/submit-request`, { ...base, phone: inp });
      assert.equal(r.status, 200, inp);
      assert.equal(DB.Requests.at(-1).fields.Phone, want, inp);
    }
    await err({ ...base, phone: "123-45" }, /phone/i, "6 digits");
    await err({ ...base, phone: "call me" }, /phone/i, "no digits");
    await err({ ...base, phone: "   " }, /required/i, "blank");
    await err({ ...base, name: { x: 1 } }, null, "object name");
    const r = await post(`/submit-request`, { ...base, email: "", notes: "", neededUntil: "" });
    assert.equal(r.status, 200);
    const f = DB.Requests.at(-1).fields;
    for (const [k, v] of Object.entries(f)) assert.notEqual(v, "", `field ${k} written as ""`);
    const mail = resendCalls().at(-1);
    assert.match(mail.text, /\(516\) 555-1234/, "notification shows formatted phone");
  });
}

// ── Health + alerts ──
{
  const alerts = () => resendCalls().filter(m => m.to[0] === "alerts@example.com");
  const settle = async () => { await Promise.allSettled(waits); };
  await t("alerts: GET /health 200 when Airtable answers, 503 (no alert) when it doesn't", async () => {
    let r = await call("/health");
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.ok, true); assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
    const n = alerts().length;
    airtableFail = () => true;
    r = await call("/health"); airtableFail = null;
    assert.equal(r.status, 503); assert.equal((await r.json()).ok, false);
    await settle(); assert.equal(alerts().length, n, "health failures are for the uptime monitor, not alert emails");
  });
  await t("health: ?probe=1 times several kinds of Airtable call, at most once per 20 s", async () => {
    const before = calls.length;
    let j = await (await call("/health?probe=1")).json();
    assert.equal(j.probe, true);
    for (const k of ["whoami", "listPost", "listGet", "getOne", "smallTable", "whoamiAgain"]) assert.equal(typeof j.steps[k].ms, "number", k);
    assert.equal(j.steps.getOne.status, 200);
    assert.ok(calls.slice(before).some(c => c.url.endsWith("/meta/whoami")));
    j = await (await call("/health?probe=1")).json();
    assert.equal(j.probe, undefined, "second probe within 20 s falls back to the plain health check");
    assert.equal(j.ok, true);
  });
  await t("airtable: a read that stalls is sent again and the first answer wins; writes are never resent", async () => {
    const fast = { ...env, AIRTABLE_HEDGE_MS: "40" };
    const go = (path, init = {}) => worker.fetch(new Request("https://wh-gemach.example.workers.dev" + path, init), fast, ctx);
    stallOnce = (m, table, id) => table === "Gemachs" && id === "listRecords" ? 3000 : 0;
    let before = calls.length, t0 = Date.now();
    const r = await go("/health");
    const j = await r.json();
    assert.ok(Date.now() - t0 < 1500, "answered by the second copy, not after the stall");
    assert.equal(j.ok, true); assert.equal(j.resent, 1);
    assert.equal(calls.slice(before).filter(c => c.url.includes("/Gemachs/listRecords")).length, 2);
    assert.match(r.headers.get("Server-Timing"), /1 resent \(1 faster\)/);
    // A write that is slow is waited for, never duplicated.
    const loan = DB.Loans[0];
    stallOnce = (m, table, id) => m === "PATCH" ? 150 : 0;
    before = calls.length;
    const { makeDbForTest } = globalThis.__WHG_TEST__;
    const db = makeDbForTest(fast);
    await db.update("Loans", loan.id, {});
    assert.equal(calls.slice(before).filter(c => c.method === "PATCH").length, 1);
    assert.equal(db.stats.hedges, 0);
    stallOnce = null;
  });
  const base = { gemach: A.slug, name: "Failing Person", phone: "516-555-9999", email: "fp@example.com", preferredContact: "Phone", itemsRequested: ["recTYPEA000000002"], neededFrom: SOON, notes: "please call" };
  await t("alerts: failed request save emails the person's details (every time, not throttled)", async () => {
    const n = alerts().length;
    airtableFail = (m, table, id) => m === "POST" && table === "Requests" && !id;
    let r = await post("/submit-request", base);
    assert.equal(r.status, 500);
    r = await post("/submit-request", { ...base, name: "Second Person" });
    airtableFail = null; await settle();
    const got = alerts().slice(n);
    assert.equal(got.length, 2);
    assert.match(got[0].subject, /FAILED to save/);
    assert.match(got[0].text, /Failing Person/); assert.match(got[0].text, /516-555-9999/); assert.match(got[0].text, /fp@example\.com/); assert.match(got[0].text, /please call/);
    assert.match(got[1].text, /Second Person/);
    assert.ok(!("html" in got[0]), "plain text");
  });
  await t("alerts: request saved but gemach notification failed -> alert; success -> none", async () => {
    let n = alerts().length;
    let r = await post("/submit-request", base); assert.equal(r.status, 200); await settle();
    assert.equal(alerts().length, n);
    resendFail = true;
    r = await post("/submit-request", base); resendFail = false; assert.equal(r.status, 200, "borrower still sees success"); await settle();
    const a = alerts().slice(n);
    assert.equal(a.length, 1); assert.match(a[0].subject, /NOT notified/); assert.match(a[0].text, /failed to send/);
    assert.ok(!/Failing Person/.test(a[0].text), "no personal details needed here");
  });
  await t("alerts: borrower confirmation email failure -> emailSent:false + alert", async () => {
    DB.Requests.push(rec("recREQALERT000001", { "Request ID": "R-900", Name: "Mail Fail", Email: "mf@example.com", Status: "New", "Items Requested": ["recTYPEA000000002"], "Needed From": SOON, Gemach: [A.id], "Gemach Slug": [A.slug] }));
    const n = alerts().length;
    resendFail = true;
    const r = await call("/admin/requests/recREQALERT000001/decline", { method: "POST", headers: { ...auth(tokenA), "X-Gemach": A.slug, "Content-Type": "application/json" }, body: JSON.stringify({ message: "Sorry", sendMessage: true }) });
    resendFail = false; await settle();
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.emailSent, false);
    const a = alerts().slice(n); assert.equal(a.length, 1); assert.match(a[0].subject, /decline email for R-900/);
  });
  await t("alerts: generic 5xx alerts once per route per 10 minutes", async () => {
    const n = alerts().length;
    airtableFail = (m, table) => table === "Product Categories";
    for (let i = 0; i < 3; i++) { const r = await call("/public/directory?x=" + i); }
    airtableFail = null; await settle();
    const a = alerts().slice(n);
    assert.equal(a.length, 1, "exactly one (throttled)"); assert.match(a[0].subject, /Server error: GET \/public\/directory/);
  });
}

// ── Search log + stats ──
{
  const SL = DB["tblpy91cyNSkKx1NL"];
  const settle = async () => { await Promise.allSettled(waits); };
  const logSearch = body => call("/public/search-log", { method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://whgemachs.org" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  await t("search log: normalizes, creates then counts, dedupes retyping, 204 always", async () => {
    let r = await logSearch({ q: "  Hospital   BED!! ", outcome: "none", category: "Bedroom" });
    assert.equal(r.status, 204); assert.ok(["*", "https://whgemachs.org"].includes(r.headers.get("Access-Control-Allow-Origin")));
    await settle();
    assert.equal(SL.length, 1); assert.equal(SL[0].fields.Query, "hospital bed"); assert.equal(SL[0].fields.Count, 1);
    assert.equal(SL[0].fields["Last Outcome"], "Nothing found"); assert.equal(SL[0].fields.Category, "Bedroom");
    assert.equal(SL[0].fields["Nothing Found Count"], 1); assert.equal(SL[0].fields["All On Loan Count"], 0);
    await logSearch({ q: "hospital bed", outcome: "none" }); await settle();
    assert.equal(SL[0].fields.Count, 1, "same search within 10 min not double-counted");
    await logSearch({ q: "Hospital bed", outcome: "all-on-loan" }); await settle();
    assert.equal(SL.length, 1); assert.equal(SL[0].fields.Count, 2); assert.equal(SL[0].fields["All On Loan Count"], 1);
    assert.equal(SL[0].fields["Last Outcome"], "All on loan"); assert.equal(SL[0].fields.Category, null);
  });
  await t("search log: never stores personal info or junk", async () => {
    const n = SL.length;
    for (const q of ["me@example.com", "516-555-1234", "call 5165551234", "ab", "x".repeat(61), "https://evil.example", "www.site.com"]) {
      assert.equal((await logSearch({ q, outcome: "none" })).status, 204, q);
    }
    for (const b of ["not json", "null", JSON.stringify({ q: "stroller", outcome: "found" }), JSON.stringify({ q: ["stroller"], outcome: "none" })]) {
      assert.equal((await logSearch(b)).status, 204);
    }
    await settle();
    assert.equal(SL.length, n);
    await logSearch({ q: "size 10 gown", outcome: "none" }); await settle();
    assert.equal(SL.length, n + 1, "a couple of digits is fine");
  });
  await t("network searches: Network Admin only; rows with counts", async () => {
    assert.equal((await call("/admin/network/searches", { headers: auth(tokenA) })).status, 403);
    const r = await call("/admin/network/searches?days=30", { headers: auth(tokNet) });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.days, 30);
    const hb = d.searches.find(x => x.query === "hospital bed");
    assert.ok(hb); assert.equal(hb.count, 2); assert.equal(hb.nothingFound, 1); assert.equal(hb.allOnLoan, 1);
  });
  await t("stats: request outcomes, reply time, waiting >48h, most requested, loan length, never lent", async () => {
    const G = { id: "recSTATSGEMACH001", slug: "stats-gemach" };
    DB.Gemachs.push(rec(G.id, { Name: "Stats Gemach", Slug: G.slug, Active: true, Email: "s@example.com" }));
    const sc = { Gemach: [G.id], "Gemach Slug": [G.slug] };
    const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
    DB["Item Types"].push(rec("recSTYPE000000001", { Name: "Crib", Active: true, ...sc }), rec("recSTYPE000000002", { Name: "Stroller", Active: true, ...sc }));
    const oldItem = (id, type, status, statuses) => ({ ...rec(id, { "Item Type": [type], Active: true, Status: status, "Loan Statuses": statuses, ...sc }), createdTime: hoursAgo(24 * 100) });
    DB.Items.push(oldItem("recSITEM000000001", "recSTYPE000000001", "On Loan", ["Active"]), oldItem("recSITEM000000002", "recSTYPE000000001", "On Loan", ["Returned", "Active"]),
                  oldItem("recSITEM000000003", "recSTYPE000000002", "Available", []), oldItem("recSITEM000000004", "recSTYPE000000002", "Available", ["Cancelled"]));
    DB.Requests.push(
      rec("recSREQ0000000001", { "Request ID": "S-1", Status: "Converted", "Received At": hoursAgo(50), "Items Requested": ["recSTYPE000000001"], ...sc }),
      rec("recSREQ0000000002", { "Request ID": "S-2", Status: "Declined", "Received At": hoursAgo(30), "Items Requested": ["recSTYPE000000001", "recSTYPE000000002"], ...sc }),
      rec("recSREQ0000000003", { "Request ID": "S-3", Status: "New", Name: "Old Waiter", "Received At": hoursAgo(60), "Items Requested": ["recSTYPE000000001"], ...sc }),
      rec("recSREQ0000000004", { "Request ID": "S-4", Status: "New", Name: "Fresh", "Received At": hoursAgo(2), ...sc }));
    DB["tblC3PY7f5sXQDMJK"].push(
      rec("recSLOG0000000001", { "Event Type": "Request Confirmed", "Loan ID": "S-1", Timestamp: hoursAgo(46), ...sc }),   // 4h
      rec("recSLOG0000000002", { "Event Type": "Request Declined", "Loan ID": "S-2", Timestamp: hoursAgo(0), ...sc }),     // 30h
      rec("recSLOG0000000003", { "Event Type": "Item Returned", "Loan ID": "S-1", Timestamp: hoursAgo(1), ...sc }));
    const d0 = new Date(); const iso = n => new Date(d0.getTime() - n * 86400e3).toISOString().slice(0, 10);
    DB.Loans.push(
      rec("recSLOAN000000001", { Status: "Returned", "Date Borrowed": iso(20), "Date Returned": iso(10), Item: ["recSITEM000000002"], "Item Type (from Item)": ["recSTYPE000000001"], ...sc }),
      rec("recSLOAN000000002", { Status: "Returned", "Date Borrowed": iso(8), "Date Returned": iso(4), Item: ["recSITEM000000002"], "Item Type (from Item)": ["recSTYPE000000001"], ...sc }),
      rec("recSLOAN000000003", { Status: "Active", "Date Borrowed": iso(3), Item: ["recSITEM000000001"], ...sc }));
    const r = await call("/admin/stats?days=90&g=" + G.slug, { headers: auth(tokNet) });
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.equal(s.days, 90);
    assert.deepEqual(s.requests, { received: 4, confirmed: 1, declined: 1, waiting: 2 });
    assert.equal(s.response.answered, 2); assert.equal(s.response.medianHours, 17); assert.equal(s.response.within24hPct, 50);
    assert.equal(s.waitingOver48h.count, 1); assert.equal(s.waitingOver48h.oldest[0].name, "Old Waiter");
    assert.deepEqual(s.topRequested[0], { name: "Crib", requests: 3, units: 2, available: 0 });
    assert.deepEqual(s.topRequested[1], { name: "Stroller", requests: 1, units: 2, available: 2 });
    assert.deepEqual(s.loanLength, [{ name: "Crib", loans: 2, medianDays: 7 }]);
    assert.equal(s.loansReturned, 2);
    assert.equal(s.neverLent.count, 2); assert.deepEqual(s.neverLent.types, [{ name: "Stroller", count: 2, units: 2 }]);
    // other gemachs' data never leaks in; an unsupported period falls back to 90
    const s2 = await (await call("/admin/stats?days=7", { headers: { ...auth(tokenA), "X-Gemach": A.slug } })).json();
    assert.equal(s2.days, 90);
    assert.ok(!s2.topRequested.some(x => x.name === "Crib" || x.name === "Stroller"));
    assert.ok(!(s2.waitingOver48h.oldest || []).some(x => x.name === "Old Waiter"));
  });
}

// ── Public cache resilience (fake Cache API) ──
{
  const store = new Map();
  globalThis.caches = { default: {
    match: async req => { const r = store.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, res) => { store.set(req.url, res.clone()); },
    delete: async req => store.delete(req.url),
  } };
  const settle = async () => { await Promise.allSettled(waits); };
  const dirKey = "https://whgemachs.org/__cache/v1/directory";
  const setAge = (key, ms) => { const r = store.get(key); const h = new Headers(r.headers); h.set("X-Cached-At", String(Date.now() - ms)); return r.text().then(b => store.set(key, new Response(b, { headers: h }))); };
  await t("cache: miss builds and stores; hit served; rebuild kept alive with waitUntil", async () => {
    const before = waits.length;
    let r = await call("/public/directory");
    assert.equal(r.status, 200); assert.equal(r.headers.get("X-Cache"), "MISS");
    assert.ok(waits.length > before, "miss rebuild registered with waitUntil");
    await settle();
    assert.ok(store.has(dirKey));
    r = await call("/public/directory"); assert.equal(r.headers.get("X-Cache"), "HIT");
  });
  await t("cache: stale (2h) served instantly with background refresh; >24h + Airtable down serves old copy", async () => {
    await setAge(dirKey, 2 * 3600e3);
    let r = await call("/public/directory"); assert.equal(r.headers.get("X-Cache"), "STALE"); await settle();
    r = await call("/public/directory"); assert.equal(r.headers.get("X-Cache"), "HIT", "refreshed in background");
    await setAge(dirKey, 30 * 3600e3);
    airtableFail = () => true;
    r = await call("/public/directory");
    airtableFail = null; await settle();
    assert.equal(r.status, 200); assert.equal(r.headers.get("X-Cache"), "STALE-ERROR");
    assert.ok(Array.isArray((await r.json()).gemachs));
  });
  await t("cache: admin change purges and immediately rebuilds with the new data", async () => {
    await call("/public/directory"); await settle();
    const r = await call("/admin/gemach", { method: "PATCH", headers: { ...auth(tokenA), "X-Gemach": A.slug, "Content-Type": "application/json" }, body: JSON.stringify({ tagline: "Fresh tagline 123" }) });
    assert.equal(r.status, 200, await r.clone().text());
    await settle();
    assert.ok(store.has(dirKey), "directory rebuilt after purge");
    const d = await (await store.get(dirKey).clone()).json();
    assert.equal(d.gemachs.find(g => g.slug === A.slug).tagline, "Fresh tagline 123");
    const gk = "https://whgemachs.org/__cache/v1/gemach/" + A.slug;
    assert.ok(store.has(gk), "gemach page rebuilt after purge");
    const hit = await call("/public/gemach/" + A.slug); assert.equal(hit.headers.get("X-Cache"), "HIT");
  });
  delete globalThis.caches;
}

// ── Admin notification: item table, quantities, availability conflicts ──
{
  const G = { id: "recNOTIFYGEMACH01", slug: "notify-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Notify Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "notify@example.com" }));
  const sc = { Gemach: [G.id], "Gemach Slug": [G.slug] };
  const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  DB["Item Types"].push(
    rec("recNTYPE000000001", { Name: "Walker", Active: true, ...sc }),                                         // 2 units, both booked over the window
    rec("recNTYPE000000002", { Name: "Cane", Active: true, ...sc }),                                           // 2 units, 1 booked -> ok
    rec("recNTYPE000000003", { Name: "Folding Chair", Active: true, Tracking: "Quantity", "Quantity Owned": 60, "Out of Service": 0, ...sc }), // 50 booked -> short
    rec("recNTYPE000000004", { Name: "Bath Bench", Active: true, ...sc }),                                     // no units listed
    rec("recNTYPE000000005", { Name: "Table", Active: true, Tracking: "Quantity", "Quantity Owned": 10, ...sc }));  // plenty
  DB.Items.push(
    rec("recNITEM000000001", { "Item ID": "W-1", "Item Type": ["recNTYPE000000001"], Active: true, ...sc }),
    rec("recNITEM000000002", { "Item ID": "W-2", "Item Type": ["recNTYPE000000001"], Active: true, ...sc }),
    rec("recNITEM000000003", { "Item ID": "C-1", "Item Type": ["recNTYPE000000002"], Active: true, ...sc }),
    rec("recNITEM000000004", { "Item ID": "C-2", "Item Type": ["recNTYPE000000002"], Active: true, ...sc }),
    rec("recNITEM000000005", { "Item ID": "W-3", "Item Type": ["recNTYPE000000001"], Active: false, ...sc }));   // inactive: not counted
  DB.Loans.push(
    rec("recNLOAN000000001", { Status: "Active", Item: ["recNITEM000000001"], "Date Borrowed": day(-3), "Expected Return": day(12), ...sc }),
    rec("recNLOAN000000002", { Status: "Reserved", "Item to Reserve": ["recNTYPE000000001"], "Reservation Start": day(5), "Reservation End": day(9), ...sc }),
    rec("recNLOAN000000003", { Status: "Active", Item: ["recNITEM000000003"], "Date Borrowed": day(-1), ...sc }),               // open-ended cane
    rec("recNLOAN000000004", { Status: "Reserved", "Item to Reserve": ["recNTYPE000000003"], Quantity: 50, "Reservation Start": day(6), "Reservation End": day(8), ...sc }),
    rec("recNLOAN000000005", { Status: "Returned", Item: ["recNITEM000000004"], "Date Borrowed": day(-9), "Date Returned": day(-2), ...sc }));
  const all = ["recNTYPE000000001", "recNTYPE000000002", "recNTYPE000000003", "recNTYPE000000004", "recNTYPE000000005"];

  await t("notify: items table with quantities and per-item availability; conflicts flagged in subject, banner and text", async () => {
    const r = await post("/submit-request", { gemach: G.slug, name: "Many Items", phone: "5165551234", preferredContact: "Phone",
      itemsRequested: all, quantities: { recNTYPE000000003: 20, recNTYPE000000005: 4 }, neededFrom: day(7), neededUntil: day(8), notes: "line1\nline2 <b>x</b>" });
    assert.equal(r.status, 200, await r.clone().text());
    const m = resendCalls().filter(x => x.to[0] === "notify@example.com").at(-1);
    assert.ok(m, "gemach notified");
    assert.match(m.subject, /^⚠ New Notify Gemach Request: Many Items — Walker, Cane \+3 more$/);
    // text
    assert.match(m.text, /⚠ 3 of 5 items may not be available/);
    assert.match(m.text, /Items requested \(5\):/);
    assert.match(m.text, /• Walker — None free — all 2 out or reserved \(next due back /);
    assert.match(m.text, /• Cane — 1 free/);
    assert.match(m.text, /• Folding Chair × 20 — Only 10 of 20 free/);
    assert.match(m.text, /• Bath Bench — None listed in your inventory/);
    assert.match(m.text, /• Table × 4 — 10 of 10 free/);
    assert.match(m.text, /Dates: \w{3}, \w{3} \d+, \d{4} → \w{3}, \w{3} \d+, \d{4}/);
    // html
    assert.ok(m.html.includes("Items requested (5)"));
    assert.ok(m.html.includes("<strong>× 20</strong>") && m.html.includes("<strong>× 4</strong>"));
    assert.ok(m.html.includes("may not be available for these dates:</strong> Walker, Folding Chair × 20, Bath Bench"));
    assert.ok(m.html.includes("line1<br>line2 &lt;b&gt;x&lt;/b&gt;"), "notes escaped");
    assert.ok(m.html.includes("Review in admin") && m.html.includes("?g=notify-gemach"));
    assert.ok(!m.html.includes("<b>x</b>"));
  });
  await t("notify: everything available -> no warning; window outside bookings frees items", async () => {
    await post("/submit-request", { gemach: G.slug, name: "All Good", phone: "5165551234", preferredContact: "Phone",
      itemsRequested: ["recNTYPE000000001", "recNTYPE000000003"], quantities: { recNTYPE000000003: 60 }, neededFrom: day(20), neededUntil: day(22) });
    const m = resendCalls().filter(x => x.to[0] === "notify@example.com").at(-1);
    assert.match(m.subject, /^New Notify Gemach Request: All Good — Walker, Folding Chair × 60$/);
    assert.ok(!/may not be available/.test(m.text));
    assert.match(m.text, /• Walker — 2 free/);
    assert.match(m.text, /• Folding Chair × 60 — 60 of 60 free/);
  });
  await t("notify: availability lookup failure still sends the email (with a note) and saves the request", async () => {
    airtableFail = (m, table, id) => table === "Loans" && id === "listRecords";
    const r = await post("/submit-request", { gemach: G.slug, name: "Check Fail", phone: "5165551234", preferredContact: "Phone",
      itemsRequested: ["recNTYPE000000002"], neededFrom: day(3) });
    airtableFail = null;
    assert.equal(r.status, 200);
    const m = resendCalls().filter(x => x.to[0] === "notify@example.com").at(-1);
    assert.match(m.subject, /Check Fail — Cane$/);
    assert.match(m.text, /Couldn't check availability/);
  });
}

await t("donation info: saved from Settings (trimmed, ≤2000, '' clears) and shown on the public page", async () => {
  const H = { ...auth(tokenA), "X-Gemach": A.slug, "Content-Type": "application/json" };
  const text = "For monetary donations, visit anshei.org/donate.\n\nEquipment: call (718) 986-7345.";
  let r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ donationInfo: "  " + text + "  " }) });
  assert.equal(r.status, 200);
  const rec = DB.Gemachs.find(g => g.id === A.id);
  assert.equal(rec.fields["Donation Info"], text);
  assert.equal((await r.json()).donationInfo, text);
  __WHG_TEST__.clearMemo();
  const pub = await (await call("/public/gemach/" + A.slug)).json();
  assert.equal(pub.gemach.donationInfo, text);
  r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ donationInfo: "x".repeat(2001) }) });
  assert.equal(r.status, 400);
  r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ donationInfo: "" }) });
  assert.equal(r.status, 200);
  assert.ok(!rec.fields["Donation Info"]);
});

// ── Add-ons (made to order, for purchase) ──
{
  const G = { id: "recADDONGEMACH001", slug: "addon-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Addon Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "addon@example.com" }));
  const sc = { Gemach: [G.id], "Gemach Slug": [G.slug] };
  const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  DB["Item Types"].push(
    rec("recADDTYPE0000001", { Name: "Family Sweatshirt", Active: true, Tracking: "Add-on", Price: 40, Description: "$40 each", ...sc }),
    rec("recADDTYPE0000002", { Name: "Tumblers", Active: true, Tracking: "Add-on", ...sc }), // no price
    rec("recADDTYPE0000003", { Name: "Arch", Active: true, Items: ["recADDITEM0000001"], ...sc }));
  DB.Items.push(rec("recADDITEM0000001", { "Item ID": "AR-001", "Item Type": ["recADDTYPE0000003"], Active: true, Status: "Available", ...sc }));
  const H = { ...auth(tokNet), "X-Gemach": G.slug, "Content-Type": "application/json" };
  const settle = async () => { await Promise.allSettled(waits); };

  await t("add-ons: public page marks them as add-ons with price, never 'available' counts", async () => {
    __WHG_TEST__.clearMemo();
    const d = await (await call("/public/gemach/" + G.slug)).json();
    const sw = d.items.find(i => i.name === "Family Sweatshirt");
    assert.equal(sw.tracking, "addon"); assert.equal(sw.price, 40); assert.equal(sw.availableCount, null); assert.equal(sw.totalUnits, 0);
    assert.equal(d.items.find(i => i.name === "Tumblers").price, null);
    assert.equal(d.items.find(i => i.name === "Arch").tracking, undefined);
  });

  let reqRec;
  await t("add-ons: can be ordered on their own, with a count; email shows price, total, no availability warning", async () => {
    const r = await post("/submit-request", { gemach: G.slug, name: "Sweat Shirt", phone: "5165551234", preferredContact: "Phone",
      itemsRequested: ["recADDTYPE0000001", "recADDTYPE0000002"], quantities: { recADDTYPE0000001: 4 }, neededFrom: day(20) });
    assert.equal(r.status, 200, await r.clone().text());
    reqRec = DB.Requests.at(-1);
    assert.deepEqual(JSON.parse(reqRec.fields["Item Quantities"]), { recADDTYPE0000001: 4, recADDTYPE0000002: 1 });
    await settle();
    const m = resendCalls().filter(x => x.to[0] === "addon@example.com").at(-1);
    assert.match(m.text, /• Family Sweatshirt × 4 — Add-on · \$40 × 4 = \$160/);
    assert.match(m.text, /• Tumblers × 1 — Add-on \(for purchase\)/);
    assert.match(m.text, /Add-ons total: \$160 \(separate payment\)/);
    assert.ok(!/may not be available/.test(m.text) && !/^⚠/.test(m.subject), "no conflict warning for add-ons");
    assert.ok(m.html.includes("Add-ons total: $160"));
    const bad = await post("/submit-request", { gemach: G.slug, name: "X", phone: "5165551234", preferredContact: "Phone",
      itemsRequested: ["recADDTYPE0000001"], quantities: { recADDTYPE0000001: 0 }, neededFrom: day(20) });
    assert.equal(bad.status, 400);
  });

  await t("add-ons: admin request card, confirm -> add-on reservation, hand over completes it", async () => {
    const list = await (await call("/admin/requests", { headers: H })).json();
    const card = list.find(x => x.id === reqRec.id);
    const it = card.items.find(i => i.id === "recADDTYPE0000001");
    assert.equal(it.addon, true); assert.equal(it.price, 40); assert.equal(it.quantity, 4); assert.equal(it.available, null);
    let r = await call(`/admin/requests/${reqRec.id}/confirm`, { method: "POST", headers: H, body: JSON.stringify({ quantities: { recADDTYPE0000001: 5 } }) });
    assert.equal(r.status, 200, await r.clone().text());
    const created = (await r.json()).reservations;
    assert.equal(created.length, 2);
    const loan = DB.Loans.find(l => l.id === created.find(c => /Sweatshirt/.test(c.itemTypeName)).id);
    assert.equal(loan.fields.Status, "Reserved"); assert.equal(loan.fields.Quantity, 5);
    await settle();
    assert.ok(DB["tblC3PY7f5sXQDMJK"].some(l => l.fields["Event Type"] === "Add-on Ordered" && l.fields["Loan ID"] === loan.fields["Loan ID"]));
    const res = await (await call("/admin/reservations", { headers: H })).json();
    const row = res.find(x => x.id === loan.id);
    assert.equal(row.isAddon, true); assert.equal(row.isQuantity, false); assert.equal(row.price, 40); assert.equal(row.quantity, 5);
    r = await call(`/admin/loans/${loan.id}/pickup`, { method: "POST", headers: H, body: JSON.stringify({}) });
    assert.equal(r.status, 200); assert.equal((await r.json()).handedOver, true);
    assert.equal(loan.fields.Status, "Returned"); assert.ok(loan.fields["Date Borrowed"] && loan.fields["Date Borrowed"] === loan.fields["Date Returned"]);
    await settle();
    assert.ok(DB["tblC3PY7f5sXQDMJK"].some(l => l.fields["Event Type"] === "Add-on Handed Over" && l.fields["Loan ID"] === loan.fields["Loan ID"]));
    const loans = await (await call("/admin/loans", { headers: H })).json();
    assert.ok(!loans.some(l => l.id === loan.id), "never shows as out on loan");
    const stats = await (await call("/admin/stats?days=90", { headers: H })).json();
    assert.ok(!stats.loanLength.some(x => x.name === "Family Sweatshirt"), "not counted as a loan");
    assert.equal(stats.topRequested.find(x => x.name === "Family Sweatshirt").addon, true);
  });

  await t("add-ons: an add-on-only order needs no deposit acknowledgement; borrowing still does", async () => {
    const gr = DB.Gemachs.find(x => x.id === G.id); gr.fields["Deposit Required"] = true; __WHG_TEST__.clearMemo();
    const base = { gemach: G.slug, name: "Dep Test", phone: "5165551234", preferredContact: "Phone", neededFrom: day(25) };
    let r = await post("/submit-request", { ...base, itemsRequested: ["recADDTYPE0000001"] });
    assert.equal(r.status, 200, await r.clone().text());
    r = await post("/submit-request", { ...base, itemsRequested: ["recADDTYPE0000001", "recADDTYPE0000003"] });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /deposit/i);
    gr.fields["Deposit Required"] = false; __WHG_TEST__.clearMemo();
  });

  await t("add-ons: item types take Tracking 'Add-on' + price; no numbered units for add-ons", async () => {
    let r = await call("/admin/catalog/items", { method: "POST", headers: H, body: JSON.stringify({ itemTypeId: "recADDTYPE0000001" }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /add-on/i);
    r = await call("/admin/catalog/item-types/recADDTYPE0000003", { method: "PATCH", headers: H, body: JSON.stringify({ tracking: "Add-on" }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /numbered unit/);
    r = await call("/admin/catalog/item-types/recADDTYPE0000002", { method: "PATCH", headers: H, body: JSON.stringify({ price: "28" }) });
    assert.equal(r.status, 200); assert.equal(DB["Item Types"].find(x => x.id === "recADDTYPE0000002").fields.Price, 28);
    r = await call("/admin/catalog/item-types/recADDTYPE0000002", { method: "PATCH", headers: H, body: JSON.stringify({ price: "abc" }) });
    assert.equal(r.status, 400);
    const types = await (await call("/admin/catalog/item-types", { headers: H })).json();
    assert.equal(types.find(x => x.id === "recADDTYPE0000001").tracking, "Add-on");
    assert.equal(types.find(x => x.id === "recADDTYPE0000002").price, 28);
  });
}

// ── New-request email for a gemach with no Email → network fallback, with a note saying why ──
{
  const G = { id: "recNOEMAILGEMACH1", slug: "no-email-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Quiet Gemach", Slug: G.slug, Active: true, Mode: "Full", Phone: "(516) 555-0100" }));
  DB["Item Types"].push(rec("recNOEMAILTYPE001", { Name: "Punch Bowl", Active: true, Tracking: "Quantity", "Quantity Owned": 2, Gemach: [G.id], "Gemach Slug": [G.slug] }));
  const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await t("request email with no gemach Email goes to NOTIFY_EMAIL and explains why", async () => {
    env.NOTIFY_EMAIL = "network@example.com";
    try {
      const r = await post("/submit-request", { gemach: G.slug, name: "No Mail", phone: "5165551234", preferredContact: "Phone",
        itemsRequested: ["recNOEMAILTYPE001"], neededFrom: day(10), neededUntil: day(12) });
      assert.equal(r.status, 200, await r.clone().text());
      await Promise.allSettled(waits);
      const m = resendCalls().filter(x => x.to[0] === "network@example.com").at(-1);
      assert.ok(m, "sent to the fallback address");
      assert.match(m.text, /Quiet Gemach has no email address in its Settings, so this request came to you instead\. Gemach contact: \(516\) 555-0100\./);
      assert.ok(m.html.includes("Why you got this:"));
      // A gemach that has its own Email gets no such note.
      const own = resendCalls().filter(x => x.to[0] === "addon@example.com").at(-1);
      assert.ok(own && !/no email address in its Settings/.test(own.text) && !own.html.includes("Why you got this"));
    } finally { delete env.NOTIFY_EMAIL; }
  });
}

// ── Item attributes (filters like Size / Color for gown gemachs) ──
{
  const G = { id: "recGOWNGEMACH0001", slug: "gown-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Gown Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "gown@example.com", "Request Style": "Appointment" }));
  const sc = { Gemach: [G.id], "Gemach Slug": [G.slug] };
  DB["Item Types"].push(
    rec("recGOWNTYPE000001", { Name: "Navy A-line", Active: true, ...sc }),
    rec("recGOWNTYPE000002", { Name: "Gold Mermaid", Active: true, ...sc, Attributes: JSON.stringify({ size: ["12"], Color: ["gold", "Silver"], Old: ["x"] }) }));
  const H = { ...auth(tokNet), "X-Gemach": G.slug, "Content-Type": "application/json" };
  const patchG = b => call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify(b) });

  await t("attributes: Settings saves the gemach's filters (cleaned, deduped); bad input refused", async () => {
    let r = await patchG({ itemAttributes: [{ name: " Size ", values: "0, 2, 4,6,8,10,12, 2" }, { name: "Color", values: ["Navy", "Gold", "Black", "Silver"] }, { name: "Length", values: ["Floor", "Tea"] }] });
    assert.equal(r.status, 200, await r.clone().text());
    const saved = JSON.parse(DB.Gemachs.find(x => x.id === G.id).fields["Item Attributes"]);
    assert.deepEqual(saved[0], { name: "Size", values: ["0", "2", "4", "6", "8", "10", "12"] });
    assert.deepEqual((await r.json()).itemAttributes.map(a => a.name), ["Size", "Color", "Length"]);
    for (const bad of [[{ name: "", values: "a" }], [{ name: "Size", values: "a" }, { name: "size", values: "b" }], [{ name: "Size", values: " , " }],
      "Size", [{ name: "x".repeat(31), values: "a" }], Array.from({ length: 7 }, (_, i) => ({ name: "A" + i, values: "x" }))]) {
      r = await patchG({ itemAttributes: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
  });

  await t("attributes: item values checked against the gemach's list; public page shows them in list order", async () => {
    let r = await call("/admin/catalog/item-types/recGOWNTYPE000001", { method: "PATCH", headers: H, body: JSON.stringify({ attributes: { Size: "8", color: ["gold", "Navy"] } }) });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(JSON.parse(DB["Item Types"].find(x => x.id === "recGOWNTYPE000001").fields.Attributes), { Size: ["8"], Color: ["Navy", "Gold"] });
    r = await call("/admin/catalog/item-types/recGOWNTYPE000001", { method: "PATCH", headers: H, body: JSON.stringify({ attributes: { Size: "9" } }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /isn't a Size choice/);
    r = await call("/admin/catalog/item-types/recGOWNTYPE000001", { method: "PATCH", headers: H, body: JSON.stringify({ attributes: { Fabric: "Silk" } }) });
    assert.equal(r.status, 400);
    r = await call("/admin/catalog/item-types", { method: "POST", headers: H, body: JSON.stringify({ name: "Black Sheath", attributes: { Length: ["Tea"] } }) });
    assert.equal(r.status, 200, await r.clone().text());
    const types = await (await call("/admin/catalog/item-types", { headers: H })).json();
    assert.deepEqual(types.find(x => x.name === "Black Sheath").attributes, { Length: ["Tea"] });

    __WHG_TEST__.clearMemo();
    const d = await (await call("/public/gemach/" + G.slug + "?attrs=1")).json();
    assert.deepEqual(d.gemach.itemAttributes.find(a => a.name === "Size").values.slice(0, 3), ["0", "2", "4"]);
    assert.deepEqual(d.items.find(i => i.name === "Navy A-line").attributes, { Size: ["8"], Color: ["Navy", "Gold"] });
    // Stored values are matched case-insensitively; values/filters the gemach no longer offers are dropped.
    assert.deepEqual(d.items.find(i => i.name === "Gold Mermaid").attributes, { Size: ["12"], Color: ["Gold", "Silver"] });
    const dir = await (await call("/public/directory?attrs=1")).json();
    assert.deepEqual(dir.gemachs.find(x => x.slug === G.slug).items.find(i => i.name === "Navy A-line").attributes.Size, ["8"]);

    // Clearing an item's values
    r = await call("/admin/catalog/item-types/recGOWNTYPE000001", { method: "PATCH", headers: H, body: JSON.stringify({ attributes: {} }) });
    assert.equal(r.status, 200); assert.equal(DB["Item Types"].find(x => x.id === "recGOWNTYPE000001").fields.Attributes, null);
  });

  await t("attributes: gemachs without filters get no attributes on items", async () => {
    const d = await (await call("/public/gemach/wh-medical?attrs=2")).json();
    assert.deepEqual(d.gemach.itemAttributes, []);
    assert.ok(d.items.every(i => !("attributes" in i)));
  });
}

// ── Status "Coming soon" + type "Info only" ──
{
  const CS = { id: "recCOMINGSOON0001", slug: "soon-gemach" }, IN = { id: "recINFOONLY000001", slug: "info-gemach" };
  DB.Gemachs.push(
    rec(CS.id, { Name: "Soon Gemach", Slug: CS.slug, Active: true, Mode: "Full", Email: "soon@example.com", Phone: "(516) 555-0111" }),
    rec(IN.id, { Name: "Info Gemach", Slug: IN.slug, Active: true, Mode: "Info", Email: "info@example.com", Phone: "(516) 555-0122", "Gemach Info": "Call Sarah for sizes." }));
  DB["Item Types"].push(
    rec("recCSTYPE00000001", { Name: "Soon Item", Active: true, Gemach: [CS.id], "Gemach Slug": [CS.slug] }),
    rec("recINTYPE00000001", { Name: "Info Item", Active: true, Gemach: [IN.id], "Gemach Slug": [IN.slug] }));
  const HI = { ...auth(tokNet), "X-Gemach": IN.slug, "Content-Type": "application/json" };

  await t("status: Network Admin sets Coming soon; public data carries it; requests refused", async () => {
    let r = await req(tokNet, "PATCH", `/admin/network/gemachs/${CS.id}`, { comingSoon: true });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).comingSoon, true);
    assert.equal(DB.Gemachs.find(x => x.id === CS.id).fields["Coming Soon"], true);
    assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${CS.id}`, { comingSoon: "yes" })).status, 400);
    __WHG_TEST__.clearMemo();
    const d = await (await call(`/public/gemach/${CS.slug}?cs=1`)).json();
    assert.equal(d.gemach.comingSoon, true);
    assert.equal(d.items.length, 1, "items still shown as a preview");
    const dir = await (await call("/public/directory?cs=1")).json();
    assert.equal(dir.gemachs.find(g => g.slug === CS.slug).comingSoon, true);
    assert.equal(dir.gemachs.find(g => g.slug === "wh-medical").comingSoon, false);
    r = await post("/submit-request", { gemach: CS.slug, name: "X", phone: "5165551234", preferredContact: "Phone", itemsRequested: ["recCSTYPE00000001"], neededFrom: "2030-01-01" });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /doesn't take online requests/);
    assert.ok(!DB.Requests.some(x => (x.fields["Gemach Slug"] || [])[0] === CS.slug));
  });

  await t("type: Info only — no items published, no requests; mode settable by Network Admin", async () => {
    __WHG_TEST__.clearMemo();
    const d = await (await call(`/public/gemach/${IN.slug}?in=1`)).json();
    assert.equal(d.gemach.mode, "Info"); assert.deepEqual(d.items, []);
    assert.equal(d.gemach.gemachInfo, "Call Sarah for sizes.");
    const dir = await (await call("/public/directory?in=1")).json();
    assert.deepEqual(dir.gemachs.find(g => g.slug === IN.slug).items, []);
    const r = await post("/submit-request", { gemach: IN.slug, name: "X", phone: "5165551234", preferredContact: "Phone", itemsRequested: ["recINTYPE00000001"], neededFrom: "2030-01-01" });
    assert.equal(r.status, 400);
    const p = await req(tokNet, "PATCH", `/admin/network/gemachs/${CS.id}`, { mode: "Info" });
    assert.equal(p.status, 200); assert.equal((await p.json()).mode, "Info");
    await req(tokNet, "PATCH", `/admin/network/gemachs/${CS.id}`, { mode: "Full" });
    assert.equal((await req(tokNet, "PATCH", `/admin/network/gemachs/${CS.id}`, { mode: "Other" })).status, 400);
  });

  await t("browse categories: saved from Settings (active categories only) and published", async () => {
    let r = await call("/admin/gemach", { method: "PATCH", headers: HI, body: JSON.stringify({ browseCategoryIds: ["recCAT0000000000A", "recCAT0000000000C", "recCAT0000000000A"] }) });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual((await r.json()).browseCategoryIds, ["recCAT0000000000A", "recCAT0000000000C"]);
    for (const bad of [["recCAT0000000000D"], ["recNOPE0000000000"], ["nope"], "recCAT0000000000A"]) {
      r = await call("/admin/gemach", { method: "PATCH", headers: HI, body: JSON.stringify({ browseCategoryIds: bad }) });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    __WHG_TEST__.clearMemo();
    const dir = await (await call("/public/directory?bc=1")).json();
    assert.deepEqual(dir.gemachs.find(g => g.slug === IN.slug).browseCategoryIds, ["recCAT0000000000A", "recCAT0000000000C"]);
    r = await call("/admin/gemach", { method: "PATCH", headers: HI, body: JSON.stringify({ browseCategoryIds: [] }) });
    assert.equal(r.status, 200); assert.deepEqual((await r.json()).browseCategoryIds, []);
  });
}

// ── Borrower manage link (cancel, ready to return) ──
{
  const HA = { ...auth(tokenA), "X-Gemach": A.slug, "Content-Type": "application/json" };
  const tokOf = u => u.split("/r/")[1];
  const mg = (tok, action) => action ? call(`/public/manage/${tok}/${action}`, { method: "POST", body: "{}" }) : call(`/public/manage/${tok}`);
  const soon = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const submit = extra => post("/submit-request", { gemach: A.slug, name: "Rivka Manage", phone: "5165559999", preferredContact: "Phone",
    itemsRequested: ["recTYPEA000000002"], neededFrom: soon(10), neededUntil: soon(14), ...extra });
  const logsFor = rid => DB["tblC3PY7f5sXQDMJK"].filter(l => l.fields["Loan ID"] === rid).map(l => l.fields["Event Type"]);

  await t("manage: submit returns a signed link; tampered/unknown links refused; receipt emailed when there's an email", async () => {
    const r = await submit({ email: "rivka@example.com" });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.match(d.manageUrl, /^https:\/\/whgemachs\.org\/r\/rec[A-Za-z0-9]{14}\.[A-Za-z0-9_-]{22}$/);
    const tok = tokOf(d.manageUrl);
    await Promise.allSettled(waits);
    const receipt = resendCalls().filter(x => x.to[0] === "rivka@example.com").at(-1);
    assert.ok(receipt && receipt.text.includes(d.manageUrl) && /We got your request/.test(receipt.subject));
    const g = await (await mg(tok)).json();
    assert.equal(g.request.status, "waiting"); assert.equal(g.request.firstName, "Rivka"); assert.equal(g.can.cancel, true);
    assert.ok(!("phone" in g.request) && !JSON.stringify(g).includes("5165559999"), "no borrower phone in the page data");
    const bad = tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A");
    assert.equal((await mg(bad)).status, 404);
    assert.equal((await mg("recNOPE0000000000.AAAAAAAAAAAAAAAAAAAAAA")).status, 404);
    assert.equal((await mg("junk")).status, 404);
    globalThis.__mgWaiting = { tok, id: DB.Requests.at(-1).id, rid: DB.Requests.at(-1).fields["Request ID"] };
  });

  await t("manage: cancel a waiting request — status Cancelled, gemach emailed, History logged; can't cancel twice", async () => {
    const { tok, id, rid } = globalThis.__mgWaiting;
    const before = resendCalls().length;
    const r = await mg(tok, "cancel");
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).request.status, "cancelled");
    assert.equal(DB.Requests.find(x => x.id === id).fields.Status, "Cancelled");
    await Promise.allSettled(waits);
    const mail = resendCalls().slice(before).find(x => /^Cancelled:/.test(x.subject));
    assert.ok(mail, "gemach told");
    assert.match(mail.text, new RegExp(`cancelled request ${rid}`));
    assert.ok(logsFor(rid).includes("Request Cancelled"));
    assert.equal((await mg(tok, "cancel")).status, 409);
    const list = await (await call("/admin/requests", { headers: HA })).json();
    assert.ok(!list.some(x => x.id === id), "gone from admin Requests");
  });

  await t("manage: cancel a confirmed request releases its reservations", async () => {
    const d = await (await submit({})).json();
    const reqRec = DB.Requests.at(-1);
    const list = await (await call("/admin/requests", { headers: HA })).json();
    assert.equal(list.find(x => x.id === reqRec.id).manageUrl, d.manageUrl, "admin sees the same link");
    const c = await call(`/admin/requests/${reqRec.id}/confirm`, { method: "POST", headers: HA, body: JSON.stringify({}) });
    assert.equal(c.status, 200, await c.clone().text());
    const loanId = (await c.json()).reservations[0].id;
    const res = await (await call("/admin/reservations", { headers: HA })).json();
    assert.equal(res.find(x => x.id === loanId).manageUrl, d.manageUrl);
    const g = await (await mg(tokOf(d.manageUrl))).json();
    assert.equal(g.request.status, "confirmed"); assert.equal(g.loans.length, 1); assert.equal(g.loans[0].status, "Reserved");
    const r = await mg(tokOf(d.manageUrl), "cancel");
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(DB.Loans.find(l => l.id === loanId).fields.Status, "Cancelled");
    assert.equal(reqRec.fields.Status, "Cancelled");
    await Promise.allSettled(waits);
    const ev = DB["tblC3PY7f5sXQDMJK"].filter(l => l.fields.Admin === "Borrower (online)").map(l => l.fields["Event Type"]);
    assert.ok(ev.includes("Reservation Cancelled") && ev.includes("Request Cancelled"));
  });

  await t("manage: once picked up — no cancel; 'ready to return' flags the loan, emails the gemach, shows in admin Loans", async () => {
    const d = await (await submit({})).json();
    const reqRec = DB.Requests.at(-1);
    const c = await call(`/admin/requests/${reqRec.id}/confirm`, { method: "POST", headers: HA, body: JSON.stringify({}) });
    const newLoanId = (await c.json()).reservations[0].id;
    const loan = DB.Loans.find(l => l.id === newLoanId);
    Object.assign(loan.fields, { Status: "Active", "Date Borrowed": soon(-2) }); // picked up
    const tok = tokOf(d.manageUrl);
    let g = await (await mg(tok)).json();
    assert.equal(g.request.status, "out"); assert.equal(g.can.cancel, false); assert.equal(g.can.readyToReturn, true);
    assert.equal((await mg(tok, "cancel")).status, 409);
    const before = resendCalls().length;
    const r = await mg(tok, "ready");
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(loan.fields["Ready To Return At"]);
    g = await r.json();
    assert.equal(g.can.readyToReturn, false); assert.ok(g.loans[0].readyToReturnAt);
    await Promise.allSettled(waits);
    assert.ok(resendCalls().slice(before).some(x => /^Ready to return:/.test(x.subject) && /5165559999|\(516\) 555-9999/.test(x.text)));
    assert.ok(logsFor(loan.fields["Loan ID"]).includes("Ready to Return"));
    assert.equal((await mg(tok, "ready")).status, 409, "only once");
    const loans = await (await call("/admin/loans", { headers: HA })).json();
    const row = loans.find(x => x.id === loan.id);
    assert.ok(row.readyToReturnAt && row.manageUrl === d.manageUrl);
  });

  await t("manage: link expires 30 days after everything is finished", async () => {
    const d = await (await submit({})).json();
    Object.assign(DB.Requests.at(-1).fields, { Status: "Declined", "Needed From": soon(-60), "Needed Until": soon(-50), "Received At": new Date(Date.now() - 70 * 864e5).toISOString() });
    const r = await mg(tokOf(d.manageUrl));
    assert.equal(r.status, 410); assert.equal((await r.json()).expired, true);
  });
}

// ── Speed: Network overview in one request; Server-Timing; stats reused for 5 minutes ──
{
  const airtableCalls = () => calls.filter(c => c.url.startsWith("https://api.airtable.com/")).length;
  await t("network overview: gemachs + admins + categories in one request with 3 Airtable reads; role checked from it", async () => {
    await Promise.allSettled(waits);
    const n0 = calls.length;
    const r = await req(tokNet, "GET", "/admin/network/overview");
    assert.equal(r.status, 200, await r.clone().text());
    const tables = new Set(calls.slice(n0).map(c => (c.url.match(/appTEST\/([^/?]+)/) || [])[1]).filter(Boolean).map(decodeURIComponent));
    assert.deepEqual([...tables].sort(), ["Admins", "Gemachs", "Product Categories"], "reads just three tables (the fake Airtable pages in small chunks, so count tables not calls)");
    const d = await r.json();
    const g = await (await req(tokNet, "GET", "/admin/network/gemachs")).json();
    const a = await (await req(tokNet, "GET", "/admin/network/admins")).json();
    const c = await (await req(tokNet, "GET", "/admin/network/categories")).json();
    assert.deepEqual(d.gemachs, g); assert.deepEqual(d.admins, a); assert.deepEqual(d.categories, c);
    __WHG_TEST__.clearMemo();
    assert.equal((await req(tokDemoted, "GET", "/admin/network/overview")).status, 403, "stale JWT, Airtable says not a network admin");
    assert.equal((await req(tokenA, "GET", "/admin/network/overview")).status, 403);
  });

  await t("every response carries Server-Timing with the Airtable call count", async () => {
    const r = await req(tokNet, "GET", "/admin/network/overview");
    assert.match(r.headers.get("Server-Timing") || "", /^total;dur=\d+, airtable;dur=\d+;desc="\d+ calls", queue;dur=\d+$/);
    const h = await call("/health");
    assert.match(h.headers.get("Server-Timing") || "", /airtable;dur=\d+;desc="1 call"/);
  });

  await t("dashboard stats: second load within 5 minutes reuses the first (no Airtable reads); ?fresh=1 rebuilds", async () => {
    const H = { ...auth(tokenA), "X-Gemach": A.slug };
    const first = await (await call("/admin/stats?days=30", { headers: H })).json();
    const n0 = airtableCalls();
    const second = await (await call("/admin/stats?days=30", { headers: H })).json();
    assert.ok(airtableCalls() - n0 <= 2, "only the session/gemach checks, not the stats reads");
    assert.ok(second.cachedAt); assert.deepEqual({ ...second, cachedAt: undefined }, { ...first, cachedAt: undefined });
    const n1 = airtableCalls();
    const fresh = await (await call("/admin/stats?days=30&fresh=1", { headers: H })).json();
    assert.ok(airtableCalls() - n1 >= 5 && !fresh.cachedAt);
  });
}

// ── Payment (a fee) instead of a refundable deposit ──
{
  const G = { id: "recPAYGEMACH00001", slug: "pay-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Pay Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "pay@example.com", "Deposit Required": true, "Deposit Info": "$15 per tablecloth" }));
  DB["Item Types"].push(rec("recPAYTYPE0000001", { Name: "Gold Tablecloth", Active: true, Tracking: "Quantity", "Quantity Owned": 10, Gemach: [G.id], "Gemach Slug": [G.slug] }));
  const H = { ...auth(tokNet), "X-Gemach": G.slug, "Content-Type": "application/json" };
  const soon = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  await t("payment: blank Charge Type means Deposit; Settings switches to Payment; bad value refused", async () => {
    __WHG_TEST__.clearMemo();
    assert.equal((await (await call(`/public/gemach/${G.slug}?p=1`)).json()).gemach.chargeType, "Deposit");
    let r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ chargeType: "Payment" }) });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).chargeType, "Payment");
    assert.equal(DB.Gemachs.find(x => x.id === G.id).fields["Charge Type"], "Payment");
    assert.equal((await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ chargeType: "Tip" }) })).status, 400);
    __WHG_TEST__.clearMemo();
    assert.equal((await (await call(`/public/gemach/${G.slug}?p=2`)).json()).gemach.chargeType, "Payment");
  });

  await t("item view: blank = List; Settings sets Grid/Photos; bad value refused", async () => {
    __WHG_TEST__.clearMemo();
    assert.equal((await (await call(`/public/gemach/${G.slug}?v=1`)).json()).gemach.itemView, "List");
    let r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ itemView: "Grid" }) });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).itemView, "Grid");
    assert.equal(DB.Gemachs.find(x => x.id === G.id).fields["Item View"], "Grid");
    assert.equal((await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ itemView: "Carousel" }) })).status, 400);
    __WHG_TEST__.clearMemo();
    assert.equal((await (await call(`/public/gemach/${G.slug}?v=2`)).json()).gemach.itemView, "Grid");
    await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ itemView: "Photos" }) });
    __WHG_TEST__.clearMemo();
    assert.equal((await (await call(`/public/gemach/${G.slug}?v=3`)).json()).gemach.itemView, "Photos");
  });

  await t("payment: request must acknowledge payment; gemach email says 'Payment'", async () => {
    const base = { gemach: G.slug, name: "Tova", phone: "5165557777", preferredContact: "Phone", itemsRequested: ["recPAYTYPE0000001"], quantities: { recPAYTYPE0000001: 3 }, neededFrom: soon(9) };
    let r = await post("/submit-request", base);
    assert.equal(r.status, 400); assert.match((await r.json()).error, /payment requirement/);
    r = await post("/submit-request", { ...base, depositAck: true });
    assert.equal(r.status, 200, await r.clone().text());
    await Promise.allSettled(waits);
    const m = resendCalls().filter(x => x.to[0] === "pay@example.com").at(-1);
    assert.match(m.text, /Payment acknowledged: yes/); assert.ok(!/Deposit acknowledged/.test(m.text));
    assert.ok(m.html.includes(">Payment<"));
  });
}

// ── Several photos per item (cover = R2 Photo URL, More Photos = JSON list) ──
{
  const G = { id: "recPHOTOGEMACH001", slug: "photo-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Photo Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "ph@example.com" }));
  DB["Item Types"].push(rec("recPHOTOTYPE00001", { Name: "Lace Tablecloth", Active: true, Gemach: [G.id], "Gemach Slug": [G.slug] }));
  const H = { ...auth(tokNet), "X-Gemach": G.slug, "Content-Type": "application/json" };
  const patch = b => call("/admin/catalog/item-types/recPHOTOTYPE00001", { method: "PATCH", headers: H, body: JSON.stringify(b) });
  const P = n => `https://assets/${G.slug}/photos/${n}.jpg`;

  await t("photos: cover + up to 9 more, in order; only our own links; cover never repeated", async () => {
    let r = await patch({ r2PhotoUrl: P(1), morePhotos: [P(2), P(3), P(1), P(2), "https://whgemachs.org/assets/gemachs/photo-gemach/x.jpg"] });
    assert.equal(r.status, 200, await r.clone().text());
    const f = DB["Item Types"].find(x => x.id === "recPHOTOTYPE00001").fields;
    assert.deepEqual(JSON.parse(f["More Photos"]), [P(2), P(3), "https://whgemachs.org/assets/gemachs/photo-gemach/x.jpg"]);
    for (const bad of [["https://evil.example/a.jpg"], ["http://assets/x.jpg"], Array.from({ length: 10 }, (_, i) => P(i + 10)), "nope", ["https://assets/../x.jpg"]]) {
      assert.equal((await patch({ morePhotos: bad })).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    const types = await (await call("/admin/catalog/item-types", { headers: H })).json();
    assert.deepEqual(types.find(x => x.id === "recPHOTOTYPE00001").morePhotos.length, 3);
  });

  await t("photos: gemach page gets the full list (cover first); home page stays light", async () => {
    __WHG_TEST__.clearMemo();
    const d = await (await call(`/public/gemach/${G.slug}?ph=1`)).json();
    const it = d.items.find(i => i.name === "Lace Tablecloth");
    assert.equal(it.photoUrl, P(1)); assert.deepEqual(it.photos.slice(0, 3), [P(1), P(2), P(3)]);
    const dir = await (await call("/public/directory?ph=1")).json();
    assert.ok(!("photos" in dir.gemachs.find(g => g.slug === G.slug).items[0]));
  });

  await t("photos: making another photo the cover moves the old cover into the list; clearing works", async () => {
    let r = await patch({ r2PhotoUrl: P(3), morePhotos: [P(1), P(2)] });
    assert.equal(r.status, 200);
    const f = DB["Item Types"].find(x => x.id === "recPHOTOTYPE00001").fields;
    assert.equal(f["R2 Photo URL"], P(3)); assert.deepEqual(JSON.parse(f["More Photos"]), [P(1), P(2)]);
    r = await patch({ morePhotos: [] });
    assert.equal(r.status, 200); assert.equal(f["More Photos"], null);
    __WHG_TEST__.clearMemo();
    const d = await (await call(`/public/gemach/${G.slug}?ph=2`)).json();
    assert.ok(!("photos" in d.items.find(i => i.name === "Lace Tablecloth")), "single photo: no list");
  });
}

await t("borrower email: pickup address is our own Maps link (instructions not swallowed); web links clickable", async () => {
  const g = { name: "WH Medical", pickupAddress: "507 Walton Court", phone: "(718) 986-7345", email: "g@example.com" };
  const msg = "Hi Binyamin, great news.\n\nPickup is at 507 Walton Court. In the driveway.\n\nManage or cancel: https://whgemachs.org/r/recAAAAAAAAAAAAAA.p0LoBdlHI_hcYLEp9QRaKK";
  const html = __WHG_TEST__.buildEmailHtml(g, msg, { signature: true });
  assert.ok(html.includes('<a href="https://www.google.com/maps/search/?api=1&amp;query=507%20Walton%20Court" style="color:#1B3A4B;">507 Walton Court</a>. In the driveway.'), "only the address is linked");
  assert.ok(html.includes('<a href="https://whgemachs.org/r/recAAAAAAAAAAAAAA.p0LoBdlHI_hcYLEp9QRaKK" style="color:#1B3A4B;">https://whgemachs.org/r/recAAAAAAAAAAAAAA.p0LoBdlHI_hcYLEp9QRaKK</a>'), "manage link clickable");
  const tricky = __WHG_TEST__.buildEmailHtml({ name: "X", pickupAddress: "5 Elm St <b>" }, "See https://example.org/a?x=1&y=2. Pickup at 5 Elm St <b>.", { signature: false });
  assert.ok(tricky.includes('href="https://example.org/a?x=1&amp;y=2"') && tricky.includes("</a>. Pickup") && !tricky.includes("<b>") && tricky.includes("5 Elm St &lt;b&gt;</a>"), "escaped; trailing period outside the link");
});

// ── Package size: quantity items lent in whole packages (e.g. bags of 6 tablecloths) ──
{
  const G = { id: "recPKGGEMACH00001", slug: "pkg-gemach" };
  DB.Gemachs.push(rec(G.id, { Name: "Package Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "pk@example.com" }));
  DB["Item Types"].push(rec("recPKGTYPE0000001", { Name: "Gold Jacquard · Round", Active: true, Tracking: "Quantity", "Quantity Owned": 12, "Package Size": 6, "Package Unit": "bag", Gemach: [G.id], "Gemach Slug": [G.slug] }));
  DB["Item Types"].push(rec("recPKGTYPE0000002", { Name: "Folding Chairs", Active: true, Tracking: "Quantity", "Quantity Owned": 10, Gemach: [G.id], "Gemach Slug": [G.slug] }));
  DB["Item Types"].push(rec("recPKGTYPE0000003", { Name: "Odd Lot", Active: true, Tracking: "Quantity", "Quantity Owned": 10, "Package Size": 6, Gemach: [G.id], "Gemach Slug": [G.slug] }));
  DB["Item Types"].push(rec("recPKGTYPE0000004", { Name: "Wheel Chair", Active: true, "Package Size": 6, Gemach: [G.id], "Gemach Slug": [G.slug] }));
  const H = { ...auth(tokNet), "X-Gemach": G.slug, "Content-Type": "application/json" };
  const patch = (id, b) => call(`/admin/catalog/item-types/${id}`, { method: "PATCH", headers: H, body: JSON.stringify(b) });
  const fieldsOf = id => DB["Item Types"].find(x => x.id === id).fields;
  const soon = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const base = { gemach: G.slug, name: "Tova", phone: "5165557777", preferredContact: "Phone", neededFrom: soon(9) };

  await t("package: admin item types list size + word (1 / null by default; numbered units always 1)", async () => {
    const types = await (await call("/admin/catalog/item-types", { headers: H })).json();
    const by = id => types.find(x => x.id === id);
    assert.equal(by("recPKGTYPE0000001").packageSize, 6); assert.equal(by("recPKGTYPE0000001").packageUnit, "bag");
    assert.equal(by("recPKGTYPE0000002").packageSize, 1); assert.equal(by("recPKGTYPE0000002").packageUnit, null);
    assert.equal(by("recPKGTYPE0000004").packageSize, 1);
  });

  await t("package: PATCH sets / clears; bad values refused", async () => {
    let r = await patch("recPKGTYPE0000002", { packageSize: 4, packageUnit: " box " });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(fieldsOf("recPKGTYPE0000002")["Package Size"], 4); assert.equal(fieldsOf("recPKGTYPE0000002")["Package Unit"], "box");
    for (const bad of [0, 2.5, "x", 1001]) assert.equal((await patch("recPKGTYPE0000002", { packageSize: bad })).status, 400, String(bad));
    assert.equal((await patch("recPKGTYPE0000002", { packageUnit: "x".repeat(31) })).status, 400);
    r = await patch("recPKGTYPE0000002", { packageSize: 1, packageUnit: "" });
    assert.equal(r.status, 200);
    assert.equal(fieldsOf("recPKGTYPE0000002")["Package Size"], null); assert.equal(fieldsOf("recPKGTYPE0000002")["Package Unit"], null);
    r = await patch("recPKGTYPE0000002", { name: "Folding Chairs" });
    assert.equal(r.status, 200); assert.ok(!("Package Size" in (DB["Item Types"].find(x => x.id === "recPKGTYPE0000002").fields)) || fieldsOf("recPKGTYPE0000002")["Package Size"] == null);
  });

  await t("package: create with a package size", async () => {
    const r = await call("/admin/catalog/item-types", { method: "POST", headers: H, body: JSON.stringify({ name: "Lilac Velvet · Rectangle", tracking: "Quantity", quantityOwned: 12, packageSize: 6, packageUnit: "bag" }) });
    assert.equal(r.status, 200, await r.clone().text());
    const f = DB["Item Types"].find(x => x.fields.Name === "Lilac Velvet · Rectangle").fields;
    assert.equal(f["Package Size"], 6); assert.equal(f["Package Unit"], "bag");
  });

  await t("package: public page carries size + word on packaged quantity items only", async () => {
    __WHG_TEST__.clearMemo();
    const d = await (await call(`/public/gemach/${G.slug}?pkg=1`)).json();
    const items = d.items || [];
    const q = items.find(x => x.id === "recPKGTYPE0000001");
    assert.equal(q.packageSize, 6); assert.equal(q.packageUnit, "bag"); assert.equal(q.totalUnits, 12);
    assert.equal(items.find(x => x.id === "recPKGTYPE0000002").packageSize, undefined);
    assert.equal(items.find(x => x.id === "recPKGTYPE0000004").packageSize, undefined);
  });

  await t("package: requests must be whole packages; total capped at whole packages", async () => {
    const q = (id, n) => post("/submit-request", { ...base, itemsRequested: [id], quantities: n == null ? {} : { [id]: n } });
    let r = await q("recPKGTYPE0000001", 7);
    assert.equal(r.status, 400); assert.match((await r.json()).error, /come in bags of 6 — please ask for 6, 12/);
    r = await q("recPKGTYPE0000001", 18);
    assert.equal(r.status, 400); assert.match((await r.json()).error, /12 or fewer/);
    r = await q("recPKGTYPE0000003", 12);
    assert.equal(r.status, 400); assert.match((await r.json()).error, /6 Odd Lot to lend in total/);
    r = await q("recPKGTYPE0000001", 12);
    assert.equal(r.status, 200, await r.clone().text());
    r = await q("recPKGTYPE0000001", null); // no count sent → one package
    assert.equal(r.status, 200, await r.clone().text());
    const last = DB.Requests.filter(x => (x.fields.Gemach || [])[0] === G.id).at(-1);
    assert.deepEqual(JSON.parse(last.fields["Item Quantities"]), { recPKGTYPE0000001: 6 });
    r = await q("recPKGTYPE0000002", 7); // no package size: any count
    assert.equal(r.status, 200, await r.clone().text());
  });
}
await t("inventory ?holds=1: reservations without a unit yet, per numbered item type", async () => {
  const H = { ...auth(tokenA), "X-Gemach": A.slug };
  const sc = { Gemach: [A.id], "Gemach Slug": [A.slug] };
  DB.Borrowers.push(rec("recBORRHOLD000001", { Name: "Moshe Wasserman", ...sc }));
  DB.Loans.push(
    rec("recLOANHOLD000001", { "Loan ID": "L-901", Status: "Reserved", Borrower: ["recBORRHOLD000001"], "Item to Reserve": ["recTYPEA000000001"], "Reservation Start": "2026-10-02", ...sc }),
    rec("recLOANHOLD000002", { "Loan ID": "L-902", Status: "Reserved", Borrower: ["recBORRHOLD000001"], "Item to Reserve": ["recTYPEA000000001"], Item: ["recITEMA000000001"], "Reservation Start": "2026-10-03", ...sc }), // unit already chosen
    rec("recLOANHOLD000003", { "Loan ID": "L-903", Status: "Cancelled", Borrower: ["recBORRHOLD000001"], "Item to Reserve": ["recTYPEA000000001"], ...sc }));
  const plain = await (await call("/admin/inventory", { headers: H })).json();
  assert.ok(Array.isArray(plain), "without ?holds the old list shape is kept");
  assert.equal(plain.find(i => i.itemId === "WC-001").itemTypeId, "recTYPEA000000001");
  const d = await (await call("/admin/inventory?holds=1", { headers: H })).json();
  assert.ok(Array.isArray(d.items) && d.items.length === plain.length);
  const mine = d.holds.filter(h => h.borrowerName === "Moshe Wasserman");
  assert.deepEqual(mine.map(h => h.loanId), ["L-901"], "only the reservation with no unit, not cancelled");
  assert.equal(mine[0].itemTypeId, "recTYPEA000000001"); assert.equal(mine[0].itemTypeName, "Wheelchair"); assert.equal(mine[0].reservationStart, "2026-10-02");
  assert.ok(!d.holds.some(h => /Sweatshirt|Folding|Table/.test(h.itemTypeName || "")), "quantity and add-on types are left out");
  DB.Loans = DB.Loans.filter(l => !/^recLOANHOLD/.test(l.id));
});

await t("return reminder: stamps the loan, logs it, only for loans that are out; template saved in Settings", async () => {
  const H = { ...auth(tokenA), "X-Gemach": A.slug, "Content-Type": "application/json" };
  const sc = { Gemach: [A.id], "Gemach Slug": [A.slug] };
  DB.Loans.push(rec("recLOANREMIND0001", { "Loan ID": "L-951", Status: "Active", "Item to Reserve": ["recTYPEA000000001"], "Date Borrowed": "2026-09-01", "Expected Return": "2026-09-20", ...sc }),
    rec("recLOANREMIND0002", { "Loan ID": "L-952", Status: "Returned", ...sc }));
  let r = await call("/admin/loans/recLOANREMIND0001/reminder", { method: "POST", headers: H, body: JSON.stringify({ via: "whatsapp" }) });
  assert.equal(r.status, 200, await r.clone().text());
  const at = (await r.json()).reminderSentAt;
  assert.equal(DB.Loans.find(l => l.id === "recLOANREMIND0001").fields["Reminder Sent At"], at);
  await Promise.allSettled(waits);
  const log = DB["tblC3PY7f5sXQDMJK"].find(l => l.fields["Event Type"] === "Return Reminder Sent" && l.fields["Loan ID"] === "L-951");
  assert.ok(log && log.fields.Notes === "Sent by WhatsApp" && log.fields.Gemach[0] === A.id);
  const loans = await (await call("/admin/loans", { headers: H })).json();
  assert.equal(loans.find(l => l.id === "recLOANREMIND0001").reminderSentAt, at);
  assert.equal((await call("/admin/loans/recLOANREMIND0002/reminder", { method: "POST", headers: H, body: "{}" })).status, 409);
  assert.equal((await call("/admin/loans/recLOANREMIND0001/reminder", { method: "POST", headers: { ...auth(tokenA), "X-Gemach": B.slug, "Content-Type": "application/json" }, body: "{}" })).status >= 400, true, "other gemach can't");
  r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ returnReminderMessage: "Hi {first_name}, please bring back {items}." }) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).templates.returnReminder, "Hi {first_name}, please bring back {items}.");
  assert.equal(DB.Gemachs.find(g => g.id === A.id).fields["Return Reminder Message"], "Hi {first_name}, please bring back {items}.");
  // Email is sent by the server to the borrower's address on file
  DB.Borrowers.push(rec("recBORRMAIL000001", { Name: "Mail Person", Email: "mail.person@example.com", Gemach: [A.id], "Gemach Slug": [A.slug] }));
  DB.Loans.push(rec("recLOANREMIND0003", { "Loan ID": "L-953", Status: "Active", Borrower: ["recBORRMAIL000001"], "Item to Reserve": ["recTYPEA000000001"], Gemach: [A.id], "Gemach Slug": [A.slug] }),
    rec("recLOANREMIND0004", { "Loan ID": "L-954", Status: "Reserved", Borrower: ["recBORRMAIL000001"], "Item to Reserve": ["recTYPEA000000001"], Gemach: [A.id], "Gemach Slug": [A.slug] }));
  const n0 = resendCalls().length;
  assert.equal((await call("/admin/loans/recLOANREMIND0003/reminder", { method: "POST", headers: H, body: JSON.stringify({ via: "email", message: "  " }) })).status, 400, "empty message refused");
  r = await call("/admin/loans/recLOANREMIND0003/reminder", { method: "POST", headers: H, body: JSON.stringify({ via: "email", message: "Hi Mail, please return the Wheelchair.", email: "attacker@example.com" }) });
  assert.equal(r.status, 200, await r.clone().text());
  const mail = resendCalls().slice(n0).filter(m => m.to[0] !== "alerts@example.com");
  assert.equal(mail.length, 1); assert.equal(mail[0].to[0], "mail.person@example.com", "address from Airtable, not the request");
  assert.match(mail[0].subject, /^Reminder: please return the Wheelchair — /);
  assert.match(mail[0].text, /^Hi Mail, please return the Wheelchair\./); assert.ok(mail[0].html.includes("please return the Wheelchair"));
  assert.equal(DB.Loans.find(l => l.id === "recLOANREMIND0003").fields["Reminder Sent Via"], "email");
  assert.equal((await call("/admin/loans/recLOANREMIND0001/reminder", { method: "POST", headers: H, body: JSON.stringify({ via: "email", message: "x" }) })).status, 400, "borrower without email");
  resendFail = true;
  const before = DB.Loans.find(l => l.id === "recLOANREMIND0003").fields["Reminder Sent At"];
  r = await call("/admin/loans/recLOANREMIND0003/reminder", { method: "POST", headers: H, body: JSON.stringify({ via: "email", message: "again" }) });
  resendFail = false;
  assert.equal(r.status, 422); assert.match((await r.json()).error, /didn't go through/);
  assert.equal(DB.Loans.find(l => l.id === "recLOANREMIND0003").fields["Reminder Sent At"], before, "failed email isn't recorded");
  // Pickup details by email
  const n1 = resendCalls().length;
  r = await call("/admin/loans/recLOANREMIND0004/pickup-email", { method: "POST", headers: H, body: JSON.stringify({ message: "Your Wheelchair is ready at 507 Walton Court." }) });
  assert.equal(r.status, 200, await r.clone().text());
  const pm = resendCalls().slice(n1).filter(m => m.to[0] !== "alerts@example.com");
  assert.equal(pm.length, 1); assert.equal(pm[0].to[0], "mail.person@example.com"); assert.match(pm[0].subject, /^Pickup details — /);
  assert.equal((await call("/admin/loans/recLOANREMIND0002/pickup-email", { method: "POST", headers: H, body: JSON.stringify({ message: "x" }) })).status, 409, "returned loan");
  assert.equal((await call("/admin/loans/recLOANREMIND0004/pickup-email", { method: "POST", headers: { ...auth(tokenA), "X-Gemach": B.slug, "Content-Type": "application/json" }, body: JSON.stringify({ message: "x" }) })).status >= 400, true, "other gemach can't");
  DB.Loans = DB.Loans.filter(l => !/^recLOANREMIND/.test(l.id));
});

{
  const R = await import("../src/reminders.js");
  await t("reminders: which reminder is due (before / overdue / repeat / never twice a day)", async () => {
    const due = (expected, today, lastSent, before = 2, repeat = 7) => R.reminderDue({ expected, today, lastSent, before, repeat });
    assert.equal(due("2026-10-10", "2026-10-07", null), null, "3 days out: too early");
    assert.equal(due("2026-10-10", "2026-10-08", null), "before", "2 days before");
    assert.equal(due("2026-10-10", "2026-10-09", null), "before", "missed yesterday: still sent");
    assert.equal(due("2026-10-10", "2026-10-09", "2026-10-08"), null, "already reminded in the window");
    assert.equal(due("2026-10-10", "2026-10-09", "2026-10-01"), "before", "an older reminder doesn't count");
    assert.equal(due("2026-10-10", "2026-10-10", null, 0), "before", "0 = on the due date");
    assert.equal(due("2026-10-10", "2026-10-11", "2026-10-08"), "overdue", "first overdue: the day after");
    assert.equal(due("2026-10-10", "2026-10-11", "2026-10-11"), null, "never twice a day");
    assert.equal(due("2026-10-10", "2026-10-15", "2026-10-11"), null, "repeat not yet");
    assert.equal(due("2026-10-10", "2026-10-18", "2026-10-11"), "overdue", "repeat after 7 days");
    assert.equal(due("2026-10-10", "2026-10-11", null, 2, 0), null, "repeat 0: no overdue reminders");
    assert.equal(due("", "2026-10-11", null), null, "no due date: never");
  });
  await t("reminders: template filling matches admin (dates, blanks dropped, link)", async () => {
    const g = { name: "WH Medical", rawTemplates: {} };
    const m = R.reminderMessage(g, { firstName: "Moshe", items: "Wheelchair", borrowed: "2026-09-04", expected: "2026-10-01", today: "2026-10-05", link: "https://whgemachs.org/r/x" });
    assert.match(m, /^Hi Moshe, a friendly reminder from the WH Medical: the Wheelchair you borrowed on Fri, Sep 4 was due back on Thu, Oct 1\. Please let us know/);
    assert.match(m, /Manage your loan: https:\/\/whgemachs\.org\/r\/x\n\nThank you!$/);
    const n = R.reminderMessage(g, { firstName: "Leah", items: "Chairs × 40", borrowed: "2026-10-03", expected: "2026-10-07", today: "2026-10-05", link: null });
    assert.match(n, /Chairs × 40 you borrowed on Sat, Oct 3 is due back on Wed, Oct 7\./);
    assert.ok(!/Manage your loan/.test(n), "no link: the line is dropped");
    const c = R.reminderMessage({ name: "X", rawTemplates: { returnReminder: "Hi {first_name}, {items} {due_back}. Out {days_out} days." } }, { firstName: "A", items: "Walker", borrowed: "2026-10-01", expected: "2026-10-05", today: "2026-10-05", link: "https://l" });
    assert.equal(c, "Hi A, Walker is due back today. Out 4 days.\n\nManage your loan: https://l", "custom template; link line added when the template has none");
  });
  await t("reminders: daily run emails due/overdue borrowers once, stamps + logs, dry run sends nothing", async () => {
    const G = { id: "recREMGEMACH00001", slug: "rem-gemach" };
    const sc = { Gemach: [G.id], "Gemach Slug": [G.slug] };
    DB.Gemachs.push(rec(G.id, { Name: "Reminder Gemach", Slug: G.slug, Active: true, Mode: "Full", Email: "rem@example.com", "Auto Reminders": true, "Reminder Days Before": 2, "Reminder Repeat Days": 7 }),
      rec("recREMGEMACHOFF01", { Name: "No Reminders", Slug: "no-rem", Active: true, Mode: "Full" }));
    DB["Item Types"].push(rec("recREMTYPE0000001", { Name: "Walker", Active: true, ...sc }), rec("recREMTYPE0000002", { Name: "Folding Chair", Active: true, Tracking: "Quantity", "Quantity Owned": 50, ...sc }));
    DB.Borrowers.push(rec("recREMBORROWER001", { Name: "Dina Katz", Email: "dina@example.com", ...sc }), rec("recREMBORROWER002", { Name: "Phone Only", Phone: "5165550000", ...sc }));
    const L = (id, f) => rec(id, { Status: "Active", Borrower: ["recREMBORROWER001"], "Item to Reserve": ["recREMTYPE0000001"], "Date Borrowed": "2026-09-20", ...sc, ...f });
    DB.Loans.push(
      L("recREMLOAN0000001", { "Loan ID": "L-R1", "Expected Return": "2026-10-07" }),                                    // 2 days out → before
      L("recREMLOAN0000002", { "Loan ID": "L-R2", "Expected Return": "2026-10-04", "Item to Reserve": ["recREMTYPE0000002"], Quantity: 20 }), // overdue 1 day → overdue
      L("recREMLOAN0000003", { "Loan ID": "L-R3", "Expected Return": "2026-10-01", "Reminder Sent At": "2026-10-03T14:00:00.000Z" }), // repeat not yet
      L("recREMLOAN0000004", { "Loan ID": "L-R4", "Expected Return": "2026-10-06", Borrower: ["recREMBORROWER002"] }),     // no email
      L("recREMLOAN0000005", { "Loan ID": "L-R5" }),                                                                     // open-ended: never
      L("recREMLOAN0000006", { "Loan ID": "L-R6", "Expected Return": "2026-10-20" }),                                    // too early
      rec("recREMLOAN0000007", { "Loan ID": "L-R7", Status: "Active", Borrower: ["recREMBORROWER001"], "Expected Return": "2026-10-06", Gemach: ["recREMGEMACHOFF01"], "Gemach Slug": ["no-rem"] })); // gemach has it off
    const now = Date.parse("2026-10-05T14:00:00Z");
    const before = resendCalls().length;
    const dry = await R.runReminders(env, ctx, { now, dryRun: true });
    assert.deepEqual(dry.sent.map(x => x.loanId).sort(), ["L-R1", "L-R2"]);
    assert.equal(dry.noEmail, 1);
    assert.equal(resendCalls().length, before, "dry run sends nothing");
    assert.ok(!DB.Loans.find(l => l.id === "recREMLOAN0000001").fields["Reminder Sent At"], "dry run changes nothing");

    const run = await R.runReminders(env, ctx, { now });
    await Promise.allSettled(waits);
    assert.deepEqual(run.sent.map(x => [x.loanId, x.kind]).sort(), [["L-R1", "before"], ["L-R2", "overdue"]]);
    const mails = resendCalls().slice(before);
    assert.equal(mails.length, 2);
    const m1 = mails.find(m => /Walker/.test(m.subject));
    assert.equal(m1.to[0], "dina@example.com"); assert.equal(m1.reply_to, "rem@example.com");
    assert.match(m1.subject, /^Reminder: Walker due back Wed, Oct 7 — Reminder Gemach$/);
    assert.match(m1.text, /^Hi Dina, a friendly reminder from the Reminder Gemach: the Walker you borrowed on Sun, Sep 20 is due back on Wed, Oct 7\./);
    const m2 = mails.find(m => /Folding Chair/.test(m.subject));
    assert.match(m2.subject, /^Reminder: please return the Folding Chair × 20/);
    assert.match(m2.text, /was due back on Sun, Oct 4/);
    const l1 = DB.Loans.find(l => l.id === "recREMLOAN0000001").fields;
    assert.equal(l1["Reminder Sent At"], new Date(now).toISOString()); assert.equal(l1["Reminder Sent Via"], "Email (automatic)");
    const lg = DB["tblC3PY7f5sXQDMJK"].filter(x => x.fields["Event Type"] === "Return Reminder Sent" && x.fields.Admin === "Automatic");
    assert.ok(lg.some(x => x.fields["Loan ID"] === "L-R2" && /\(overdue\)/.test(x.fields.Notes)) && lg.every(x => x.fields.Gemach[0] === G.id));

    const again = await R.runReminders(env, ctx, { now: now + 3600e3 });
    assert.equal(again.sent.length, 0, "a second run the same day sends nothing");
    assert.equal(typeof worker.scheduled, "function", "daily cron handler exported");
    const loans = await (await call("/admin/loans", { headers: { ...auth(await sign({ email: "n@x", name: "N", role: "Network Admin", gemachs: [] })), "X-Gemach": G.slug } })).json();
    const v = Array.isArray(loans) ? loans.find(l => l.id === "recREMLOAN0000001") : null;
    assert.equal(v && v.reminderSentVia, "Email (automatic)", "admin sees how it was sent");
    DB.Loans = DB.Loans.filter(l => !/^recREMLOAN/.test(l.id));
  });
  await t("reminders: settings — on/off, days before, repeat; validated", async () => {
    const tokNet2 = await sign({ email: "n@x", name: "N", role: "Network Admin", gemachs: [] });
    const H = { ...auth(tokNet2), "X-Gemach": "rem-gemach", "Content-Type": "application/json" };
    let r = await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ autoReminders: false, reminderDaysBefore: 3, reminderRepeatDays: 0 }) });
    assert.equal(r.status, 200, await r.clone().text());
    const d = await r.json();
    assert.equal(d.autoReminders, false); assert.equal(d.reminderDaysBefore, 3); assert.equal(d.reminderRepeatDays, 0);
    assert.equal((await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ reminderRepeatDays: 31 }) })).status, 400);
    assert.equal((await call("/admin/gemach", { method: "PATCH", headers: H, body: JSON.stringify({ reminderDaysBefore: 15 }) })).status, 400);
  });
}

await t("network: edit a gemach's name, email, phone, display order; email/phone not blanked here", async () => {
  DB.Gemachs.push(rec("recNETEDITGEMACH1", { Name: "Edit Me", Slug: "edit-me", Active: true, Mode: "Full", Email: "old@example.com", Phone: "111" }));
  X.clearMemo();
  let r = await req(tokNet, "PATCH", "/admin/network/gemachs/recNETEDITGEMACH1", { name: "Edited Gemach", email: " new@example.com ", phone: "516-555-1212", displayOrder: 5 });
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.deepEqual([d.name, d.email, d.phone, d.displayOrder], ["Edited Gemach", "new@example.com", "516-555-1212", 5]);
  assert.equal((await req(tokNet, "PATCH", "/admin/network/gemachs/recNETEDITGEMACH1", { email: "" })).status, 400);
  assert.equal((await req(tokNet, "PATCH", "/admin/network/gemachs/recNETEDITGEMACH1", { email: "nope" })).status, 400);
  r = await req(tokNet, "PATCH", "/admin/network/gemachs/recNETEDITGEMACH1", { name: "Edited Gemach", email: "new@example.com" });
  assert.equal(r.status, 200, "unchanged values are fine");
  assert.equal((await req(tokNet, "PATCH", "/admin/network/gemachs/recNETEDITGEMACH1", { slug: "other-addr" })).status, 400, "web address only while hidden");
});

// ─── Team: owners manage their gemach's admins ─────────────────────────────────
{
  DB.Gemachs.push(rec("recTEAMGEMACH0001", { Name: "Team Gemach", Slug: "team-gemach", Active: true, Mode: "Full" }),
                  rec("recTEAMOTHER00001", { Name: "Other Team Gemach", Slug: "team-other", Active: true, Mode: "Full" }));
  DB.Admins.push(
    rec("recTEAMOWNER00001", { Name: "Olivia Owner", Email: "olivia@example.com", Active: true, Role: "Owner", Gemachs: ["recTEAMGEMACH0001"] }),
    rec("recTEAMMGR0000001", { Name: "Moe Manager", Email: "moe@example.com", Active: true, Role: "Manager", Gemachs: ["recTEAMGEMACH0001"] }),
    rec("recTEAMSHARED0001", { Name: "Sam Shared", Email: "sam@example.com", Active: true, Role: "Volunteer", Gemachs: ["recTEAMGEMACH0001", "recTEAMOTHER00001"] }),
    rec("recTEAMELSEWHERE1", { Name: "Ella Else", Email: "ella@example.com", Active: true, Role: "Manager", Gemachs: ["recTEAMOTHER00001"] }),
    rec("recTEAMGONE000001", { Name: "Gus Gone", Email: "gus@example.com", Active: false, Role: "Volunteer", Gemachs: [] }),
    rec("recTEAMOFF0000001", { Name: "Otto Off", Email: "otto@example.com", Active: false, Role: "Volunteer", Gemachs: ["recTEAMOTHER00001"] }),
  );
  X.clearMemo();
  const G = { id: "recTEAMGEMACH0001", slug: "team-gemach", name: "Team Gemach" };
  const tokOwner = await sign({ email: "olivia@example.com", name: "Olivia Owner", role: "Owner", gemachs: [G] });
  const tokMgr = await sign({ email: "moe@example.com", name: "Moe Manager", role: "Manager", gemachs: [G] });
  const TH = (tok, extra) => ({ ...auth(tok), "X-Gemach": G.slug, "Content-Type": "application/json", ...extra });
  const team = (tok, method, path, body) => call(path, { method, headers: TH(tok), body: body === undefined ? undefined : JSON.stringify(body) });
  const row = id => DB.Admins.find(r => r.id === id).fields;

  await t("team: only owners (and network admins) can see or change it; canManageTeam in the gemach payload", async () => {
    assert.equal((await team(tokMgr, "GET", "/admin/team")).status, 403);
    assert.equal((await team(tokMgr, "POST", "/admin/team", { name: "X", email: "x@example.com", role: "Volunteer" })).status, 403);
    assert.equal((await (await team(tokMgr, "GET", "/admin/gemach")).json()).canManageTeam, false);
    assert.equal((await (await team(tokOwner, "GET", "/admin/gemach")).json()).canManageTeam, true);
    const r = await team(tokOwner, "GET", "/admin/team");
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.deepEqual(d.members.map(m => m.email), ["olivia@example.com", "moe@example.com", "sam@example.com"], "owners first; not other gemachs' people, not turned off");
    assert.equal(d.members[0].you, true);
    assert.deepEqual(d.members[2].otherGemachs, ["Other Team Gemach"]);
    const net = await call("/admin/team", { headers: { ...auth(tokNet), "X-Gemach": G.slug } });
    assert.equal(net.status, 200, "network admin too");
  });

  await t("team: add a new person (invite email names the role and who added them); duplicates refused", async () => {
    const before = resendCalls().length;
    let r = await team(tokOwner, "POST", "/admin/team", { name: "Vera Vol", email: " Vera@Example.com ", role: "Volunteer", sendInvite: true });
    assert.equal(r.status, 201, await r.clone().text());
    const d = await r.json();
    assert.equal(d.email, "vera@example.com"); assert.equal(d.role, "Volunteer"); assert.equal(d.invited, true); assert.equal(d.linked, false);
    const added = DB.Admins.find(x => x.fields.Email === "vera@example.com").fields;
    assert.deepEqual(added.Gemachs, [G.id]); assert.equal(added.Active, true);
    const mail = resendCalls().slice(before).at(-1);
    assert.deepEqual(mail.to, ["vera@example.com"]);
    assert.match(mail.text, /Olivia Owner added you as an admin of Team Gemach/);
    assert.match(mail.text, /Your role: Volunteer/);
    assert.equal((await team(tokOwner, "POST", "/admin/team", { name: "Vera", email: "vera@example.com", role: "Volunteer" })).status, 409, "already on the team");
    assert.equal((await team(tokOwner, "POST", "/admin/team", { name: "N", email: "net@example.com", role: "Owner" })).status, 409, "network admin");
    assert.equal((await team(tokOwner, "POST", "/admin/team", { name: "", email: "q@example.com", role: "Owner" })).status, 400);
    assert.equal((await team(tokOwner, "POST", "/admin/team", { name: "Q", email: "nope", role: "Owner" })).status, 400);
    assert.equal((await team(tokOwner, "POST", "/admin/team", { name: "Q", email: "q@example.com", role: "Network Admin" })).status, 400, "owners can't make network admins");
  });

  await t("team: someone from another gemach is linked, keeping their one role; removed people come back; turned-off accounts don't", async () => {
    let r = await team(tokOwner, "POST", "/admin/team", { name: "Ella", email: "ella@example.com", role: "Volunteer" });
    assert.equal(r.status, 409, "different role than they have elsewhere");
    assert.equal((await r.json()).role, "Manager");
    r = await team(tokOwner, "POST", "/admin/team", { name: "Ella", email: "ella@example.com", role: "Manager" });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).linked, true);
    assert.deepEqual(row("recTEAMELSEWHERE1").Gemachs, ["recTEAMOTHER00001", G.id]);
    assert.equal(row("recTEAMELSEWHERE1").Name, "Ella Else", "existing name kept");
    r = await team(tokOwner, "POST", "/admin/team", { name: "Gus G", email: "gus@example.com", role: "Owner" });
    assert.equal(r.status, 201);
    assert.deepEqual([row("recTEAMGONE000001").Active, row("recTEAMGONE000001").Role, row("recTEAMGONE000001").Name], [true, "Owner", "Gus G"]);
    assert.equal((await team(tokOwner, "POST", "/admin/team", { name: "Otto", email: "otto@example.com", role: "Volunteer" })).status, 409, "turned off by a network admin");
    assert.equal(row("recTEAMOFF0000001").Active, false);
  });

  await t("team: edit name/role; not your own role; not the role of someone on another team", async () => {
    let r = await team(tokOwner, "PATCH", "/admin/team/recTEAMMGR0000001", { name: "Moe M", role: "Owner" });
    assert.equal(r.status, 200);
    assert.deepEqual([row("recTEAMMGR0000001").Name, row("recTEAMMGR0000001").Role], ["Moe M", "Owner"]);
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recTEAMOWNER00001", { role: "Manager" })).status, 400, "own role");
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recTEAMOWNER00001", { name: "Olivia O" })).status, 200, "own name ok");
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recTEAMSHARED0001", { role: "Manager" })).status, 409, "shared with another gemach");
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recTEAMSHARED0001", { role: "Volunteer" })).status, 200, "same role is fine");
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recTEAMMGR0000001", { role: "Boss" })).status, 400);
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recADMIN000000001", { name: "Not mine" })).status, 404, "other gemach's admin");
    // promoted Moe is an owner now: his (stale Manager) token is checked live
    assert.equal((await team(tokMgr, "GET", "/admin/team")).status, 200);
    row("recTEAMMGR0000001").Role = "Manager"; X.clearMemo();
  });

  await t("team: remove unlinks this gemach (account off when it was the only one) and takes effect without re-login", async () => {
    const tokVera = await sign({ email: "vera@example.com", name: "Vera Vol", role: "Volunteer", gemachs: [G] });
    assert.equal((await team(tokVera, "GET", "/admin/dashboard")).status, 200);
    const vera = DB.Admins.find(x => x.fields.Email === "vera@example.com");
    let r = await team(tokOwner, "DELETE", `/admin/team/${vera.id}`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).deactivated, true);
    assert.deepEqual([vera.fields.Active, vera.fields.Gemachs], [false, []]);
    assert.equal((await team(tokVera, "GET", "/admin/dashboard")).status, 401, "lost access right away");
    r = await team(tokOwner, "DELETE", "/admin/team/recTEAMSHARED0001");
    assert.equal((await r.json()).deactivated, false);
    assert.deepEqual([row("recTEAMSHARED0001").Active, row("recTEAMSHARED0001").Gemachs], [true, ["recTEAMOTHER00001"]]);
    const tokSam = await sign({ email: "sam@example.com", name: "Sam", role: "Volunteer", gemachs: [G, { id: "recTEAMOTHER00001", slug: "team-other", name: "Other" }] });
    assert.equal((await team(tokSam, "GET", "/admin/dashboard")).status, 403, "not on this team any more");
    assert.equal((await call("/admin/dashboard", { headers: { ...auth(tokSam), "X-Gemach": "team-other" } })).status, 200, "still on the other one");
    assert.equal((await team(tokOwner, "DELETE", "/admin/team/recTEAMOWNER00001")).status, 400, "not yourself");
    assert.equal((await team(tokOwner, "DELETE", "/admin/team/recTEAMSHARED0001")).status, 404, "already off");
  });

  await t("team: network admins linked to the gemach are listed (read-only); Last Active stamped by /admin/me at most hourly", async () => {
    DB.Admins.push(rec("recTEAMNETLINKED1", { Name: "Nate Net", Email: "nate@example.com", Active: true, Role: "Network Admin", Gemachs: [G.id] }));
    X.clearMemo();
    let d = await (await team(tokOwner, "GET", "/admin/team")).json();
    const nate = d.members.find(m => m.email === "nate@example.com");
    assert.ok(nate && nate.network === true && nate.role === "Network Admin", "linked network admin listed");
    assert.equal(d.members.findIndex(m => m.network), d.members.filter(m => m.role === "Owner").length, "right after the owners");
    assert.ok(!d.members.some(m => m.email === "net@example.com"), "unlinked network admins not listed");
    assert.equal((await team(tokOwner, "PATCH", "/admin/team/recTEAMNETLINKED1", { name: "x" })).status, 404, "not editable here");
    assert.equal((await team(tokOwner, "DELETE", "/admin/team/recTEAMNETLINKED1")).status, 404, "not removable here");
    // Last Active
    const o = row("recTEAMOWNER00001");
    delete o["Last Active"];
    const writes = () => calls.filter(c => c.method === "PATCH" && c.url.includes("/Admins") && /Last Active/.test(c.body || "")).length;
    const before = writes();
    await call("/admin/me", { headers: auth(tokOwner) }); await Promise.allSettled(waits);
    assert.ok(o["Last Active"] && Date.now() - Date.parse(o["Last Active"]) < 60000, "stamped");
    assert.equal(writes(), before + 1);
    await call("/admin/me", { headers: auth(tokOwner) }); await Promise.allSettled(waits);
    assert.equal(writes(), before + 1, "not again within the hour");
    o["Last Active"] = new Date(Date.now() - 2 * 3600e3).toISOString();
    await call("/admin/me", { headers: auth(tokOwner) }); await Promise.allSettled(waits);
    assert.equal(writes(), before + 2, "again after an hour");
    d = await (await team(tokOwner, "GET", "/admin/team")).json();
    assert.ok(d.members.find(m => m.you).lastActive, "team list carries lastActive");
    assert.equal(d.members.find(m => m.email === "moe@example.com").lastActive, null);
    const na = await (await call("/admin/network/admins", { headers: auth(tokNet) })).json();
    assert.ok(na.find(a => a.email === "olivia@example.com").lastActive, "network list carries lastActive");
  });

  await t("team: resend invite; a removed owner can't manage the team any more", async () => {
    const before = resendCalls().length;
    assert.equal((await team(tokOwner, "POST", "/admin/team/recTEAMMGR0000001/invite")).status, 200);
    assert.deepEqual(resendCalls().slice(before).at(-1).to, ["moe@example.com"]);
    assert.equal((await team(tokOwner, "POST", "/admin/team/recTEAMOWNER00001/invite")).status, 400, "not to yourself");
    row("recTEAMOWNER00001").Role = "Manager"; // demoted by a network admin; the token still says Owner
    X.clearMemo();
    assert.equal((await team(tokOwner, "GET", "/admin/team")).status, 403);
    row("recTEAMOWNER00001").Role = "Owner"; X.clearMemo();
  });
}

await Promise.allSettled(waits);
const logs = DB["tblC3PY7f5sXQDMJK"];
await t("activity log entries stamped with Gemach", async () => {
  assert.ok(logs.length > 0);
  for (const l of logs) assert.ok(Array.isArray(l.fields.Gemach) && l.fields.Gemach.length === 1);
});
console.log(`${pass} passed`);
