// Home page "Try:" chips: 4 random search terms that each find something; new picks per load;
// never from Coming-soon gemachs or book titles (items with a byline); placeholder row hidden until picked.
const { chromium } = require('playwright');
const path = require('path'), { spawn } = require('child_process');
const { directory } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8805';

// Mock directory plus: a Coming-soon gemach (its items must never be suggested) and a library
// with book titles (byline) whose filter values (Yom Tov) may be suggested.
const dir = JSON.parse(JSON.stringify(directory));
dir.gemachs.push({
  id: 'recSOON0000000001', slug: 'soon', name: 'Soon Gemach', category: 'Other', comingSoon: true,
  items: [{ id: 'recSOONITEM00001', name: 'Zeppelin Lamp', categoryId: null, availableCount: 1, totalCount: 1 }]
});
dir.gemachs.push({
  id: 'recLIB0000000001', slug: 'library', name: 'Library', category: 'Other', mode: 'Directory',
  items: [
    { id: 'recBOOK000000001', name: 'The Quokka Chronicles', byline: 'by A. Author', categoryId: null, attributes: { 'Yom Tov': ['Chanukah'], Ages: ['3–6'] } },
    { id: 'recBOOK000000002', name: 'Wombat Tales', byline: 'by B. Author', categoryId: null, attributes: { 'Yom Tov': ['Purim'] } }
  ]
});

let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8805'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let delay = 0;
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route(API + '/**', async r => {
      const u = new URL(r.request().url());
      const cors = { 'access-control-allow-origin': '*' };
      if (u.pathname === '/public/directory') {
        if (delay) await new Promise(res => setTimeout(res, delay));
        return r.fulfill({ json: dir, headers: cors });
      }
      r.fulfill({ status: 204, headers: cors });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));

    // Placeholder row is invisible (keeps its height) until the directory arrives.
    delay = 1500;
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const early = await page.$eval('#search-hint', e => ({ cls: e.className, vis: getComputedStyle(e).visibility, h: e.offsetHeight }));
    assert(/picking/.test(early.cls) && early.vis === 'hidden' && early.h > 0, 'placeholder chips hidden but keep their row before data: ' + JSON.stringify(early));
    await page.waitForFunction(() => !document.getElementById('search-hint').classList.contains('picking'));
    delay = 0;

    const sets = new Set();
    const all = new Set();
    for (let i = 0; i < 12; i++) {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
      const h = await page.$eval('#search-hint', e => ({
        text: e.firstChild && e.firstChild.textContent.trim(),
        vis: getComputedStyle(e).visibility,
        qs: [...e.querySelectorAll('button[data-q]')].map(b => ({ q: b.getAttribute('data-q'), label: b.textContent }))
      }));
      if (i === 0) {
        assert(h.text === 'Try:' && h.vis === 'visible', 'row says "Try:" and is visible: ' + JSON.stringify([h.text, h.vis]));
      }
      assert(h.qs.length === 4, `load ${i + 1}: 4 chips (${h.qs.map(x => x.label).join(', ')})`);
      assert(new Set(h.qs.map(x => x.q.toLowerCase())).size === h.qs.length, `load ${i + 1}: no duplicate chips`);
      assert(h.qs.every(x => /^[A-Z0-9]/.test(x.label) && x.label.slice(1) === x.q.slice(1)), `load ${i + 1}: labels are sentence case of the term`);
      sets.add(h.qs.map(x => x.q).sort().join('|'));
      h.qs.forEach(x => all.add(x.q));
    }
    const terms = [...all];
    console.log('Terms seen:', terms.join(', '));
    assert(sets.size >= 3, 'picks change between loads: ' + sets.size + ' different sets in 12 loads');
    assert(!terms.some(t => /zeppelin|lamp/i.test(t)), 'nothing from Coming-soon gemachs');
    assert(!terms.some(t => /quokka|wombat|chronicles|tales/i.test(t)), 'no book titles (items with a byline)');
    assert(!terms.some(t => /[\d\/]/.test(t)), 'no terms with digits or slashes (sizes, set counts)');
    assert(!terms.some(t => /3–6/.test(t)), 'age/size filter values are not suggested');
    assert(!terms.includes('wheel chair'), '"wheel chair" keyword merged into "wheelchair"');

    // Every term ever shown finds something.
    for (const q of terms) {
      await page.fill('#q', q);
      await page.waitForTimeout(350);
      const count = await page.$eval('#results-count', e => e.innerText);
      assert(!/No matches/i.test(count) && count.trim(), `"${q}" finds something (${count.trim()})`);
    }
    await page.fill('#q', '');

    // Tapping a chip searches for it and hides the row while results show.
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const first = await page.$eval('#search-hint button[data-q]', b => b.getAttribute('data-q'));
    await page.click('#search-hint button[data-q]');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ q: document.getElementById('q').value, hidden: document.getElementById('search-hint').hidden }));
    assert(after.q === first && after.hidden, 'tapping a chip fills the search box and hides the row');
  } finally { await browser.close(); srv.kill(); }
  assert(!errors.length, 'no page errors ' + errors.join(' | '));
  console.log(fails ? `${fails} FAILURES` : 'ALL PASSED');
})();
