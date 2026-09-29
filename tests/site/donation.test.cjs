// Donation section on the gemach page: Donate button, donation text, or both
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


// medical: button + text; baby-gear: text only (no link); gowns: neither
const G = slug => directory.gemachs.find(g => g.slug === slug);
G('wh-medical').donationInfo = 'For monetary donations, visit anshei.org/donate or https://example.org/give?a=1&b=2.\n\nTo donate equipment, email gemach@example.com or call (718) 986-7345. <script>alert(1)</script>';
G('baby-gear').donationUrl = null;
G('baby-gear').donationInfo = 'We gladly accept clean strollers — call 516-555-0199.';

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: label === 'm' ? 2 : 1 });
      await setup(ctx);
      await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
      const support = () => page.$eval('.support', el => ({ text: el.innerText, links: [...el.querySelectorAll('a')].map(a => [a.textContent.trim(), a.getAttribute('href'), a.target || '']), html: el.innerHTML })).catch(() => null);

      const modalInfo = () => page.$eval('#donate-modal', el => ({ open: !el.hidden, title: el.querySelector('h2').textContent, text: el.querySelector('#donate-body').innerText, html: el.querySelector('#donate-body').innerHTML,
        links: [...el.querySelectorAll('#donate-body a')].map(a => [a.textContent.trim(), a.getAttribute('href')]), action: [...el.querySelectorAll('#donate-actions a')].map(a => [a.textContent.trim(), a.getAttribute('href'), a.target]) }));

      // text + link: page shows only the Donate button; clicking opens the pop-up with the text and a "Donate online" link
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      let s = await support();
      assert(s && /Support this gemach/i.test(s.text) && !s.text.includes('monetary'), `${label} medical: text not shown on the page`);
      assert(await page.$('#btn-donate') !== null && s.links.length === 0, `${label} medical: Donate is a button (opens pop-up), not a link`);
      await page.click('#btn-donate');
      await page.waitForSelector('#donate-modal.open');
      let m = await modalInfo();
      assert(m.open && m.title === 'Support West Hempstead Medical Gemach', `${label} pop-up opens with gemach name: ` + m.title);
      const hrefs = Object.fromEntries(m.links);
      assert(hrefs['anshei.org/donate'] === 'https://anshei.org/donate', `${label} bare web address linked ` + JSON.stringify(m.links));
      assert(hrefs['https://example.org/give?a=1&b=2'] === 'https://example.org/give?a=1&b=2', `${label} full URL linked, & kept`);
      assert(hrefs['gemach@example.com'] === 'mailto:gemach@example.com', `${label} email linked`);
      assert(hrefs['(718) 986-7345'] === 'tel:+17189867345', `${label} phone linked`);
      assert(m.text.includes('<script>alert(1)</script>') && !m.html.includes('<script>'), `${label} text escaped`);
      assert((m.html.match(/<p>/g) || []).length === 2, `${label} blank line = new paragraph`);
      assert(m.action.length === 1 && /Donate online/.test(m.action[0][0]) && m.action[0][1] === 'https://www.anshei.org/medical-gemach' && m.action[0][2] === '_blank', `${label} Donate online link in pop-up`);
      assert(await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'donate-close', null, { timeout: 2000 }).then(() => true, () => false), `${label} focus moves into pop-up`);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(SHOTS, `${label}-donate-modal.png`) });
      await page.keyboard.press('Escape');
      assert((await modalInfo()).open === false && await page.evaluate(() => document.activeElement && document.activeElement.id === 'btn-donate'), `${label} Escape closes, focus returns to Donate`);
      await page.click('#btn-donate'); await page.waitForSelector('#donate-modal.open');
      await page.mouse.click(5, 5);
      assert((await modalInfo()).open === false, `${label} click outside closes`);
      await page.locator('.support').screenshot({ path: path.join(SHOTS, `${label}-donate-button.png`) });

      // text only: pop-up with the text, no "Donate online"
      await page.goto(BASE + '/g/baby-gear', { waitUntil: 'networkidle' });
      await page.click('#btn-donate'); await page.waitForSelector('#donate-modal.open');
      m = await modalInfo();
      assert(m.text.includes('We gladly accept clean strollers') && m.action.length === 0, `${label} text only: pop-up without Donate online`);
      assert(m.links.length === 1 && m.links[0][1] === 'tel:+15165550199', `${label} text only: phone linked`);
      await page.keyboard.press('Escape');

      // link only: Donate opens the link in a new tab, no pop-up
      await page.goto(BASE + '/g/wedding-shtick', { waitUntil: 'networkidle' });
      s = await support();
      assert(s && s.links.length === 1 && /Donate/.test(s.links[0][0]) && s.links[0][1] === 'https://example.org/donate-shtick' && s.links[0][2] === '_blank' && await page.$('#btn-donate') === null, `${label} link only: plain link, new tab ` + JSON.stringify(s && s.links));

      await page.goto(BASE + '/g/' + directory.gemachs.find(g => !g.donationUrl && !g.donationInfo && g.mode !== 'Directory').slug, { waitUntil: 'networkidle' });
      assert(!(await support()), `${label} neither: no support section`);

      const v = await page.evaluate(() => window.__csp); assert(!v.length, `${label} no CSP violations ` + v.join(', '));
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
