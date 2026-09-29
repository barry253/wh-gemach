# whgemachs.org — notes for Claude sessions

Repo layout:
- `site/`, `admin.html`, `embed.html` → public site + admin page, deployed by Cloudflare Pages (project `whgemachs`) from `main` via `build.sh`.
- `worker/` → the API (Cloudflare Worker `wh-gemach`), deployed by Cloudflare Workers Builds from `main` (root directory `worker`, build `npm test`, deploy `npx wrangler deploy`). See `worker/README.md`.
- `tests/` → browser tests for site and admin (Playwright, API mocked).

Rules:
- Worker code lives only in `worker/src/`. Never hand Barry a worker.js to paste into the dashboard; the GitHub deploy would overwrite a pasted version.
- Work on a branch, then open a PR (or push to main only when Barry asks). Before pushing: `cd worker && npm test` and `cd tests && npm test`. Add tests for new behavior.
- Keep changes backwards compatible across the site and worker: Pages and the Worker deploy independently, so for a few minutes either can be newer than the other.
- Other Claude sessions may work on this repo at the same time: always `git fetch` and rebase before pushing; never force-push `main`.
- Never put secrets or personal data in the repo. Plain vars and secrets are managed in the Cloudflare dashboard (`keep_vars = true`).
- Airtable base `appo390Vl4QKVTdu2`; every gemach-scoped table has a `Gemach` link + `Gemach Slug` lookup, and every query must be scoped (`scopeF(g)`).
- To confirm what is live, read the deployed code with the Cloudflare connector (`workers_get_worker_code` for `wh-gemach`) and compare with `worker/src` bundled via `npm run check`.
