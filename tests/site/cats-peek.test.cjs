// Home page on phones: categories start collapsed (2 rows + faded 3rd row under "Show all"); desktop unchanged
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8797';
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
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

const logs = [];


(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8797'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const out = process.env.SHOT_DIR || SHOTS;
  const visibleTiles = p => p.$$eval('#cat-grid .cat-tile', els => els.filter(e => e.offsetParent !== null).length);
  try {
    // Phone
    let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200);
    const total = await page.$$eval('#cat-grid .cat-tile', els => els.length);
    assert(total > 6, `mock has more than 6 categories (${total})`);
    assert(await visibleTiles(page) === 6, 'phone: 6 tiles rendered while collapsed');
    assert(await page.isVisible('#cat-more-btn'), '"Show all" button visible');
    assert((await page.textContent('#cat-more-btn')).trim() === `Show all ${total} categories`, 'button names the count: ' + (await page.textContent('#cat-more-btn')).trim());
    const g = await page.$eval('#cat-grid', el => { const r = el.getBoundingClientRect(), t5 = el.children[4].getBoundingClientRect(), t3 = el.children[2].getBoundingClientRect(); return { bottom: r.bottom, t5top: t5.top, t5bottom: t5.bottom, t3bottom: t3.bottom }; });
    assert(g.bottom > g.t5top + 20 && g.bottom < g.t5bottom - 10, 'third row is cut part-way ' + JSON.stringify(g));
    const btn = await page.$eval('#cat-more-btn', el => el.getBoundingClientRect().toJSON());
    assert(btn.top > g.t5top - 10 && btn.bottom <= g.bottom + 2, 'button sits over the faded row');
    const gemTop = await page.$eval('#gemachs-section', el => el.getBoundingClientRect().top + window.scrollY);
    assert(gemTop < 1100, 'gemach list starts sooner: ' + Math.round(gemTop));
    await page.screenshot({ path: path.join(out, 'm-home-cats-collapsed.png') });

    await page.click('#cat-more-btn');
    assert(await visibleTiles(page) === total, 'Show all: every tile visible');
    assert(!(await page.isVisible('#cat-more-btn')) && await page.isVisible('#cat-less-btn'), 'Show fewer offered');
    assert(await page.evaluate(() => document.activeElement && document.activeElement.closest('#cat-grid li') === document.querySelector('#cat-grid').children[6]), 'focus moves to the first newly shown tile');
    await page.screenshot({ path: path.join(out, 'm-home-cats-expanded.png'), fullPage: true });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(200);
    assert(await visibleTiles(page) === total, 'stays open on reload in the same visit');
    await page.click('#cat-less-btn');
    assert(await visibleTiles(page) === 6 && await page.isVisible('#cat-more-btn'), 'Show fewer collapses again');

    // Tapping a category: chips row with every category, no button
    await page.click('#cat-grid .cat-tile >> nth=0'); await page.waitForTimeout(500);
    assert(await visibleTiles(page) === total, 'filtering: all categories as chips');
    assert(!(await page.isVisible('#cat-more-btn')), 'filtering: no Show all button');
    await page.click('#cat-grid .cat-tile[aria-pressed="true"]'); await page.waitForTimeout(500);
    assert(await visibleTiles(page) === 6 && await page.isVisible('#cat-more-btn'), 'back from filtering: collapsed again');
    const g2 = await page.$eval('#cat-grid', el => { const r = el.getBoundingClientRect(), t5 = el.children[4].getBoundingClientRect(); return r.bottom > t5.top + 20 && r.bottom < t5.bottom - 10; });
    assert(g2, 'fade position recomputed after filtering');
    await ctx.close();

    // Phone, landing on a filtered URL first
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx); page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE + '/?q=walker', { waitUntil: 'networkidle' });
    await page.click('#search-clear'); await page.waitForTimeout(400);
    const g3 = await page.$eval('#cat-grid', el => { const r = el.getBoundingClientRect(), t5 = el.children[4].getBoundingClientRect(); return r.bottom > t5.top + 20 && r.bottom < t5.bottom - 10; });
    assert(g3 && await page.isVisible('#cat-more-btn'), 'after clearing a search the collapsed layout is right');
    await ctx.close();

    // Desktop: unchanged
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setup(ctx); page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    assert(await visibleTiles(page) === total, 'desktop: all tiles');
    assert(!(await page.isVisible('#cat-more-btn')) && !(await page.isVisible('#cat-less-btn')), 'desktop: no buttons');
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
