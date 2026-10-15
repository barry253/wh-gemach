// Oct 14 UI refresh: compact home cards, About card with "Read more", filter values as chips (only the useful ones),
// "+ Add" pills, labelled view buttons, no-photo placeholder, slim-bar names that wrap, type scale (nothing under 12px)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = "http://localhost:8805";
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

const G = slug => directory.gemachs.find(g => g.slug === slug);
const PH = 'https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev/dr/photos/';
const gw = G('gowns');
gw.name = 'Adult Simcha Dress Gemach of West Hempstead';
gw.itemView = 'Grid';
gw.requestStyle = 'Dates';
gw.itemAttributes = [
  { name: 'Size', values: ['2', '4', '8', '10'] }, { name: 'Color', values: ['Navy', 'Blue', 'Green', 'Red'] },
  { name: 'Type', values: ['Gown', 'Dress'] }, { name: 'Length', values: ['Long', 'Short'] },
];
gw.items = [
  { id: 'recDr1', name: 'Navy gown – size 8', description: '', totalUnits: 1, availableCount: 1, hasPhoto: true, photoUrl: PH + '1.jpg', categoryId: 'catGW',
    attributes: { Size: ['8'], Color: ['Navy'], Type: ['Gown'], Length: ['Long'] } },
  { id: 'recDr2', name: 'Dark teal gown – size 2-4', description: '', totalUnits: 1, availableCount: 1, hasPhoto: true, photoUrl: PH + '2.jpg', categoryId: 'catGW',
    attributes: { Size: ['2', '4'], Color: ['Blue', 'Green'], Type: ['Gown'], Length: ['Long'] } },
  { id: 'recDr3', name: 'Red cocktail dress', description: '', totalUnits: 1, availableCount: 0, categoryId: 'catGW',
    attributes: { Size: ['10'], Color: ['Red'], Type: ['Dress'], Length: ['Long'] } },
];
G('wh-medical').description = Array(6).fill('We lend medical and mobility equipment at no charge to anyone in the West Hempstead community, and we are glad to help.').join('\n\n');

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8805'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    // ── Home: compact gemach rows ──
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const card = await page.locator('.gemach-card[data-slug="wh-medical"]').boundingBox();
    assert(card.height < 175,'home gemach card is a compact row: ' + Math.round(card.height) + 'px tall');
    assert(await page.locator('.gemach-card:has-text("View gemach")').count() === 0, 'no "View gemach" text (the whole card is the link)');
    assert(await page.$eval('.gemach-card[data-slug="wh-medical"] .gemach-tagline', el => getComputedStyle(el).whiteSpace !== 'nowrap' && el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().height > 22), 'long tagline wraps to a second line instead of being cut off');
    await page.locator('#gemachs-section').screenshot({ path: path.join(SHOTS, 'ui14-m-home-cards.png') });

    // ── Gemach page: About card ──
    await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
    assert(await page.$eval('.g-store .g-logo', el => el.getBoundingClientRect().width) === 80, 'phone logo 80px');
    assert(await page.locator('#ginfo-title').count() === 0 && await page.locator('.info-panel').count() === 1, 'one About card (no separate Gemach Info box)');
    assert(await page.$eval('#about-text', el => el.classList.contains('clamp') && el.scrollHeight > el.clientHeight + 4 && el.clientHeight < 140), 'long text cut to a few lines');
    assert(await page.isVisible('#about-more') && (await page.textContent('#about-more')).trim() === 'Read more', 'Read more shown');
    assert(/By appointment/.test(await page.textContent('.about-facts')), 'hours shown in full outside the cut');
    assert(await page.locator('.about-actions .support #btn-donate, .about-actions .support a.btn-pill').count() === 1, 'Donate on the About card\'s bottom row');
    await page.screenshot({ path: path.join(SHOTS, 'ui14-m-gemach-top.png') });
    await page.click('#about-more');
    assert(await page.$eval('#about-text', el => !el.classList.contains('clamp') && el.scrollHeight <= el.clientHeight + 1) && (await page.textContent('#about-more')).trim() === 'Show less'
      && await page.getAttribute('#about-more', 'aria-expanded') === 'true', 'Read more opens the full text');
    await page.click('#about-more');
    assert(await page.$eval('#about-text', el => el.classList.contains('clamp')), 'Show less cuts it again');
    await page.goto(BASE + '/g/baby-gear', { waitUntil: 'networkidle' });
    assert(await page.isHidden('#about-more'), 'short text: no Read more');
    await page.goto(BASE + '/g/wedding-shtick', { waitUntil: 'networkidle' });
    assert(/\$100 refundable deposit/.test(await page.textContent('.about-facts .deposit-callout')), 'deposit note shown in full');

    // ── Items: chips, Add pill, view labels, sort label, placeholder ──
    await page.goto(BASE + '/g/gowns', { waitUntil: 'networkidle' });
    const chips = id => page.$$eval('#row-' + id + ' .attr-chips .ia', els => els.map(e => e.textContent));
    assert((await chips('recDr1')).length === 0, 'everything already in the name: no chips (' + JSON.stringify(await chips('recDr1')) + ')');
    assert(JSON.stringify(await chips('recDr2')) === '["Blue, Green"]', 'only the color isn\'t in the name: ' + JSON.stringify(await chips('recDr2')));
    const c3 = await chips('recDr3');
    assert(c3.includes('Size 10') && c3.includes('Dress') === false && !c3.some(x => /Long/.test(x)), 'Size 10 labelled; "Dress" (in the name) and Length (same on every item) left out: ' + JSON.stringify(c3));
    assert(JSON.stringify(await page.$$eval('.view-btn .view-txt', els => els.map(e => e.textContent))) === '["List","Grid","Large"]', 'view buttons have text labels');
    assert(await page.$eval('#af-sort option[value=""]', o => o.textContent) === 'Gemach’s order' || await page.locator('#af-sort').count() === 0, 'sort default says "Gemach’s order"');
    assert((await page.textContent('#row-recDr3 .no-photo')).trim() === 'No photo yet', 'no-photo placeholder');
    assert((await page.textContent('#row-recDr1 .add-pill')).includes('+ Add'), 'tile shows "+ Add"');
    await page.click('#row-recDr1 .add-pill');
    assert(await page.isChecked('#row-recDr1 .add-pill input') && /✓ Added/.test(await page.$eval('#row-recDr1 .add-pill', el => el.innerText)), 'tap → "✓ Added"');
    assert((await page.textContent('#cta-count')).trim() === '1 item', 'request bar counts it');
    await page.screenshot({ path: path.join(SHOTS, 'ui14-m-gemach-items.png') });
    await page.click('.view-btn[data-view="List"]');
    assert(await page.isChecked('#row-recDr1 .add-pill input') && (await page.textContent('#row-recDr2 .add-pill')).includes('+ Add'), 'list view uses the same pill');
    await page.locator('#row-recDr1').screenshot({ path: path.join(SHOTS, 'ui14-m-list-row.png') });

    // ── Slim bar: a long name wraps instead of being cut mid-word ──
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(400);
    assert(await page.$eval('.g-mini-name', el => el.classList.contains('long') && getComputedStyle(el.firstElementChild).webkitLineClamp === '2'), 'slim bar name may use two lines');

    // ── Type scale: nothing readable under 12px; 12px only for small uppercase labels ──
    for (const url of ['/', '/g/gowns', '/g/wh-medical']) {
      await page.goto(BASE + url, { waitUntil: 'networkidle' });
      const small = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
        if (!el.offsetParent || el.closest('.sr-only, [hidden], svg')) return false;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!own) return false;
        const cs = getComputedStyle(el), px = parseFloat(cs.fontSize);
        return px < 13 && !(px >= 12 && cs.textTransform === 'uppercase');
      }).map(el => el.className + ' ' + getComputedStyle(el).fontSize));
      assert(small.length === 0, url + ': no text under 13px (except 12px uppercase labels) ' + JSON.stringify(small.slice(0, 5)));
    }
    assert(!errors.length, 'no page errors ' + JSON.stringify(errors));
  } finally { await browser.close(); srv.kill(); }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e); process.exit(1); });
