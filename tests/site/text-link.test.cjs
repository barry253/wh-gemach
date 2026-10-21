// The "Text" link in gemach emails goes to /text/<digits> (functions/text/[number].js), because Gmail drops sms:
// links. The page must open sms:+<digits> (meta refresh, script, button), accept only digits, and run its script
// under its own nonce CSP.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/text/[number].js'), 'utf8');
  const fn = await import('data:text/javascript,' + encodeURIComponent(src));
  globalThis.crypto ??= require('crypto').webcrypto;

  const r = fn.onRequestGet({ params: { number: '17189867345' } });
  const html = await r.text();
  assert(r.status === 200 && /text\/html/.test(r.headers.get('Content-Type')), 'valid number: HTML page');
  assert(html.includes('content="0;url=sms:+17189867345"'), 'meta refresh to sms:');
  assert(html.includes('<a class="btn" href="sms:+17189867345">Open Messages</a>'), 'tap button');
  assert(html.includes('location.href="sms:+17189867345"'), 'script redirect');
  assert(html.includes('(718) 986-7345'), 'US number shown formatted');
  const csp = r.headers.get('Content-Security-Policy');
  const nonce = (/script-src 'nonce-([0-9a-f]+)'/.exec(csp) || [])[1];
  assert(nonce && html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`), 'script and style carry the CSP nonce');
  assert(r.headers.get('X-Frame-Options') === 'DENY' && /noindex/.test(r.headers.get('X-Robots-Tag')), 'not framed, not indexed');
  assert(fn.displayNumber('972521234567') === '+972521234567', 'other countries shown with +');

  for (const bad of ['123', 'abc', '1718986734512345678', '+17189867345', '1718986%3Bx', '17189867345?body=x'])
    assert(fn.onRequestGet({ params: { number: bad } }).status === 404, 'rejected: ' + bad);

  const redirects = fs.readFileSync(path.join(ROOT, 'site/_redirects'), 'utf8');
  assert(!/^\/text/m.test(redirects), 'no _redirects rule shadows /text');
  if (fails) process.exit(1);
})();
