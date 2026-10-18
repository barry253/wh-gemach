// Home page results: a few rows per gemach + "See all N at …" that opens the gemach page narrowed to the
// same category / search (?cat= & ?q=). Browsing a category: no gemach chip row, "‹ All categories" pill on the
// count row, and a gemach listed under the category only through its Home page categories shows its own items.
const { chromium } = require('playwright');
const path = require('path'), { spawn } = require('child_process');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const PORT = '8799', BASE = 'http://localhost:' + PORT;
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, '..', 'test-output');
const errors = [];

const cats = [
  { id: 'catGW', name: 'Dresses and Gowns', icon: '👗', keywords: ['dress', 'gown'], displayOrder: 100 },
  { id: 'catBA', name: 'Bathroom Safety', icon: '🚿', keywords: ['shower', 'toilet'], displayOrder: 60 },
  { id: 'catTC', name: 'Tablecloths & Linens', icon: '🍽️', keywords: ['tablecloth'], displayOrder: 75 },
  { id: 'catWS', name: 'Wedding & Simcha', icon: '💍', keywords: ['simcha'], displayOrder: 80 },
];
const V3 = { primaryContact: 'Call', secondaryContact: null, themeColor: '#1B3A4B', requestStyle: 'Dates', eventLabel: 'Event date', depositRequired: false };
let n = 0;
const it = (name, categoryId, avail, attributes) => ({ id: 'recIt' + String(++n).padStart(12, '0'), name, description: '', totalUnits: 1,
  availableCount: avail, hasPhoto: false, photoUrl: null, categoryId, ...(attributes ? { attributes } : {}) });
const colors = ['Navy', 'Black', 'Gold', 'Silver', 'Blue'];
const bigItems = [];
for (let i = 0; i < 12; i++) bigItems.push(it('Gown #' + (i + 1), 'catGW', 1, { Size: [String(2 + (i % 6) * 2)], Color: [colors[i % 5]] }));
bigItems.push(it('Lace Tablecloth', 'catTC', 1));
const gemachs = [
  { id: 'recGBIG', slug: 'big-dresses', name: 'Big Dress Gemach', tagline: 'Lots of dresses', category: 'Simchas', mode: 'Full',
    phone: '(516) 555-0100', email: null, whatsapp: null, items: bigItems, ...V3,
    itemAttributes: [{ name: 'Size', values: ['2', '4', '6', '8', '10', '12'] }, { name: 'Color', values: colors }] },
  { id: 'recGSML', slug: 'small-dresses', name: 'Small Dress Gemach', tagline: 'A few dresses', category: 'Simchas', mode: 'Full',
    phone: '(516) 555-0101', email: null, whatsapp: null, ...V3,
    items: [it('Evening Gown', 'catGW', 1), it('Navy Dress', 'catGW', 0)] },
  { id: 'recGMED', slug: 'medical', name: 'Medical Gemach', tagline: 'Medical', category: 'Medical', mode: 'Full',
    phone: '(516) 555-0102', email: null, whatsapp: null, ...V3,
    items: [it('Shower Seat', 'catBA', 2), it('Toilet Seat Riser', 'catBA', 1), it('Commode', 'catBA', 1)] },
  { id: 'recGTBL', slug: 'tablecloths', name: 'Tablecloth Gemach', tagline: 'Tablecloths', category: 'Wedding & Events', mode: 'Full',
    phone: '(516) 555-0103', email: null, whatsapp: null, ...V3, browseCategoryIds: ['catWS'],
    items: [it('Gold Round', 'catTC', 1), it('Navy Rectangle', 'catTC', 1), it('White Round', 'catTC', 0), it('Ivory Round', 'catTC', 1), it('Black Round', 'catTC', 1)] },
  { id: 'recGSHT', slug: 'shtick', name: 'Shtick Gemach', tagline: 'Shtick', category: 'Wedding & Events', mode: 'Full',
    phone: '(516) 555-0104', email: null, whatsapp: null, ...V3, browseCategoryIds: ['catWS'],
    items: [it('Light-up Arch', 'catWS', 1), it('Kids Gown', 'catGW', 1)] },
];
const directory = { categories: cats, gemachs, generatedAt: new Date().toISOString() };
const payload = slug => { const g = gemachs.find(x => x.slug === slug); if (!g) return null; const { items, ...gemach } = g; return { gemach, items, categories: cats }; };

