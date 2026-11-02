// Vacations (admin Settings → Vacations): the "on vacation" note above the contact buttons (no dates), the note under the
// request form's dates (with dates), no pickup / return on a vacation day (right away and on Send), Event style's worked-out
// days, the date bar, and the manage page's note.
const { chromium } = require('playwright');
const path = require('path'), { spawn } = require('child_process');
const { directory, gemachPayload } = require('./mock.js');
const API = 'https://wh-gemach.barry253-0f5.workers.dev';
const BASE = 'http://localhost:8795';
const SHOTS = path.join(__dirname, '..', 'test-output');
const errors = [];

const todayNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = n => { const d = new Date(todayNY() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const BANNER = 'This gemach is currently on vacation and will have delayed responses.';
const TOK = 'recREQVACATION001.AAAAAAAAAAAAAAAAAAAAAA';
const posts = [];

const base = directory.gemachs.find(g => g.slug === 'wh-medical');
const itemId = base.items[0].id;
directory.gemachs.push(
  { ...base, id: 'recVAC1', slug: 'vac-now', name: 'Away Now Gemach', requestStyle: 'Dates', availabilityMode: 'Now',
    vacations: [{ start: plus(-9), end: plus(-4) }, { start: plus(-1), end: plus(2) }, { start: plus(10), end: plus(14) }] },
  { ...base, id: 'recVAC2', slug: 'vac-later', name: 'Away Later Gemach', requestStyle: 'Event', eventLabel: 'Simcha date', pickupDaysBefore: 1, returnDaysAfter: 1, shabbosAdjust: false,
    availabilityMode: 'Date', vacations: [{ start: plus(10), end: plus(14) }] },
  { ...base, id: 'recVAC3', slug: 'vac-appt', name: 'Away Appointment Gemach', requestStyle: 'Appointment', vacations: [{ start: plus(10), end: plus(10) }] },
);

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
    if (u.pathname === '/submit-request') { posts.push(JSON.parse(req.postData())); return r.fulfill({ json: { success: true, requestId: 'R-1' }, headers: cors }); }
    if (u.pathname === '/public/manage/' + TOK) return r.fulfill({ headers: cors, json: {
      gemach: { name: 'Away Now Gemach', slug: 'vac-now', phone: '(718) 986-7345', email: 'a@example.com', primaryContact: 'Call', themeColor: '#1B3A4B', requestStyle: 'Dates', eventLabel: 'Event date', onVacation: true },
      request: { requestId: 'R-77', firstName: 'Dina', type: 'Loan', status: 'waiting', neededFrom: plus(20), neededUntil: plus(25), openEnded: false, items: [{ name: 'Wheelchair' }] },
      loans: [], can: { cancel: true, readyToReturn: false }, partlyOut: false } });
    r.fulfill({ status: 404, json: { error: 'nope' }, headers: cors });
  });
}
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }
const setDate = (page, sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
const text = (page, sel) => page.$eval(sel, e => e.textContent.trim()).catch(() => null);
const shown = (page, sel) => page.isVisible(sel).catch(() => false);

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), path.join(__dirname, '../../dist'), '8795'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const [label, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await setup(ctx);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));

      // ── On vacation now (Dates style) ──
      await page.goto(BASE + '/g/vac-now', { waitUntil: 'networkidle' });
      await page.waitForSelector('#g-head .contact-row a');
      assert(await text(page, '#g-head .vac-banner') === BANNER, `${label} banner shown while on vacation`);
      assert(await page.evaluate(() => { const b = document.querySelector('#g-head .vac-banner'), c = document.querySelector('#g-head .contact-row'); return !!(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }), `${label} banner sits above the contact buttons`);
      await page.screenshot({ path: path.join(SHOTS, `vacation-banner-${label}.png`) });

      await page.click(`#row-${itemId} input[type=checkbox]`);
      await page.click('#btn-open-modal');
      await page.waitForSelector('#f-from', { state: 'visible' });
      const note = await text(page, '#vac-note');
      assert(await shown(page, '#vac-note') && /^The gemach is away .+ and .+, so pickups and returns can’t be scheduled then\.$/.test(note || ''), `${label} form note lists the vacations: ${note}`);
      assert(!/–.*–.*–/.test(note || ''), `${label} the one that already ended isn't listed`);

      await setDate(page, '#f-from', plus(11));
      let err = await text(page, '#err-f-from');
      assert(/^The gemach is on vacation .+ – .+, so a pickup on .+ can’t be scheduled then\. Please choose a different date\.$/.test(err || ''), `${label} pickup in a vacation flagged right away: ${err}`);
      await page.evaluate(() => document.getElementById('dates-group').scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: path.join(SHOTS, `vacation-form-${label}.png`) });
      await setDate(page, '#f-from', plus(16));
      assert(!(await shown(page, '#err-f-from')), `${label} a day after the vacation clears it`);
      await setDate(page, '#f-from', plus(5));
      await setDate(page, '#f-until', plus(12));
      assert(/a return on/.test(await text(page, '#err-f-until') || ''), `${label} return in a vacation flagged`);

      await page.fill('#f-name', 'Shira Test');
      await page.fill('#f-phone', '5165550123');
      await page.fill('#f-email', 'shira@example.com');
      const before = posts.length;
      await page.click('#btn-submit');
      await page.waitForTimeout(300);
      assert(posts.length === before, `${label} nothing sent while a date is in a vacation`);
      const focusInfo = await page.evaluate(() => ({ a: document.activeElement && document.activeElement.id, errs: [...document.querySelectorAll('.field-error')].map(e => e.id + ':' + e.textContent) }));
      assert(focusInfo.a === 'f-until', `${label} focus goes to the flagged date ` + JSON.stringify(focusInfo));
      await setDate(page, '#f-until', plus(20));
      assert(!(await shown(page, '#err-f-until')), `${label} fixed return date clears the message`);

      // ── Upcoming vacation only (Event style, date bar) ──
      await page.goto(BASE + '/g/vac-later', { waitUntil: 'networkidle' });
      await page.waitForSelector('#g-head .contact-row a');
      assert(!(await shown(page, '.vac-banner')), `${label} no banner before the vacation starts`);
      await setDate(page, '#av-date', plus(15));
      assert(/a pickup on .* can’t be scheduled then/.test(await text(page, '#av-note .vac-warn') || ''), `${label} date bar warns when the pickup day is in a vacation`);
      await setDate(page, '#av-date', plus(25));
      assert(!(await shown(page, '#av-note .vac-warn')), `${label} date bar fine outside it`);
      await page.click('.item-row input[type=checkbox], [id^=row-] input[type=checkbox]');
      await page.click('#btn-open-modal');
      await page.waitForSelector('#f-event', { state: 'visible' });
      assert(/^The gemach is away .+, so pickups and returns can’t be scheduled then\.$/.test(await text(page, '#vac-note') || ''), `${label} event form shows the note`);
      await setDate(page, '#f-event', plus(15)); // pickup plus(14) is the last vacation day
      assert(/a pickup on/.test(await text(page, '#err-f-event') || ''), `${label} event date whose pickup falls in the vacation is flagged`);
      await setDate(page, '#f-event', plus(9)); // return plus(10) is the first day
      assert(/a return on/.test(await text(page, '#err-f-event') || ''), `${label} …and one whose return falls in it`);
      await setDate(page, '#f-event', plus(20));
      assert(!(await shown(page, '#err-f-event')), `${label} event date outside it is fine`);

      // ── Appointment style: only the note ──
      await page.goto(BASE + '/g/vac-appt', { waitUntil: 'networkidle' });
      await page.click('#btn-open-modal');
      await page.waitForSelector('#f-times', { state: 'visible' });
      assert(/^The gemach is away \w{3}, \w{3} \d+\. Please suggest times outside those dates\.$/.test(await text(page, '#vac-note') || ''), `${label} appointment form asks for other times`);

      // ── No vacations: nothing shown ──
      await page.goto(BASE + '/g/wh-medical', { waitUntil: 'networkidle' });
      await page.click(`#row-${itemId} input[type=checkbox]`);
      await page.click('#btn-open-modal');
      await page.waitForSelector('#f-from', { state: 'visible' });
      assert(!(await shown(page, '#vac-note')) && !(await shown(page, '.vac-banner')), `${label} gemach without vacations unchanged`);

      // ── Manage page ──
      await page.goto(BASE + '/r/' + TOK, { waitUntil: 'networkidle' });
      await page.waitForSelector('.m-help');
      assert(await text(page, '.m-help .vac-banner') === BANNER, `${label} manage page says so above the contact buttons`);
      await ctx.close();
    }
    assert(!errors.length, 'no errors ' + errors.join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})();
