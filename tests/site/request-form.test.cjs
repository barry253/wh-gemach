// Listing-only gemach that takes requests through its own form (e.g. a Google Form)
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


const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSexample/viewform';
const base = { tagline: 'Shtick for every simcha.', description: '', category: 'Wedding & Events', phone: '(917) 555-1554', whatsapp: null, website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 60, primaryContact: 'Call', secondaryContact: null, email: 'sh@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Event', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], comingSoon: false, browseCategoryIds: [], mode: 'Directory', gemachInfo: null, depositRequired: false };
const its = p => [{ id: p + '1', name: 'Light-up Signs', description: 'Set of 4', totalUnits: 2, availableCount: 0, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }];
directory.gemachs.push(
  { ...base, id: 'recFORM', slug: 'formg', name: 'Form Shtick', requestFormUrl: FORM, items: its('recF') },
  { ...base, id: 'recFORMBAD', slug: 'formbad', name: 'Bad Link Shtick', requestFormUrl: 'javascript:alert(1)', items: its('recB') },
  { ...base, id: 'recNOFORM', slug: 'noform', name: 'Plain Listing', items: its('recN') },
  { ...base, id: 'recFULLF', slug: 'fullf', name: 'Online Shtick', mode: 'Full', requestFormUrl: FORM, items: its('recU') });

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    await ctx.route('https://docs.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<title>form</title>ok' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    await page.goto(BASE + '/g/formg', { waitUntil: 'networkidle' });
    const link = page.locator('.form-notice a');
    assert(await link.count() === 1 && await link.getAttribute('href') === FORM && await link.getAttribute('target') === '_blank', 'form notice links to the form in a new tab');
    assert(!(await page.locator('.badge-dir, .badge-ok, .badge-out').count()), 'no availability / "Contact to check" badges');
    assert(!(await page.locator('#row-recF1 input[type=checkbox]').count()), 'items can\'t be selected');
    assert(await page.isVisible('#sticky-cta') && await page.textContent('#btn-open-modal') === 'Open the request form', 'sticky bar offers the form');
    await page.screenshot({ path: path.join(SHOTS, 'm-request-form.png') });
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#btn-open-modal')]);
    await popup.waitForLoadState();
    assert(popup.url() === FORM, 'sticky button opens the form');
    await popup.close();
    assert(!(await page.locator('#modal-backdrop.open, .modal.open').count()), 'request form modal not opened');

    await page.goto(BASE + '/g/formbad', { waitUntil: 'networkidle' });
    assert(!(await page.locator('.form-notice').count()) && await page.locator('.badge-dir').count() > 0, 'non-https link ignored → plain listing');

    await page.goto(BASE + '/g/noform', { waitUntil: 'networkidle' });
    assert(!(await page.locator('.form-notice').count()) && !(await page.isVisible('#sticky-cta')), 'listing without a form: unchanged');

    await page.goto(BASE + '/g/fullf', { waitUntil: 'networkidle' });
    assert(!(await page.locator('.form-notice').count()) && await page.locator('#row-recU1 input[type=checkbox]').count() === 1, 'online-requests gemach ignores the form link');
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
