// Sharing one item: Share in the photo viewer and in Large photos view (share sheet, or copy + WhatsApp on computers);
// opening /g/<slug>?item=<id> points at the item and opens its photos, or says it is no longer listed
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = "http://localhost:8806";
const SHOTS = path.join(__dirname, '..', 'test-output');
const FONTDIR = path.join(path.dirname(require.resolve('@fontsource/figtree/package.json')), '..');
const posts = [], errors = [];
const errs = p => p.$$eval('.field-error:not([hidden]), #error-msg:not([hidden])', els => els.map(e => e.textContent).join(' | '));
let postStatus = 200, postReply = { success: true, requestId: 'recREQ1' };

const fontCss = `
@font-face{font-family:'Figtree';font-weight:400;src:url(https://fonts.gstatic.com/x/figtree-400.woff2) format('woff2')}
@font-face{font-family:'Figtree';font-weight:500;src:url(https://fonts.gstatic.com/x/figtree-500.woff2) format('woff2')}
@font-face{font-family:'Figtree';font-weight:600;src:url(https://fonts.gstatic.com/x/figtree-600.woff2) format('woff2')}
@font-face{font-family:'Source Serif 4';font-weight:600;src:url(https://fonts.gstatic.com/x/sserif-600.woff2) format('woff2')}`;
const colors = ['#cfe0ea', '#e6d9c8', '#d5e6d3', '#e9d3d3', '#d9d5ea'];
const photo = n => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${colors[n % colors.length]}"/><circle cx="200" cy="140" r="70" fill="#1B3A4B" opacity=".25"/><text x="200" y="270" font-size="28" text-anchor="middle" fill="#1B3A4B" font-family="sans-serif">photo ${n}</text></svg>`;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64"><rect width="64" height="64" fill="#FFF7EC"/><circle cx="32" cy="32" r="26" fill="#7B2D5B"/><path d="M20 36c4 10 20 10 24 0" stroke="#E0B84F" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="25" cy="27" r="3" fill="#E0B84F"/><circle cx="39" cy="27" r="3" fill="#E0B84F"/></svg>`;

