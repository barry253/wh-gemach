# whgemachs.org

West Hempstead gemach network: public directory, per-gemach pages with request forms, and the admin app.

| Folder | What | Deployed by |
|---|---|---|
| `site/`, `admin.html`, `embed.html` | Public site and admin page | Cloudflare Pages (`whgemachs`), from `main` via `build.sh` |
| `worker/` | API at `api.whgemachs.org` | Cloudflare Workers Builds (`wh-gemach`), from `main` — only if `npm test` passes |
| `tests/` | Browser tests for site + admin | GitHub Actions on every push / pull request |

See `worker/README.md` for how the API is organized, where settings live, and how to roll back.
