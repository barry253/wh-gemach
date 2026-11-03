// Gemach policies: a "Read the policies" row on the page, a required check on the request form, the text in a pop-up
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

const POLICIES = 'Cleaning: $5 per tablecloth, or return them washed and pressed.\n\nReturn within 2 days of your simcha.\nLate returns: $10 a day.';
const base = { tagline: 'Tablecloths for every simcha.', description: '', category: 'Wedding & Events', phone: '(917) 555-1554', whatsapp: null, website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 60, primaryContact: 'Call', secondaryContact: null, email: 'tc@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], comingSoon: false, browseCategoryIds: [], mode: 'Full', gemachInfo: null };
directory.gemachs.push(
  { ...base, id: 'recPOL', slug: 'pol', name: 'Shulchan Test', depositRequired: true, chargeType: 'Payment', depositInfo: '$36 minimum donation.', policies: POLICIES,
    items: [{ id: 'recPolIt1', name: 'Navy Round', description: '', totalUnits: 1, availableCount: 1, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }] },
  { ...base, id: 'recNOP', slug: 'nop', name: 'No Policies Gemach', depositRequired: false, policies: null,
    items: [{ id: 'recNopIt1', name: 'Crib', description: '', totalUnits: 1, availableCount: 1, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }] });

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8814'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const B = 'http://localhost:8814';
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(B + '/g/pol', { waitUntil: 'networkidle' });
    assert(await page.isVisible('.about .policies-callout'), 'page: policies row in the About card');
    assert(!/\$10 a day/.test(await page.textContent('#g-body')), 'page: the full text is not printed on the page');
    await page.locator('.policies-callout').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'm-policies-page.png') });
    await page.click('.policies-callout [data-policies]');
    assert(await page.isVisible('#policies-modal'), 'page button opens the pop-up');
    assert((await page.textContent('#policies-title')) === 'Shulchan Test policies', 'pop-up title names the gemach');
    assert((await page.$$eval('#policies-body p', ps => ps.length)) === 2 && /\$10 a day/.test(await page.textContent('#policies-body')), 'pop-up shows the text in paragraphs');
    assert(await page.isVisible('#policies-done') && !(await page.$('#policies-agree')), 'from the page: just Close');
    await page.screenshot({ path: path.join(SHOTS, 'm-policies-popup.png') });
    await page.keyboard.press('Escape');
    assert(!(await page.isVisible('#policies-modal')), 'Escape closes it');
    assert(await page.evaluate(() => document.documentElement.style.overflow) === '', 'page scrolls again');

    // Request form: the check is required; the link opens the pop-up on top; "I've read them" checks the box
    await page.check('#row-recPolIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    assert(await page.isVisible('#policies-group') && await page.$eval('#f-policies', e => e.required), 'form: policies check shown and required');
    await page.fill('#f-name', 'T'); await page.fill('#f-email', 't@example.com'); await page.fill('#f-town', 'Lynbrook');
    const d = new Date(); d.setDate(d.getDate() + 9); await page.fill('#f-from', d.toISOString().slice(0, 10));
    await page.check('#f-deposit');
    await page.click('#btn-submit'); await page.waitForTimeout(300);
    assert(!posts.length && /read the gemach’s policies/.test(await errs(page)), 'unchecked → blocked with a message: ' + await errs(page));
    assert(await page.$eval('#policies-line', e => e.classList.contains('invalid')), 'the check is marked invalid');
    await page.click('#policies-group [data-policies]');
    assert(await page.isVisible('#policies-modal') && await page.isVisible('#modal'), 'pop-up opens over the form');
    const z = await page.evaluate(() => [getComputedStyle(document.getElementById('policies-modal')).zIndex, getComputedStyle(document.getElementById('modal')).zIndex]);
    assert(+z[0] > +z[1], 'pop-up is above the form ' + z);
    await page.screenshot({ path: path.join(SHOTS, 'm-policies-popup-form.png') });
    await page.click('#policies-agree');
    assert(!(await page.isVisible('#policies-modal')) && await page.isVisible('#modal'), '"I’ve read them" closes only the pop-up');
    assert(await page.isChecked('#f-policies') && !(await page.$eval('#policies-line', e => e.classList.contains('invalid'))), '…and checks the box, clearing the error');
    assert(await page.evaluate(() => document.documentElement.style.overflow) === 'hidden', 'page stays locked while the form is open');
    assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'f-policies', 'focus goes back to the check');
    await page.locator('#policies-group').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'm-policies-form.png') });
    await page.click('#btn-submit'); await page.waitForTimeout(400);
    assert(posts.length === 1 && posts[0].policiesAck === true, 'sent with policiesAck: true');

    // No policies: nothing shown, nothing sent
    await page.goto(B + '/g/nop', { waitUntil: 'networkidle' });
    assert(!(await page.$('.policies-callout')), 'no policies → no row on the page');
    await page.check('#row-recNopIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    assert(!(await page.isVisible('#policies-group')) && !(await page.$eval('#f-policies', e => e.required)), 'no policies → no check on the form');
    await page.fill('#f-name', 'T'); await page.fill('#f-email', 't@example.com');
    await page.fill('#f-from', d.toISOString().slice(0, 10));
    await page.click('#btn-submit'); await page.waitForTimeout(400);
    assert(posts.length === 2 && !('policiesAck' in posts[1]), 'no policiesAck sent ' + JSON.stringify(posts[1] && Object.keys(posts[1])));
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
