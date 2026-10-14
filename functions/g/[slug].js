// Cloudflare Pages Function for /g/<slug> (gemach pages).
//
// The page itself is the static gemach.html, filled in by gemach.js in the browser. Link previews
// (WhatsApp, iMessage, Facebook, Google) don't run JavaScript, so without this every gemach link showed the
// generic network title. This function serves the same gemach.html with the gemach's own name, short text
// and logo in <title> and the og:/twitter: tags, read from the API's small GET /public/meta/:slug.
//
// If the API is slow or the gemach isn't public, the page is served unchanged (generic tags) — never an error.
// Responses from Functions don't get the rules in site/_headers, so the security headers are set here;
// tests/site/link-preview.test.cjs checks they stay identical to the "/*" block in site/_headers.

export const API = "https://api.whgemachs.org";
export const SITE = "https://whgemachs.org";
export const DEFAULT_IMAGE = SITE + "/assets/brand/og-card.png";
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev https://*.airtableusercontent.com; connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com https://api.whgemachs.org https://wh-gemach.barry253-0f5.workers.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

export const LOGO_OK = /^https:\/\/[^?#]+\.(png|jpe?g)([?#]|$)/i;
/** PNG copy kept in the site for a gemach whose uploaded logo is WebP (logos uploaded before Oct 14, 2026). */
export const copyPath = slug => "/assets/gemachs/" + slug + "/logo.png";

/** What goes in the tags for a gemach, from the /public/meta answer (null → nothing to change).
 *  `copy`: URL of a PNG copy of the logo, used when the uploaded logo isn't PNG/JPEG. */
export function tagsFor(slug, meta, copy = null) {
  if (!meta || typeof meta.name !== "string" || !meta.name.trim()) return null;
  const name = meta.name.trim().slice(0, 120);
  const text = String(meta.description || meta.tagline || "").trim() ||
    "See what " + name + " lends and send a request — free, from West Hempstead Gemachs.";
  // Only PNG / JPEG logos: WhatsApp and some other apps don't show WebP or SVG previews, so those get the network card.
  const logo = typeof meta.logoUrl === "string" && LOGO_OK.test(meta.logoUrl) ? meta.logoUrl
    : meta.logoUrl && copy ? copy : null;
  return {
    title: name + " — West Hempstead Gemachs",
    ogTitle: name,
    description: text.slice(0, 300),
    url: SITE + "/g/" + slug,
    image: logo || DEFAULT_IMAGE,
    logo: !!logo,
    imageAlt: logo ? name + " logo" : "West Hempstead Gemachs — volunteer-run lending libraries",
    card: logo ? "summary" : "summary_large_image",
  };
}

async function fetchMeta(slug) {
  const timeout = new Promise(res => setTimeout(() => res(null), 1500));
  const req = fetch(API + "/public/meta/" + encodeURIComponent(slug), { cf: { cacheTtl: 300, cacheEverything: true } })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  return Promise.race([req, timeout]);
}

const escAttr = v => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function withHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export async function onRequestGet({ request, env, params }) {
  const page = await env.ASSETS.fetch(new Request(new URL("/gemach", request.url), { headers: request.headers }));
  const slug = String(params.slug || "").toLowerCase();
  if (!page.ok || !SLUG_RE.test(slug)) return withHeaders(page);
  const meta = await fetchMeta(slug);
  let copy = null;
  if (meta && meta.logoUrl && !LOGO_OK.test(meta.logoUrl)) {
    const c = await env.ASSETS.fetch(new Request(new URL(copyPath(slug), request.url), { method: "HEAD" })).catch(() => null);
    if (c && c.ok && /image\/png/.test(c.headers.get("content-type") || "")) copy = SITE + copyPath(slug);
  }
  const t = tagsFor(slug, meta, copy);
  if (!t) return withHeaders(page);
  const setContent = v => ({ element(el) { el.setAttribute("content", v); } });
  const rewritten = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(t.title); } })
    .on('meta[name="description"]', setContent(t.description))
    .on('meta[property="og:title"]', setContent(t.ogTitle))
    .on('meta[property="og:description"]', setContent(t.description))
    .on('meta[property="og:image"]', setContent(t.image))
    .on('meta[property="og:image:alt"]', setContent(t.imageAlt))
    // The 1200×630 size belongs to the network card; a logo has its own size, so leave it unstated.
    .on('meta[property="og:image:width"]', { element(el) { if (t.logo) el.remove(); } })
    .on('meta[property="og:image:height"]', { element(el) { if (t.logo) el.remove(); } })
    .on('meta[name="twitter:card"]', setContent(t.card))
    .on("head", { element(el) {
      el.append('<link rel="canonical" href="' + escAttr(t.url) + '" />\n<meta property="og:url" content="' + escAttr(t.url) + '" />\n', { html: true });
    } })
    .transform(page);
  return withHeaders(rewritten);
}
