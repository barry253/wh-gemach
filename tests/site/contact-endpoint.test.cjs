// Contact details come from GET /public/contact/:slug (encoded), not the directory / page data (worker public.js).
// Home cards have no contact buttons; the gemach page shows a placeholder, then the buttons; retry on failure.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory: mockDir } = require('./mock.js');
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
    gets.push(u.pathname + u.search);
    if (u.pathname === '/public/directory') return r.fulfill({ json: directory, headers: cors });
    const m = u.pathname.match(/^\/public\/gemach\/([^/]+)$/);
    if (m) { const p = gemachPayload(decodeURIComponent(m[1])); return p ? r.fulfill({ json: p, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors }); }
    const c = u.pathname.match(/^\/public\/contact\/([^/]+)$/);
    if (c) {
      if (contactDelay) await new Promise(res => setTimeout(res, contactDelay));
      if (contactFail) return r.fulfill({ status: 500, json: { error: 'x' }, headers: cors });
      const k = CONTACTS[decodeURIComponent(c[1])];
      return k ? r.fulfill({ json: { c: enc(k) }, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors });
    }
    if (u.pathname === '/public/event') { events.push(req.postData()); return r.fulfill({ status: 204, headers: cors }); }
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

// New-worker shape: no contact keys in the directory or page data; contact served encoded on its own route.
const KEYS = ['phone', 'email', 'whatsapp', 'primaryContact', 'secondaryContact'];
const enc = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').split('').reverse().join('');
const CONTACTS = {};
const strip = g => { const o = { ...g }; const c = {}; KEYS.forEach(k => { c[k] = o[k] ?? null; delete o[k]; }); CONTACTS[g.slug] = c; return o; };
const base = { tagline: 'x', description: 'We lend things.', category: 'Other', website: null, donationUrl: null,
  hours: null, logoUrl: null, communityName: 'West Hempstead', displayOrder: 60, email: 'contact.me@example.com',
  themeColor: '#1B3A4B', accentColor: null, requestStyle: 'Dates', eventLabel: 'Event date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
  itemAttributes: [], comingSoon: false, browseCategoryIds: [], mode: 'Full', gemachInfo: 'How it works.', depositRequired: false,
  items: [{ id: 'recCeIt1', name: 'Thing', description: '', totalUnits: 1, availableCount: 1, hasPhoto: false, photoUrl: null, categoryId: 'catSH' }] };
const all = [...mockDir.gemachs,
  { ...base, id: 'recCE1', slug: 'ce', name: 'Endpoint Gemach', phone: '(516) 555-0142', whatsapp: '(347) 555-0188', primaryContact: 'WhatsApp', secondaryContact: 'Call' },
  { ...base, id: 'recCE2', slug: 'cei', name: 'Endpoint Info Gemach', mode: 'Info', phone: '(516) 555-0142', whatsapp: null, primaryContact: 'Call', secondaryContact: 'Email' },
  { ...base, id: 'recCE3', slug: 'cen', name: 'No Contact Gemach', email: null, phone: null, whatsapp: null, primaryContact: null, secondaryContact: null }];
