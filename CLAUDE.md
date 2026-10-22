# whgemachs.org — notes for Claude sessions

Repo layout:
- `site/`, `admin.html`, `embed.html` → public site + admin page, deployed by Cloudflare Pages (project `whgemachs`) from `main` via `build.sh`.
- `worker/` → the API (Cloudflare Worker `wh-gemach`), deployed by Cloudflare Workers Builds from `main` (root directory `worker`, build `npm test`, deploy `npx wrangler deploy`). See `worker/README.md`.
- `tests/` → browser tests for site and admin (Playwright, API mocked).

Rules:
- Worker code lives only in `worker/src/`. Never hand Barry a worker.js to paste into the dashboard; the GitHub deploy would overwrite a pasted version.
- Release flow (Barry's choice — he approves in chat, not on GitHub):
  1. Work on a branch; run `cd worker && npm test` and `cd tests && npm test`; push the branch (GitHub Actions runs both suites).
  2. Show Barry what changed and ask for approval in the conversation.
  3. Only after he says yes: `git fetch`, merge the branch into `main` (fast-forward or merge commit), re-run the tests, push `main`. Don't delete the branch yourself (pushes that delete branches are blocked here): `.github/workflows/cleanup-branches.yml` deletes branches already merged into main on every push to main and daily, skipping ones touched in the last hour or still level with main. Pages and Workers Builds deploy from `main`; Workers Builds re-runs the worker tests and refuses to deploy on failure.
  4. After the deploy, confirm: live worker code matches `npm run check` output, `/health` is ok, and the change works.
  Don't ask Barry to open or merge pull requests himself. Small docs-only changes to CLAUDE.md/README can go straight to `main`.
- Add tests for new behavior.
- Script / stylesheet links in site/*.html carry `?v=…`, but `build.sh` replaces it with a fingerprint of the file (Oct 15, 2026), so never bump those numbers by hand; changing the .js/.css is enough. `tests/site/asset-versions.test.cjs` checks it.
- The session's network allowlist includes whgemachs.org, *.whgemachs.org, whgemachs.pages.dev and *.whgemachs.pages.dev (Barry, Oct 22, 2026), so `curl` the live site, `/admin` and `https://api.whgemachs.org/health` directly to verify a deploy (e.g. diff the live admin.html against the repo). `/version.txt` on any of them shows which commit it serves. Each pushed branch has a preview at `https://<branch>.whgemachs.pages.dev` (site + admin; it talks to the live API): check it before asking Barry to merge. `curl: (56) CONNECT tunnel failed, response 403` means the allowlist refused the host, not that the site is down: say so and fall back to the GitHub check runs; never loop waiting on it.
- After every deploy and daily, `.github/workflows/live-check.yml` opens the real site (tests/live/live-check.cjs: pages load without script errors, the request form opens; nothing is sent). A red run means the live site is broken: look at it first.
- Keep changes backwards compatible across the site and worker: Pages and the Worker deploy independently, so for a few minutes either can be newer than the other.
- Other Claude sessions may work on this repo at the same time: always `git fetch` and rebase before pushing; never force-push `main`.
- Never put secrets or personal data in the repo. Plain vars and secrets are managed in the Cloudflare dashboard (`keep_vars = true`).
- Data lives in Cloudflare D1 (database `wh-gemach`, binding `DB`) since Oct 7, 2026; `DB_BACKEND` in `worker/wrangler.toml` picks D1 or the old Airtable base `appo390Vl4QKVTdu2` (kept read-only as a backup, no longer updated). Both data layers take the same calls and return Airtable-shaped records (`src/db.js`, `src/d1.js`, `src/airtable.js`).
- Queries are structured (`Q.*` from `src/query.js`), never raw formulas; every query on a gemach-scoped table passes `scope: g`. Schema changes: edit `src/dbschema.js`, run `npm run schema`, then apply `schema.sql` (Actions → "D1 schema", or the Cloudflare connector; new columns need ALTER TABLE on the live database). `npm test` runs the suite on fake Airtable and on SQLite; keep both passing, and no request over 50 D1 queries (Free plan).
- One-off data fixes: SQL through the Cloudflare connector (`d1_database_query`, database id 974be829-ed62-4e9a-9965-77784d5d74a5) — read first, change carefully, tell Barry.
- If the live worker doesn't change after a merge, check the Workers Builds result: `curl -s https://api.github.com/repos/barry253/wh-gemach/commits/<sha>/check-runs` (look for "Workers Builds: wh-gemach"). The build log itself is only in the Cloudflare dashboard (Workers → wh-gemach → Deployments/Builds). A failed build leaves the previous worker live while Pages may already have the new site — keep changes backwards compatible.
- To confirm what is live, read the deployed code with the Cloudflare connector (`workers_get_worker_code` for `wh-gemach`) and compare with `worker/src` bundled via `npm run check`.
