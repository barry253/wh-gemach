// Quantity items lent in whole packages (package size, e.g. bags of 6 tablecloths): card, dropdown, submit
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
G('wh-medical').items.push(
  { id: 'recPkg0001', name: 'Gold Jacquard · Round', description: '120" round.', totalUnits: 12, availableCount: 12, hasPhoto: false, photoUrl: null, categoryId: 'catWC', tracking: 'quantity', bookings: [], packageSize: 6, packageUnit: 'bag' },
  { id: 'recPkg0002', name: 'Lilac Velvet · Round', description: '', totalUnits: 12, availableCount: 12, hasPhoto: false, photoUrl: null, categoryId: 'catWC', tracking: 'quantity', packageSize: 4, packageUnit: null,
    bookings: [{ from: '2000-01-01', to: '2100-01-01', qty: 5 }] });

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8798'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      const row = await page.$eval('#row-recPkg0001', el => el.innerText);
      assert(/12 in the gemach · lent in bags of 6 · choose how many/.test(row), `${label} card: ` + row.replace(/\n/g, ' / '));
      assert(/lent in packages of 4/.test(await page.$eval('#row-recPkg0002', el => el.innerText)), `${label} card without a package word`);
      await page.click('#row-recPkg0001 input[type=checkbox]');
      await page.click('#row-recPkg0002 input[type=checkbox]');
      await page.click('#btn-open-modal');
      await page.waitForSelector('#qty-group:not([hidden])');
      const opts = await page.$$eval('#q-recPkg0001 option', os => os.map(o => o.value + '=' + o.textContent));
      assert(JSON.stringify(opts) === JSON.stringify(['=Choose…', '6=6 (1 bag)', '12=12 (2 bags)']), `${label} dropdown choices: ` + JSON.stringify(opts));
      assert(JSON.stringify(await page.$$eval('#q-recPkg0002 option', os => os.map(o => o.value))) === '["","4","8","12"]', `${label} packages of 4`);
      let note = await page.textContent('#qn-recPkg0001');
      assert(/^Lent in bags of 6\. 12 in the gemach — choose your dates/.test(note), `${label} note: ` + note);
      await page.selectOption('#q-recPkg0001', '12');
      await page.selectOption('#q-recPkg0002', '8');
      const d = new Date(); d.setDate(d.getDate() + 20); const ymd = d.toISOString().slice(0, 10);
      await page.fill('#f-from', ymd);
      await page.waitForTimeout(100);
      note = await page.textContent('#qn-recPkg0001');
      assert(/^Lent in bags of 6\. 12 of 12 free for your dates/.test(note), `${label} with dates: ` + note);
      note = await page.textContent('#qn-recPkg0002');
      assert(/^Lent in packages of 4\. Only 7 free for your dates/.test(note) && await page.$eval('#qn-recPkg0002', e => e.classList.contains('warn')), `${label} short warning: ` + note);
      await page.locator('#qty-group').screenshot({ path: path.join(SHOTS, `${label}-package-form.png`) });
      await page.fill('#f-name', 'Table Person'); await page.fill('#f-phone', '5165551234');
      await page.selectOption('#f-contact', { index: 1 });
      const before = posts.length;
      await page.click('#btn-submit');
      await page.waitForTimeout(700);
      const p = posts[before];
      assert(p && p.quantities && p.quantities.recPkg0001 === 12 && p.quantities.recPkg0002 === 8, `${label} submitted 12 + 8: ` + JSON.stringify(p && p.quantities));
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
