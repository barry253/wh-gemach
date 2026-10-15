// Live check (Oct 15, 2026): after a deploy (and once a day), open the REAL site like a borrower would and
// make sure nothing is broken: pages load without script errors, every script / stylesheet loads, and the
// request form opens on real gemachs. It never sends a request. Run by .github/workflows/live-check.yml.
//   node live/live-check.cjs            (needs internet; CHROMIUM_PATH optional)
// Env: SITE (default https://whgemachs.org), API (default the wh-gemach worker), EXPECT_GEMACH_JS (the
// ?v= the deployed gemach.html should point to; the workflow waits for it before calling this).
const { chromium } = require('playwright');
const SITE = (process.env.SITE || 'https://whgemachs.org').replace(/\/$/, '');
const API = (process.env.API || 'https://wh-gemach.barry253-0f5.workers.dev').replace(/\/$/, '');
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  // Worker health first: a broken API breaks every page.
  const health = await fetch(API + '/health').then(async r => ({ status: r.status, body: await r.text() })).catch(e => ({ status: 0, body: String(e) }));
  assert(health.status === 200, `worker /health is 200 (got ${health.status} ${health.body.slice(0, 120)})`);

  // Which gemachs to try the request form on: the Live ones that take online requests, from the public directory.
  const dir = await fetch(API + '/public/directory').then(r => r.json()).catch(() => null);
  const live = (dir && dir.gemachs || []).filter(g => !g.comingSoon && (g.mode || 'Full') === 'Full' && !g.requestFormUrl && (g.items || []).length);
  assert(live.length > 0, `directory lists gemachs taking requests (${live.map(g => g.slug).join(', ')})`);
  // A few, not all: medical (units), a counted one, and an event / appointment one when there is one.
  const pick = [];
  for (const test of [g => g.slug === 'wh-medical', g => (g.items || []).some(i => i.tracking === 'quantity'), g => g.requestStyle === 'Event', g => g.requestStyle === 'Appointment']) {
    const g = live.find(x => test(x) && !pick.includes(x));
    if (g) pick.push(g);
  }
  if (!pick.length && live[0]) pick.push(live[0]);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route('https://static.cloudflareinsights.com/**', r => r.abort()); // don't count as a visitor
    const page = await ctx.newPage();
    const errors = [], badAssets = [];
    page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`));
    page.on('response', r => { const u = r.url(); if (u.startsWith(SITE + '/assets/') && r.status() >= 400) badAssets.push(`${r.status()} ${u}`); });

    // Home page
    await page.goto(SITE + '/', { waitUntil: 'networkidle', timeout: 45000 });
    assert(await page.locator('a[href*="/g/"]').count() > 0, 'home page lists gemachs');

    // The request form on each picked gemach
    for (const g of pick) {
      await page.goto(`${SITE}/g/${g.slug}`, { waitUntil: 'networkidle', timeout: 45000 });
      const gjs = await page.$$eval('script[src*="/assets/gemach.js"]', s => s.map(x => x.getAttribute('src')));
      if (process.env.EXPECT_GEMACH_JS) assert(gjs.some(s => s.includes('?v=' + process.env.EXPECT_GEMACH_JS)), `${g.slug}: page uses the new gemach.js (${gjs.join(', ')})`);
      const box = page.locator('input[name="items"], .item-row input[type=checkbox], .item-card input[type=checkbox], label.item-check input[type=checkbox]').first();
      if (await box.count()) { await box.check({ force: true }).catch(() => {}); }
      const btn = page.locator('#btn-open-modal');
      assert(await btn.count() === 1, `${g.slug}: request button is there`);
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 10000 }).catch(e => errors.push(`${g.slug}: click failed: ${e.message.split('\n')[0]}`));
      const opened = await page.locator('#form-view').isVisible({ timeout: 5000 }).catch(() => false)
        || await page.waitForSelector('#form-view', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
      assert(opened, `${g.slug}: "Request" opens the request form`);
      if (opened) {
        assert(await page.$eval('#f-email', e => e.required).catch(() => false), `${g.slug}: form asks for an email`);
        await page.keyboard.press('Escape');
      }
    }

    // Borrower manage page shell (no token: just has to load without errors)
    await page.goto(SITE + '/manage', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});

    assert(!badAssets.length, 'every script / stylesheet loads ' + badAssets.join(' | '));
    assert(!errors.length, 'no script errors ' + errors.join(' | '));
    await ctx.close();
  } finally { await browser.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})().catch(e => { console.log('ASSERT FAIL: live check crashed:', e.message); process.exit(1); });
