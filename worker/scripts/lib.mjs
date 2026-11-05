// Shared helpers for the D1 scripts (run by the GitHub workflows, or locally with the same
// environment variables). Nothing here is bundled into the worker.
//   CLOUDFLARE_API_TOKEN               D1 access (account found automatically)
//   D1_DATABASE_ID                     the wh-gemach D1 database

export const need = name => {
  const v = process.env[name];
  if (!v) { console.error(`Missing environment variable ${name}`); process.exit(2); }
  return v;
};

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
