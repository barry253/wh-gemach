// Cloudflare Pages Function for /admin-login: where Google sends the admin back after "Sign in with Google"
// when the sign-in runs in redirect mode (iPhone / iPad Safari, where Google's popup mode can end on a blank
// accounts.google.com page).
//
// Google POSTs a form here: `credential` (the Google ID token) and `g_csrf_token` (which must equal the
// g_csrf_token cookie Google set — Google's documented double-submit check). The token is NOT trusted here:
// this function only hands it to the admin page (through sessionStorage, never in a URL), and admin.html sends
// it to the worker's POST /admin/login, which verifies it with Google exactly as for the popup flow.
//
// Responses from Functions don't get site/_headers, so the headers are set here.

const CREDENTIAL_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/; // a JWT: three base64url parts
export const STORAGE_KEY = "whg_google_cred"; // admin.html reads and clears this

function headers(nonce) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
}

function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function page(nonce, body, script, status = 200) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Gemach Admin</title>' +
    '<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#1B3A4B;color:#fff;margin:0;padding:3rem 1.25rem;text-align:center}a{color:#E0A63A}</style>' +
    '</head><body>' + body + (script ? '<script nonce="' + nonce + '">' + script + '</script>' : '') + '</body></html>';
  return new Response(html, { status, headers: headers(nonce) });
}

export async function onRequestPost({ request }) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const sorry = (status, text) => page(nonce, "<p>" + text + '</p><p><a href="/admin">Back to sign-in</a></p>', "", status);

  let form;
  try { form = await request.formData(); } catch (e) { return sorry(400, "Couldn't finish signing in."); }
  const credential = form.get("credential");
  const csrfBody = form.get("g_csrf_token");
  const csrfCookie = cookie(request, "g_csrf_token");
  if (typeof credential !== "string" || credential.length > 4096 || !CREDENTIAL_RE.test(credential)) {
    return sorry(400, "Couldn't finish signing in.");
  }
  if (typeof csrfBody !== "string" || !csrfBody || !csrfCookie || csrfBody !== csrfCookie) {
    return sorry(403, "Couldn't finish signing in. Please go back and try again.");
  }
  // The credential only contains [A-Za-z0-9_.-], so it can sit inside a script string as is.
  const script =
    'try{sessionStorage.setItem("' + STORAGE_KEY + '","' + credential + '");location.replace("/admin");}' +
    'catch(e){document.body.innerHTML=\'<p>Your browser blocked saving the sign-in.</p><p><a href="/admin">Back to sign-in</a></p>\';}';
  return page(nonce, "<p>Signing you in…</p>", script);
}

// Opening /admin-login directly (or any other method) just goes to the admin page.
export async function onRequest({ request }) {
  if (request.method === "POST") return onRequestPost({ request });
  return new Response(null, { status: 303, headers: { Location: "/admin", "Cache-Control": "no-store" } });
}
