// Home page results: a few rows per gemach + "See all N at …" that opens the gemach page narrowed to the
// same category / search (?cat= & ?q=). Browsing a category (no search): the category name is the heading, the
// tile scroller is hidden, and 2+ gemachs show as one swipe row each; a gemach listed under the category only
// through its Home page categories shows its own items.
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

    // ── Browsing a category that 3 gemachs have: one swipe row per gemach, every gemach on the first screen ──
    await page.goto(BASE + '/?cat=dresses-and-gowns', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .gem-row');
    const rows = await page.$$eval('#results .gem-row', els => els.map(s => ({
      id: s.id, tiles: s.querySelectorAll('.gem-tile:not(.gem-tile-more)').length,
      more: (s.querySelector('.gem-tile-more') || {}).textContent || '',
      moreHref: s.querySelector('.gem-tile-more') ? s.querySelector('.gem-tile-more').getAttribute('href') : '',
      head: s.querySelector('.gem-row-title h3 a').getAttribute('href'),
      all: s.querySelector('.gem-row-all').textContent, meta: s.querySelector('.gem-row-meta').textContent,
      headTop: s.querySelector('.gem-row-head').getBoundingClientRect().top })));
    const big = rows.find(g => g.id === 'rg-big-dresses'), small = rows.find(g => g.id === 'rg-small-dresses');
    assert(rows.length === 3, 'category with 3 gemachs: 3 rows (' + rows.length + ')');
    assert(rows.every(r => r.headTop > 0 && r.headTop < 844 - 60), 'every gemach’s heading is on the first phone screen ' + JSON.stringify(rows.map(r => Math.round(r.headTop))));
    assert(big && big.tiles === 10 && /See all 12/.test(big.more), 'big gemach: 10 tiles + "See all 12" tile: ' + (big && big.tiles) + ' ' + (big && big.more));
    assert(big && big.moreHref === '/g/big-dresses?cat=dresses-and-gowns' && big.head === big.moreHref, 'See all links carry the category: ' + (big && big.moreHref));
    assert(big && /12 items · 12 available/.test(big.meta) && /See all/.test(big.all), 'row heading: count, available, See all: ' + (big && big.meta));
    assert(small && small.tiles === 2 && !small.more, 'small gemach: its 2 tiles, no See-all tile');
    const strip = await page.$eval('#rg-big-dresses .gem-strip', el => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
    assert(strip.ox === 'auto' && strip.sw > strip.cw, 'tiles scroll sideways inside the row ' + JSON.stringify(strip));
    const hdr = await page.evaluate(() => ({
      title: document.querySelector('#results-title .cat-title-name').textContent,
      icon: (document.querySelector('#results-title .cat-title-icon') || {}).textContent, titleVisible: document.getElementById('results-title').getBoundingClientRect().height > 20,
      count: document.getElementById('results-count').textContent, back: document.getElementById('clear-filters').textContent.trim(),
      backAbove: document.getElementById('clear-filters').getBoundingClientRect().top < document.getElementById('results-title').getBoundingClientRect().top,
      tiles: getComputedStyle(document.getElementById('cats-section')).display }));
    assert(hdr.title === 'Dresses and Gowns' && hdr.titleVisible, 'category name is the heading ' + JSON.stringify(hdr));
    assert(hdr.icon === '👗', 'heading keeps the category icon: ' + hdr.icon);
    assert(hdr.count === '3 gemachs · 15 items', 'count line: ' + hdr.count);
    assert(hdr.back === 'All categories' && hdr.backAbove, '"‹ All categories" above the heading');
    assert(hdr.tiles === 'none', 'category tile scroller hidden while browsing a category');
    await page.screenshot({ path: path.join(SHOTS, 'm-results-cap-category.png') });
    const wide = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth,
      [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.gem-strip'))
        .slice(0, 5).map(e => e.tagName + '.' + e.className + '#' + e.id)]);
    assert(wide[0] <= wide[1], 'no sideways page scroll on a phone ' + JSON.stringify(wide));

    // ── Category with one gemach: the usual list, same heading ──
    await page.goto(BASE + '/?cat=bathroom-safety', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .result-group');
    assert(await page.$$eval('.gem-row', e => e.length) === 0, 'single gemach: list, not rows');
    assert(await page.$$eval('.result-more', e => e.length) === 0, 'small category: no See all');
    assert(await page.textContent('#results-title .cat-title-name') === 'Bathroom Safety' && await page.textContent('#results-count') === '1 gemach · 3 items', 'single gemach: heading + count');

    // ── Gemach listed under a category through Home page categories, items filed elsewhere ──
    await page.goto(BASE + '/?cat=catWS', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .gem-row');
    const tbl = await page.$eval('#rg-tablecloths', el => ({
      tiles: [...el.querySelectorAll('.gem-tile-name')].map(e => e.textContent),
      head: el.querySelector('.gem-row-title h3 a').getAttribute('href') }));
    assert(tbl.tiles.length === 5, 'linked gemach shows its own items: ' + tbl.tiles.join(','));
    assert(tbl.head === '/g/tablecloths', 'linked gemach links to its whole page, not narrowed to the category: ' + tbl.head);
    const sht = await page.$$eval('#rg-shtick .gem-tile-name', els => els.map(e => e.textContent));
    assert(sht.join() === 'Light-up Arch', 'gemach with items in the category shows only those: ' + sht.join());
    await page.click('#clear-filters');
    await page.waitForTimeout(300);
    assert(!(await page.evaluate(() => document.body.classList.contains('filtering') || document.body.classList.contains('browsing-cat'))), 'All categories: back to the category list');
    assert(await page.evaluate(() => getComputedStyle(document.getElementById('cats-section')).display !== 'none'), 'tiles shown again');
    assert(await page.evaluate(() => document.activeElement !== document.getElementById('q')), 'All categories: search box not focused (no keyboard)');
    assert(await page.textContent('#results-title') === 'Search results' || await page.evaluate(() => document.getElementById('results-section').hidden), 'heading reset');

    // ── Tapping a tile: category view from the top ──
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.click('.cat-tile[data-cat="dresses-and-gowns"]');
    await page.waitForSelector('#results .gem-row');
    assert(await page.evaluate(() => scrollY) === 0 && await page.evaluate(() => document.activeElement && document.activeElement.id === 'results-title'), 'tile tap: page at top, focus on the heading');

    // ── Typed search inside a category keeps the list ──
    await page.goto(BASE + '/?cat=dresses-and-gowns&q=gown', { waitUntil: 'networkidle' });
    await page.waitForSelector('#results .result-group');
    assert(await page.$$eval('.gem-row', e => e.length) === 0 && !(await page.evaluate(() => document.body.classList.contains('browsing-cat'))), 'search + category: list, tiles still shown');

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
