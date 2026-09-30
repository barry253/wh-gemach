// Gemach status "Coming soon" and type "Info only" on the home page and gemach pages
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8796';
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


const G = slug => directory.gemachs.find(g => g.slug === slug);


const base = { tagline: '', description: '', category: 'Other', phone: '(516) 555-0100', whatsapp: null, website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 50, primaryContact: 'Call', secondaryContact: 'Email',
  themeColor: '#1B3A4B', accentColor: null, depositRequired: false, depositInfo: null, requestStyle: 'Dates', eventLabel: 'Event date',
  pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false, itemAttributes: [] };
directory.gemachs.push(
  { ...base, id: 'recSOON', slug: 'soon', name: 'Zmiros Stroller Gemach', tagline: 'Double strollers for simchas.', mode: 'Full', comingSoon: true,
    email: 'soon@example.com', gemachInfo: null, browseCategoryIds: [],
    items: [{ id: 'recSoonIt1', name: 'Quinoxx Double Stroller', description: '', totalUnits: 2, availableCount: 2, hasPhoto: false, photoUrl: null, categoryId: 'catBB' }] },
  { ...base, id: 'recINFO', slug: 'info', name: 'Chesed Info Gemach', tagline: 'Call us for what you need.', mode: 'Info', comingSoon: false,
    email: 'info@example.com', hours: 'Sun–Thu 8–10pm', gemachInfo: 'We lend <b>shabbos</b> hot plates.\n\nCall Rivky at (516) 555-0100 or see https://example.org/info.',
    browseCategoryIds: ['catEM', 'catSH', 'catNOPE'], items: [] });
const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\n+/g, ' / '));

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));

      // Home: cards
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      const soonCard = await txt(page, '.gemach-card[data-slug="soon"]');
      assert(/Coming soon/i.test(soonCard) && /Not taking requests yet/.test(soonCard), `${label} coming-soon card: ` + soonCard);
      const infoCard = await txt(page, '.gemach-card[data-slug="info"]');
      assert(/Contact for details/.test(infoCard), `${label} info-only card: ` + infoCard);
      await page.locator('.gemach-card[data-slug="soon"]').scrollIntoViewIfNeeded();
      await page.locator('.gemach-card[data-slug="soon"]').screenshot({ path: path.join(SHOTS, `${label}-status-soon-card.png`) });

      // Category tiles: Info gemach's chosen categories appear even with no items
      const tiles = await page.$$eval('.cat-tile .cat-name', els => els.map(e => e.textContent));
      assert(tiles.includes('Empty Category'), `${label} tile from Info gemach's browse categories`);

      // Text search never finds the Coming soon gemach or its items
      await page.goto(BASE + '/?q=quinoxx', { waitUntil: 'networkidle' });
      assert(!/Zmiros|Quinoxx/.test(await txt(page, '#results')), `${label} coming-soon items not searchable`);
      await page.goto(BASE + '/?q=zmiros', { waitUntil: 'networkidle' });
      assert(!/Zmiros/.test(await txt(page, '#results')), `${label} coming-soon gemach not searchable by name`);
      // …but the Info gemach is
      await page.goto(BASE + '/?q=chesed%20info', { waitUntil: 'networkidle' });
      assert(/Chesed Info Gemach/.test(await txt(page, '#results')) && /Info/.test(await txt(page, '#results')), `${label} info gemach found by name`);

      // Category browse lists both, marked
      await page.goto(BASE + '/?cat=catBB', { waitUntil: 'networkidle' });
      const bb = await txt(page, '#results');
      assert(/Zmiros Stroller Gemach/.test(bb) && /Coming soon/i.test(bb) && !/Quinoxx/.test(bb), `${label} coming-soon gemach listed under its item's category: ` + bb.slice(0, 300));
      await page.screenshot({ path: path.join(SHOTS, `${label}-status-category.png`) });
      await page.goto(BASE + '/?cat=catEM', { waitUntil: 'networkidle' });
      assert(/Chesed Info Gemach/.test(await txt(page, '#results')), `${label} info gemach under its chosen category`);

      // Coming soon page: banner, preview items, no selecting, no request button
      await page.goto(BASE + '/g/soon', { waitUntil: 'networkidle' });
      assert(/Coming soon/.test(await txt(page, '.soon-banner')) && /Coming soon/i.test(await txt(page, '#g-head')), `${label} coming-soon banner + chip`);
      assert(await page.isVisible('#row-recSoonIt1') && !(await page.$('#row-recSoonIt1 input[type=checkbox]')), `${label} items shown read-only`);
      await page.click('#row-recSoonIt1 .item-name');
      assert(!(await page.$eval('#row-recSoonIt1', e => e.classList.contains('selected'))) && !(await page.isVisible('#btn-open-modal')), `${label} can't select or request`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-status-soon-page.png`) });

      // Info only page: big info box with contact buttons; no items, no request button
      await page.goto(BASE + '/g/info', { waitUntil: 'networkidle' });
      const box = await txt(page, '.info-only');
      assert(/We lend <b>shabbos<\/b> hot plates/.test(box) && !(await page.$('.info-only b')) && /Sun–Thu 8–10pm/.test(box), `${label} info box text (escaped, not HTML) + hours: ` + box);
      assert(await page.$$eval('.info-only .io-actions a', els => els.length) >= 1, `${label} contact buttons in the box`);
      assert(await page.$eval('.info-only .prose a', a => a.getAttribute('href')) !== null, `${label} links in info are clickable`);
      assert(!(await page.$('.item-list')) && !(await page.isVisible('#btn-open-modal')), `${label} no items / request button`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-status-info-page.png`), fullPage: true });

      // A normal gemach still takes requests
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      assert(!(await page.$('.soon-banner')) && !(await page.$('.info-only')) && await page.$('.item-row input[type=checkbox]'), `${label} normal gemach unchanged`);
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
