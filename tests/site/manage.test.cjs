// Borrower manage link (/r/<token>): success screen, "Remember me", home "Your requests", cancel + ready to return
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8796';
const SHOTS = path.join(__dirname, '..', 'test-output');
const FONTDIR = path.join(path.dirname(require.resolve('@fontsource/figtree/package.json')), '..');
const posts = [], errors = [];
const errs = p => p.$$eval('.field-error:not([hidden]), #error-msg:not([hidden])', els => els.map(e => e.textContent).join(' | '));
let postStatus = 200, postReply = { success: true, requestId: 'R-050', manageUrl: 'https://whgemachs.org/r/recREQMANAGE00001.AAAAAAAAAAAAAAAAAAAAAA' };

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



const TOK = 'recREQMANAGE00001.AAAAAAAAAAAAAAAAAAAAAA', TOK_OUT = 'recREQMANAGE00002.BBBBBBBBBBBBBBBBBBBBBB', TOK_OLD = 'recREQMANAGE00003.CCCCCCCCCCCCCCCCCCCCCC';
const G1 = { name: 'West Hempstead Medical Gemach', slug: 'wh-medical', phone: '(718) 986-7345', email: 'whmedicalgemach@gmail.com', whatsapp: '718-986-7345',
  primaryContact: 'Call', secondaryContact: 'WhatsApp', logoUrl: null, logoDarkUrl: null, themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date' };
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
function fresh() {
  return {
    [TOK]: { gemach: G1, request: { requestId: 'R-050', firstName: 'Rivka', type: 'Loan', status: 'waiting', neededFrom: plus(10), neededUntil: plus(14), openEnded: false, eventDate: null, appointmentAt: null,
      items: [{ name: 'Wheelchair', quantity: null, addon: false }] }, loans: [], can: { cancel: true, readyToReturn: false }, partlyOut: false },
    [TOK_OUT]: { gemach: G1, request: { requestId: 'R-051', firstName: 'Moshe', type: 'Loan', status: 'out', neededFrom: plus(-3), neededUntil: plus(4), openEnded: false, items: [{ name: 'Walker', quantity: null }] },
      loans: [{ loanId: 'L-090', itemName: 'Walker', quantity: null, status: 'Active', dateBorrowed: plus(-3), expectedReturn: plus(4), readyToReturnAt: null }],
      can: { cancel: false, readyToReturn: true }, partlyOut: false },
  };
}
let M = fresh(); const mposts = [];
async function manageRoutes(ctx) {
  await ctx.route(API + '/public/manage/**', async r => {
    const req = r.request(), u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const [, tok, action] = u.pathname.match(/^\/public\/manage\/([^/]+)(?:\/(\w+))?$/) || [];
    const t = decodeURIComponent(tok || '');
    if (t === TOK_OLD) return r.fulfill({ status: 410, json: { error: 'This link has expired. Please contact the gemach.', expired: true }, headers: cors });
    const d = M[t];
    if (!d) return r.fulfill({ status: 404, json: { error: "This link isn't valid. Please contact the gemach." }, headers: cors });
    if (req.method() === 'POST') {
      mposts.push({ tok: t, action });
      await new Promise(res => setTimeout(res, 150));
      if (action === 'cancel') { d.request.status = 'cancelled'; d.can = { cancel: false, readyToReturn: false }; }
      if (action === 'ready') { d.loans[0].readyToReturnAt = new Date().toISOString(); d.can = { cancel: false, readyToReturn: false }; }
      return r.fulfill({ json: { success: true, ...d }, headers: cors });
    }
    return r.fulfill({ json: d, headers: cors });
  });
}
const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\n+/g, ' / '));

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 900 }]]) {
      M = fresh(); mposts.length = 0;
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx); await manageRoutes(ctx);
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));

      // 1) Request with "Remember me" ticked → success shows the private link
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      await page.locator('.item-row input[type=checkbox]').first().check();
      await page.click('#btn-open-modal');
      assert(!(await page.isChecked('#f-remember')) && await page.isHidden('#remember-saved'), `${label} remember-me unchecked by default`);
      await page.fill('#f-name', 'Rivka Test'); await page.fill('#f-phone', '5165559999'); await page.selectOption('#f-contact', 'WhatsApp');
      await page.fill('#f-from', plus(10));
      await page.check('#f-remember');
      await page.click('#btn-submit');
      await page.waitForSelector('#success-view:not([hidden])');
      assert(await page.isVisible('#manage-box') && await page.getAttribute('#manage-link', 'href') === 'https://whgemachs.org/r/' + TOK, `${label} success screen shows the private link`);
      assert(/bookmark it or send it to yourself/.test(await page.textContent('#manage-hint')), `${label} save hint (no email given)`);
      await page.click('#manage-copy');
      await page.waitForTimeout(150);
      assert(/Copied/.test(await page.textContent('#manage-copy')), `${label} copy link`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-manage-success.png`) });
      await page.click('#success-done');

      // 2) Home shows "Your requests" from this device
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      assert(await page.isVisible('#my-requests') && /West Hempstead Medical Gemach/.test(await txt(page, '#my-requests')) && /R-050/.test(await txt(page, '#my-requests')), `${label} home 'Your requests'`);
      assert(await page.getAttribute('.my-req', 'href') === 'https://whgemachs.org/r/' + TOK, `${label} links to the manage page`);

      // 3) Next request is pre-filled; "Not you? Forget me" clears it
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      await page.locator('.item-row input[type=checkbox]').first().check();
      await page.click('#btn-open-modal');
      assert(await page.inputValue('#f-name') === 'Rivka Test' && await page.inputValue('#f-contact') === 'WhatsApp' && await page.isChecked('#f-remember') && await page.isVisible('#remember-saved'), `${label} form pre-filled from this device`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-manage-prefill.png`) });
      await page.click('#forget-me');
      assert(await page.inputValue('#f-name') === '' && !(await page.isChecked('#f-remember')), `${label} forget me clears the form`);
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      assert(await page.isHidden('#my-requests'), `${label} and the home panel`);

      // 4) Without "Remember me", nothing is saved
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      await page.locator('.item-row input[type=checkbox]').first().check();
      await page.click('#btn-open-modal');
      await page.fill('#f-name', 'No Save'); await page.fill('#f-phone', '5165558888'); await page.selectOption('#f-contact', 'Phone'); await page.fill('#f-from', plus(10));
      await page.click('#btn-submit');
      await page.waitForSelector('#success-view:not([hidden])');
      assert(await page.evaluate(() => localStorage.getItem('whg_me_v1') === null && localStorage.getItem('whg_my_requests_v1') === null), `${label} nothing stored when unticked`);

      // 5) Manage page: waiting → cancel (with confirm step)
      await page.goto(BASE + '/r/' + TOK, { waitUntil: 'networkidle' });
      assert(/Waiting for the gemach/.test(await txt(page, '#m-body')) && /Hi Rivka/.test(await txt(page, '#m-body')) && /Wheelchair/.test(await txt(page, '#m-body')), `${label} manage page shows the request`);
      assert(/Request R-050/.test(await txt(page, '#m-head')) && /West Hempstead Medical Gemach/.test(await txt(page, '#m-back')), `${label} header names gemach + request`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-manage-waiting.png`), fullPage: true });
      await page.click('[data-act="cancel"]');
      assert(await page.isVisible('.m-confirm') && !mposts.length, `${label} cancel asks to confirm first`);
      await page.click('[data-act="cancel-no"]');
      assert(await page.isHidden('.m-confirm') && !mposts.length, `${label} 'Keep it' backs out`);
      await page.click('[data-act="cancel"]');
      await page.screenshot({ path: path.join(SHOTS, `${label}-manage-confirm.png`) });
      await page.click('[data-act="cancel-yes"]');
      await page.waitForSelector('.m-flash');
      assert(mposts.at(-1).action === 'cancel' && /Cancelled/.test(await txt(page, '#m-status')) && !(await page.$('[data-act="cancel"]')), `${label} cancelled`);

      // 6) Picked up → ready to return
      await page.goto(BASE + '/r/' + TOK_OUT, { waitUntil: 'networkidle' });
      assert(/Picked up/.test(await txt(page, '#m-body')) && !(await page.$('[data-act="cancel"]')) && await page.isVisible('[data-act="ready"]'), `${label} out on loan: ready button, no cancel`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-manage-out.png`), fullPage: true });
      await page.click('[data-act="ready"]');
      await page.waitForSelector('.m-flash');
      assert(mposts.at(-1).action === 'ready' && /Gemach notified/.test(await txt(page, '.m-loans')) && !(await page.$('[data-act="ready"]')), `${label} ready to return sent`);

      // 7) Bad and expired links
      await page.goto(BASE + '/r/junk', { waitUntil: 'networkidle' });
      assert(/couldn’t open this link/.test(await txt(page, '#m-head')), `${label} malformed link`);
      await page.goto(BASE + '/r/recREQMANAGE00009.ZZZZZZZZZZZZZZZZZZZZZZ', { waitUntil: 'networkidle' });
      assert(/isn't valid/.test(await txt(page, '#m-body')), `${label} unknown link`);
      await page.goto(BASE + '/r/' + TOK_OLD, { waitUntil: 'networkidle' });
      assert(/expired/.test(await txt(page, '#m-head')), `${label} expired link`);
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