const directory = { categories: mockDir.categories, gemachs: all.map(strip), generatedAt: new Date().toISOString() };
function gemachPayload(slug) {
  const g = directory.gemachs.find(x => x.slug === slug);
  if (!g) return null;
  const { items, ...profile } = g;
  return { gemach: profile, items, categories: directory.categories };
}
const gets = [], events = [];
let contactDelay = 0, contactFail = false;
const RAW = /555-01(42|88)|contact\.me@example\.com/;
const SIG = 'AbCdEfGhIjKlMnOpQrStUv';

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const head = () => page.$$eval('#g-head .contact-row a', as => as.map(a => [a.dataset.contact, a.getAttribute('href')]));

    // Home: cards have no contact buttons, just the "View gemach" cue; the whole card opens the gemach
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    assert(await page.locator('.gemach-card').count() >= 5, 'home cards rendered');
    assert(await page.locator('.gemach-card a[href^="tel:"], .gemach-card a[href^="sms:"], .gemach-card a[href^="mailto:"], .gemach-card a[href*="wa.me"], .gemach-card [data-contact]').count() === 0, 'no contact buttons on home cards');
    assert(await page.locator('.gemach-card .gemach-go').count() === await page.locator('.gemach-card').count(), 'every card shows "View gemach"');
    assert(!gets.some(g => g.startsWith('/public/contact/')), 'home page never asks for contact details');
    await page.locator('.gemach-card[data-slug="ce"]').screenshot({ path: path.join(SHOTS, 'm-home-card-no-contact.png') });
    // A real tap on the cue lands on the card's link overlay (the cue itself isn't a link)
    await page.$eval('.gemach-card[data-slug="ce"] .gemach-go', el => el.scrollIntoView({ block: 'center' }));
    const box = await page.locator('.gemach-card[data-slug="ce"] .gemach-go').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(/\/g\/ce$/, { timeout: 5000 });
    assert(true, 'tapping the "View gemach" cue opens the gemach page');

    // Gemach page: placeholder while loading, then the buttons
    contactDelay = 1200;
    await page.goto(BASE + '/g/ce', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#g-head .g-name');
    assert(await page.locator('#g-head .contact-row.contact-pending').count() === 1 && (await head()).length === 0, 'placeholder holds the space while contact loads');
    const hPending = await page.locator('#g-head .contact-row').boundingBox();
    await page.locator('#g-header').screenshot({ path: path.join(SHOTS, 'm-contact-pending.png') });
    await page.waitForSelector('#g-head .contact-row a');
    const h = await head();
    assert(JSON.stringify(h) === '[["WhatsApp","https://wa.me/13475550188"],["Call","tel:+15165550142"]]', 'buttons after loading: ' + JSON.stringify(h));
    const hDone = await page.locator('#g-head .contact-row').boundingBox();
    assert(hPending && hDone && Math.abs(hPending.height - hDone.height) <= 4, `no jump when the buttons arrive (${hPending && hPending.height} → ${hDone && hDone.height})`);
    assert(await page.locator('#g-mini .g-mini-btn').count() === 2, 'slim bar gets the same two buttons');
    assert(!RAW.test(await page.innerText('body')), 'nothing printed raw');
    assert(await page.locator('.item-list li, .item-grid li').count() >= 1, 'inventory still there');
    contactDelay = 0;

    // Failure → "Try again"
    contactFail = true;
    await page.goto(BASE + '/g/ce', { waitUntil: 'networkidle' });
    await page.waitForSelector('#g-head .contact-failed');
    assert(/Couldn’t load contact details/.test(await page.innerText('#g-head')), 'failure message in the header');
    await page.locator('#g-header').screenshot({ path: path.join(SHOTS, 'm-contact-failed.png') });
    contactFail = false;
    await page.click('#g-head [data-contact-retry]');
    await page.waitForSelector('#g-head .contact-row a');
    assert((await head()).length === 2, 'Try again loads the buttons');

    // Info only: big buttons arrive in the info box
    await page.goto(BASE + '/g/cei', { waitUntil: 'networkidle' });
    const io = await page.$$eval('.io-actions a', as => as.map(a => a.getAttribute('href')));
    assert(JSON.stringify(io) === '["tel:+15165550142","mailto:contact.me@example.com"]', 'Info only box buttons: ' + JSON.stringify(io));
    assert(await page.locator('.contact-pending').count() === 0, 'no placeholder left');

    // No contact methods at all: no row, no placeholder
    await page.goto(BASE + '/g/cen', { waitUntil: 'networkidle' });
    assert(await page.locator('#g-head .contact-row').count() === 0, 'gemach with no contact: no contact row');

    // Test link: the contact request carries the signature too
    await page.goto(BASE + '/g/ce?test=' + SIG, { waitUntil: 'networkidle' });
    assert(gets.includes('/public/contact/ce?test=' + SIG), 'contact request sent with the test signature');

    await ctx.close();
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
