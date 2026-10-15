// Site events for Network → Analytics: item photos opened / ticked, browser errors, "couldn't load" (POST /public/event)
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
    if (u.pathname === '/public/event') { events.push({ body: JSON.parse(req.postData()), ct: req.headers()['content-type'] }); return r.fulfill({ status: 204, headers: cors }); }
    if (u.pathname === '/public/directory') return dirFail ? r.fulfill({ status: 500, json: { error: 'x' }, headers: cors }) : r.fulfill({ json: directory, headers: cors });
    const m = u.pathname.match(/^\/public\/gemach\/([^/]+)$/);
    if (m) { if (gemachFail) return r.fulfill({ status: 500, json: { error: 'x' }, headers: cors }); const p = gemachPayload(decodeURIComponent(m[1])); return p ? r.fulfill({ json: p, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors }); }
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

const logs = [], events = [];
let dirFail = false, gemachFail = false;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await wait(500);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx);
    // Real visitors' browsers: automated browsers (navigator.webdriver) are never counted.
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
    const btn = await page.$('[data-photo]');
    const itemId = await btn.getAttribute('data-photo');
    await btn.click(); await page.waitForSelector('#lightbox.open');
    await page.click('#lightbox-close');
    await btn.click(); await page.click('#lightbox-close'); // again: still one count per page view
    await wait(300);
    const photos = events.filter(e => e.body.kind === 'item-photos');
    assert(photos.length === 1 && photos[0].body.item === itemId && photos[0].body.gemach === 'wh-medical', 'photo open sent once: ' + JSON.stringify(events));
    assert(/^text\/plain/.test(photos[0].ct || ''), 'text/plain (no preflight)');
    const chk = await page.$(`input[type=checkbox][data-id="${itemId}"]`) || await page.$('input[type=checkbox][data-id]');
    const pickId = await chk.getAttribute('data-id');
    await chk.check(); await chk.uncheck(); await chk.check(); await wait(300);
    const picks = events.filter(e => e.body.kind === 'item-pick');
    assert(picks.length === 1 && picks[0].body.item === pickId, 'tick sent once: ' + JSON.stringify(picks));
    assert(!events.some(e => /[\w.]+@[\w.]+|\d{7}/.test(JSON.stringify(e.body))), 'nothing personal in events');
    // A script error on the page
    await page.evaluate(() => setTimeout(() => { throw new Error('Boom from test'); }, 0));
    await page.evaluate(() => setTimeout(() => { throw new Error('Boom 2'); }, 0));
    await page.evaluate(() => setTimeout(() => { throw new Error('Boom 3'); }, 0));
    await page.evaluate(() => setTimeout(() => { throw new Error('Boom 4'); }, 0));
    await wait(400);
    const errs_ = events.filter(e => e.body.kind === 'js-error');
    assert(errs_.length === 3 && /Boom from test/.test(errs_[0].body.msg) && errs_[0].body.page === '/g/wh-medical', 'browser errors reported, at most 3 per page: ' + JSON.stringify(errs_.map(e => e.body.msg)));
    errors.length = 0; // the thrown test errors

    // "couldn't load" on the home page and on a gemach page
    dirFail = true; events.length = 0;
    const p2 = await ctx.newPage();
    await p2.goto(BASE + '/', { waitUntil: 'networkidle' }); await wait(4000); // 3 directory attempts, pauses 0.7 s + 1.5 s
    assert(events.some(e => e.body.kind === 'load-fail' && e.body.what === 'directory' && e.body.page === '/'), 'directory load failure sent: ' + JSON.stringify(events));
    dirFail = false; gemachFail = true; events.length = 0;
    await p2.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await p2.goto(BASE + '/g/baby-gear', { waitUntil: 'networkidle' }); await wait(1500);
    assert(events.some(e => e.body.kind === 'load-fail' && e.body.what === 'gemach' && e.body.page === '/g/baby-gear'), 'gemach load failure sent: ' + JSON.stringify(events));
    gemachFail = false;

    // Automated browsers aren't counted
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await setup(ctx2); events.length = 0;
    const p3 = await ctx2.newPage();
    await p3.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
    await p3.click('[data-photo]'); await wait(300);
    assert(!events.length, 'webdriver browsers send nothing');
    assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} failed` : 'all passed');
})();
