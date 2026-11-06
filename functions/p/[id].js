// Cloudflare Pages Function for /p/<id> — the "Pickup photo" link in a gemach's pickup instructions.
//
// An admin can add up to 3 photos on "Send pickup instructions" (where the items are, which ones are the
// borrower's). They live in the worker's PRIVATE bucket; this page shows them, read from the API's
// GET /public/pickup-photos/:id (gemach name + photo names) with the images at /public/pickup-photo/:id/:name.
// The og:image tag gives WhatsApp / iMessage a preview of the first photo.
// Photos are deleted 30 days after the items come back; then this page says so.
// Never indexed, no referrer, no caching (the answer changes when photos are removed).

export const API = "https://api.whgemachs.org";
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const NAME_RE = /^[1-9]-[A-Za-z0-9_-]{8}\.(jpg|png|webp)$/;

const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/** The page for a set: data = { gemach, photos } from the API, or null when it's gone / unknown. */
export function pickupPage(id, data, nonce, { failed = false } = {}) {
  const photos = data && Array.isArray(data.photos) ? data.photos.filter(n => NAME_RE.test(n)).slice(0, 3) : [];
  const gemach = data && typeof data.gemach === "string" ? data.gemach.trim().slice(0, 120) : "";
  const src = n => `${API}/public/pickup-photo/${id}/${n}`;
  const title = photos.length ? `Pickup photo${photos.length > 1 ? "s" : ""}${gemach ? ` — ${gemach}` : ""}` : failed ? "Couldn't load the photo" : "Photo no longer available";
  const og = photos.length
    ? `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Where to pick up your items.">` +
      `<meta property="og:image" content="${esc(src(photos[0]))}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`
    : "";
  const body = photos.length
    ? `<h1>${esc(photos.length > 1 ? "Pickup photos" : "Pickup photo")}</h1>${gemach ? `<p class="sub">${esc(gemach)}</p>` : ""}` +
      photos.map((n, i) => `<a href="${esc(src(n))}"><img src="${esc(src(n))}" alt="Pickup photo ${i + 1}"></a>`).join("")
    : failed ? `<h1>Couldn't load the photo</h1><p class="sub">Please try again in a minute.</p>`
    : `<h1>This photo is no longer available</h1><p class="sub">Pickup photos are removed after the items are returned. If you still need help finding your items, reply to the gemach's message.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow">` +
    `<title>${esc(title)}</title>${og}` +
    `<style nonce="${nonce}">body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#FBF6EC;color:#1B3A4B}` +
    `main{max-width:720px;margin:0 auto;padding:20px 16px 32px}h1{font-size:22px;margin:4px 0 2px}.sub{margin:0 0 16px;color:#5e6b72;font-size:15px;line-height:1.5}` +
    `img{display:block;width:100%;height:auto;border-radius:10px;margin:0 0 14px;background:#eee}` +
    `footer{margin-top:20px;font-size:13px;color:#5e6b72}footer a{color:#5e6b72}</style></head><body><main>` +
    body + `<footer><a href="https://whgemachs.org">West Hempstead Gemachs</a></footer></main></body></html>`;
}

export async function onRequestGet({ params }) {
  const id = String(params.id || "");
  let data = null, status = 404;
  if (ID_RE.test(id)) {
    try {
      const res = await fetch(`${API}/public/pickup-photos/${id}`, { signal: AbortSignal.timeout(8000), cf: { cacheTtl: 0 } });
      if (res.ok) { data = await res.json(); status = 200; }
    } catch { status = 503; data = null; }
  }
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const page = pickupPage(id, data, nonce, { failed: status === 503 });
  return new Response(page, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": `default-src 'none'; img-src ${API}; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    },
  });
}
