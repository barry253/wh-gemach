// Request form contact rules (Oct 2026): email required, phone optional unless a call / text / WhatsApp is the best way
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
    if (u.pathname === '/public/config') return r.fulfill({ json: { turnstileSiteKey: null }, headers: cors });
    if (u.pathname.startsWith('/public/contact/')) return r.fulfill({ json: { c: '=03e' }, headers: cors }); // payloads here still carry contact inline (older worker); see contact-endpoint.test.cjs
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

const logs = [];



const base = { tagline: 'Test', description: '', category: 'Medical', phone: '(917) 555-1554', whatsapp: null, website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 61, primaryContact: 'Call', secondaryContact: null, email: 'cr@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], comingSoon: false, browseCategoryIds: [], mode: 'Full', gemachInfo: null, depositRequired: false };
directory.gemachs.push({ ...base, id: 'recCR', slug: 'cr', name: 'Contact Rules Gemach',
  items: [{ id: 'recCrIt1', name: 'Walker', description: '', totalUnits: 2, availableCount: 2, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }] });

const fromDate = () => { const d = new Date(); d.setDate(d.getDate() + 9); return d.toISOString().slice(0, 10); };
async function openForm(page) {
  await page.goto(BASE + '/g/cr', { waitUntil: 'networkidle' });
  await page.check('#row-recCrIt1 input[type=checkbox]');
  await page.click('#btn-open-modal');
  await page.fill('#f-name', 'Chana Test');
  await page.fill('#f-from', fromDate());
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    // Defaults: Email is the preference; email required, phone optional.
    await openForm(page);
    assert(await page.inputValue('#f-contact') === 'Email', 'best way to reach you starts on Email');
    assert(await page.$eval('#f-email', e => e.required) && !(await page.$eval('#f-phone', e => e.required)), 'email required, phone not');
    assert(await page.isVisible('#phone-opt') && !(await page.isVisible('#phone-req')), 'phone marked (optional)');

    // No email → stopped with a message, nothing sent.
    await page.click('#btn-submit'); await page.waitForTimeout(200);
    assert(/Please enter your email address/.test(await errs(page)) && !posts.length, 'email required: ' + await errs(page));
    await page.fill('#f-email', 'not-an-email');
    await page.click('#btn-submit'); await page.waitForTimeout(200);
    assert(/doesn’t look right/.test(await errs(page)) && !posts.length, 'bad email refused');

    // Email only, no phone → sent, preference Email.
    await page.fill('#f-email', 'chana@example.com');
    await page.click('#btn-submit'); await page.waitForTimeout(600);
    let p = posts.at(-1);
    assert(p && p.email === 'chana@example.com' && p.preferredContact === 'Email' && !p.phone, 'sent with email only: ' + JSON.stringify(p && { email: p.email, phone: p.phone, pc: p.preferredContact }));
    await page.screenshot({ path: path.join(SHOTS, 'm-contact-rules-sent.png') });

    // WhatsApp without a phone → the phone becomes required.
    const n = posts.length;
    await openForm(page);
    await page.fill('#f-email', 'chana@example.com');
    await page.selectOption('#f-contact', 'WhatsApp');
    assert(await page.isVisible('#phone-req') && !(await page.isVisible('#phone-opt')) && await page.$eval('#f-phone', e => e.required), 'WhatsApp makes the phone required');
    await page.click('#btn-submit'); await page.waitForTimeout(200);
    assert(/add your phone number/.test(await errs(page)) && posts.length === n, 'phone needed for WhatsApp: ' + await errs(page));
    await page.locator('#f-phone').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'm-contact-rules-phone.png') });
    await page.selectOption('#f-contact', 'Email');
    assert(!(await page.$eval('#f-phone', e => e.required)), 'back to Email: phone optional again');
    await page.selectOption('#f-contact', 'WhatsApp');
    await page.fill('#f-phone', '5165551234');
    await page.click('#btn-submit'); await page.waitForTimeout(600);
    p = posts.at(-1);
    assert(posts.length === n + 1 && p.preferredContact === 'WhatsApp' && p.phone === '(516) 555-1234' && p.email === 'chana@example.com', 'sent with WhatsApp + phone');

    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
