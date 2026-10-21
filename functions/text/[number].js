// Cloudflare Pages Function for /text/<digits> — the "Text" link in gemach emails.
//
// Gmail drops sms: links from emails (tel: and https: links survive), so the email links here instead.
// On a phone it redirects straight to sms: (Chrome then closes the tab it opened, so nothing is left behind).
// Elsewhere it serves a small page: a meta refresh and script try sms:, a big button does it on a tap, and on
// a computer it just shows the number.
// Only digits are accepted (10–15, with country code), so this can't be used to send anyone anywhere else.

export const NUMBER_RE = /^\d{10,15}$/;

/** "17189867345" → "(718) 986-7345"; other countries "+972521234567". */
export function displayNumber(d) {
  return d.length === 11 && d[0] === "1" ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : "+" + d;
}

export function textPage(digits, nonce) {
  const sms = "sms:+" + digits, shown = displayNumber(digits);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<meta http-equiv="refresh" content="0;url=${sms}">` +
    `<title>Text ${shown} — West Hempstead Gemachs</title>` +
    `<style nonce="${nonce}">body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;` +
    `display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}` +
    `main{padding:24px}p{margin:0 0 20px;font-size:18px}a.btn{display:inline-block;background:#1B3A4B;color:#fff;` +
    `text-decoration:none;padding:14px 26px;border-radius:10px;font-size:18px;font-weight:600}` +
    `small{display:block;margin-top:24px;color:#5e6b72;font-size:14px}small a{color:#5e6b72}</style></head><body><main>` +
    `<p>Text <strong>${shown}</strong></p>` +
    `<a class="btn" href="${sms}">Open Messages</a>` +
    `<small><a href="https://whgemachs.org">West Hempstead Gemachs</a></small>` +
    `</main><script nonce="${nonce}">location.href=${JSON.stringify(sms)};</script></body></html>`;
}

/** Phones and tablets: hand straight to the messaging app with a redirect, so no page is left open behind it. */
export const MOBILE_RE = /Android|iPhone|iPad|iPod|Mobile/i;

export function onRequestGet({ params, request }) {
  const digits = String(params.number || "");
  if (!NUMBER_RE.test(digits)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (MOBILE_RE.test(request?.headers?.get("User-Agent") || "")) {
    return new Response(null, { status: 302, headers: { "Location": "sms:+" + digits, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Vary": "User-Agent" } });
  }
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return new Response(textPage(digits, nonce), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store", // the answer depends on the device
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    },
  });
}
