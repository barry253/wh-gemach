import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname); // screenshots land in tests/test-output
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

function mkState(role) {
  return {
    role,
    gemachs: [
      { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", active: true },
      { id: "recH", slug: "hidden-one", name: "Hidden <b>Gemach</b>", active: false },
    ],
    G: { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", mode: "Directory", phone: "(516) 555-1234", email: "wh@example.com",
      primaryContact: "Call", themeColor: "#1B3A4B", requestStyle: "Dates", pickupDaysBefore: 1, returnDaysAfter: 1,
      templates: { confirm: "c", decline: "d", pickup: "p", appointment: "a" }, rawTemplates: {}, placeholders: [], canEdit: true },
    netGemachs: [
      { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", active: true, mode: "Full", category: "Medical", displayOrder: 10, itemCount: 12, adminCount: 2, email: "wh@example.com" },
      { id: "recH", slug: "hidden-one", name: "Hidden <b>Gemach</b>", active: false, mode: "Full", category: "Baby", displayOrder: 90, itemCount: 0, adminCount: 0, email: null },
    ],
    admins: [
      { id: "recADM1", name: "Barry", email: "barry@example.com", role: "Network Admin", active: true, gemachs: [] },
      { id: "recADM2", name: "Rivka O'Neil", email: "rivka@example.com", role: "Manager", active: true, gemachs: [{ id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach" }] },
    ],
    cats: [
      { id: "recCAT1", name: "Wheelchairs", icon: "🦽", keywords: ["wheel chair"], displayOrder: 10, active: true, itemTypeCount: 3 },
      { id: "recCAT2", name: "Walkers", icon: "🚶", keywords: [], displayOrder: 20, active: true, itemTypeCount: 1 },
      { id: "recCAT3", name: "Old", icon: "", keywords: [], displayOrder: null, active: false, itemTypeCount: 0 },
    ],
  };
}

async function setup(role, { viewport = { width: 390, height: 844 } } = {}) {
  const st = mkState(role);
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  const errors = [], reqs = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); });
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const M = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    reqs.push({ method: M, path: p, h: req.headers(), body });
    const J = (d, s = 200) => r.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "barry@example.com", name: "Barry", role: st.role, gemachs: role === "Network Admin" ? st.gemachs : st.gemachs.slice(0, 1) });
    if (p === "/admin/gemach" && M === "GET") return J(st.G);
    if (p === "/admin/gemach" && M === "PATCH") { st.G = { ...st.G, ...body }; return J(st.G); }
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/inventory") return J([{ id: "recITEM1", itemId: "WC-001", itemTypeId: "recT1", itemTypeName: "Wheelchair", condition: "Good", status: "Available", active: true, notes: null }]);
    if (p === "/admin/catalog/item-types" && M === "GET") return J([{ id: "recT1", name: "Wheelchair", description: "", displayOrder: 1, active: true, photoUrl: null, r2PhotoUrl: null, itemCount: 1, categoryId: "recCAT1" }]);
    if (p === "/admin/catalog/items" && M === "GET") return J({ items: [], itemTypes: [{ id: "recT1", name: "Wheelchair" }] });
    if (p === "/admin/catalog/categories") return J(st.cats.filter(c => c.active));
    if (p === "/admin/inventory/recITEM1/assign") return J({ success: true });
    if (p === "/admin/catalog/items/recITEM1" && M === "PATCH") return J({ id: "recITEM1", fields: body });
    if (p === "/admin/catalog/item-types/recT1" && M === "PATCH") return J({ id: "recT1", fields: {} });
    if (p.startsWith("/admin/network/") && role !== "Network Admin") return J({ error: "Network admins only." }, 403);
    if (p === "/admin/network/overview" && M === "GET") return st.oldApi ? J({ error: "Not found" }, 404) : J({ gemachs: st.netGemachs, admins: st.admins, categories: st.cats });
    if (p === "/admin/network/gemachs" && M === "GET") return J(st.netGemachs);
    if (p === "/admin/network/gemachs" && M === "POST") {
      const g = { id: "recNEW", slug: body.slug || "kallah-gowns", name: body.name, active: false, mode: body.mode, category: body.category, displayOrder: 100, itemCount: 0, adminCount: 0, email: body.email || null };
      st.netGemachs.push(g); st.gemachs.push({ id: g.id, slug: g.slug, name: g.name, active: false }); return J(g, 201);
    }
    let m;
    if ((m = p.match(/^\/admin\/network\/gemachs\/(\w+)$/)) && M === "PATCH") { const g = st.netGemachs.find(x => x.id === m[1]); Object.assign(g, body); return J(g); }
    if (p === "/admin/network/admins" && M === "GET") return J(st.admins);
    if (p === "/admin/network/admins" && M === "POST") {
      const a = { id: "recADM9", name: body.name, email: body.email.toLowerCase(), role: body.role, active: true,
        gemachs: body.gemachIds.map(id => st.netGemachs.find(g => g.id === id)).map(g => ({ id: g.id, slug: g.slug, name: g.name })), invited: !!body.sendInvite };
      st.admins.push(a); return J(a, 201);
    }
    if ((m = p.match(/^\/admin\/network\/admins\/(\w+)$/)) && M === "PATCH") { const a = st.admins.find(x => x.id === m[1]); Object.assign(a, body); return J(a); }
    if (p === "/admin/network/categories" && M === "GET") return J(st.cats);
    if (p === "/admin/network/categories" && M === "POST") { const c = { id: "recCAT9", ...body, keywords: body.keywords.split(",").map(s => s.trim()).filter(Boolean), itemTypeCount: 0 }; st.cats.push(c); return J(c, 201); }
    return J([]);
  });
  await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); if (!localStorage.getItem("gemach_slug")) localStorage.setItem("gemach_slug", "wh-medical"); });
  await page.goto("http://admin.test/admin.html");
  await page.waitForFunction(() => document.getElementById("stat-new-requests").textContent === "0");
  await page.waitForTimeout(150);
  return { page, errors, reqs, st };
}

