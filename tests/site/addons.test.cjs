// Add-ons (made to order, for purchase) on the gemach page and home search
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
G('wedding-shtick').items.push(
  { id: 'recAddon001', name: 'Family Sweatshirt', description: '$40 each (separate payment).', totalUnits: 0, availableCount: null, hasPhoto: false, photoUrl: null, categoryId: 'catWD', tracking: 'addon', price: 40 },
  { id: 'recAddon002', name: 'Bride and Groom Tumblers', description: '', totalUnits: 0, availableCount: null, hasPhoto: false, photoUrl: null, categoryId: 'catWD', tracking: 'addon', price: null });

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
      await page.goto(BASE + '/g/wedding-shtick', { waitUntil: 'networkidle' });
      const blocks = await page.$$eval('.cat-block', els => els.map(e => ({ h: (e.querySelector('h3') || {}).textContent || '', names: [...e.querySelectorAll('.item-name')].map(n => n.textContent) })));
      const last = blocks.at(-1);
      assert(/Add-ons \(for purchase\)/.test(last.h) && last.names.join('|') === 'Family Sweatshirt|Bride and Groom Tumblers', `${label} add-ons in their own group at the end ` + JSON.stringify(blocks.map(b => b.h)));
      assert(!blocks.slice(0, -1).some(b => b.names.includes('Family Sweatshirt')), `${label} not repeated in the category group`);
      const row = await page.$eval('#row-recAddon001', el => el.innerText);
      assert(/Add-on · \$40/.test(row) && /Made to order/.test(row) && !/on loan/i.test(row), `${label} add-on row: price badge, no 'on loan' ` + row.replace(/\n/g, ' / '));
      assert(/Add-on$/m.test(await page.$eval('#row-recAddon002', el => el.innerText)), `${label} add-on without price`);
      await page.locator('#row-recAddon001').scrollIntoViewIfNeeded();
      await page.locator('.cat-block:last-of-type').screenshot({ path: path.join(SHOTS, `${label}-addons-group.png`) });

      // order add-on on its own, 3 of them
      await page.click('#row-recAddon001 input[type=checkbox]');
      await page.click('#btn-open-modal');
      await page.waitForSelector('#qty-group:not([hidden])');
      assert(await page.inputValue('#q-recAddon001') === '1', `${label} add-on count starts at 1`);
      await page.fill('#q-recAddon001', '3');
      await page.waitForTimeout(100);
      const note = await page.textContent('#qn-recAddon001');
      assert(/\$40 each — \$120 for 3 · paid separately/.test(note), `${label} price note: ` + note);
      assert(/Add-on · \$40 each/.test(await page.$eval('#modal-items-grid', e => e.innerText)), `${label} modal list marks add-on`);
      assert(await page.$eval('#deposit-group', e => e.hidden), `${label} add-on only: no deposit box`);
      await page.fill('#f-name', 'Addon Buyer'); await page.fill('#f-phone', '5165551234');
      await page.selectOption('#f-contact', { index: 1 });
      const d = new Date(); d.setDate(d.getDate() + 30); const ymd = d.toISOString().slice(0, 10);
      await page.fill('#f-event', ymd);
      await page.screenshot({ path: path.join(SHOTS, `${label}-addons-form.png`) });
      const before = posts.length;
      await page.click('#btn-submit');
      await page.waitForTimeout(700);
      const p = posts[before];
      assert(p && JSON.stringify(p.itemsRequested) === '["recAddon001"]' && p.quantities && p.quantities.recAddon001 === 3, `${label} submitted add-on only, qty 3: ` + JSON.stringify(p && { i: p.itemsRequested, q: p.quantities }));

      // home search shows the add-on as orderable, not "all on loan"
      await page.goto(BASE + '/?q=sweatshirt', { waitUntil: 'networkidle' });
      const res = await page.$eval('#results', e => e.innerText);
      assert(/Family Sweatshirt/.test(res) && /Add-on/.test(res) && !/All on loan/.test(res), `${label} home search badge: ` + res.replace(/\n/g, ' / '));
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
