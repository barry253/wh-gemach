// v5 brand tests (was: v3 tests: contacts, logos/favicon, theme colors, Gemach Info, Event / Appointment / deposit request styles
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8796';
const SHOTS = path.join(__dirname, '..', '.out');
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

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8796'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const px = v => parseFloat(v);
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 860 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: label === 'm' ? 2 : 1, isMobile: label === 'm', hasTouch: label === 'm', timezoneId: 'America/New_York' });
      await setup(ctx);
      await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
      const page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${label}] ${m.type()}: ${m.text()} @ ${page.url()}`); });
      page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message} @ ${page.url()}`));
      const shot = async (name, full = true) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, `${label}-v5-${name}.png`), fullPage: full }); };
      const go = async u => { await page.goto(BASE + u, { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); };
      const csp = async () => { const v = await page.evaluate(() => window.__csp); assert(!v.length, `${label} no CSP violations on ${page.url().replace(BASE, '')} ${v.join(', ')}`); };
      // contrast of computed fg on computed bg (both rgb())
      const pairContrast = (sel, bgSel) => page.evaluate(([sel, bgSel]) => {
        const hex = c => '#' + c.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
        const el = document.querySelector(sel), bg = document.querySelector(bgSel || sel);
        const f = hex(getComputedStyle(el).color), b = hex(getComputedStyle(bg).backgroundColor);
        return [f, b, WHG.contrast(f, b)];
      }, [sel, bgSel]);
      const checkPair = async (sel, bgSel, min, what) => { const [f, b, c] = await pairContrast(sel, bgSel); assert(c >= min, `${label} contrast ${what}: ${f} on ${b} = ${c.toFixed(2)} (>= ${min})`); };

      // ── Home ──
      await go('/');
      const home = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement), q = s => document.querySelector(s), g = s => getComputedStyle(q(s));
        return {
          tokens: ['--primary','--primary-dark','--accent','--accent-text','--bg','--bg-tint','--border','--text','--text-muted','--on-primary-muted','--success','--success-tint','--error','--error-tint'].map(k => cs.getPropertyValue(k).trim()).join(),
          bodyFont: g('body').fontFamily, h1Font: g('.hero h1').fontFamily, h1W: g('.hero h1').fontWeight, h1C: g('.hero h1').color,
          bodyBg: g('body').backgroundColor, bodyC: g('body').color,
          heroBg: g('.hero').backgroundColor, heroB: g('.hero').borderBottom,
          footBg: g('.site-footer').backgroundColor,
          card: [g('.gemach-card').backgroundColor, g('.gemach-card').borderTopWidth, g('.gemach-card').borderTopColor, g('.gemach-card').borderRadius].join(' '),
          medLogo: q('.gemach-card[data-slug="wh-medical"] img.g-avatar') && q('.gemach-card[data-slug="wh-medical"] img.g-avatar').getAttribute('src'),
          fontsOk: document.fonts.check('600 20px "Source Serif 4"') && document.fonts.check('400 16px Figtree') && document.fonts.check('600 16px Figtree'),
        };
      });
      console.log('   home:', JSON.stringify(home));
      assert(home.tokens === '#1B3A4B,#12293A,#E0A63A,#8A5D14,#FBF6EC,#F3EADA,#E6DCC8,#1F2A30,#5E6B72,#D5DEE3,#2F6B4A,#E4F0E8,#A63D2A,#F6E3DE', `${label} brand tokens on :root`);
      assert(/^"?Figtree/.test(home.bodyFont) && /^"?Source Serif 4/.test(home.h1Font) && home.h1W === '600' && home.fontsOk, `${label} fonts: Figtree body, Source Serif 4 600 headings (loaded)`);
      assert(home.bodyBg === 'rgb(251, 246, 236)' && home.bodyC === 'rgb(31, 42, 48)', `${label} page bg --bg, text --text`);
      assert(home.heroBg === 'rgb(27, 58, 75)' && home.heroB === '3px solid rgb(224, 166, 58)' && home.h1C === 'rgb(251, 246, 236)', `${label} network header: navy, 3px gold rule, cream wordmark`);
      assert(home.footBg === 'rgb(18, 41, 58)', `${label} footer --primary-dark`);
      assert(home.card === 'rgb(255, 255, 255) 1px rgb(230, 220, 200) 12px', `${label} cards white, 1px --border, 12px radius`);
      assert(home.medLogo && home.medLogo.includes('/logo-light/'), `${label} home card uses logoUrl (light) tile`);
      await checkPair('.hero .lede', '.hero', 4.5, 'home lede on navy');
      await checkPair('.section-title', 'body', 4.5, 'section title on bg');
      await checkPair('.gemach-tagline', '.gemach-card', 4.5, 'card tagline on white');
      await checkPair('.footer-credit', '.site-footer', 4.5, 'footer credit');
      await checkPair('.footer-credit a', '.site-footer', 4.5, 'footer link');
      await csp();
      await shot('home');
      await page.fill('#q', 'walker'); await page.waitForTimeout(350);
      await checkPair('.badge-ok', null, 4.5, 'Available badge'); 
      assert(await page.$eval('.badge-ok', e => getComputedStyle(e).color === 'rgb(47, 107, 74)' && getComputedStyle(e).backgroundColor === 'rgb(228, 240, 232)'), `${label} Available badge uses --success/--success-tint`);
      if (await page.$('.badge-out')) {
        assert(await page.$eval('.badge-out', e => getComputedStyle(e).color === 'rgb(166, 61, 42)' && getComputedStyle(e).backgroundColor === 'rgb(246, 227, 222)'), `${label} On-loan badge uses --error/--error-tint`);
        await checkPair('.badge-out', null, 4.5, 'On-loan badge');
      }
      await shot('search-walker');

      // ── WH Medical header ──
      await go('/g/wh-medical');
      const med = await page.evaluate(() => {
        const q = s => document.querySelector(s), g = s => getComputedStyle(q(s)), r = s => q(s).getBoundingClientRect();
        return {
          topbar: [g('.topbar').backgroundColor, g('.topbar').borderBottom, g('.brand').color, g('.brand').fontFamily, g('.brand').fontWeight].join(' | '),
          band: [g('.hero-gemach').backgroundColor, g('.hero-gemach').borderBottom].join(' | '),
          logo: [q('.g-logo').tagName, q('.g-logo').className, q('.g-logo').getAttribute('src'), q('.g-logo').alt, Math.round(r('.g-logo').width), g('.g-logo').backgroundColor].join(' | '),
          h1: [q('h1').textContent, g('h1').fontFamily, g('h1').fontWeight, g('h1').fontSize, g('h1').color].join(' | '),
          eyebrow: [g('.g-eyebrow').display, g('.g-eyebrow').fontSize, g('.g-eyebrow').color, g('.g-eyebrow').textTransform, g('.g-eyebrow').letterSpacing, g('.g-rest').fontSize].join(' | '),
          tagline: [g('.tagline').fontSize, g('.tagline').color].join(' | '),
          logoLeft: r('.g-logo').left < r('h1').left && Math.abs((r('.g-logo').top + r('.g-logo').bottom) / 2 - (r('.g-lockup-text').top + r('.g-lockup-text').bottom) / 2) < 40,
          pill: [q('.btn-pill').textContent.trim(), g('.btn-pill').backgroundColor, g('.btn-pill').color, g('.btn-pill').borderTopLeftRadius, Math.round(r('.btn-pill').height)].join(' | '),
          taps: [...document.querySelectorAll('.back-link, .contact-row a, .btn-pill, .brand')].map(e => Math.round(e.getBoundingClientRect().height)),
          fav: q('link[rel=icon]').getAttribute('href'),
          style: document.documentElement.getAttribute('style')
        };
      });
      console.log('   medical:', JSON.stringify(med));
      assert(med.topbar.startsWith('rgb(27, 58, 75) | 3px solid rgb(224, 166, 58) | rgb(251, 246, 236) | "Source Serif 4"') && med.topbar.endsWith('| 600'), `${label} gemach top bar: navy, gold rule, cream serif wordmark`);
      assert(med.band === 'rgb(27, 58, 75) | 3px solid rgb(224, 166, 58)', `${label} band + 3px accentColor rule`);
      const logoW = label === 'm' ? 36 : 48;
      assert(med.logo.startsWith('IMG | g-logo g-logo-bare | ') && med.logo.includes('/logo-dark/') && med.logo.includes('| West Hempstead Medical Gemach | ' + logoW + ' | rgba(0, 0, 0, 0)'), `${label} logoDarkUrl shown bare at ${logoW}px`);
      assert(med.logoLeft, `${label} lockup: logo left of the text block`);
      const h1Size = label === 'm' ? '19px' : '24px';
      assert(med.h1 === `West Hempstead Medical Gemach | "Source Serif 4", Georgia, "Times New Roman", serif | 600 | ${h1Size} | rgb(251, 246, 236)`, `${label} name: full text for AT, serif 600 ${h1Size}, cream`);
      if (label === 'm') assert(med.eyebrow === 'block | 10px | rgb(224, 166, 58) | uppercase | 1.6px | 19px', `m two-line lockup: 10px gold uppercase eyebrow (.16em) + 19px rest`);
      else assert(med.eyebrow.startsWith('inline | 24px | rgb(251, 246, 236) | none'), `d desktop: single-line name`);
      assert(med.tagline === '14px | rgb(213, 222, 227)', `${label} tagline 14px --on-primary-muted`);
      assert(med.pill === 'Donate | rgb(224, 166, 58) | rgb(27, 58, 75) | 999px | 44', `${label} Donate pill: gold bg, navy text`);
      assert(med.taps.every(h => h >= 44), `${label} header tap targets >= 44px (${med.taps})`);
      assert(!med.style, `${label} network-default gemach sets no theme overrides`);
      await checkPair('h1', '.hero-gemach', 4.5, 'medical name on band');
      await checkPair('.hero-gemach .tagline', '.hero-gemach', 4.5, 'medical tagline on band');
      await checkPair('.back-link', '.hero-gemach', 4.5, 'back link on band');
      if (label === 'm') await checkPair('.g-eyebrow', '.hero-gemach', 4.5, 'eyebrow on band');
      await checkPair('.btn-pill', null, 4.5, 'Donate pill');
      await checkPair('.info-side a:not(.btn)', '.info-panel', 4.5, 'info link (--accent-text) on white');
      await checkPair('.cat-block h3', 'body', 4.5, 'category heading on bg');
      await csp();
      await page.evaluate(() => window.scrollTo(0, 0)); await shot('medical-top', false); await shot('medical');

      // request form
      await page.click('#row-' + (await page.$eval('.item-row.selectable', e => e.id.replace('row-', ''))) + ' .item-content');
      await page.click('#btn-open-modal');
      await page.click('#btn-submit');
      await page.waitForTimeout(200);
      assert(await page.$eval('.field-error:not([hidden])', e => getComputedStyle(e).color === 'rgb(166, 61, 42)'), `${label} form errors use --error`);
      await checkPair('.field-error:not([hidden])', '.modal', 4.5, 'field error on white');
      await checkPair('.modal-subtitle', '.modal', 4.5, 'modal subtitle');
      assert(await page.$eval('#f-name', e => getComputedStyle(e).borderColor === 'rgb(166, 61, 42)'), `${label} invalid input border --error`);
      await page.evaluate(() => document.querySelector('.modal').scrollTo(0, 0));
      await shot('form-errors', false);
      await page.keyboard.press('Escape');

      // ── Themed (shtick #7B2D5B / accent #E0B84F, light logo tile) ──
      await go('/g/wedding-shtick');
      const sh = await page.evaluate(() => {
        const q = s => document.querySelector(s), g = s => getComputedStyle(q(s));
        return { band: [g('.hero-gemach').backgroundColor, g('.hero-gemach').borderBottom].join(' | '), h1: g('h1').color,
          logo: [q('.g-logo').className, g('.g-logo').backgroundColor].join(' | '), eyebrow: !!q('.g-eyebrow'),
          pill: g('.btn-pill').backgroundColor, btn: g('#btn-open-modal').backgroundColor };
      });
      console.log('   shtick:', JSON.stringify(sh));
      assert(sh.band === 'rgb(123, 45, 91) | 3px solid rgb(224, 184, 79)' && sh.h1 === 'rgb(251, 246, 236)', `${label} per-gemach theme band + accent rule, cream name`);
      assert(sh.logo === 'g-logo | rgb(255, 255, 255)' && !sh.eyebrow, `${label} logoUrl -> light tile; no eyebrow when name doesn't start with community`);
      assert(sh.pill === 'rgb(224, 184, 79)', `${label} pill uses gemach accent (navy text contrast ok)`);
      await checkPair('h1', '.hero-gemach', 4.5, 'shtick name on band');
      await checkPair('.hero-gemach .tagline', '.hero-gemach', 4.5, 'shtick tagline on band');
      await checkPair('.btn-pill', null, 4.5, 'shtick Donate pill');
      await csp();
      await page.evaluate(() => window.scrollTo(0, 0)); await shot('shtick-top', false);

      // ── Light theme (gowns #F4D9E0, no logo) ──
      await go('/g/gowns');
      const gw = await page.evaluate(() => ({ logo: document.querySelector('.g-logo').className, txt: document.querySelector('.g-logo').textContent }));
      assert(gw.logo === 'g-logo g-logo-initials' && gw.txt === 'AC', `${label} no logo -> initials avatar on band`);
      await checkPair('h1', '.hero-gemach', 4.5, 'gowns name on light band');
      await checkPair('.hero-gemach .tagline', '.hero-gemach', 4.5, 'gowns tagline (derived muted) on light band');
      await checkPair('.g-logo-initials', null, 4.5, 'gowns initials');
      await csp();
      await page.evaluate(() => window.scrollTo(0, 0)); await shot('gowns-top', false);

      // helper rules
      const tv = await page.evaluate(() => [
        WHG.themeVars({ themeColor: '#7B2D5B', accentColor: '#E0B84F', name: 'x' })['--t-eyebrow'],
        WHG.themeVars({ themeColor: '#F4D9E0', accentColor: '#F7E3E8' })['--t-eyebrow'],
        WHG.themeVars({ themeColor: '#F4D9E0', accentColor: '#F7E3E8' })['--t-on-muted'],
        WHG.themeVars({ themeColor: '#1B3A4B', accentColor: '#3A5A6B' })['--pill-bg'],
        WHG.themeVars({ themeColor: '#1B3A4B' })['--t-accent'],
        WHG.themeVars({ themeColor: '#2E7D32' })['--t-accent'],
        WHG.contrast(WHG.themeVars({ themeColor: '#2E7D32' })['--t-on-muted'], '#2E7D32'),
        WHG.contrast(WHG.themeVars({ themeColor: '#E0A63A' })['--t-on-muted'], '#E0A63A'),
      ]);
      console.log('   helpers:', JSON.stringify(tv));
      assert(tv[0] === '#E0B84F', `${label} eyebrow uses accent when >= 3:1 on band`);
      assert(tv[1] === tv[2], `${label} eyebrow falls back to muted when accent is low-contrast`);
      assert(tv[3] === undefined, `${label} pill falls back to network gold when accent fails 4.5:1 with navy text`);
      assert(tv[4] === undefined && typeof tv[5] === 'string', `${label} default band rule = network gold; themed w/o accent derives one`);
      assert(tv[6] >= 4.5 && tv[7] >= 4.5, `${label} derived muted band text >= 4.5:1 (${tv[6].toFixed(2)}, ${tv[7].toFixed(2)})`);

      // ── v2 payload (no v3/v5 fields) still renders ──
      await go('/g/baby-gear');
      const bb = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent, band: getComputedStyle(document.querySelector('.hero-gemach')).borderBottom, init: !!document.querySelector('.g-logo-initials'), style: document.documentElement.getAttribute('style') }));
      assert(bb.h1 === 'Bais Chaim Baby Gear Gemach' && bb.band === '3px solid rgb(224, 166, 58)' && bb.init && !bb.style, `${label} v2 payload: network look, initials, gold rule`);
      await csp();

      // ── Content pages ──
      for (const p of ['/about', '/disclaimer', '/nope-404']) {
        await go(p);
        const cp = await page.evaluate(() => ({ top: getComputedStyle(document.querySelector('.topbar')).backgroundColor, hero: getComputedStyle(document.querySelector('.hero')).borderBottom, h1: getComputedStyle(document.querySelector('h1')).fontFamily }));
        assert(cp.top === 'rgb(27, 58, 75)' && cp.hero === '3px solid rgb(224, 166, 58)' && /Source Serif 4/.test(cp.h1), `${label} ${p}: navy header w/ gold rule, serif title`);
        if (p === '/about') {
          assert(await page.$eval('.content a:not(.btn)', e => getComputedStyle(e).color === 'rgb(138, 93, 20)'), `${label} links use --accent-text`);
          await checkPair('.content a:not(.btn)', '.card', 4.5, 'content link on card');
          await checkPair('.content .credit', '.card', 4.5, 'credit on card');
          await csp();
          await shot('about');
        }
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.kill(); }
  const real = errors.filter(e => !/status of 404 .*nope-404/.test(e));
  console.log('Console errors/warnings:', real.length ? '\n' + real.join('\n') : 'none');
  if (real.length) process.exitCode = 1;
  console.log(fails || real.length ? `${fails} FAILURES` : 'ALL PASSED');
})();
