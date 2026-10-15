// Home page directory load: a dropped or stalled first attempt is retried (up to 3 attempts) before the
// "We couldn't load the directory" screen; a failure is only reported once all attempts are used up;
// a 4xx isn't retried. (Oct 15, 2026: one Windows Firefox visitor hit a stalled request and saw the error.)
const { chromium } = require('playwright');
const path = require('path'), { spawn } = require('child_process');
const { directory } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8807';
const wait = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8807'], { stdio: 'inherit' });
  await wait(500);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    let plan = [];        // what each directory request does, in order: 'ok' | 'drop' | 'hang' | '500' | '404'
    let dirCalls = 0;
    const events = [];
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route(API + '/**', async r => {
      const req = r.request(), u = new URL(req.url());
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (u.pathname === '/public/event') { events.push(JSON.parse(req.postData())); return r.fulfill({ status: 204, headers: cors }); }
      if (u.pathname === '/public/directory') {
        const step = plan[Math.min(dirCalls, plan.length - 1)] || 'ok';
        dirCalls++;
        if (step === 'drop') return r.abort('connectionreset');
        if (step === 'hang') { await wait(20000); return r.abort().catch(() => {}); } // the page gives up on it first
        if (step === '500') return r.fulfill({ status: 500, json: { error: 'x' }, headers: cors });
        if (step === '404') return r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
        return r.fulfill({ json: directory, headers: cors });
      }
      r.fulfill({ status: 204, headers: cors });
    });

    async function fresh() {
      const page = await ctx.newPage();
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch (e) {} });
      await page.close();
      events.length = 0; dirCalls = 0;
      return ctx.newPage();
    }
    const shown = page => page.evaluate(() => ({
      cards: document.querySelectorAll('#gemach-list a[href^="/g/"]').length,
      err: /couldn.t load the directory/i.test(document.body.innerText)
    }));

    // 1. Two dropped connections, then it works: the visitor just sees the directory.
    plan = ['drop', 'drop', 'ok'];
    let page = await fresh();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#gemach-list a[href^="/g/"]').length > 0, null, { timeout: 15000 });
    let s = await shown(page);
    assert(s.cards > 0 && !s.err && dirCalls === 3, 'two dropped connections then ok: directory shows after ' + dirCalls + ' attempts');
    await wait(500);
    assert(!events.some(e => e.kind === 'load-fail'), 'a recovered load is not reported as a failure');
    await page.close();

    // 2. A stalled first attempt is abandoned after ~8 s and retried (not 20 s + 20 s).
    plan = ['hang', 'ok'];
    page = await fresh();
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#gemach-list a[href^="/g/"]').length > 0, null, { timeout: 20000 });
    const took = Date.now() - t0;
    assert(dirCalls === 2 && took > 7000 && took < 14000, 'stalled attempt retried after about 8 s (took ' + took + ' ms, ' + dirCalls + ' attempts)');
    await page.close();

    // 3. A 500 then ok.
    plan = ['500', 'ok'];
    page = await fresh();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#gemach-list a[href^="/g/"]').length > 0, null, { timeout: 15000 });
    assert(dirCalls === 2, 'a 500 is retried');
    await page.close();

    // 4. Every attempt fails: error screen after exactly 3 attempts, one load-fail event.
    plan = ['500'];
    page = await fresh();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /couldn.t load the directory/i.test(document.body.innerText), null, { timeout: 15000 });
    await wait(800);
    assert(dirCalls === 3, 'gives up after 3 attempts (' + dirCalls + ')');
    assert(events.filter(e => e.kind === 'load-fail' && e.what === 'directory').length === 1, 'one load-fail event after all attempts failed: ' + JSON.stringify(events));
    assert(await page.$('#retry'), '"Try again" button shown');
    await page.close();

    // 5. A 4xx is not retried.
    plan = ['404'];
    page = await fresh();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /couldn.t load the directory/i.test(document.body.innerText), null, { timeout: 10000 });
    assert(dirCalls === 1, 'a 404 is not retried (' + dirCalls + ')');
    await page.close();
  } finally {
    await browser.close();
    srv.kill();
  }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ASSERT FAIL: test crashed:', e && e.stack || e); process.exit(1); });
