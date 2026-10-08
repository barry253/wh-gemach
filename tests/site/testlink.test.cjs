// Test link (?test=<sig>): a gemach that isn't live opens in test mode, sends testToken, shows the Test banner; manage page marks test requests
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8796';
const SHOTS = path.join(__dirname, '..', 'test-output');
const FONTDIR = path.join(path.dirname(require.resolve('@fontsource/figtree/package.json')), '..');
const posts = [], errors = [];
const errs = p => p.$$eval('.field-error:not([hidden]), #error-msg:not([hidden])', els => els.map(e => e.textContent).join(' | '));
let postStatus = 200, postReply = { success: true, requestId: 'R-090', test: true, manageUrl: 'https://whgemachs.org/r/recREQTESTMODE001.DDDDDDDDDDDDDDDDDDDDDD' };
const gets = [];

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
    if (m) {
      gets.push(u.pathname + u.search);
      const slug = decodeURIComponent(m[1]), tok = u.searchParams.get('test');
      if (slug === 'hid') return tok === SIG ? r.fulfill({ json: hidden(true), headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors });
      const p = gemachPayload(slug); return p ? r.fulfill({ json: p, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors });
    }
    if (u.pathname === '/public/manage/' + MTOK) return r.fulfill({ json: manageData, headers: cors });
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



const SIG = 'AbCdEfGhIjKlMnOpQrStUv', MTOK = 'recREQTESTMODE001.DDDDDDDDDDDDDDDDDDDDDD';
const base = { tagline: 'Not open yet.', description: '', category: 'Other', phone: '(516) 555-0300', whatsapp: null, website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 70, primaryContact: 'Call', secondaryContact: null, email: 'hid@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], browseCategoryIds: [], mode: 'Full', gemachInfo: null, depositRequired: false, depositInfo: null };
const hidden = test => ({
  gemach: { ...base, id: 'recHID', slug: 'hid', name: 'Hidden Walker Gemach', comingSoon: false, ...(test ? { testMode: true } : {}) },
  items: [{ id: 'recHidIt1', name: 'Rollator', description: '', totalUnits: 1, availableCount: 1, hasPhoto: false, photoUrl: null, categoryId: null }],
  categories: [],
});
const manageData = {
  gemach: { name: 'Hidden Walker Gemach', slug: 'hid', phone: '(516) 555-0300', email: 'hid@example.com', whatsapp: null, primaryContact: 'Call', secondaryContact: null,
    logoUrl: null, logoDarkUrl: null, themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date' },
  request: { requestId: 'R-090', firstName: 'Tess', type: 'Loan', status: 'waiting', receivedAt: new Date().toISOString(), neededFrom: '2030-01-05', neededUntil: null,
    openEnded: true, eventDate: null, appointmentAt: null, visitOutcome: null, items: [{ name: 'Rollator', quantity: null, addon: false }] },
  loans: [], can: { cancel: true, readyToReturn: false }, partlyOut: false, openCount: 0, test: true,
};

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    // Without the link: the hidden gemach isn't found
    await page.goto(BASE + '/g/hid', { waitUntil: 'networkidle' });
    assert(/couldn’t find that gemach/.test(await page.textContent('#g-head')), 'hidden gemach without the link → not found');

    // With the link: test banner, selectable items, noindex
    await page.goto(BASE + '/g/hid?test=' + SIG, { waitUntil: 'networkidle' });
    assert(gets.some(g => g === '/public/gemach/hid?test=' + SIG), 'page asks the API with the test signature');
    assert(/Test mode/.test(await page.textContent('.test-banner')) && /tests, not real loans/.test(await page.textContent('.test-banner')), 'test banner shown');
    assert(await page.getAttribute('meta[name="robots"]', 'content') === 'noindex', 'test page is noindex');
    await page.screenshot({ path: path.join(SHOTS, 'm-testlink-page.png') });
    await page.check('#row-recHidIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    await page.fill('#f-name', 'Tess'); await page.fill('#f-phone', '5165550301'); await page.selectOption('#f-contact', 'Phone');
    const d = new Date(); d.setDate(d.getDate() + 9); await page.fill('#f-from', d.toISOString().slice(0, 10));
    await page.click('#btn-submit');
    await page.waitForSelector('#success-view:not([hidden])');
    assert(posts.length === 1 && posts[0].testToken === SIG && posts[0].gemach === 'hid', 'request carries the test token: ' + JSON.stringify(posts[0] && { t: posts[0].testToken, g: posts[0].gemach }));
    assert(/test request/.test(await page.textContent('#success-text')), 'success screen says it was a test');
    await page.screenshot({ path: path.join(SHOTS, 'm-testlink-sent.png') });

    // The link is remembered for this tab: reloading without ?test still opens test mode
    gets.length = 0;
    await page.goto(BASE + '/g/hid', { waitUntil: 'networkidle' });
    assert(gets.some(g => g === '/public/gemach/hid?test=' + SIG) && await page.isVisible('.test-banner'), 'test link kept for this tab');

    // A live gemach with no test link: no banner, no token sent
    posts.length = 0;
    await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
    assert(!(await page.$('.test-banner')), 'no test banner on a normal page');

    // Manage page marks test requests
    await page.goto(BASE + '/r/' + MTOK, { waitUntil: 'networkidle' });
    assert(/Test request/.test(await page.textContent('#m-body .test-banner')), 'manage page shows Test request');
    await page.screenshot({ path: path.join(SHOTS, 'm-testlink-manage.png') });
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
