// Gemach page info card: contact + website are buttons, never the raw number / email / link
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
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

const logs = [];


const base = { tagline: 'x', description: 'We lend things.', category: 'Other', website: 'https://example.org/our-page', donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 60, email: 'contact.me@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], comingSoon: false, browseCategoryIds: [], mode: 'Full', gemachInfo: 'How it works.', depositRequired: false,
  items: [{ id: 'recCtaIt1', name: 'Thing', description: '', totalUnits: 1, availableCount: 1, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }] };
directory.gemachs.push(
  { ...base, id: 'recCTA', slug: 'cta', name: 'Button Gemach', phone: '(516) 555-0142', whatsapp: '(347) 555-0188', primaryContact: 'WhatsApp', secondaryContact: 'Email' },
  { ...base, id: 'recCTAI', slug: 'ctai', name: 'Info Gemach', mode: 'Info', phone: '(516) 555-0142', whatsapp: null, primaryContact: 'Call', secondaryContact: 'Email' });
const old = { ...base, id: 'recCTAO', slug: 'ctao', name: 'Old Gemach', phone: '(516) 555-0142', whatsapp: '(347) 555-0188' };
['primaryContact', 'secondaryContact', 'requestStyle', 'depositRequired', 'gemachInfo'].forEach(k => delete old[k]); // older API payload
directory.gemachs.push(old);
const RAW = /555-01(42|88)|contact\.me@example\.com|example\.org\/our-page/;

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const ctas = () => page.$$eval('.info-side .info-ctas a', as => as.map(a => [a.dataset.contact, a.textContent.trim(), a.getAttribute('href'), a.target]));

    await page.goto(BASE + '/g/cta', { waitUntil: 'networkidle' });
    const c = await ctas();
    assert(JSON.stringify(c.map(x => x[0])) === '["WhatsApp","Email","Website"]', 'info card buttons: WhatsApp, Email, Website — ' + JSON.stringify(c));
    assert(c[0][2] === 'https://wa.me/13475550188' && c[0][3] === '_blank', 'WhatsApp button opens wa.me in a new tab');
    assert(c[1][2] === 'mailto:contact.me@example.com', 'Email button is a mailto');
    assert(c[2][1] === 'Visit website' && c[2][2] === 'https://example.org/our-page' && c[2][3] === '_blank', 'Visit website button');
    assert(!RAW.test(await page.innerText('body')), 'no phone number, email or web address printed on the page');
    await page.locator('.info-panel').screenshot({ path: path.join(SHOTS, 'm-contact-ctas.png') });

    await page.goto(BASE + '/g/ctai', { waitUntil: 'networkidle' });
    assert(await page.locator('.io-actions a').count() === 2 && !RAW.test(await page.innerText('body')), 'Info only box: buttons without the number/email');

    await page.goto(BASE + '/g/ctao', { waitUntil: 'networkidle' });
    const o = await ctas();
    assert(JSON.stringify(o.map(x => x[0])) === '["Call","WhatsApp","Email","Website"]' && o[0][2] === 'tel:+15165550142', 'older payload: Call / WhatsApp / Email buttons — ' + JSON.stringify(o));
    assert(!RAW.test(await page.innerText('body')), 'older payload: nothing raw printed');
    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
