// Item views: List / Grid / Large photos — gemach default, visitor switch (remembered), selection, photo viewer
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8798';
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
const R2 = 'https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev/tc/photos/';
const gw = G('gowns');
gw.itemView = 'Grid';
gw.itemAttributes = [{ name: 'Size', values: ['4', '6', '8'] }];
gw.items = [
  { id: 'recVw1', name: 'Ivory Lace', description: 'Long sleeves, lace overlay, cathedral train. Dry cleaned after every use; please return on the hanger and in the garment bag provided.', totalUnits: 1, availableCount: 1, hasPhoto: true, photoUrl: R2 + '1.jpg', categoryId: 'catGW',
    photos: [R2 + '1.jpg', R2 + '2.jpg', R2 + '3.jpg'], attributes: { Size: ['6'] } },
  { id: 'recVw2', name: 'Gold Sequin', description: 'Short note.', totalUnits: 1, availableCount: 0, hasPhoto: true, photoUrl: R2 + '4.jpg', categoryId: 'catGW', attributes: { Size: ['8'] } },
  { id: 'recVw3', name: 'Navy Chiffon', description: '', totalUnits: 1, availableCount: 1, categoryId: 'catGW' },
];
const shtick = G('wedding-shtick');
shtick.itemView = 'Grid';
shtick.items.forEach(i => { delete i.photoUrl; delete i.photos; i.hasPhoto = false; });
const lbSrc = p => p.$eval('#lightbox-img', i => i.getAttribute('src'));
const cols = (p, sel) => p.$eval(sel, el => getComputedStyle(el).gridTemplateColumns.split(' ').length);

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8798'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    // ── Phone ──
    let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    await setup(ctx);
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/g/gowns', { waitUntil: 'networkidle' });
    assert(await page.$('.item-list.item-grid') && await page.getAttribute('.view-btn[data-view="Grid"]', 'aria-pressed') === 'true', 'gemach default Grid is used');
    assert(await cols(page, '.item-list.item-grid') === 2, 'phone grid: 2 across');
    assert((await page.textContent('.inv-head h2')).trim() === 'Gemach Inventory', 'heading says Gemach Inventory');
    assert(/3/.test(await page.textContent('#row-recVw1 .tile-count')) && !(await page.$('#row-recVw2 .tile-count')), 'photo count only on multi-photo tiles');
    assert(await page.$('#row-recVw3 .tile-nophoto'), 'item without a photo gets a plain tile');
    assert((await page.textContent('#row-recVw1 .tile-attrs')).trim() === 'Size 6', 'filter values under the name');
    await page.evaluate(() => document.querySelector('.inv-head').scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, 'm-view-grid.png') });

    await page.click('#row-recVw1 .tile-photo');
    assert(await page.isVisible('#lightbox') && (await lbSrc(page)).endsWith('/1.jpg') && await page.textContent('#lightbox-count') === '1 of 3', 'grid: tapping the photo opens the full-screen viewer');
    assert(await page.isVisible('#lightbox-desc') && /cathedral train/.test(await page.textContent('#lightbox-desc')), 'viewer shows the description under the name');
    const lbBox = await page.evaluate(() => { const i = document.getElementById('lightbox-img').getBoundingClientRect(), c = document.querySelector('.lightbox-caption').getBoundingClientRect(); return { imgBottom: i.bottom, capTop: c.top, capBottom: c.bottom, imgH: i.height }; });
    assert(lbBox.imgBottom <= lbBox.capTop + 1 && lbBox.capBottom <= 844 && lbBox.imgH > 200, 'photo sits above the caption, nothing off screen ' + JSON.stringify(lbBox));
    await page.screenshot({ path: path.join(SHOTS, 'm-viewer-desc.png') });
    await page.keyboard.press('Escape');
    assert(!(await page.$eval('#row-recVw1', el => el.classList.contains('selected'))), 'opening photos does not select');
    await page.click('#row-recVw1 .tile-check input');
    assert(await page.$eval('#row-recVw1', el => el.classList.contains('selected')) && /1 item/.test(await page.textContent('#cta-count')), 'grid: tick selects');
    await page.click('#row-recVw1 .tile-name');
    assert(!(await page.$eval('#row-recVw1', el => el.classList.contains('selected'))), 'grid: tapping the tile text toggles off');
    await page.click('#row-recVw2 .tile-name');
    assert(await page.$eval('#row-recVw2', el => el.classList.contains('selected')), 'grid: tapping the tile text selects');

    // Large photos
    await page.click('.view-btn[data-view="Photos"]');
    assert(await page.$('.item-list.item-photos') && await page.evaluate(() => localStorage.getItem('whg_view:gowns')) === 'Photos', 'switch to Large photos, remembered');
    assert(await page.$eval('#row-recVw2', el => el.classList.contains('selected')) && await page.$eval('#row-recVw2 .post-add input', i => i.checked), 'selection kept across views');
    assert(await page.$$eval('#row-recVw1 .post-photo', b => b.length) === 3 && await page.textContent('#row-recVw1 .post-num') === '1/3', 'post: 3 photos, 1/3');
    assert(await page.isHidden('#row-recVw1 .post-nav.next'), 'phone: no arrows (swipe instead)');
    const w = await page.$eval('#row-recVw1 .post-track', t => t.clientWidth);
    assert(w === 390, 'post photo spans the phone width: ' + w);
    await page.$eval('#row-recVw1 .post-track', t => { t.scrollLeft = t.clientWidth; });
    await page.waitForTimeout(250);
    assert(await page.textContent('#row-recVw1 .post-num') === '2/3' && await page.$eval('#row-recVw1 .post-dots span:nth-child(2)', s => s.classList.contains('on')), 'swiping updates 2/3 and the dots');
    await page.click('#row-recVw1 .post-photo[data-pi="1"]');
    assert((await lbSrc(page)).endsWith('/2.jpg') && await page.textContent('#lightbox-count') === '2 of 3', 'tapping photo 2 opens the viewer on photo 2');
    await page.keyboard.press('Escape');
    assert(await page.$eval('#desc-recVw1', d => d.classList.contains('clamp')), 'long description clamped');
    await page.click('#row-recVw1 .post-more');
    assert(!(await page.$eval('#desc-recVw1', d => d.classList.contains('clamp'))) && (await page.textContent('#row-recVw1 .post-more')) === 'less', '"more" opens it');
    assert(!(await page.$('#row-recVw2 .post-more')), 'short description: no "more"');
    await page.click('#row-recVw1 .post-desc');
    assert(!(await page.$eval('#row-recVw1', el => el.classList.contains('selected'))), 'tapping post text does not select');
    await page.click('#row-recVw1 .post-add');
    assert(await page.$eval('#row-recVw1', el => el.classList.contains('selected')) && /Added/.test(await page.$eval('#row-recVw1 .post-add', el => el.innerText)), 'Add to request selects, shows Added');
    assert(/2 items/.test(await page.textContent('#cta-count')), 'sticky bar counts 2');
    await page.evaluate(() => document.getElementById('row-recVw1').scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, 'm-view-photos.png') });

    await page.reload({ waitUntil: 'networkidle' });
    assert(await page.$('.item-list.item-photos'), 'reload: still Large photos');
    await page.click('.view-btn[data-view="List"]');
    assert(await page.$('#row-recVw1.item-row .item-thumb') && await page.evaluate(() => localStorage.getItem('whg_view:gowns')) === 'List', 'switch to List');

    // A gemach without photos: no switcher, plain list even if its default is Grid
    await page.goto(BASE + '/g/wedding-shtick', { waitUntil: 'networkidle' });
    assert(!(await page.$('.view-seg')) && !(await page.$('.item-grid')) && await page.$('.item-row'), 'no photos: no switcher, list');
    // Default List (wh-medical has photos): switcher shown, List pressed
    await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
    assert(await page.getAttribute('.view-btn[data-view="List"]', 'aria-pressed') === 'true' && await page.$('.item-row'), 'no default set: List');
    await ctx.close();

    // ── Computer ──
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await setup(ctx);
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/g/gowns', { waitUntil: 'networkidle' });
    assert(await cols(page, '.item-list.item-grid') === 4, 'computer grid: 4 across');
    await page.screenshot({ path: path.join(SHOTS, 'd-view-grid.png') });
    await page.click('.view-btn[data-view="Photos"]');
    assert(await cols(page, '.item-list.item-photos') === 2, 'computer large photos: 2 columns');
    assert(await page.isVisible('#row-recVw1 .post-nav.next') && await page.isHidden('#row-recVw1 .post-nav.prev'), 'computer: next arrow shown');
    await page.click('#row-recVw1 .post-nav.next');
    await page.waitForTimeout(700);
    assert(await page.textContent('#row-recVw1 .post-num') === '2/3' && await page.isVisible('#row-recVw1 .post-nav.prev'), 'arrow moves to photo 2');
    await page.screenshot({ path: path.join(SHOTS, 'd-view-photos.png') });
    await ctx.close();

    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
