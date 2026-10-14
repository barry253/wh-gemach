// Link previews: the Pages Function functions/g/[slug].js puts each gemach's name, text and logo into
// gemach.html for WhatsApp / iMessage / Facebook previews. These checks run without Cloudflare:
// - the security headers it sets match the "/*" block in site/_headers (Functions don't get _headers)
// - tagsFor() builds the right tags, and falls back safely
// - gemach.html has every tag the function rewrites, and every page has the network share image
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/g/[slug].js'), 'utf8');
  const fn = await import('data:text/javascript,' + encodeURIComponent(src)); // the repo has no package.json, so load it as a module this way

  // 1. headers identical to _headers "/*"
  const lines = fs.readFileSync(path.join(ROOT, 'site/_headers'), 'utf8').split('\n');
  const want = {}; let inAll = false;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) { if (!line.trim()) inAll = false; continue; }
    if (!/^\s/.test(line)) { inAll = line.trim() === '/*'; continue; }
    if (inAll) { const i = line.indexOf(':'); want[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  assert(Object.keys(want).length >= 5, 'read the "/*" headers from site/_headers');
  assert(JSON.stringify(fn.SECURITY_HEADERS) === JSON.stringify(want), 'function security headers match site/_headers "/*" exactly');

  // 2. tags
  const t = fn.tagsFor('wh-medical', { name: 'West Hempstead Medical Gemach', tagline: 'Wheelchairs and more', description: 'Wheelchairs and more', logoUrl: 'https://pub.example/logo.png' });
  assert(t.title === 'West Hempstead Medical Gemach — West Hempstead Gemachs' && t.ogTitle === 'West Hempstead Medical Gemach', 'title and og:title from the gemach name');
  assert(t.description === 'Wheelchairs and more' && t.url === 'https://whgemachs.org/g/wh-medical', 'description and url');
  assert(t.image === 'https://pub.example/logo.png' && t.card === 'summary' && t.logo && t.imageAlt === 'West Hempstead Medical Gemach logo', 'PNG gemach logo as a square preview');
  for (const u of ['https://pub.example/logo.webp', 'https://pub.example/logo.svg', 'https://pub.example/png'])
    assert(fn.tagsFor('x', { name: 'N', logoUrl: u }).image === fn.DEFAULT_IMAGE, 'not PNG/JPEG (' + u + '): network card');
  assert(fn.tagsFor('x', { name: 'N', logoUrl: 'https://pub.example/a/logo.JPG?v=2' }).logo, 'JPEG with a query string is fine');
  const cp = fn.tagsFor('wh-medical', { name: 'N', logoUrl: 'https://pub.example/logo.webp' }, 'https://whgemachs.org/assets/gemachs/wh-medical/logo.png');
  assert(cp.image === 'https://whgemachs.org/assets/gemachs/wh-medical/logo.png' && cp.card === 'summary', 'WebP logo with a PNG copy: the copy is used');
  assert(fn.tagsFor('x', { name: 'N', logoUrl: null }, 'https://whgemachs.org/x.png').image === fn.DEFAULT_IMAGE, 'no logo at all: copy ignored (logo was removed)');
  for (const f of fs.readdirSync(path.join(ROOT, 'site/assets/gemachs'))) {
    const p = path.join(ROOT, 'site/assets/gemachs', f, 'logo.png');
    if (fs.existsSync(p)) assert(fs.readFileSync(p).subarray(1, 4).toString() === 'PNG' && fs.statSync(p).size < 400000, 'PNG copy ' + f + ' is a real PNG under 400 KB');
  }
  const n = fn.tagsFor('x', { name: 'No Logo Gemach', tagline: null, description: null, logoUrl: 'http://insecure/x.png' });
  assert(n.image === fn.DEFAULT_IMAGE && n.card === 'summary_large_image', 'no (https) logo: network share card');
  assert(/No Logo Gemach/.test(n.description), 'no text: a sentence with the name');
  assert(fn.tagsFor('x', null) === null && fn.tagsFor('x', { name: '  ' }) === null && fn.tagsFor('x', { error: 'Not found' }) === null, 'missing / hidden gemach: page left as is');
  // shared item links
  const iMeta = { name: 'Adult Simcha Dress Gemach', description: 'Welcome.', logoUrl: 'https://pub.example/logo.webp',
    item: { id: 'recITEMAAAAAAAAAA', name: 'Navy gown – size 8', description: 'Long, with sleeves.', photoUrl: 'https://pub.example/photos/1.jpg' } };
  const it1 = fn.tagsFor('simcha-dress', iMeta, 'https://whgemachs.org/assets/gemachs/simcha-dress/logo.png');
  assert(it1.ogTitle === 'Navy gown – size 8 · Adult Simcha Dress Gemach' && it1.title === 'Navy gown – size 8 · Adult Simcha Dress Gemach — West Hempstead Gemachs', 'item link: item name, then gemach');
  assert(it1.image === 'https://pub.example/photos/1.jpg' && it1.card === 'summary_large_image' && !it1.logo, 'item link: the item photo, large');
  assert(it1.url === 'https://whgemachs.org/g/simcha-dress?item=recITEMAAAAAAAAAA' && it1.canonical === 'https://whgemachs.org/g/simcha-dress', 'item link: og:url is the item link, canonical stays the gemach page');
  assert(it1.description === 'Long, with sleeves. From Adult Simcha Dress Gemach on West Hempstead Gemachs.' && !/free/i.test(it1.description), 'item link: description (never says "free" — some gemachs charge)');
  const it2 = fn.tagsFor('simcha-dress', { ...iMeta, item: { ...iMeta.item, photoUrl: 'https://pub.example/photos/1.webp' } }, 'https://whgemachs.org/assets/gemachs/simcha-dress/logo.png');
  assert(it2.image === 'https://whgemachs.org/assets/gemachs/simcha-dress/logo.png' && it2.card === 'summary' && it2.logo, 'item photo not PNG/JPEG: the gemach logo (its PNG copy)');
  const it3 = fn.tagsFor('simcha-dress', { ...iMeta, item: null });
  assert(it3.ogTitle === 'Adult Simcha Dress Gemach' && it3.url === 'https://whgemachs.org/g/simcha-dress', 'item no longer listed: the gemach preview');
  assert(fn.tagsFor('x', { name: 'N', item: { id: 'bad', name: 'X' } }).ogTitle === 'N', 'item with a bad id ignored');
  assert(fn.SLUG_RE.test('simcha-dress') && !fn.SLUG_RE.test('../x') && !fn.SLUG_RE.test('A B'), 'slug check');

  // 3. the function, with a fake ASSETS and a tiny HTMLRewriter stand-in
  const html = fs.readFileSync(path.join(ROOT, 'site/gemach.html'), 'utf8');
  for (const sel of ['<title>', 'name="description"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"'])
    assert(html.includes(sel), 'gemach.html has ' + sel);
  for (const f of ['index.html', 'about.html', 'disclaimer.html', 'gemach.html', '404.html'])
    assert(/property="og:image" content="https:\/\/whgemachs\.org\/assets\/brand\/og-card\.png"/.test(fs.readFileSync(path.join(ROOT, 'site', f), 'utf8')), f + ' has the share image');
  assert(fs.statSync(path.join(ROOT, 'site/assets/brand/og-card.png')).size > 10000, 'share image file exists');

  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return new Response(JSON.stringify({ name: 'A & "B" <Gemach>', tagline: 'Hi', description: 'Hi', logoUrl: null, comingSoon: false }), { status: 200 }); };
  globalThis.HTMLRewriter = class {
    constructor() { this.h = []; }
    on(sel, h) { this.h.push([sel, h]); return this; }
    transform(res) { this.res = res; this.res.__handlers = this.h.map(x => x[0]); return res; }
  };
  const env = { ASSETS: { fetch: async (req) => {
    const p = new URL(req.url).pathname; calls.push('asset ' + req.method + ' ' + p);
    if (p.startsWith('/assets/gemachs/')) return p.includes('/abc/') ? new Response(null, { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }); } } };
  const res = await fn.onRequestGet({ request: new Request('https://whgemachs.org/g/abc'), env, params: { slug: 'abc' } });
  assert(calls.includes('asset GET /gemach') && calls.includes('https://api.whgemachs.org/public/meta/abc'), 'serves gemach.html and reads /public/meta/abc');
  assert(res.headers.get('Content-Security-Policy') === want['Content-Security-Policy'] && res.headers.get('X-Frame-Options') === 'DENY', 'response carries the security headers');
  assert(!calls.some(c => c.includes('/assets/gemachs/')), 'no logo: no PNG copy lookup');
  calls.length = 0;
  globalThis.fetch = async (u) => { calls.push(String(u)); return new Response(JSON.stringify({ name: 'Webp Gemach', description: 'Hi', logoUrl: 'https://pub.example/abc/logo/1.webp' }), { status: 200 }); };
  await fn.onRequestGet({ request: new Request('https://whgemachs.org/g/abc'), env, params: { slug: 'abc' } });
  assert(calls.includes('asset HEAD /assets/gemachs/abc/logo.png'), 'WebP logo: looks for the PNG copy');
  calls.length = 0;
  await fn.onRequestGet({ request: new Request('https://whgemachs.org/g/abc?item=recITEMAAAAAAAAAA'), env, params: { slug: 'abc' } });
  assert(calls.includes('https://api.whgemachs.org/public/meta/abc?item=recITEMAAAAAAAAAA'), 'item link: asks for the item');
  calls.length = 0;
  await fn.onRequestGet({ request: new Request('https://whgemachs.org/g/abc?item=%3Cscript%3E'), env, params: { slug: 'abc' } });
  assert(calls.includes('https://api.whgemachs.org/public/meta/abc'), 'bad item id: plain gemach lookup');
  calls.length = 0;
  const bad = await fn.onRequestGet({ request: new Request('https://whgemachs.org/g/..'), env, params: { slug: '..' } });
  assert(!calls.some(c => c.includes('/public/meta')) && bad.headers.get('X-Content-Type-Options') === 'nosniff', 'bad slug: no API call, page still has headers');
  globalThis.fetch = () => new Promise(() => {}); // API never answers
  const t0 = Date.now();
  const slow = await fn.onRequestGet({ request: new Request('https://whgemachs.org/g/abc'), env, params: { slug: 'abc' } });
  assert(slow.status === 200 && Date.now() - t0 < 3000, 'slow API: page served unchanged after the time limit');

  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e); process.exit(1); });
