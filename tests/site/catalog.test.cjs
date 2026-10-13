// Catalog extras (Sefer Shelf): sections, Featured / New / holiday strips, byline, borrow note, portrait photos
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
    if (u.pathname === '/public/config') return r.fulfill({ json: { turnstileSiteKey: null }, headers: cors });
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }
const logs = [];

const R2 = 'https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev/sefer/';
const base = { tagline: 'A Jewish children’s library.', description: '', category: 'Other', phone: '(516) 555-1554', whatsapp: null, website: null, donationUrl: null,
  hours: 'Sun 10–1, Tue 4–7', logoUrl: null, communityName: 'West Hempstead', displayOrder: 70, primaryContact: 'Call', secondaryContact: null, email: 'ss@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  comingSoon: false, browseCategoryIds: [], mode: 'Directory', gemachInfo: null, depositRequired: false, itemView: 'List',
  itemAttributes: [{ name: 'Shelf', values: ['New Releases', 'Middos & Character', 'Shabbos & Yom Tov'] }, { name: 'Ages', values: ['3–6', '5–9'] }, { name: 'Yom Tov', values: ['Rosh Hashanah', 'Chanukah', 'Pesach'] }],
  groupBy: 'Shelf', spotlightFilter: 'Yom Tov', photoShape: 'Portrait',
  borrowNote: 'Come visit during open hours to browse.\n\nBorrow up to 3 books at the desk.' };
const book = (n, name, extra) => ({ id: 'recBK' + n, name, description: 'About ' + name + '.', totalUnits: 0, availableCount: 0, hasPhoto: true, photoUrl: R2 + n + '.jpg', categoryId: 'catBK', ...extra });
const items = [
  book(1, 'Yossi and Laibel', { byline: 'Dina Rosenfeld · Hachai', featured: true, attributes: { Shelf: ['Middos & Character'], Ages: ['3–6'] } }),
  book(2, 'I Can Choose', { byline: 'Rikki Benenfeld', newUntil: '2099-01-01', attributes: { Shelf: ['Middos & Character'], Ages: ['3–6'] } }),
  book(3, 'Miracle Lights', { searchWords: 'menorah dreidel', attributes: { Shelf: ['Shabbos & Yom Tov'], 'Yom Tov': ['Chanukah'], Ages: ['5–9'] } }),
  book(4, 'Uh! Oh! Haggadah', { attributes: { Shelf: ['Shabbos & Yom Tov'], 'Yom Tov': ['Pesach'], Ages: ['5–9'] } }),
  book(5, 'Mystery Shelf Book', { newUntil: '2020-01-01' }),
];
directory.gemachs.push(
  { ...base, id: 'recSEFER', slug: 'sefer', name: 'Sefer Shelf', items },
  { ...base, id: 'recSEFER2', slug: 'sefer-plain', name: 'Plain Library', groupBy: null, spotlightFilter: null, photoShape: 'Landscape', borrowNote: null, items: items.map(it => ({ ...it, id: it.id + 'p', featured: false, newUntil: null })) });