// ── Owner: no Network tab, tab order, rename, URL copy, mode words, condition ──
{
  const { page, errors, reqs } = await setup("Owner");
  const tabs = await page.$$eval(".nav-tab", ts => ts.filter(t => !t.hidden).map(t => t.textContent.trim().replace(/\s+/g, " ")));
  ok(JSON.stringify(tabs) === JSON.stringify(["Dashboard", "Requests", "Reservations", "Loans", "Inventory", "History", "Settings"]), "tab order (owner): " + tabs.join(", "));
  ok(await page.$eval("#tab-network", t => t.hidden), "Network tab hidden for non-network admin");
  ok(await page.getAttribute("#topbar-public", "href") === "https://whgemachs.org/g/wh-medical" && await page.isVisible("#topbar-public"), "top bar 'View public page' link");
  ok(await page.$("#gemach-switcher") === null, "single-gemach owner: no switcher");

  await page.click("text=Settings");
  await page.waitForSelector("#set-name");
  ok(await page.textContent("#set-mode") === "Listing only" && (await page.textContent("#set-mode-help")).includes("contact details only"), "mode shown in plain words + help");
  ok(await page.textContent("#set-public-url") === "https://whgemachs.org/g/wh-medical", "public URL shown");
  ok((await page.getAttribute("#share-url-btn", "href")).startsWith("https://wa.me/?text=") && (await page.getAttribute("#share-url-btn", "href")).includes(encodeURIComponent("https://whgemachs.org/g/wh-medical")), "WhatsApp share link");
  ok(await page.getAttribute("#open-url-btn", "href") === "https://whgemachs.org/g/wh-medical", "Open link");
  await page.click("#copy-url-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Link copied"));
  ok(await page.evaluate(() => window.__copied) === "https://whgemachs.org/g/wh-medical", "Copy puts URL on clipboard + toast");
  await page.evaluate(() => { const e = document.getElementById("set-title"); window.scrollTo(0, e.closest(".card").getBoundingClientRect().top + scrollY - 200); });
  await page.screenshot({ path: "shot-r4-settings-profile.png" });
  await page.fill("#set-name", "");
  await page.click("#settings-save-btn");
  await page.waitForFunction(() => document.body.textContent.includes("can't be empty"));
  ok(!reqs.some(r => r.method === "PATCH" && r.path === "/admin/gemach"), "empty name blocked client-side");
  await page.fill("#set-name", "WH Medical & Mobility");
  await page.click("#settings-save-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
  const patch = reqs.filter(r => r.method === "PATCH" && r.path === "/admin/gemach").at(-1).body;
  ok(JSON.stringify(patch) === JSON.stringify({ name: "WH Medical & Mobility" }), "rename PATCH: " + JSON.stringify(patch));
  await page.waitForFunction(() => document.getElementById("topbar-gemach")?.textContent === "WH Medical & Mobility", null, { timeout: 5000 }).catch(() => {});
  ok(await page.textContent("#topbar-gemach") === "WH Medical & Mobility", "top bar label updated after rename");
  // Donation info: a text box next to the Donate link, saved like the other profile fields
  ok(await page.$("#set-donationInfo") !== null && (await page.$eval("#set-donationInfo", e => e.tagName)) === "TEXTAREA", "donation info text box in Settings");
  const donText = "For monetary donations visit anshei.org/donate.\n\nEquipment: call (718) 986-7345.";
  await page.fill("#set-donationInfo", donText);
  await page.click("#settings-save-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
  const donPatch = reqs.filter(r => r.method === "PATCH" && r.path === "/admin/gemach").at(-1).body;
  ok(JSON.stringify(donPatch) === JSON.stringify({ donationInfo: donText }), "donation info PATCH: " + JSON.stringify(donPatch));

  // condition in item sheet
  await page.click("text=Inventory");
  await page.waitForSelector(".inventory-item");
  await page.click(".inventory-item");
  ok(await page.inputValue("#assign-condition") === "Good", "item sheet has Condition select");
  ok(JSON.stringify(await page.$$eval("#assign-condition option", o => o.map(x => x.value))) === '["Good","Needs Repair"]', "condition choices match Airtable");
  await page.selectOption("#assign-condition", "Needs Repair");
  await page.screenshot({ path: "shot-r4-edit-item.png" });
  await page.click("#assign-item-submit-btn");
  await page.waitForFunction(() => !document.getElementById("assign-item-sheet").classList.contains("open"));
  await page.waitForTimeout(200);
  const cp = reqs.find(r => r.method === "PATCH" && r.path === "/admin/catalog/items/recITEM1");
  ok(cp && cp.body.condition === "Needs Repair", "condition saved via PATCH catalog item");
  await page.click(".inventory-item");
  await page.click('#assign-status-btns button[data-status="Needs Repair"]');
  ok(await page.$eval("#assign-condition", e => e.disabled && e.value === "Needs Repair"), "status Needs Repair locks condition");
  await page.click("#assign-item-sheet .sheet-close");
  await page.click(".inventory-item");
  await page.click("#assign-edit-details-btn");
  ok(await page.evaluate(() => document.getElementById("physical-item-sheet").classList.contains("open")) && JSON.stringify(await page.$$eval("#pi-condition option", o => o.map(x => x.value))) === '["Good","Needs Repair"]', "Edit item details sheet opens with Condition (Good/Needs Repair)");
  await page.click("#physical-item-sheet .sheet-close");

  // item type browse category
  await page.click("button[title='Edit item type']");
  ok(await page.inputValue("#it-category") === "recCAT1", "item type sheet preselects browse category");
  const catOpts = await page.$$eval("#it-category option", o => o.map(x => x.textContent));
  ok(catOpts[0] === "— none —" && catOpts.length === 3, "category options (active only + none): " + catOpts.join(" | "));
  await page.selectOption("#it-category", "");
  await page.click("#item-type-submit-btn");
  await page.waitForTimeout(300);
  const tp = reqs.find(r => r.method === "PATCH" && r.path === "/admin/catalog/item-types/recT1");
  ok(tp && tp.body.categoryId === "", "clearing category sends categoryId ''");
  ok(!reqs.some(r => r.path.startsWith("/admin/network/")), "owner never calls network routes");
  ok(errors.length === 0, "no console errors (owner) " + errors.join(" | "));
  await page.close();
}

// ── Network Admin ──
{
  const { page, errors, reqs, st } = await setup("Network Admin");
  const tabs = await page.$$eval(".nav-tab", ts => ts.filter(t => !t.hidden).map(t => t.textContent.trim()));
  ok(JSON.stringify(tabs) === JSON.stringify(["Dashboard", "Requests", "Reservations", "Loans", "Inventory", "History", "Settings", "Network"]), "tab order (network): " + tabs.join(", "));
  const opts = await page.$$eval("#gemach-switcher option", o => o.map(x => x.textContent));
  ok(opts.includes("Hidden <b>Gemach</b> (hidden)") && opts.includes("West Hempstead Medical Gemach"), "switcher lists hidden gemach, labelled: " + opts.join(" | "));

  await page.click("#tab-network");
  await page.waitForSelector("#ng-row-recA");
  ok((await page.textContent("#net-gemachs")).includes("Hidden <b>Gemach</b>") && await page.$("#net-gemachs b") === null, "gemach names escaped");
  ok((await page.textContent("#ng-row-recA")).includes("12 items · 2 admins"), "counts shown");
  const netGets = reqs.filter(r => r.method === "GET" && r.path.startsWith("/admin/network/")).map(r => r.path);
  ok(netGets.includes("/admin/network/overview") && !netGets.some(p => /\/(gemachs|admins|categories)$/.test(p)), "Network tab loads with one overview request (+ searches): " + netGets.join(", "));
  // Back to the tab: shown straight away from what's loaded, refreshed underneath
  await page.evaluate(() => switchTab("dashboard"));
  await page.click("#tab-network");
  ok(await page.$("#ng-row-recA") !== null, "tab re-shows immediately");
  // An older API without /overview: falls back to the three calls
  st.oldApi = true;
  await page.evaluate(() => switchTab("dashboard"));
  await page.click("#tab-network");
  await page.waitForTimeout(400);
  ok(reqs.some(r => r.path === "/admin/network/gemachs") && reqs.some(r => r.path === "/admin/network/admins") && await page.$("#ng-row-recA") !== null, "fallback to the old endpoints works");
  st.oldApi = false;
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 404/.test(errors[i])) errors.splice(i, 1); // the deliberate old-API 404
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "shot-r4-network-gemachs.png" });

  // toggle active on hidden gemach
  await page.selectOption("#ng-status-recH", "live");
  await page.waitForFunction(() => document.body.textContent.includes("Saved"));
  ok(reqs.some(r => r.method === "PATCH" && r.path === "/admin/network/gemachs/recH" && r.body.active === true && r.body.comingSoon === false), "status Live PATCHes gemach");
  await page.selectOption("#ng-status-recH", "soon");
  await page.waitForTimeout(300);
  ok(reqs.some(r => r.path === "/admin/network/gemachs/recH" && r.body.active === true && r.body.comingSoon === true), "status Coming soon PATCHes active + comingSoon");
  ok(/Coming soon/.test(await page.textContent("#ng-row-recH .card-title")) && await page.inputValue("#ng-status-recH") === "soon", "row shows Coming soon");
  await page.selectOption("#ng-status-recH", "hidden");
  await page.waitForTimeout(300);
  ok(reqs.some(r => r.path === "/admin/network/gemachs/recH" && r.body.active === false), "status Hidden PATCHes active false");
  await page.selectOption("#ng-row-recA select[aria-label='Gemach type']", "Directory");
  await page.waitForTimeout(250);
  ok(reqs.some(r => r.path === "/admin/network/gemachs/recA" && r.body.mode === "Directory"), "type select PATCHes gemach");
  await page.selectOption("#ng-row-recA select[aria-label='Gemach type']", "Info");
  await page.waitForTimeout(250);
  ok(reqs.some(r => r.path === "/admin/network/gemachs/recA" && r.body.mode === "Info"), "type Info only PATCHes gemach");
  await page.selectOption("#ng-row-recA select[aria-label='Gemach type']", "Full");
  await page.waitForTimeout(250);
  await page.locator("#ng-row-recH").screenshot({ path: "shot-status-network-row.png" });

  // create gemach flow
  await page.click("text=+ New gemach");
  await page.fill("#ng-name", "Kallah Gowns");
  ok(await page.inputValue("#ng-slug") === "kallah-gowns" && (await page.textContent("#ng-slug-preview")).includes("https://whgemachs.org/g/kallah-gowns"), "slug preview from name");
  await page.fill("#ng-name", "WH Medical");
  ok((await page.textContent("#ng-slug-preview")).includes("taken, a number will be added"), "slug collision hint");
  await page.fill("#ng-name", "Kallah Gowns");
  await page.fill("#ng-slug", "kallah");
  await page.fill("#ng-name", "Kallah Gowns of WH");
  ok(await page.inputValue("#ng-slug") === "kallah", "edited slug not overwritten");
  await page.selectOption("#ng-category", "Wedding & Events");
  await page.selectOption("#ng-mode", "Directory");
  await page.fill("#ng-email", "kallah@example.com");
  await page.screenshot({ path: "shot-r4-new-gemach.png" });
  await page.click("#ng-submit-btn");
  await page.waitForSelector("#ng-done:not([hidden])");
  const created = reqs.find(r => r.method === "POST" && r.path === "/admin/network/gemachs").body;
  ok(JSON.stringify(created) === JSON.stringify({ name: "Kallah Gowns of WH", category: "Wedding & Events", mode: "Directory", email: "kallah@example.com", phone: "", slug: "kallah" }), "create body: " + JSON.stringify(created));
  ok(await page.isVisible("#ng-open-btn") && (await page.textContent("#ng-done-text")).includes("https://whgemachs.org/g/kallah"), "offers 'Open it now'");
  ok((await page.$$eval("#gemach-switcher option", o => o.map(x => x.textContent))).includes("Kallah Gowns of WH (hidden)"), "new gemach added to switcher as hidden");
  await page.click("#net-gemach-sheet .sheet-close");

  // admins
  ok(!(await page.textContent("#net-admins")).includes("Rivka O'Neil"), "managers hidden by default (owners + network admins only)");
  await page.selectOption("#net-admin-role", "");
  ok((await page.textContent("#net-admins")).includes("Rivka O'Neil"), "admins listed");
  await page.selectOption("#net-admin-filter", "recH");
  ok((await page.textContent("#net-admins")).includes("No admins"), "filter by gemach");
  await page.selectOption("#net-admin-filter", "");
  await page.click("text=+ Add admin");
  ok(await page.isChecked("#na-invite"), "invite checkbox defaults on");
  await page.fill("#na-name", "Dina");
  await page.fill("#na-email", "Dina@Example.com");
  await page.selectOption("#na-role", "Volunteer");
  await page.click("#na-submit-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Choose at least one gemach"));
  ok(!reqs.some(r => r.method === "POST" && r.path === "/admin/network/admins"), "needs a gemach before submit");
  await page.check("#na-gemachs input[value='recA']");
  await page.check("#na-gemachs input[value='recNEW']");
  await page.screenshot({ path: "shot-r4-add-admin.png" });
  await page.click("#na-submit-btn");
  await page.waitForFunction(() => document.getElementById("net-admins").textContent.includes("dina@example.com") && !document.getElementById("net-admin-sheet").classList.contains("open"), null, { timeout: 10000 });
  const ab = reqs.find(r => r.method === "POST" && r.path === "/admin/network/admins").body;
  ok(JSON.stringify({ ...ab, gemachIds: [...ab.gemachIds].sort() }) === JSON.stringify({ name: "Dina", role: "Volunteer", gemachIds: ["recA", "recNEW"], email: "Dina@Example.com", sendInvite: true }), "add admin body: " + JSON.stringify(ab));
  await page.waitForFunction(() => document.getElementById("net-admins").textContent.includes("dina@example.com"), null, { timeout: 5000 }).catch(() => {});
  ok((await page.textContent("#net-admins")).includes("dina@example.com"), "new admin in list: " + (await page.textContent("#net-admins")).replace(/\s+/g, " ").slice(0, 300));
  await page.click("#na-row-recADM2 >> text=Edit");
  ok(await page.$eval("#na-email", e => e.disabled) && !(await page.isVisible("#na-invite-row")) && await page.isVisible("#na-active-row"), "edit sheet: email locked, active shown");
  await page.uncheck("#na-active");
  await page.click("#na-submit-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Admin updated"));
  ok(reqs.some(r => r.method === "PATCH" && r.path === "/admin/network/admins/recADM2" && r.body.active === false), "edit admin PATCH");

  // categories
  await page.click("text=+ Add category");
  await page.fill("#nc-icon", "🛏️"); await page.fill("#nc-name", "Cribs"); await page.fill("#nc-keywords", "crib, bassinet");
  await page.click("#nc-submit-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Category added"));
  const cb = reqs.find(r => r.method === "POST" && r.path === "/admin/network/categories").body;
  ok(cb.name === "Cribs" && cb.icon === "🛏️" && cb.keywords === "crib, bassinet" && cb.displayOrder === 30 && cb.active === true, "add category body: " + JSON.stringify(cb));
  await page.evaluate(() => { const e = document.getElementById("net-sec-admins"); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); });
  await page.screenshot({ path: "shot-r4-network-admins.png" });
  await page.evaluate(() => { const e = document.getElementById("net-sec-categories"); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); });
  await page.screenshot({ path: "shot-r4-network-categories.png" });

  // Open switches gemach
  await page.click("#ng-row-recH >> text=Open");
  await page.waitForFunction(() => localStorage.getItem("gemach_slug") === "hidden-one");
  await page.waitForFunction(() => document.getElementById("stat-new-requests")?.textContent === "0");
  await page.waitForTimeout(200);
  ok(reqs.filter(r => r.path === "/admin/dashboard").at(-1).h["x-gemach"] === "hidden-one", "Open switches into the hidden gemach");
  ok(errors.length === 0, "no console errors (network) " + errors.join(" | "));
  await page.close();
}
await browser.close();
