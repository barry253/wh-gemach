// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Test link ("Test as a borrower") ──────────────────────────────────────────
// A gemach that isn't Live (status Hidden or Coming soon) has a shareable test link:
//   https://whgemachs.org/g/<slug>?test=<signature>
// The signature is an HMAC (key: GEMACH_JWT) of the gemach's record id, so it can't be guessed, works for
// anyone who has it (no sign-in), and survives slug renames only by also updating the slug in the URL.
// Rotating GEMACH_JWT changes every test link.
//
// With a valid signature:
//   GET  /public/gemach/:slug?test=<sig>   the page loads even when Hidden; Coming soon is lifted; testMode:true.
//                                          Never cached (no-store) and never shared with ordinary visitors.
//   POST /submit-request {testToken}       allowed for Hidden / Coming soon; the request is saved with Test = true.
// Live gemachs ignore the signature on the page (normal page, real requests) and refuse it on submit, so
// nothing tagged Test is ever created for a gemach that's taking real loans.
// Listing-only / Info-only gemachs stay non-requestable even with the link.
//
// Admin:
//   GET  /admin/test-data         { live, testUrl, requests, loans } — the link (when not Live) and what Clear would remove
//   POST /admin/test-data/clear   deletes the gemach's Test requests, the loans made from them, borrowers left with
//                                 nothing else, and their History rows (Owner / Manager / Network Admin).

import { Q, linkedId } from "./airtable.js";
import { REC_RE, T } from "./config.js";
import { json } from "./http.js";
import { canEditGemach } from "./settings.js";

const DEFAULT_SITE_URL = "https://whgemachs.org";
const SIG_LEN = 22;
const SIG_RE = /^[A-Za-z0-9_-]{22}$/;
const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Live = Active and not Coming soon. Only non-Live gemachs have a test mode. */
const isLive = g => !!g?.active && !g?.comingSoon;

async function testSig(env, gemachId) {
  if (!env.GEMACH_JWT || !REC_RE.test(gemachId || "")) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(String(env.GEMACH_JWT)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`test-link:v1:${gemachId}`))).slice(0, SIG_LEN);
}

/** The shareable test link for gemach g, or null when it's Live (or has no slug / no secret). */
async function testUrl(env, g) {
  if (!g?.slug || isLive(g)) return null;
  const sig = await testSig(env, g.id);
  return sig ? `${String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "")}/g/${encodeURIComponent(g.slug)}?test=${sig}` : null;
}

/** True when token is gemach g's test signature (constant-time compare). Says nothing about status. */
async function validTestToken(env, g, token) {
  if (!g?.id || typeof token !== "string" || !SIG_RE.test(token)) return false;
  const want = await testSig(env, g.id);
  if (!want) return false;
  let diff = 0;
  for (let i = 0; i < SIG_LEN; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** A gemach in test mode for this token: valid signature and not Live. */
async function inTestMode(env, g, token) {
  return !!g && !isLive(g) && (await validTestToken(env, g, token));
}

const isTestRequest = rec => !!rec?.fields?.Test;

// ─── Admin: what's there, and clearing it ─────────────────────────────────────

async function findTestData(db, g) {
  const reqs = await db.listAll(T.REQUESTS, { scope: g, where: [Q.isTrue("Test")], fields: ["Request ID", "Test"] });
  const tests = reqs.filter(isTestRequest);
  if (!tests.length) return { requests: [], loans: [] };
  const ids = new Set(tests.map(r => r.id));
  const loans = (await db.listAll(T.LOANS, { scope: g, where: [Q.notBlank("Source Request")], fields: ["Loan ID", "Source Request", "Borrower"] }))
    .filter(l => (l.fields["Source Request"] || []).map(linkedId).some(id => ids.has(id)));
  return { requests: tests, loans };
}

async function handleGetTestData({ db, g, env }) {
  const { requests, loans } = await findTestData(db, g);
  return json({ live: isLive(g), testUrl: await testUrl(env, g), requests: requests.length, loans: loans.length });
}

async function handleClearTestData({ db, g, user }) {
  if (!canEditGemach(user)) return json({ error: "Only the gemach's owner or manager can clear test data." }, 403);
  const { requests, loans } = await findTestData(db, g);
  if (!requests.length) return json({ success: true, requests: 0, loans: 0, borrowers: 0, history: 0 });

  // History rows that name a test request or one of its loans (Activity Log."Loan ID" holds either).
  const refs = new Set([...requests.map(r => r.fields["Request ID"]), ...loans.map(l => l.fields["Loan ID"])].filter(Boolean));
  const borrowerIds = [...new Set(loans.map(l => linkedId((l.fields.Borrower || [])[0])).filter(Boolean))];
  const [log, borrowerLoans] = await Promise.all([
    refs.size ? db.listAll(T.LOG, { scope: g, where: [Q.in("Loan ID", [...refs])], fields: ["Loan ID"] }) : [],
    borrowerIds.length ? db.listAll(T.LOANS, { scope: g, where: [Q.notBlank("Borrower")], fields: ["Borrower"] }) : [],
  ]);
  // A borrower goes only when every loan pointing at them is one of the test loans (real history stays).
  const testLoanIds = new Set(loans.map(l => l.id));
  const keep = new Set(borrowerLoans.filter(l => !testLoanIds.has(l.id)).map(l => linkedId((l.fields.Borrower || [])[0])).filter(Boolean));
  const borrowers = borrowerIds.filter(id => !keep.has(id));
  const logIds = log.filter(r => refs.has(r.fields["Loan ID"])).map(r => r.id);

  await db.delMany(T.LOANS, loans.map(l => l.id));
  await db.delMany(T.REQUESTS, requests.map(r => r.id));
  await db.delMany(T.BORROWERS, borrowers);
  await db.delMany(T.LOG, logIds);
  return json({ success: true, requests: requests.length, loans: loans.length, borrowers: borrowers.length, history: logIds.length });
}

export { isLive, testSig, testUrl, validTestToken, inTestMode, isTestRequest, findTestData, handleGetTestData, handleClearTestData };
