// Availability for a date (gemach Settings → Availability = "For a date"): date bar at the top, projected badges,
// "only what's free", the date carrying into the request form (and back), Dates-style range, and no change for "Right now" gemachs.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8799';
const SHOTS = path.join(__dirname, '..', 'test-output');
const errors = [];

const todayNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = n => { const d = new Date(todayNY() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const short = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function setup(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '', headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 204 }));
  await ctx.route(API + '/**', async r => {
    const req = r.request(), u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/public/directory') return r.fulfill({ json: directory, headers: cors });
    const m = u.pathname.match(/^\/public\/gemach\/([^/]+)$/);
    if (m) { const p = gemachPayload(decodeURIComponent(m[1])); return p ? r.fulfill({ json: p, headers: cors }) : r.fulfill({ status: 404, json: { error: 'Not found' }, headers: cors }); }
    if (u.pathname === '/public/config') return r.fulfill({ json: { turnstileSiteKey: null }, headers: cors });
    if (u.pathname.startsWith('/public/contact/')) return r.fulfill({ json: { c: '=03e' }, headers: cors });
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

const base = directory.gemachs.find(g => g.slug === 'wh-medical');
const unit = (id, name, capacity, bookings) => ({ id, name, description: '', totalUnits: capacity, availableCount: capacity, hasPhoto: false, photoUrl: null, categoryId: 'catWC', capacity, bookings });
const items = () => [
  unit('recGown0001', 'Navy gown', 1, [{ from: plus(20), to: plus(23), qty: 1 }]),
  unit('recGown0002', 'Emerald gown', 1, []),
  unit('recGown0003', 'Plum gown', 1, [{ from: plus(-3), to: null, qty: 1 }]),
  unit('recGown0004', 'Broken gown', 0, []),
  unit('recWheel001', 'Wheelchair', 3, [{ from: plus(20), to: plus(30), qty: 1 }, { from: plus(21), to: plus(25), qty: 1 }]),
  { id: 'recChair001', name: 'Chairs', description: '', totalUnits: 10, availableCount: 10, hasPhoto: false, photoUrl: null, categoryId: 'catWC', tracking: 'quantity', bookings: [{ from: plus(20), to: plus(21), qty: 4 }] },
  { id: 'recAddon001', name: 'Sweatshirt', description: '', totalUnits: 0, availableCount: null, hasPhoto: false, photoUrl: null, categoryId: 'catWC', tracking: 'addon', price: 40 },
];
directory.gemachs.push(
  { ...base, id: 'recAVEV', slug: 'avail-event', name: 'Event Dresses', mode: 'Full', requestStyle: 'Event', eventLabel: 'Simcha date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false, availabilityMode: 'Date', items: items() },
  { ...base, id: 'recAVDT', slug: 'avail-dates', name: 'Date Tablecloths', mode: 'Full', requestStyle: 'Dates', availabilityMode: 'Date', items: items() },
  { ...base, id: 'recAVNO', slug: 'avail-now', name: 'Now Equipment', mode: 'Full', requestStyle: 'Dates', availabilityMode: 'Now', items: items().map(i => (i.tracking === 'addon' ? i : { ...i, bookings: undefined })) },
);

const rowText = (page, id) => page.$eval('#row-' + id, el => el.innerText.replace(/\s+/g, ' ')).catch(() => null);

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8799'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));

      // ── Event gemach ──
      await page.goto(BASE + '/g/avail-event', { waitUntil: 'networkidle' });
      assert(await page.isVisible('#avail-bar'), `${label} date bar shown at the top`);
      const barFirst = await page.evaluate(() => { const b = document.getElementById('avail-bar'), a = document.querySelector('.about-card, .info-card, #about-text'); return !a || !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); });
      assert(barFirst, `${label} the date bar comes before the About card`);
      assert(/Simcha date/.test(await page.textContent('label[for=av-date]')), `${label} uses the gemach's event label`);
      assert(!(await page.$('#av-until')), `${label} no end date for Event style`);
      assert(/Choose a date to see what will be free/.test(await page.textContent('#av-note')), `${label} neutral note before a date`);
      assert(await page.isHidden('#av-only-row'), `${label} 'only free' hidden until a date is chosen`);
      assert((await page.$$eval('#inv-wrap .badge-ok, #inv-wrap .badge-out', b => b.length)) === 0, `${label} no availability badges before a date (today's count would mislead)`);
      assert(/Choose a date above/.test(await page.textContent('.inv-title .section-sub')), `${label} heading line asks for a date`);

      const E = plus(22); // window: pickup E-1 .. return E+1 = plus(21)..plus(23)
      await page.fill('#av-date', E);
      await page.waitForTimeout(100);
      assert(await page.isChecked('#av-only'), `${label} 'only show what's free' starts ticked`);
      assert(!(await rowText(page, 'recGown0001')) && !!(await rowText(page, 'recGown0002')), `${label} so taken items are hidden by default`);
      await page.uncheck('#av-only');
      await page.waitForTimeout(100);
      const navy = await rowText(page, 'recGown0001');
      assert(new RegExp('Taken for ' + short(E)).test(navy) && new RegExp('back ' + short(plus(23))).test(navy), `${label} booked gown: Taken for ${short(E)}, back ${short(plus(23))}: ` + navy);
      assert(new RegExp('Free on ' + short(E)).test(await rowText(page, 'recGown0002')), `${label} free gown: Free on ${short(E)}`);
      const plum = await rowText(page, 'recGown0003');
      assert(/Taken for/.test(plum) && !/back /.test(plum), `${label} open-ended loan: taken, no back date: ` + plum);
      assert(/Not available/.test(await rowText(page, 'recGown0004')), `${label} item with no bookable unit: Not available`);
      assert(new RegExp('1 of 3 free on ' + short(E)).test(await rowText(page, 'recWheel001')), `${label} 3 units, 2 booked in the window: 1 of 3 free`);
      assert(new RegExp('6 of 10 free on ' + short(E)).test(await rowText(page, 'recChair001')), `${label} quantity item: 6 of 10 free`);
      assert(/Add-on/.test(await rowText(page, 'recAddon001')) && !/free on|Taken/i.test(await rowText(page, 'recAddon001')), `${label} add-on unchanged`);
      const note = await page.textContent('#av-note');
      assert(/3 of 6 items are free for your simcha date on/.test(note) && new RegExp('pick up ' + short(plus(21)) + ', return ' + short(plus(23))).test(note), `${label} summary counts items and shows the window: ` + note);
      assert(new RegExp('Showing what’s free on ' + short(E)).test(await page.textContent('.inv-title .section-sub')) && await page.isVisible('#av-change'), `${label} heading line names the date and offers Change date`);
      await page.screenshot({ path: path.join(SHOTS, `${label}-avail-event.png`) });

      // a booking outside the window doesn't count
      await page.fill('#av-date', plus(60));
      await page.waitForTimeout(100);
      assert(/Free on/.test(await rowText(page, 'recGown0001')), `${label} later date: the booked gown is free again`);
      assert(/Taken for/.test(await rowText(page, 'recGown0003')), `${label} later date: an open-ended loan still blocks`);
      await page.fill('#av-date', E);

      // only what's free (ticked again)
      await page.check('#av-only');
      await page.waitForTimeout(100);
      assert(!(await rowText(page, 'recGown0001')) && !(await rowText(page, 'recGown0003')) && !(await rowText(page, 'recGown0004')), `${label} 'only free' hides taken and unavailable items`);
      assert(!!(await rowText(page, 'recGown0002')) && !!(await rowText(page, 'recWheel001')) && !!(await rowText(page, 'recChair001')) && !!(await rowText(page, 'recAddon001')), `${label} 'only free' keeps free items and add-ons`);
      await page.uncheck('#av-only');

      // past date refused with a message, nothing shown
      await page.evaluate(d => { const i = document.getElementById('av-date'); i.value = d; i.dispatchEvent(new Event('change', { bubbles: true })); }, plus(-2));
      assert(/has passed/.test(await page.textContent('#av-note')) && (await page.$$eval('#inv-wrap .badge-ok, #inv-wrap .badge-out', b => b.length)) === 0, `${label} a past date is refused`);
      await page.fill('#av-date', E);

      // the date carries into the request form, and the form can change it
      await page.click('#row-recGown0001 input[type=checkbox]');
      await page.click('#row-recGown0002 input[type=checkbox]');
      await page.click('#btn-open-modal');
      await page.waitForSelector('#f-event', { state: 'visible' });
      assert(await page.inputValue('#f-event') === E, `${label} form's event date starts as the checked date`);
      const taken = await page.$$eval('[data-av]:not([hidden])', els => els.map(e => e.closest('label').innerText.replace(/\s+/g, ' ')));
      assert(taken.length === 3 && taken.some(t => /Navy gown.*Taken for/.test(t)) && !taken.some(t => /Emerald/.test(t)), `${label} the form's item list marks what's taken for that date: ` + JSON.stringify(taken));
      await page.fill('#f-event', plus(60));
      await page.waitForTimeout(150);
      assert(await page.inputValue('#av-date') === plus(60), `${label} changing the date in the form updates the page's date`);
      assert(!(await page.$$eval('[data-av]:not([hidden])', els => els.map(e => e.closest('label').innerText)).then(t => t.some(x => /Navy gown/.test(x)))), `${label} form's notes follow the new date`);
      await page.keyboard.press('Escape');

      // remembered for the tab
      await page.reload({ waitUntil: 'networkidle' });
      assert(await page.inputValue('#av-date') === plus(60), `${label} the date is remembered after a reload`);
      await ctx.close();

      // ── Dates gemach: from / until ──
      const ctx2 = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx2);
      const p2 = await ctx2.newPage();
      p2.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await p2.goto(BASE + '/g/avail-dates', { waitUntil: 'networkidle' });
      assert(/Needed from/.test(await p2.textContent('label[for=av-date]')) && await p2.isVisible('#av-until'), `${label} Dates style: needed from + until`);
      await p2.fill('#av-date', plus(19));
      await p2.uncheck('#av-only');
      await p2.waitForTimeout(80);
      assert(new RegExp('Free on ' + short(plus(19))).test(await rowText(p2, 'recGown0001')), `${label} single day before the booking: free`);
      await p2.fill('#av-until', plus(22));
      await p2.waitForTimeout(80);
      const r2 = await rowText(p2, 'recGown0001');
      assert(new RegExp('Taken for ' + short(plus(19)) + ' – ' + short(plus(22))).test(r2), `${label} a range that reaches the booking: taken, range shown: ` + r2);
      assert(new RegExp('Free ' + short(plus(19)) + ' – ' + short(plus(22))).test(await rowText(p2, 'recGown0002')), `${label} range wording without "on"`);
      await p2.screenshot({ path: path.join(SHOTS, `${label}-avail-dates.png`) });
      await p2.click('#row-recGown0002 input[type=checkbox]');
      await p2.click('#btn-open-modal');
      await p2.waitForSelector('#f-from', { state: 'visible' });
      assert(await p2.inputValue('#f-from') === plus(19) && await p2.inputValue('#f-until') === plus(22), `${label} form starts with the checked dates`);
      await ctx2.close();

      // ── "Right now" gemach: nothing changes ──
      const ctx3 = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx3);
      const p3 = await ctx3.newPage();
      p3.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await p3.goto(BASE + '/g/avail-now', { waitUntil: 'networkidle' });
      assert(!(await p3.$('#avail-bar')), `${label} Right now gemach has no date bar`);
      assert(/Availability updates in real time/.test(await p3.textContent('.inv-title .section-sub')) && /available/.test(await rowText(p3, 'recGown0002')), `${label} Right now gemach still shows today's availability`);
      await ctx3.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
