// Item filters (Size / Color / Length…) on a gown gemach's page and in home search
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

const gowns = G('gowns');
gowns.itemAttributes = [
  { name: 'Size', values: ['0', '2', '4', '6', '8', '10', '12', '14', '16'] },
  { name: 'Color', values: ['Black', 'Navy', 'Gold', 'Silver', 'Blush'] },
  { name: 'Length', values: ['Floor-length', 'Tea-length'] },
  { name: 'Sleeves', values: ['Long sleeves', '3/4 sleeves'] }, // no gown uses these → filter hidden
];
const gown = (id, name, attributes, n) => ({ id, name, description: '', totalUnits: 1, availableCount: 1, hasPhoto: true,
  photoUrl: `https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev/gowns/photos/${n}.jpg`, categoryId: 'catGW', attributes });
gowns.items = [
  gown('recGw1', 'Navy A-line', { Size: ['12'], Color: ['Navy'], Length: ['Floor-length'] }, 1),
  gown('recGw2', 'Gold Mermaid', { Size: ['4'], Color: ['Gold', 'Silver'], Length: ['Floor-length'] }, 2),
  gown('recGw3', 'Black Sheath', { Size: ['8'], Color: ['Black'], Length: ['Tea-length'] }, 3),
  gown('recGw4', 'Blush Ball Gown', { Size: ['2'], Color: ['Blush'] }, 4),
  gown('recGw5', 'Navy Empire', { Size: ['8', '10'], Color: ['Navy'], Length: ['Tea-length'] }, 5),
  gown('recGw6', 'Mystery Gown', {}, 6),
];
const names = p => p.$$eval('.item-name', els => els.map(e => e.textContent));

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
      await page.goto(BASE + '/g/gowns', { waitUntil: 'networkidle' });

      const rows = await page.$$eval('.af-row .af-label', els => els.map(e => e.textContent));
      assert(rows.join('|') === 'Size|Color|Length', `${label} filters shown, unused one hidden: ` + rows.join('|'));
      const sizes = await page.$$eval('.af-row:first-child .af-v', els => els.map(e => e.textContent));
      assert(sizes.join(',') === '2,4,8,10,12', `${label} only sizes that exist, in the gemach's order: ` + sizes.join(','));
      assert(/Size 12/.test((await page.$eval('#row-recGw1', e => e.innerText)).replace(/\n/g, ' ')), `${label} gown row shows its size`);
      assert(/6 items/.test(await page.textContent('.af-count')), `${label} count before filtering`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-filters.png`), fullPage: label === 'm' ? false : true });

      // Size 8 → Black Sheath + Navy Empire
      await page.click('.af-chip:has(.af-v:text-is("8"))');
      assert((await names(page)).join('|') === 'Black Sheath|Navy Empire', `${label} size 8: ` + (await names(page)).join('|'));
      assert(await page.$eval('.af-chip:has(.af-v:text-is("8"))', e => e.getAttribute('aria-pressed')) === 'true' && await page.evaluate(() => document.activeElement.querySelector('.af-v').textContent) === '8', `${label} chip pressed and keeps focus`);
      assert(/Showing 2 of 6/.test(await page.textContent('.af-count')), `${label} count after filter`);
      // Choices with nothing left in size 8 are grayed out; sizes themselves stay open (OR within a filter)
      const chipState = () => page.$$eval('.af-row', rs => rs.map(r => [...r.querySelectorAll('.af-chip')].map(c =>
        c.querySelector('.af-v').textContent + (c.disabled ? '-' : '') + ':' + c.querySelector('.af-n').textContent).join(',')).join(' | '));
      assert(await chipState() === '2:1,4:1,8:2,10:1,12:1 | Black:1,Navy:1,Gold-:0,Silver-:0,Blush-:0 | Floor-length-:0,Tea-length:2',
        `${label} size 8 grays out other colors/lengths: ` + await chipState());
      await page.screenshot({ path: path.join(SHOTS, `${label}-filters-facets.png`) });
      // + Size 12 (OR within a filter) and Color Navy (AND across filters)
      await page.click('.af-chip:has(.af-v:text-is("12"))');
      await page.click('.af-row:nth-child(2) .af-chip:has(.af-v:text-is("Navy"))');
      assert((await names(page)).join('|') === 'Navy A-line|Navy Empire', `${label} sizes 8/12 + navy: ` + (await names(page)).join('|'));
      await page.screenshot({ path: path.join(SHOTS, `${label}-filters-on.png`) });
      // Picked chips stay tappable even when their count drops to 0
      await page.click('.af-row:nth-child(3) .af-chip:has(.af-v:text-is("Tea-length"))');
      assert(await chipState() === '2-:0,4-:0,8:1,10:1,12:0 | Black:1,Navy:1,Gold-:0,Silver-:0,Blush-:0 | Floor-length:1,Tea-length:1',
        `${label} counts follow the other filters: ` + await chipState());
      await page.click('.af-chip:has(.af-v:text-is("12"))');
      assert(await page.$eval('.af-chip:has(.af-v:text-is("12"))', e => e.disabled && e.getAttribute('aria-pressed') === 'false'), `${label} unpicked 12 is grayed (no tea-length navy 12)`);
      await page.click('.af-row:nth-child(3) .af-chip:has(.af-v:text-is("Tea-length"))');
      assert(await page.$eval('.af-chip:has(.af-v:text-is("12"))', e => !e.disabled), `${label} 12 back once tea-length is off`);
      await page.click('.af-chip:has(.af-v:text-is("12"))');
      // Fold a section shut: chips hide, summary shows the picks, and it's remembered on reload
      await page.click('.af-row:nth-child(1) .af-name');
      assert(await page.$eval('.af-row:nth-child(1)', r => r.querySelector('.af-chips').hidden && r.querySelector('.af-name').getAttribute('aria-expanded') === 'false'
        && getComputedStyle(r.querySelector('.af-sum')).display !== 'none' && r.querySelector('.af-sum').textContent === '8, 12'), `${label} size section folded with summary`);
      assert(await page.evaluate(() => document.activeElement.classList.contains('af-name')), `${label} fold button keeps focus`);
      await page.click('.af-row:nth-child(2) .af-name');
      assert(await page.$eval('.af-row:nth-child(2) .af-sum', e => e.textContent) === 'Navy', `${label} color folded shows Navy`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-filters-folded.png`) });
      await page.reload({ waitUntil: 'networkidle' });
      assert(await page.$eval('.af-row:nth-child(1) .af-chips', e => e.hidden) && await page.$eval('.af-row:nth-child(2) .af-chips', e => e.hidden)
        && !(await page.$eval('.af-row:nth-child(3) .af-chips', e => e.hidden)), `${label} folded sections remembered`);
      await page.click('.af-row:nth-child(1) .af-name');
      await page.click('.af-row:nth-child(2) .af-name');
      assert(!(await page.$eval('.af-row:nth-child(1) .af-chips', e => e.hidden)), `${label} unfold`);
      await page.click('.af-chip:has(.af-v:text-is("8"))');
      await page.click('.af-chip:has(.af-v:text-is("12"))');
      await page.click('.af-row:nth-child(2) .af-chip:has(.af-v:text-is("Navy"))');
      // Grayed chips can't be tapped, so picks can no longer lead to "nothing matches"
      await page.click('.af-row:nth-child(2) .af-chip:has(.af-v:text-is("Blush"))', { force: true });
      assert((await names(page)).join('|') === 'Navy A-line|Navy Empire' && !(await page.isVisible('.af-none')), `${label} tapping a grayed chip does nothing`);
      await page.click('#af-clear');
      assert((await names(page)).length === 6 && !(await page.$('.af-chip[aria-pressed="true"]')), `${label} clear filters shows everything`);

      // Sort by size, smallest first; gowns without a size last
      await page.selectOption('#af-sort', 'size');
      assert((await names(page)).join('|') === 'Blush Ball Gown|Gold Mermaid|Black Sheath|Navy Empire|Navy A-line|Mystery Gown', `${label} sorted by size: ` + (await names(page)).join('|'));

      // Selecting still works with filters on
      await page.click('.af-chip:has(.af-v:text-is("4"))');
      await page.click('#row-recGw2');
      assert(await page.$eval('#row-recGw2', e => e.classList.contains('selected')), `${label} select a filtered gown`);
      await page.click('.af-clear');
      assert(await page.$eval('#row-recGw2', e => e.classList.contains('selected')), `${label} selection kept after clearing filters`);

      // Home search finds gowns by color / size words
      await page.goto(BASE + '/?q=navy', { waitUntil: 'networkidle' });
      const res = await page.$eval('#results', e => e.innerText);
      assert(/Navy A-line/.test(res) && /Navy Empire/.test(res), `${label} home search by color: ` + res.slice(0, 200).replace(/\n/g, ' / '));

      // A gemach without filters shows no filter bar
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      assert(!(await page.$('.af-bar')), `${label} no filter bar when a gemach has no filters`);
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