async function setup(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route(API + '/**', r => {
    const req = r.request(), u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/public/directory') return r.fulfill({ json: directory, headers: cors });
    const m = u.pathname.match(/^\/public\/gemach\/([^/]+)$/);
    if (m) { const p = payload(decodeURIComponent(m[1])); return p ? r.fulfill({ json: p, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors }); }
    if (u.pathname === '/public/search-log') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/public/config') return r.fulfill({ json: { turnstileSiteKey: null }, headers: cors });
    if (u.pathname.startsWith('/public/contact/')) return r.fulfill({ json: { c: '=03e' }, headers: cors }); // payloads here still carry contact inline (older worker); see contact-endpoint.test.cjs
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), PORT], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

    // ── Browsing a category with a big and a small gemach ──
    await page.goto(BASE + '/?cat=dresses-and-gowns', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .result-group');
    const groups = await page.$$eval('#results .result-group', els => els.map(s => ({
      id: s.id, rows: s.querySelectorAll('.result-row:not(.result-more)').length,
      more: (s.querySelector('.result-more') || {}).textContent || '', moreHref: (s.querySelector('.result-more') || {}).getAttribute ? s.querySelector('.result-more').getAttribute('href') : '',
      head: s.querySelector('.result-group-head h3 a').getAttribute('href') })));
    const big = groups.find(g => g.id === 'rg-big-dresses'), small = groups.find(g => g.id === 'rg-small-dresses');
    assert(big && big.rows === 4, 'category: big gemach shows 4 rows (' + (big && big.rows) + ')');
    assert(big && /See all 12 at Big Dress Gemach/.test(big.more), 'category: "See all 12" row: ' + (big && big.more));
    assert(big && /Filter by size and color/.test(big.more), 'See all mentions the gemach’s filters');
    assert(big && big.moreHref === '/g/big-dresses?cat=dresses-and-gowns', 'See all link carries the category: ' + (big && big.moreHref));
    assert(big && big.head === '/g/big-dresses?cat=dresses-and-gowns', 'group header links to the gemach with the category');
    assert(small && small.rows === 2 && !small.more, 'small gemach shows all its rows and no See all');
    assert(/15 items/.test(await page.textContent('#results-count')), 'count line keeps full totals: ' + await page.textContent('#results-count'));
    assert(await page.$$eval('.rg-summary, .rg-card', e => e.length) === 0, 'category: no gemach chip row above the results');
    const bar = await page.evaluate(() => {
      const b = document.getElementById('clear-filters'), c = document.getElementById('results-count');
      const br = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
      return { text: b.textContent.trim(), back: b.classList.contains('back'), sameRow: br.top < cr.bottom && br.left > cr.left };
    });
    assert(bar.text === 'All categories' && bar.back, 'back pill reads "All categories": ' + JSON.stringify(bar));
    assert(bar.sameRow, 'back pill sits on the count row, not a line of its own ' + JSON.stringify(bar));
    await page.screenshot({ path: path.join(SHOTS, 'm-results-cap-category.png'), fullPage: true });
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(noHScroll, 'no sideways page scroll on a phone');

    // ── Category with small groups: no summary for one gemach, no See all ──
    await page.goto(BASE + '/?cat=bathroom-safety', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .result-group');
    assert(await page.$$eval('.result-more', e => e.length) === 0, 'small category: no See all');

    // ── Gemach listed under a category through Home page categories, items filed elsewhere ──
    await page.goto(BASE + '/?cat=catWS', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .result-group');
    const tbl = await page.$eval('#rg-tablecloths', el => ({
      rows: [...el.querySelectorAll('.result-row:not(.result-more) .result-name')].map(e => e.textContent),
      more: (el.querySelector('.result-more') || {}).textContent || '',
      moreHref: el.querySelector('.result-more') ? el.querySelector('.result-more').getAttribute('href') : '',
      head: el.querySelector('.result-group-head h3 a').getAttribute('href') }));
    assert(tbl.rows.length === 4 && !tbl.rows.some(n => /View gemach/.test(n)), 'linked gemach shows its own items, not "View gemach & contact info": ' + tbl.rows.join(','));
    assert(/See all 5 at Tablecloth Gemach/.test(tbl.more), 'linked gemach: See all 5 ' + tbl.more);
    assert(tbl.head === '/g/tablecloths' && tbl.moreHref === '/g/tablecloths', 'linked gemach links to its whole page, not narrowed to the category: ' + tbl.head + ' ' + tbl.moreHref);
    const sht = await page.$$eval('#rg-shtick .result-name', els => els.map(e => e.textContent));
    assert(sht.join() === 'Light-up Arch', 'gemach with items in the category shows only those: ' + sht.join());
    await page.click('#clear-filters');
    await page.waitForTimeout(300);
    assert(!(await page.evaluate(() => document.body.classList.contains('filtering'))), 'All categories: back to the category list');
    assert(await page.evaluate(() => document.activeElement !== document.getElementById('q')), 'All categories: search box not focused (no keyboard)');

    // ── Typed search: 6 rows, q carried over ──
    await page.goto(BASE + '/?q=gown', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .result-group');
    const s = await page.$eval('#rg-big-dresses', el => ({ rows: el.querySelectorAll('.result-row:not(.result-more)').length, href: el.querySelector('.result-more').getAttribute('href') }));
    assert(s.rows === 6, 'search: 6 rows before See all (' + s.rows + ')');
    assert(s.href === '/g/big-dresses?q=gown', 'search: See all carries the search text: ' + s.href);
    assert(await page.$$eval('.rg-summary', e => e.length) === 0, 'search without a category: no summary row');

    // ── Gemach page opened from See all: narrowed to the category, filters still work, Show all clears ──
    await page.goto(BASE + '/g/big-dresses?cat=dresses-and-gowns', { waitUntil: 'networkidle' });
    await page.waitForSelector('.scope-note');
    const listed = () => page.$$eval('.item-list > li', els => els.length);
    assert(await listed() === 12, 'gemach page: only the 12 gowns, not the tablecloth (' + await listed() + ')');
    assert(/Showing 12 items for Dresses and Gowns \(of 13\)/.test(await page.textContent('.scope-note')), 'scope note: ' + await page.textContent('.scope-note'));
    await page.screenshot({ path: path.join(SHOTS, 'm-results-cap-gemach-scoped.png'), fullPage: true });
    await page.click('#scope-clear');
    await page.waitForTimeout(200);
    assert(await listed() === 13 && !(await page.$('.scope-note')), 'Show all items: everything back, note gone');
    assert(new URL(page.url()).search === '', 'Show all items: address cleaned up (' + new URL(page.url()).search + ')');

    // q narrows (same matching as the home page) and the size/color filters still apply on top
    await page.goto(BASE + '/g/big-dresses?q=navy', { waitUntil: 'networkidle' });
    await page.waitForSelector('.scope-note');
    assert(await listed() === 3, 'q=navy: the 3 navy gowns (' + await listed() + ')');
    const chips = await page.$$eval('.af-chip', els => els.map(e => e.textContent.trim()));
    assert(chips.length > 0, 'filter chips offered within the scope: ' + chips.join(','));

    // Unknown category / nothing matching: show everything with a note, never an empty page
    await page.goto(BASE + '/g/big-dresses?q=xylophone', { waitUntil: 'networkidle' });
    await page.waitForSelector('.scope-note');
    assert(await listed() === 13 && /Nothing here matches/.test(await page.textContent('.scope-note')), 'no match: everything shown with a note');
    await page.goto(BASE + '/g/big-dresses?cat=no-such-category', { waitUntil: 'networkidle' });
    await page.waitForSelector('.item-list');
    assert(await listed() === 13 && !(await page.$('.scope-note')), 'unknown category ignored');

    // ?type= deep links still work
    await page.goto(BASE + '/g/big-dresses?type=' + bigItems[3].id, { waitUntil: 'networkidle' });
    await page.waitForSelector('#row-' + bigItems[3].id + '.selected');
    assert(true, 'type= deep link still selects the item');
    await ctx.close();
  } catch (e) {
    fails++; process.exitCode = 1; console.log('FAIL:', e.stack || e.message);
  } finally {
    await browser.close();
    srv.kill();
    assert(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
    console.log(fails ? `${fails} failure(s)` : 'all passed');
  }
})();
