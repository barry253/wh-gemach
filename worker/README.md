# Gemach Network API (Cloudflare Worker)

The API behind whgemachs.org: public directory and gemach pages, the request form, and everything in
the admin page. Worker name **wh-gemach**, served at `https://api.whgemachs.org` and
`https://wh-gemach.barry253-0f5.workers.dev`. Data lives in Airtable; photos and logos in the R2 bucket
`wh-gemach-assets`; email goes out through Resend.

## How changes go live

1. Changes are made on a branch and pushed; GitHub Actions runs the worker tests + browser tests.
2. Barry approves the change (in the Claude conversation), and Claude merges the branch into `main`.
3. Cloudflare **Workers Builds** runs `npm test` and, only if every test passes,
   `npx wrangler deploy`. A failing test means nothing is deployed.
4. If something goes wrong anyway: Cloudflare dashboard → Workers & Pages → wh-gemach → **Deployments**
   → roll back to the previous version (one click, instant).

Never paste code into the dashboard editor any more — the next deploy from GitHub would overwrite it.

### Settings that live where

| What | Where | Notes |
|---|---|---|
| Code | `worker/src/` | bundled by Wrangler into one script |
| Bindings, domain, logs | `worker/wrangler.toml` | R2 bucket, `api.whgemachs.org`, workers.dev, Observability |
| Plain variables (`AIRTABLE_BASE_ID`, `FROM_EMAIL`, `ALERT_EMAIL`, `NOTIFY_EMAIL`, `ASSETS_URL`, …) | Cloudflare dashboard | kept on deploy because of `keep_vars = true` |
| Secrets (`AIRTABLE_TOKEN`, `GEMACH_JWT`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`) | Cloudflare dashboard | never touched by deploys |

## Working on it locally

```sh
cd worker
npm install
npm test          # the API tests twice: against a fake Airtable, then against D1 (Node's built-in SQLite)
npm run check     # bundles exactly as a deploy would, without deploying
npm run schema    # regenerate schema.sql after changing src/dbschema.js (a test checks they match)
```

Browser tests for the site and admin page are in `../tests` (`cd tests && npm install && npx playwright install chromium && npm test`).

## Where things are

| File | What it does |
|---|---|
| `index.js` | Entry point: routing, CORS, admin session handling, env var list (top comment) |
| `config.js` | Constants: table names, allowed origins, cache timings |
| `http.js` | JSON responses and CORS headers |
| `db.js` | Picks the data layer: Airtable, or D1 when `DB_BACKEND` = `d1` |
| `query.js` | Structured query conditions (`Q.eq`, `Q.in`, …) and their Airtable formulas |
| `airtable.js` | Airtable client (concurrency limit, 429 retry, paging) and record helpers |
| `d1.js` | D1 client with the same calls and Airtable-shaped records |
| `dbschema.js` / `../schema.sql` | How each Airtable table and field maps to D1 tables, columns and views |
| `gemachs.js` | Loading a gemach by slug/id, admin gemach resolution |
| `auth.js` | Google sign-in, admin lookup, session tokens (JWT) |
| `dates.js` | New York dates, event-date rule, calendar invites |
| `requests.js` | Admin request list, confirm/decline, appointments, reservations from requests |
| `quantity.js` | Quantity-tracked item types (e.g. 60 folding chairs) and date-range availability |
| `loans.js` | Loans and reservations: lists, pickup, return, cancel, assigning units |
| `booking.js` | Admin "Edit": a request + its open reservations / loans edited as one (contact, dates, items, cancel) |
| `checkout.js` | Lending at the counter: appointment check-out, "Nothing borrowed" / "No-show", walk-in loans |
| `ids.js` / `borrowers.js` | Loan/request/item ids; borrower matching |
| `inventory.js` | Admin inventory screen |
| `public.js` / `cache.js` | Public directory + gemach pages and their resilient cache |
| `submit.js` | The public request form (validation, availability check, notification) |
| `activity.js` | Activity Log (History) |
| `search.js` | "Searches with no results" log |
| `stats.js` | Dashboard tiles and "How it's going" stats |
| `alerts.js` | `/health` and failure alert emails |
| `email.js` | Resend sending, the new-request email, HTML email layout |
| `settings.js` | Gemach Settings (profile, branding, templates, logo upload) |
| `network.js` | Network Admin: gemachs, admins, categories |
| `catalog.js` | Item types, items, photo uploads |

The tests import `src/index.js` directly and also pass against the bundled output.

## Admin notifications (Web Push)
`src/push.js` sends lock-screen notifications to admins' devices (new request, borrower cancelled, ready to return,
and site alerts for Network Admins). Devices are stored in D1 `push_subscriptions`; the admin page's 🔔 manages them
and `site/admin-sw.js` shows them. It's off until the secret `VAPID_PRIVATE_KEY` is set — a P-256 private key as a
JWK JSON string. To make one (any computer with Node 20+):

    node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(JSON.stringify(j)))"

Paste the whole `{...}` line as the secret (Cloudflare → wh-gemach → Settings → Variables and Secrets → Add → Secret).
Changing it later makes every device turn notifications on again.
