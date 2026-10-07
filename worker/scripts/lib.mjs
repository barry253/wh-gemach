// Shared helpers for the D1 migration scripts (run by .github/workflows/d1.yml, or locally with
// the same environment variables). Nothing here is bundled into the worker.
//   AIRTABLE_TOKEN, AIRTABLE_BASE_ID   read the Airtable base
//   CLOUDFLARE_API_TOKEN               D1 read/write (account found automatically)
//   D1_DATABASE_ID                     the wh-gemach D1 database

export const need = name => {
  const v = process.env[name];
  if (!v) { console.error(`Missing environment variable ${name}`); process.exit(2); }
  return v;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Every record of an Airtable table (all fields), oldest first. */
export async function airtableAll(table) {
  const token = need("AIRTABLE_TOKEN"), base = need("AIRTABLE_BASE_ID");
  const out = [];
  let offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`);
    u.searchParams.set("pageSize", "100");
    if (offset) u.searchParams.set("offset", offset);
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429 && attempt < 5) { await sleep(1000 * 2 ** attempt); continue; }
      break;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`Airtable ${table}: ${res.status} ${JSON.stringify(data)}`);
    out.push(...data.records);
    offset = data.offset || null;
    await sleep(220); // stay under 5 requests/second
  } while (offset);
  return out.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
}

let accountId = null;
async function cf(path, init = {}) {
  const token = need("CLOUDFLARE_API_TOKEN");
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(`Cloudflare ${path}: ${res.status} ${JSON.stringify(data.errors || data)}`);
  return data;
}
async function account() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const d = await cf("/accounts");
    if (d.result.length !== 1) throw new Error(`token sees ${d.result.length} accounts; set CLOUDFLARE_ACCOUNT_ID`);
    accountId = d.result[0].id;
  }
  return accountId;
}

/** One SQL statement against the real D1 database over the REST API. */
export async function d1Query(sql, params = []) {
  const id = need("D1_DATABASE_ID");
  const d = await cf(`/accounts/${await account()}/d1/database/${id}/query`, { method: "POST", body: JSON.stringify({ sql, params }) });
  return d.result[0];
}

/**
 * A read-only stand-in for the worker's D1 binding, backed by the REST API (for comparing the
 * worker's answers on D1 with its answers on Airtable). Writes are refused.
 */
export function readOnlyD1Binding() {
  const isRead = q => /^\s*SELECT/i.test(q);
  const stmt = (q, params) => ({
    bind: (...p) => stmt(q, p), _q: q, _params: params,
    async all() {
      if (!isRead(q)) throw new Error("compare run: D1 writes are blocked");
      const r = await d1Query(q, params);
      return { results: r.results, success: true, meta: r.meta };
    },
    async first() { return (await this.all()).results[0] ?? null; },
    async run() { throw new Error("compare run: D1 writes are blocked"); },
  });
  return {
    prepare: q => stmt(q, []),
    async batch(stmts) {
      if (stmts.some(s => !isRead(s._q))) throw new Error("compare run: D1 writes are blocked");
      return Promise.all(stmts.map(s => s.all()));
    },
  };
}