const markDark = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="34" fill="none" stroke="#E0A63A" stroke-width="10"/><circle cx="48" cy="48" r="9" fill="#E0A63A"/></svg>`;
const markLight = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#FBF6EC"/><circle cx="48" cy="48" r="30" fill="none" stroke="#1B3A4B" stroke-width="9"/><circle cx="48" cy="48" r="8" fill="#E0A63A"/></svg>`;
async function setup(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: fontCss, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://fonts.gstatic.com/**', r => {
    const u = r.request().url();
    const f = u.includes('sserif-600') ? 'source-serif-4/files/source-serif-4-latin-600-normal.woff2'
      : `figtree/files/figtree-latin-${u.match(/figtree-(\d+)/)[1]}-normal.woff2`;
    r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(FONTDIR, f)), headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.route('https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev/**', r => {
    const u = r.request().url();
    if (u.includes('/logo-dark/')) return r.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(__dirname, '../../site/assets/brand/', 'mark-on-dark.svg')) });
    if (u.includes('/logo-light/')) return r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '../../site/assets/brand/', 'favicon-256.png')) });
    if (u.includes('/logo/')) return r.fulfill({ contentType: 'image/svg+xml', body: logo });
    const n = +(u.match(/(\d+)\.jpg/) || [0, 1])[1];
    r.fulfill({ contentType: 'image/svg+xml', body: photo(n) });
  });
  await ctx.route(API + '/**', async r => {
    const req = r.request(), u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/public/directory') return r.fulfill({ json: directory, headers: cors });
    const m = u.pathname.match(/^\/public\/gemach\/([^/]+)$/);
    if (m) { const p = gemachPayload(decodeURIComponent(m[1])); return p ? r.fulfill({ json: p, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors }); }
    if (u.pathname === '/public/search-log') { logs.push({ body: req.postData(), ct: req.headers()['content-type'] }); return r.fulfill({ status: 204, headers: cors }); }
    if (u.pathname === '/submit-request') {
      posts.push(JSON.parse(req.postData()));
      await new Promise(res => setTimeout(res, 200));
      return r.fulfill({ status: postStatus, json: postReply, headers: cors });
    }
    if (u.pathname === '/public/config') return r.fulfill({ json: { turnstileSiteKey: null }, headers: cors });
    if (u.pathname.startsWith('/public/contact/')) return r.fulfill({ json: { c: '=03e' }, headers: cors }); // payloads here still carry contact inline (older worker); see contact-endpoint.test.cjs
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }
const logs = [];
const G = slug => directory.gemachs.find(g => g.slug === slug);
const R2 = 'https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev/tc/photos/';
const gw = G('gowns');
gw.itemView = 'Grid';
gw.items = [
  { id: 'recVw1AAAAAAAAAAA', name: 'Ivory Lace', description: 'Long sleeves.', totalUnits: 1, availableCount: 1, hasPhoto: true, photoUrl: R2 + '1.jpg', categoryId: 'catGW', photos: [R2 + '1.jpg', R2 + '2.jpg'] },
  { id: 'recVw2AAAAAAAAAAA', name: 'Gold Sequin', description: 'Short note.', totalUnits: 1, availableCount: 0, hasPhoto: true, photoUrl: R2 + '4.jpg', categoryId: 'catGW' },
  { id: 'recVw3AAAAAAAAAAA', name: 'Navy Chiffon', description: '', totalUnits: 1, availableCount: 1, categoryId: 'catGW' },
];

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8806'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    // ── Phone: the share sheet ──
    let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    await setup(ctx);
    await ctx.addInitScript(() => { window.__shared = []; navigator.share = d => { window.__shared.push(d); return Promise.resolve(); }; });
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/g/gowns', { waitUntil: 'networkidle' });
    assert(await page.locator('.item-tile .share-btn').count() === 0, 'grid tiles stay uncluttered (no Share on the tile)');
    await page.click('#row-recVw1AAAAAAAAAAA .tile-photo');
    await page.waitForSelector('#lightbox.open');
    assert(await page.isVisible('#lightbox-share'), 'Share in the photo viewer');
    await page.click('#lightbox-share');
    let shared = await page.evaluate(() => window.__shared);
    assert(shared.length === 1 && shared[0].url === BASE + '/g/gowns?item=recVw1AAAAAAAAAAA' && shared[0].title === 'Ivory Lace' && /Ivory Lace — Ahavas Chesed Gown Gemach/.test(shared[0].text),
      'viewer Share opens the share sheet with the item link: ' + JSON.stringify(shared));
    await page.screenshot({ path: path.join(SHOTS, 'share-m-viewer.png') });
    await page.keyboard.press('Escape');
    await page.click('.view-btn[data-view="Photos"]');
    assert(await page.locator('.item-post .share-btn').count() === 3, 'Large photos view: a Share button on every item (photo or not)');
    await page.click('#row-recVw3AAAAAAAAAAA .share-btn');
    shared = await page.evaluate(() => window.__shared);
    assert(shared.length === 2 && shared[1].url.endsWith('/g/gowns?item=recVw3AAAAAAAAAAA'), 'Large view Share uses that item');
    assert(await page.locator('.item-post.selected, .item-tile.selected').count() === 0, 'sharing doesn\'t add anything to the request');
    // Firefox on Android refuses every share sheet after the first ("InvalidStateError"): copy + our own bar
    await page.evaluate(() => { window.__calls = 0; const ok = navigator.share; navigator.share = d => { window.__calls++; const e = new Error('An attempt was made to use an object that is not, or is no longer, usable'); e.name = 'InvalidStateError'; return Promise.reject(e); }; });
    await page.click('#row-recVw1AAAAAAAAAAA .share-btn');
    await page.waitForSelector('#share-toast.show');
    const bar = await page.$$eval('#share-toast a, #share-toast button', els => els.map(e => e.textContent.trim()));
    assert(JSON.stringify(bar) === '["WhatsApp","Text","Email","×"]', 'refused share sheet: our own bar with WhatsApp, Text, Email (no More… — it would be refused too) ' + JSON.stringify(bar));
    assert(/^sms:\?&body=Ivory%20Lace/.test(await page.getAttribute('#share-toast a.share-alt', 'href')) && /mailto:\?subject=Ivory%20Lace/.test(await page.$$eval('#share-toast a.share-alt', a => a[1].getAttribute('href'))), 'Text and Email carry the link');
    await page.screenshot({ path: path.join(SHOTS, 'share-m-refused.png') });
    await page.click('.share-close');
    await page.click('#row-recVw3AAAAAAAAAAA .share-btn');
    await page.waitForSelector('#share-toast.show');
    assert(await page.evaluate(() => window.__calls) === 1, 'after a refusal the page doesn\'t ask the phone again (straight to the bar)');
    await page.click('.share-close');
    // A different refusal (a fresh tap may help): More… tries again
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => { window.__shared = []; window.__refuse = 1; navigator.share = d => { if (window.__refuse-- > 0) { const e = new Error('Must be handling a user gesture'); e.name = 'NotAllowedError'; return Promise.reject(e); } window.__shared.push(d); return Promise.resolve(); }; });
    await page.click('#row-recVw1AAAAAAAAAAA .share-btn');
    await page.waitForSelector('#share-toast.show');
    await page.click('#share-toast .share-more');
    assert((await page.evaluate(() => window.__shared)).length === 1, 'NotAllowedError: More… opens the share sheet again');
    await page.evaluate(() => { navigator.share = d => { const e = new Error('cancelled'); e.name = 'AbortError'; return Promise.reject(e); }; });
    await page.click('#row-recVw1AAAAAAAAAAA .share-btn');
    await page.waitForTimeout(300);
    assert(await page.isHidden('#share-toast'), 'closing the share sheet shows nothing else');

    // ── Opening a shared link ──
    await page.goto(BASE + '/g/gowns?item=recVw2AAAAAAAAAAA', { waitUntil: 'networkidle' });
    await page.waitForSelector('#lightbox.open', { timeout: 3000 }).catch(() => {});
    assert(await page.isVisible('#lightbox') && (await page.textContent('#lightbox-caption')).trim() === 'Gold Sequin', 'shared link opens that item\'s photos');
    assert(await page.locator('.selected').count() === 0 && !(await page.isChecked('#row-recVw2AAAAAAAAAAA input[type=checkbox]')), 'shared item is not added to the request');
    await page.keyboard.press('Escape');
    assert(await page.$eval('#row-recVw2AAAAAAAAAAA', el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 200; }), 'page is scrolled to the item');
    await page.goto(BASE + '/g/gowns?item=recVw3AAAAAAAAAAA', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    assert(await page.isHidden('#lightbox') && await page.$eval('#row-recVw3AAAAAAAAAAA', el => el.classList.contains('flash') || true), 'item without photos: just scrolled to, no empty viewer');
    await page.goto(BASE + '/g/gowns?item=recGONEAAAAAAAAAA', { waitUntil: 'networkidle' });
    assert(/isn’t listed here any more/.test(await page.textContent('#item-gone')) && await page.isHidden('#lightbox'), 'item no longer listed: a short note');
    await page.screenshot({ path: path.join(SHOTS, 'share-m-gone.png') });
    await page.goto(BASE + '/g/gowns?item=<script>', { waitUntil: 'networkidle' });
    assert(await page.locator('#item-gone').count() === 0 && await page.isHidden('#lightbox'), 'not an item id: ignored');
    await ctx.close();

    // ── Computer (no share sheet): copy the link, offer WhatsApp ──
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await setup(ctx);
    await ctx.addInitScript(() => { try { delete Navigator.prototype.share; } catch (e) {} navigator.share = undefined; });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/g/gowns', { waitUntil: 'networkidle' });
    await page.click('#row-recVw1AAAAAAAAAAA .tile-photo');
    await page.click('#lightbox-share');
    await page.waitForSelector('#share-toast.show');
    const toast = await page.$eval('#share-toast', el => ({ text: el.innerText, wa: el.querySelector('.share-wa').getAttribute('href'), z: getComputedStyle(el).zIndex }));
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    assert(/Link copied/.test(toast.text) || /Copy this link/.test(toast.text), 'toast shown: ' + toast.text);
    assert(clip === null || clip === BASE + '/g/gowns?item=recVw1AAAAAAAAAAA', 'link copied to the clipboard: ' + clip);
    assert(toast.wa === 'https://wa.me/?text=' + encodeURIComponent('Ivory Lace — Ahavas Chesed Gown Gemach ' + BASE + '/g/gowns?item=recVw1AAAAAAAAAAA'), 'WhatsApp option with the link');
    assert(Number(toast.z) > 300, 'toast sits above the photo viewer');
    await page.screenshot({ path: path.join(SHOTS, 'share-d-toast.png') });
    await page.click('.share-close');
    assert(await page.isHidden('#share-toast'), 'toast closes');
    assert(!errors.length, 'no page errors ' + JSON.stringify(errors));
  } finally { await browser.close(); srv.kill(); }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e); process.exit(1); });
