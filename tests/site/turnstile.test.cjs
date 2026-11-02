// Request form spam protection: Cloudflare Turnstile token asked for on Send (execute mode, fake widget), one quiet retry
// when the worker turns a token down, reset after each send, honeypot, CSP
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


const base = { tagline: 'Wheelchairs and more.', description: '', category: 'Medical', phone: '(516) 555-1554', whatsapp: null, website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 60, primaryContact: 'Call', secondaryContact: null, email: 'ts@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], comingSoon: false, browseCategoryIds: [], mode: 'Full', gemachInfo: null, depositRequired: false };
directory.gemachs.push({ ...base, id: 'recTSG', slug: 'tsg', name: 'Turnstile Gemach',
  items: [{ id: 'recTsIt1', name: 'Walker', description: '', totalUnits: 1, availableCount: 1, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }] });

// A stand-in for Cloudflare's widget: in execute mode it hands out "tok-N" a moment after each execute(); like the real
// one, execute() does nothing while a token is already out until reset() is called.
const FAKE_TURNSTILE = `window.turnstile = {
  render: function (el, o) { window.__tsOpts = o; window.__tsRenders = (window.__tsRenders || 0) + 1; window.__tsHas = false;
    if (o.execution !== 'execute') setTimeout(function () { o.callback('tok-auto'); }, 300); return 'w1'; },
  execute: function () { if (window.__tsHas) return; window.__tsExecs = (window.__tsExecs || 0) + 1; var n = window.__tsExecs;
    setTimeout(function () { window.__tsHas = true; window.__tsOpts.callback('tok-' + n); }, 150); },
  reset: function () { window.__tsResets = (window.__tsResets || 0) + 1; window.__tsHas = false; }
};`;

async function fillAndSend(page) {
  await page.fill('#f-name', 'Tess T'); await page.fill('#f-email', 'tess@example.com'); await page.fill('#f-phone', '5165551234'); await page.selectOption('#f-contact', 'Phone');
  const d = new Date(); d.setDate(d.getDate() + 9); await page.fill('#f-from', d.toISOString().slice(0, 10));
  await page.click('#btn-submit');
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    // 1. Keys set: token sent, widget reset after each send, honeypot passed through, nothing blocked by CSP
    let ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx);
    const cors = { 'access-control-allow-origin': '*' };
    await ctx.route(API + '/public/config', r => r.fulfill({ json: { turnstileSiteKey: '0x4AAAtest' }, headers: cors }));
    await ctx.route('https://challenges.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_TURNSTILE }));
    let page = await ctx.newPage();
    const csp = [];
    page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/g/tsg', { waitUntil: 'networkidle' });
    assert(!(await page.evaluate(() => !!window.turnstile)), 'widget script not loaded until the form opens');
    await page.check('#row-recTsIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    await page.waitForTimeout(100);
    const opts = await page.evaluate(() => window.__tsOpts && { sitekey: window.__tsOpts.sitekey, action: window.__tsOpts.action, appearance: window.__tsOpts.appearance, execution: window.__tsOpts.execution });
    assert(opts && opts.sitekey === '0x4AAAtest' && opts.action === 'request' && opts.appearance === 'interaction-only' && opts.execution === 'execute', 'widget rendered on opening the form: ' + JSON.stringify(opts));
    await page.waitForTimeout(500);
    assert(!(await page.evaluate(() => window.__tsExecs)), 'no token asked for until Send');
    // The worker turns the first token down (e.g. it went stale): a fresh token is fetched and sent once more, quietly
    let replies = [{ s: 403, b: { error: 'The security check didn\'t go through. Please try sending again.', turnstile: true } }, { s: 200, b: { success: true, requestId: 'R-1' } }];
    const next = () => { const r = replies.shift() || { s: 200, b: { success: true, requestId: 'R-x' } }; postStatus = r.s; postReply = r.b; };
    await ctx.route(API + '/submit-request', async r => { posts.push(JSON.parse(r.request().postData())); next(); await new Promise(res => setTimeout(res, 100)); r.fulfill({ status: postStatus, json: postReply, headers: cors }); });
    await fillAndSend(page);
    await page.waitForTimeout(1200);
    assert(posts.length === 2 && posts[0].turnstileToken === 'tok-1' && posts[1].turnstileToken === 'tok-2' && !('website' in posts[0]), 'refused token: retried once with a fresh token, no honeypot value: ' + JSON.stringify(posts.map(p => p.turnstileToken)));
    assert(await page.isVisible('#success-view') && !(await errs(page)), 'request sent, no error shown: ' + await errs(page));
    // Refused twice in a row: the message shows, and only one retry was made
    await page.goto(BASE + '/g/tsg', { waitUntil: 'networkidle' });
    await page.check('#row-recTsIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    const refused = { s: 403, b: { error: 'The security check didn\'t go through. Please try sending again.', turnstile: true } };
    replies = [refused, refused];
    await fillAndSend(page);
    await page.waitForTimeout(1200);
    assert(posts.length === 4 && posts[2].turnstileToken !== posts[3].turnstileToken, 'one retry only, each with its own token: ' + JSON.stringify(posts.slice(2).map(p => p.turnstileToken)));
    assert(/security check didn’t go through|security check didn't go through/.test(await errs(page)), 'second refusal shown: ' + await errs(page));
    assert(!(await page.$eval('#btn-submit', b => b.disabled)), 'send button usable again');
    // Pressing Send again after that gets yet another fresh token
    replies = [{ s: 200, b: { success: true, requestId: 'R-2' } }];
    await page.click('#btn-submit');
    await page.waitForTimeout(800);
    assert(posts.length === 5 && ![posts[2], posts[3]].some(p => p.turnstileToken === posts[4].turnstileToken), 'next send uses a fresh token: ' + posts[4]?.turnstileToken);
    assert(await page.isVisible('#success-view'), 'request sent');
    // A different refusal (not Turnstile) is not retried
    await page.goto(BASE + '/g/tsg', { waitUntil: 'networkidle' });
    await page.check('#row-recTsIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    replies = [{ s: 400, b: { error: 'Name and email are required.' } }];
    await fillAndSend(page);
    await page.waitForTimeout(800);
    assert(posts.length === 6 && /Name and email are required/.test(await errs(page)), 'other errors shown without a retry');
    await ctx.unroute(API + '/submit-request');
    postStatus = 200; postReply = { success: true, requestId: 'R-3' };
    // honeypot: a bot that fills every field
    await page.goto(BASE + '/g/tsg', { waitUntil: 'networkidle' });
    await page.check('#row-recTsIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    const hpBox = await page.locator('#f-hp').boundingBox();
    assert(!hpBox || hpBox.x + hpBox.width < 0, 'honeypot field is off-screen');
    await page.evaluate(() => { document.getElementById('f-hp').value = 'http://spam.example'; });
    await fillAndSend(page);
    await page.waitForTimeout(700);
    assert(posts.length === 7 && posts[6].website === 'http://spam.example', 'honeypot value reaches the server (which refuses it)');
    assert(!csp.length, 'nothing blocked by the Content-Security-Policy: ' + csp.join(' | '));
    await ctx.close();

    // 2. The widget script can't load (ad blocker): a clear message, nothing sent
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx);
    await ctx.route(API + '/public/config', r => r.fulfill({ json: { turnstileSiteKey: '0x4AAAtest' }, headers: cors }));
    await ctx.route('https://challenges.cloudflare.com/**', r => r.abort('blockedbyclient'));
    page = await ctx.newPage();
    await page.goto(BASE + '/g/tsg', { waitUntil: 'networkidle' });
    await page.check('#row-recTsIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    const before = posts.length;
    await fillAndSend(page);
    await page.waitForTimeout(500);
    assert(posts.length === before && /couldn’t load/.test(await errs(page)), 'blocked widget explained, nothing sent: ' + await errs(page));
    assert(!(await page.$eval('#btn-submit', b => b.disabled)), 'send button usable again');
    await ctx.close();

    // 3. No keys yet (config says null): sends as before, no widget
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx);
    await ctx.route(API + '/public/config', r => r.fulfill({ json: { turnstileSiteKey: null }, headers: cors }));
    page = await ctx.newPage();
    await page.goto(BASE + '/g/tsg', { waitUntil: 'networkidle' });
    await page.check('#row-recTsIt1 input[type=checkbox]');
    await page.click('#btn-open-modal');
    await fillAndSend(page);
    await page.waitForTimeout(500);
    assert(posts.at(-1) && !('turnstileToken' in posts.at(-1)) && await page.isVisible('#success-view'), 'no keys: request goes through without a token');
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
