// iPhone / iPad admin sign-in: Google's redirect mode posts to the Pages Function functions/admin-login.js,
// which hands the Google token to the admin page (sessionStorage) — never a URL — after Google's CSRF check.
// Runs without Cloudflare: the function is loaded as a module and called with real Request objects.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/admin-login.js'), 'utf8');
  const fn = await import('data:text/javascript,' + encodeURIComponent(src));
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImpAeC5jb20ifQ.c2lnbmF0dXJl';

  const post = (fields, cookie) => {
    const body = new URLSearchParams(fields);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cookie) headers.Cookie = cookie;
    return fn.onRequest({ request: new Request('https://whgemachs.org/admin-login', { method: 'POST', headers, body }) });
  };

  // 1. a valid Google post: stores the token for admin.html and goes to /admin
  let r = await post({ credential: jwt, g_csrf_token: 'abc123' }, 'a=1; g_csrf_token=abc123');
  let html = await r.text();
  assert(r.status === 200, 'valid post answers 200');
  assert(html.includes('sessionStorage.setItem("' + fn.STORAGE_KEY + '","' + jwt + '")') && html.includes('location.replace("/admin")'), 'page stores the token and redirects to /admin');
  assert(fn.STORAGE_KEY === 'whg_google_cred' && fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8').includes('"whg_google_cred"'), 'admin.html reads the same storage key');
  const csp = r.headers.get('Content-Security-Policy') || '';
  const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
  assert(nonce && html.includes('nonce="' + nonce + '"') && !/'unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline/.test(csp), 'inline script allowed by a nonce only');
  assert(r.headers.get('Cache-Control') === 'no-store' && r.headers.get('Referrer-Policy') === 'no-referrer' && /noindex/.test(r.headers.get('X-Robots-Tag') || ''), 'no-store, no referrer, noindex');
  assert(r.headers.get('X-Frame-Options') === 'DENY', 'not frameable');
  assert(!/location\.(search|hash)|\?cred|#cred/.test(html), 'token is never put in a URL');

  // 2. Google's double-submit check: cookie and body must match
  r = await post({ credential: jwt, g_csrf_token: 'abc123' }, 'g_csrf_token=other');
  assert(r.status === 403 && !(await r.text()).includes(jwt), 'cookie ≠ body → refused, token not echoed');
  r = await post({ credential: jwt, g_csrf_token: 'abc123' });
  assert(r.status === 403, 'no cookie → refused');
  r = await post({ credential: jwt }, 'g_csrf_token=abc123');
  assert(r.status === 403, 'no body token → refused');

  // 3. only a JWT-shaped credential goes anywhere near the script
  for (const bad of ['', 'x', 'a.b', '"><script>alert(1)</script>.b.c', 'a.b.c"+alert(1)+"', 'a b.c.d', jwt + 'x'.repeat(5000)]) {
    r = await post({ credential: bad, g_csrf_token: 't' }, 'g_csrf_token=t');
    const t = await r.text();
    assert(r.status === 400 && !t.includes('sessionStorage.setItem'), 'rejects credential ' + JSON.stringify(bad.slice(0, 30)));
  }
  r = await fn.onRequest({ request: new Request('https://whgemachs.org/admin-login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'nope' }) });
  assert(r.status === 400, 'a non-form post is refused');

  // 4. opening it by hand just goes to the admin page
  r = await fn.onRequest({ request: new Request('https://whgemachs.org/admin-login') });
  assert(r.status === 303 && r.headers.get('Location') === '/admin', 'GET → 303 /admin');

  console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
})().catch(e => { console.log('ASSERT FAIL: threw', e); process.exitCode = 1; });
