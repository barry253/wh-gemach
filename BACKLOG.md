# Backlog

Work we've agreed is worth doing but haven't started. Newest decisions first within each section.

## Owners can pause their gemach (status control) — added Oct 14, 2026

Today only the Network Admin sets status (Live / Coming soon / Hidden) in the Network tab.

- **First Live stays with the Network Admin.** A gemach that has never been Live can't be switched to Live by its owner. Owner Settings shows "Ready to go live?" with a **Request to go live** button → email + push to Network Admins.
- **After it has been Live once:** Owner / Manager can switch between **Live** and **Paused** in Settings. Volunteers see it read-only.
- **Paused** = Coming soon with friendlier wording: page stays up, "Not taking requests right now", contact buttons and items shown; the worker refuses requests (as for Coming soon today).
- Optional later: a pause message and a "back on" date ("Back after Sukkos") that returns the gemach to Live automatically (daily cron).
- **Hidden stays Network Admin only**, and so does Type (Online requests / Listing only / Info only).
- Every owner status change: alert email + push to Network Admins, and a History row naming who changed it.
- Needs a record of "has been Live before" (e.g. Gemachs.`Went Live At`, set the first time Live is chosen; backfill for gemachs Live today).
- Size: about an afternoon with tests.

## Delete an item type / a browse category — added Oct 14, 2026

Today admin can delete a single unit (`DELETE /admin/catalog/items/:id`) but not an item type, and Network → Categories can't delete a category. Active off is the only option.

- **Delete item type:** only when it has never been on a loan or a request (no Loans pointing at it or its units; not in any request's Items Requested / Item Quantities). Its units are deleted with it. Otherwise the button says "Has history — hide it instead (Active off)". Photos in R2 are left in place.
- **Delete browse category:** only when no item type and no gemach's Home page categories link to it.
- Why the guard: loans, requests and History point at the item type; a hard delete would leave blank names in history and drop it from stats.
- Item types: Owner / Manager / Network Admin. Categories: Network Admin. Confirm step before deleting; public cache purged after.
- Size: about an hour with tests.

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
