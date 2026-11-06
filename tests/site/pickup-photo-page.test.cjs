// The "Pickup photo" link in pickup instructions goes to /p/<id> (functions/p/[id].js). The page reads the API's
// /public/pickup-photos/<id>, shows up to 3 photos from /public/pickup-photo/<id>/<name>, gives link previews the
// first photo, and says so plainly once the photos are deleted (30 days after the items come back).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/p/[id].js'), 'utf8');
  const fn = await import('data:text/javascript,' + encodeURIComponent(src));
  globalThis.crypto ??= require('crypto').webcrypto;
  const ID = 'AbCdEfGhIjKlMnOpQrStUv';
  const API = 'https://api.whgemachs.org';
  let answer = null, asked = [];
  globalThis.fetch = async url => { asked.push(url); return answer(url); };

  answer = () => new Response(JSON.stringify({ gemach: 'West Hempstead <Medical> Gemach', photos: ['1-abcdefgh.jpg', '2-ijklmnop.jpg', '../evil.jpg'] }), { status: 200 });
  let r = await fn.onRequestGet({ params: { id: ID } });
  let html = await r.text();
  assert(r.status === 200 && asked[0] === `${API}/public/pickup-photos/${ID}`, 'reads the set from the API');
  assert(html.includes(`<img src="${API}/public/pickup-photo/${ID}/1-abcdefgh.jpg"`) && html.includes(`/2-ijklmnop.jpg"`), 'shows the photos');
  assert(!html.includes('evil'), 'bad photo names dropped');
  assert(html.includes(`<meta property="og:image" content="${API}/public/pickup-photo/${ID}/1-abcdefgh.jpg">`), 'first photo is the link preview');
  assert(html.includes('<h1>Pickup photos</h1>') && html.includes('West Hempstead &lt;Medical&gt; Gemach'), 'heading + gemach name (escaped)');
  const csp = r.headers.get('Content-Security-Policy');
  const nonce = (/style-src 'nonce-([0-9a-f]+)'/.exec(csp) || [])[1];
  assert(nonce && html.includes(`<style nonce="${nonce}">`) && /img-src https:\/\/api\.whgemachs\.org;/.test(csp) && !/<script/.test(html), 'nonce CSP, images only from the API, no script');
  assert(/noindex/.test(r.headers.get('X-Robots-Tag')) && r.headers.get('Referrer-Policy') === 'no-referrer' && r.headers.get('Cache-Control') === 'no-store', 'not indexed, no referrer, not cached');

  answer = () => new Response('{"error":"Not found"}', { status: 404 });
  r = await fn.onRequestGet({ params: { id: ID } });
  html = await r.text();
  assert(r.status === 404 && html.includes('This photo is no longer available') && !html.includes('og:image'), 'deleted: plain message, no preview');

  answer = () => { throw new Error('down'); };
  r = await fn.onRequestGet({ params: { id: ID } });
  html = await r.text();
  assert(r.status === 503 && html.includes("Couldn't load the photo"), 'API down: try again');

  asked = [];
  for (const bad of ['short', 'AbCdEfGhIjKlMnOpQrStU/', 'AbCdEfGhIjKlMnOpQrStUv1', '../../admin'])
    assert((await fn.onRequestGet({ params: { id: bad } })).status === 404, 'rejected: ' + bad);
  assert(!asked.length, 'bad ids never reach the API');

  const redirects = fs.readFileSync(path.join(ROOT, 'site/_redirects'), 'utf8');
  assert(!/^\/p(\/|\s)/m.test(redirects), 'no _redirects rule shadows /p');
  if (fails) process.exit(1);
})();
