// Accessibility fixes (Oct 18, 2026): danger buttons keep white text on hover (was navy on dark red, 1.5:1),
// and the compact search bar's home link has a name on phones (its text is hidden under 480px).
const { chromium } = require('playwright');
const path = require('path'), { spawn } = require('child_process');
const { directory } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8813';
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }
(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8813'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com|cloudflareinsights|challenges\.cloudflare/, r => r.fulfill({ body: '' }));
    await ctx.route(API + '/**', r => {
      const u = new URL(r.request().url()), h = { 'access-control-allow-origin': '*' };
      if (u.pathname === '/public/directory') return r.fulfill({ json: directory, headers: h });
      return r.fulfill({ status: 404, json: {}, headers: h });
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const mb = await page.$eval('.mini-brand', a => ({ label: a.getAttribute('aria-label'), textShown: getComputedStyle(a.querySelector('span')).display !== 'none' }));
    assert(!mb.textShown, 'phone: the compact bar hides the brand text (so the link needs a label)');
    assert(/West Hempstead Gemachs/.test(mb.label || ''), 'compact bar home link has an accessible name');

    await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn btn-danger'; b.id = 'dz'; b.textContent = 'Yes, cancel'; document.querySelector('main').prepend(b); });
    await page.hover('#dz'); await page.waitForTimeout(250);
    const c = await page.$eval('#dz', b => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
    assert(c[0] === 'rgb(255, 255, 255)', `danger button text stays white on hover (${c.join(' on ')})`);
  } finally { await browser.close(); srv.kill(); }
  if (fails) process.exit(1);
})();
