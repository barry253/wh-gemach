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
  3. Only after he says yes: `git fetch`, merge the branch into `main` (fast-forward or merge commit), re-run the tests, push `main`, then delete the branch. Pages and Workers Builds deploy from `main`; Workers Builds re-runs the worker tests and refuses to deploy on failure.
  4. After the deploy, confirm: live worker code matches `npm run check` output, `/health` is ok, and the change works.
  Don't ask Barry to open or merge pull requests himself. Small docs-only changes to CLAUDE.md/README can go straight to `main`.
- Add tests for new behavior.
- Keep changes backwards compatible across the site and worker: Pages and the Worker deploy independently, so for a few minutes either can be newer than the other.
- Other Claude sessions may work on this repo at the same time: always `git fetch` and rebase before pushing; never force-push `main`.
- Never put secrets or personal data in the repo. Plain vars and secrets are managed in the Cloudflare dashboard (`keep_vars = true`).
- Airtable base `appo390Vl4QKVTdu2`; every gemach-scoped table has a `Gemach` link + `Gemach Slug` lookup, and every query must be scoped (`scopeF(g)`).
- To confirm what is live, read the deployed code with the Cloudflare connector (`workers_get_worker_code` for `wh-gemach`) and compare with `worker/src` bundled via `npm run check`.
