# Backlog

Work we've agreed is worth doing but haven't started. Newest decisions first within each section.

## Worker performance (CPU limit) — added Oct 6, 2026

**Background.** The worker is on Cloudflare's free plan: **10 ms of CPU per request**, and background work (`ctx.waitUntil`, e.g. public-cache rebuilds) counts against the request that started it. On Oct 6 the bulk photo update on the Simcha Dress Gemach (451 item types) produced "Worker exceeded CPU time limit" on most saves, and `GET /admin/catalog/item-types` for that gemach failed intermittently for a few minutes (a CPU-limit kill has no CORS headers, so the browser shows "Failed to fetch"). Commit 251d1fe merges bursts of forced cache rebuilds and stops photo uploads from purging the cache; it prevents pile-ups but doesn't make a single big read or rebuild cheaper.

The bottleneck is CPU spent parsing Airtable responses and building ours — it grows with the amount of data, not the number of Airtable calls (Airtable already pages at 100 records).

1. ~~**Request only the fields each read uses.**~~ **Done Oct 6 (0a13701).** Every big read names its fields (`GEMACH_FIELDS` / `getGemachRecord`, `TYPE_PUBLIC_FIELDS`, `TYPE_ADMIN_FIELDS`, `LOAN_LIST_FIELDS`, `BORROWER_FIELDS`, …); the test fake returns only requested fields, so a forgotten field fails the tests. Measured from Airtable: simcha-dress item types ≈235 → 197 KB (−16%; most of it is photo links, attributes and descriptions the pages use), one gemach record −18 KB (simcha-dress), the directory −35 KB of link lists. Mainly stops growth from Loans / Requests / Activity Log links; doesn't by itself fix the simcha-dress CPU limit.
2. **"Load more" for lists that grow forever** — past loans, History (Activity Log), closed/declined/cancelled requests: show the latest ~50, fetch older ones on demand (Airtable `pageSize` + `offset`; offsets are next-page only, so "Load more", not numbered pages).
   - Not planned for the public gemach page (client-side filters/sort across all items; served from the cache) or the admin inventory list (bounded by inventory size; would need server-side search).
3. **Workers Paid plan ($5/month, 30 s CPU)** — removes the limit entirely. Barry not ready yet (Oct 6). Until then, a large gemach's admin list can occasionally fail to load at busy moments, and bulk imports/edits should be paced.

## Simcha Dress Gemach photos — follow-ups
- Optional crops to remove the wall alarm keypad / door frame (~69 photos can be cropped cleanly; ~20 can't). Review data: the Oct 6 photo review; original links in the project doc `simcha-dress-photo-backup.md`.
- Retakes Michal could do: #80 (tiny, blurry), #88 and #92 (hem cut off), #310 (dress small in frame).
- Check whether #354 and #356 are the same floral dress.
- Confirm pickup timing with Michal (Event style, currently 7 days before).