const txt = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8797'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const open = async (today, w = 390) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2 });
      await setup(ctx);
      await ctx.addInitScript(d => { window.WHG_TODAY = d; try { localStorage.clear(); } catch (e) {} }, today);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      return { ctx, page };
    };

    // Three weeks before Chanukah 5787 (starts Sat Dec 5, 2026)
    let { ctx, page } = await open('2026-11-20');
    await page.goto(BASE + '/g/sefer', { waitUntil: 'networkidle' });
    assert(await page.locator('.borrow-note').count() === 1 && /open hours/.test(await page.textContent('.borrow-note')), 'borrow note shown');
    assert(await page.locator('.borrow-note p').count() === 2, 'borrow note keeps its paragraphs');
    assert(!(await page.locator('.badge-dir, .badge-ok, .badge-out').count()), 'no “Contact to check” or availability tags');
    assert(!(await page.isVisible('#sticky-cta')), 'no request bar');
    assert(await page.locator('#inv-wrap.photos-portrait').count() === 1, 'portrait photo shape');
    const strips = await txt(page, '.strip-title');
    assert(strips.length === 3 && /^Chanukah is coming/.test(strips[0]) && /^New releases/.test(strips[1]) && /^Featured/.test(strips[2]), 'strips: holiday, new, featured — ' + strips.join(' / '));
    assert((await txt(page, '.strip-spotlight .strip-name')).join() === 'Miracle Lights', 'holiday strip has the Chanukah book only');
    assert((await txt(page, '.strip-new .strip-name')).join() === 'I Can Choose', 'New strip skips books whose New Until passed');
    assert((await txt(page, '.strip-featured .strip-by')).join() === 'Dina Rosenfeld · Hachai', 'featured card shows the byline');
    const secs = await txt(page, '.shelf-block > h3');
    assert(secs.join(' | ') === 'Middos & Character 2 | Shabbos & Yom Tov 2 | More 1', 'sections in the filter’s order, empty ones skipped, unshelved last — ' + secs.join(' | '));
    assert((await txt(page, '.shelf-link')).length === 3, 'jump bar links every section');
    const filters = await txt(page, '.af-name');
    assert(!filters.some(f => /Shelf/.test(f)) && filters.some(f => /Ages/.test(f)), 'section filter not offered as a filter; others are — ' + filters.join(' / '));
    assert(/Rikki Benenfeld/.test(await page.textContent('#row-recBK2 .item-byline')), 'byline under the name');
    assert(await page.locator('#row-recBK2 .tag-new').count() === 1 && !(await page.locator('#row-recBK5 .tag-new').count()), 'New tag only while New Until hasn’t passed');
    const box = await page.locator('#row-recBK2 .item-thumb').boundingBox();
    assert(box && box.height > box.width, 'portrait thumbnails are taller than wide');
    await page.screenshot({ path: path.join(SHOTS, 'm-catalog-top.png') });
    await page.click('.strip-spotlight .strip-card');
    await page.waitForTimeout(150);
    assert(await page.locator('#row-recBK3.flash').count() === 1, 'tapping a strip card jumps to the book');
    await page.click('.shelf-link[data-sec="1"]');
    await page.waitForTimeout(300);
    const top = await page.locator('#sec-1').boundingBox();
    assert(top && top.y >= 0 && top.y < 400, 'jump bar scrolls to the section');
    await page.screenshot({ path: path.join(SHOTS, 'm-catalog-shelf.png') });
    // a filter hides the strips
    await page.evaluate(() => window.scrollTo(0, 0));
    const agesIdx = (await txt(page, '.af-name')).findIndex(f => /Ages/.test(f));
    const chip = page.locator(`.af-chip[data-fa="${agesIdx}"]`).first();
    if (!(await chip.isVisible())) await page.click(`.af-name[data-fold="${agesIdx}"]`);
    await page.locator(`.af-chip[data-fa="${agesIdx}"]`).first().click();
    assert(!(await page.locator('.strip').count()), 'strips hidden while a filter is on');
    assert((await txt(page, '.shelf-block > h3')).join(' | ') === 'Middos & Character 2', 'sections follow the filter');
    // Grid view
    await page.click('.view-btn[data-view="Grid"]');
    const tb = await page.locator('#row-recBK1 .tile-photo').boundingBox();
    assert(tb && tb.height > tb.width * 1.2 && /Hachai/.test(await page.textContent('#row-recBK1 .tile-byline')), 'grid tiles: portrait covers + byline');
    await page.screenshot({ path: path.join(SHOTS, 'm-catalog-grid.png'), fullPage: true });
    await ctx.close();

    // During Chanukah; search words + byline reach the page search
    ({ ctx, page } = await open('2026-12-08'));
    await page.goto(BASE + '/g/sefer', { waitUntil: 'networkidle' });
    assert(/^For Chanukah/.test((await txt(page, '.strip-title'))[0] || ''), 'during the holiday: “For Chanukah”');
    await page.goto(BASE + '/g/sefer?q=dreidel', { waitUntil: 'networkidle' });
    assert((await page.locator('.item-row').count()) === 1 && await page.locator('#row-recBK3').count() === 1 && !(await page.locator('.strip').count()), 'search words match (strips hidden while searching)');
    await page.goto(BASE + '/g/sefer?q=rosenfeld', { waitUntil: 'networkidle' });
    assert((await page.locator('.item-row').count()) === 1 && await page.locator('#row-recBK1').count() === 1, 'byline matches search');
    await ctx.close();

    // No holiday near; a gemach without the extras looks as before
    ({ ctx, page } = await open('2026-10-13'));
    await page.goto(BASE + '/g/sefer', { waitUntil: 'networkidle' });
    assert(!(await page.locator('.strip-spotlight').count()) && await page.locator('.strip-new').count() === 1, 'no holiday strip when none is near');
    await page.goto(BASE + '/g/sefer-plain', { waitUntil: 'networkidle' });
    assert(!(await page.locator('.strip, .shelf-nav, .shelf-block, .borrow-note, .photos-portrait').count()), 'plain listing: no strips, sections, note or portrait');
    assert(await page.locator('.badge-dir').count() > 0, 'plain listing keeps “Contact to check”');
    await ctx.close();

    // Home page search finds books by byline / search words
    ({ ctx, page } = await open('2026-10-13'));
    await page.goto(BASE + '/?q=menorah', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    assert(/Miracle Lights/.test(await page.textContent('body')), 'home search matches search words');
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
