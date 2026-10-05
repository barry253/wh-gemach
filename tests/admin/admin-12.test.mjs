// Team: Settings → Team for owners (add / edit / resend invite / remove); hidden for others.
// Network tab: the admins list shows Owners and network admins by default.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, canManageTeam: true, primaryContact: "Text", phone: "5165551212", rawTemplates: {}, templates: {}, placeholders: [] };
let TEAM = [
  { id: "recADMOWNER000001", name: "Barry", email: "b@x", role: "Owner", you: true, otherGemachs: [], lastActive: new Date().toISOString() },
  { id: "recADMNETLINKED01", name: "Nate Net", email: "nate@x", role: "Network Admin", you: false, otherGemachs: [], network: true, lastActive: new Date(Date.now() - 3 * 86400e3).toISOString() },
  { id: "recADMMGR00000001", name: "Moe Manager", email: "moe@example.com", role: "Manager", you: false, otherGemachs: [], lastActive: new Date(Date.now() - 5 * 3600e3).toISOString() },
  { id: "recADMSHARED00001", name: "Sam Shared", email: "sam@example.com", role: "Volunteer", you: false, otherGemachs: ["Tablecloth Gemach"] },
];
const NET_ADMINS = [
  { id: "recN1", name: "Nina Net", email: "nina@x", role: "Network Admin", active: true, gemachs: [] },
  { id: "recN2", name: "Olivia Owner", email: "o@x", role: "Owner", active: true, lastActive: new Date(Date.now() - 2 * 3600e3).toISOString(), gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] },
  { id: "recN3", name: "Moe Manager", email: "moe@example.com", role: "Manager", active: true, gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] },
  { id: "recN4", name: "Vic Volunteer", email: "vic@x", role: "Volunteer", active: true, gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] },
  { id: "recN5", name: "Otto Off", email: "otto@x", role: "Owner", active: false, gemachs: [] },
];

async function open(role, gemach) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("dialog", d => d.accept());
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const rq = r.request(); const p = new URL(rq.url()).pathname; const m = rq.method();
    let body = null; try { body = JSON.parse(rq.postData() || "null"); } catch {}
    calls.push({ method: m, path: p, body });
    const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role, gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
    if (p === "/admin/gemach") return J(gemach);
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/team" && m === "GET") return J({ members: TEAM });
    if (p === "/admin/team" && m === "POST") {
      if (body.email === "taken@example.com") return J({ error: "This person is already a Manager at Tablecloth Gemach, and a person has one role in all their gemachs." }, 409);
      const row = { id: "recADMNEW00000001", name: body.name, email: body.email.toLowerCase(), role: body.role, you: false, otherGemachs: [], invited: !!body.sendInvite };
      return J(row, 201);
    }
    let mm;
    if ((mm = p.match(/^\/admin\/team\/(rec\w+)\/invite$/))) return J({ ok: true });
    if ((mm = p.match(/^\/admin\/team\/(rec\w+)$/)) && m === "PATCH") {
      const cur = TEAM.find(x => x.id === mm[1]);
      return J({ ...cur, ...body });
    }
    if ((mm = p.match(/^\/admin\/team\/(rec\w+)$/)) && m === "DELETE") return J({ ok: true, id: mm[1], deactivated: true });
    if (p === "/admin/network/gemachs/recA" && m === "PATCH") return J({ id: "recA", slug: "wh-medical", name: body.name || G.name, active: true, adminCount: 3, itemCount: 0, email: body.email || "whm@x", phone: "516", displayOrder: body.displayOrder ?? null, mode: "Full", category: "Medical" });
    if (p === "/admin/network/overview") return J({ gemachs: [{ id: "recA", slug: "wh-medical", name: G.name, active: true, adminCount: 3, itemCount: 0, email: "whm@x", phone: "516", mode: "Full", category: "Medical" }], admins: NET_ADMINS, categories: [] });
    if (p === "/admin/network/searches") return J({ days: 30, total: 0, top: [], misses: [] });
    return J([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("gemach_token", "fake.token.x");
    localStorage.setItem("gemach_slug", "wh-medical");
  });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(400);
  return { page, errors, calls };
}

// Owner
{
  const { page, errors, calls } = await open("Owner", G);
  await page.click(".nav-tab:has-text('Settings')");
  ok((await page.$$eval(".set-tab", b => b.map(x => x.innerText.trim()))).join("|") === "Profile|Page|Requests|Messages|Team", "owner sees a Team area");
  ok(await page.$eval(".set-tabs", el => el.scrollWidth <= el.clientWidth + 1), "all five tabs fit on a phone " + await page.$eval(".set-tabs", el => el.scrollWidth + "/" + el.clientWidth));
  await page.click("#set-tab-team");
  await page.waitForSelector("#team-list .team-row");
  ok((await page.$$eval("#team-list .team-row .card-title", e => e.map(x => x.textContent.trim()))).join("|") === "Barry You|Nate Net|Moe Manager|Sam Shared", "team listed, you marked, linked network admin after owners");
  ok(!(await page.$("#team-row-recADMNETLINKED01 button")), "network admin row: no buttons (managed on the Network tab)");
  ok(/Active in the last hour/.test(await page.textContent("#team-row-recADMOWNER000001")) && /Last active 5h ago/.test(await page.textContent("#team-row-recADMMGR00000001")) && /Hasn't signed in yet/.test(await page.textContent("#team-row-recADMSHARED00001")), "last active shown");
  ok(!(await page.$("#team-row-recADMMGR00000001 button:has-text('Resend invite')")) && !!(await page.$("#team-row-recADMSHARED00001 button:has-text('Resend invite')")), "Resend invite only for people who haven't signed in");
  ok(/Also on the team at Tablecloth Gemach/.test(await page.textContent("#team-row-recADMSHARED00001")), "shows other gemachs");
  ok(!(await page.$("#team-row-recADMOWNER000001 button:has-text('Remove')")) && !(await page.$("#team-row-recADMOWNER000001 button:has-text('Resend invite')")), "your own row: no Remove or Resend invite");
  ok(await page.isHidden("#settings-savebar"), "no save bar for team changes");
  await page.screenshot({ path: "shot-team-list.png" });

  // Add
  await page.click("button:has-text('+ Add person')");
  ok(await page.isChecked('#team-roles input[value="Volunteer"]') && await page.isChecked("#team-invite"), "new person: Volunteer + invite by default");
  await page.fill("#team-name", "Vera Vol");
  await page.fill("#team-email", "Vera@Example.com");
  await page.click('#team-roles label:has-text("Manager")');
  await page.screenshot({ path: "shot-team-add.png" });
  ok(await page.$eval("#set-tab-team .set-dot", d => d.hidden), "no unsaved dot on Team");
  await page.click("#team-submit-btn");
  await page.waitForSelector("#team-row-recADMNEW00000001");
  const add = calls.find(c => c.method === "POST" && c.path === "/admin/team");
  ok(add && add.body.name === "Vera Vol" && add.body.email === "Vera@Example.com" && add.body.role === "Manager" && add.body.sendInvite === true, "add sends name, email, role, invite: " + JSON.stringify(add?.body));
  ok(/Vera Vol added · invite sent/.test(await page.textContent("body")), "toast says the invite went");
  ok((await page.$$eval("#team-list .team-row .card-title", e => e.map(x => x.textContent.trim()))).join("|") === "Barry You|Nate Net|Moe Manager|Vera Vol|Sam Shared", "sorted by role then name");
  // An error from the server is shown and the sheet stays open
  await page.click("button:has-text('+ Add person')");
  await page.fill("#team-name", "Ella"); await page.fill("#team-email", "taken@example.com");
  await page.click("#team-submit-btn");
  await page.waitForFunction(() => /one role in all their gemachs/.test(document.body.textContent));
  ok(await page.isVisible("#team-sheet .sheet"), "sheet stays open on error");
  await page.click("#team-sheet .btn-ghost");

  // Edit: role locked for yourself and for people on other teams
  await page.click("#team-row-recADMOWNER000001 button:has-text('Edit')");
  ok(await page.isDisabled('#team-roles input[value="Manager"]') && /your own role/.test(await page.textContent("#team-role-note")), "own role locked");
  ok(await page.isHidden("#team-email-group") && await page.isHidden("#team-invite-row"), "edit: no email or invite fields");
  await page.click("#team-sheet .btn-ghost");
  await page.click("#team-row-recADMSHARED00001 button:has-text('Edit')");
  ok(await page.isDisabled('#team-roles input[value="Owner"]') && /Tablecloth Gemach/.test(await page.textContent("#team-role-note")), "shared person's role locked, says why");
  await page.click("#team-sheet .btn-ghost");
  await page.click("#team-row-recADMMGR00000001 button:has-text('Edit')");
  await page.click('#team-roles label:has-text("Owner")');
  await page.click("#team-submit-btn");
  await page.waitForFunction(() => /Owner/.test(document.querySelector("#team-row-recADMMGR00000001 .tag-navy")?.textContent || ""));
  const ed = calls.find(c => c.method === "PATCH" && c.path === "/admin/team/recADMMGR00000001");
  ok(ed && ed.body.role === "Owner" && ed.body.name === "Moe Manager", "edit sends the new role: " + JSON.stringify(ed?.body));

  // Resend + remove
  await page.click("#team-row-recADMSHARED00001 button:has-text('Resend invite')");
  await page.waitForFunction(() => /Invite sent to sam@example.com/.test(document.body.textContent));
  ok(calls.some(c => c.method === "POST" && c.path === "/admin/team/recADMSHARED00001/invite"), "resend invite");
  await page.click("#team-row-recADMSHARED00001 button:has-text('Remove')");
  await page.waitForSelector("#team-row-recADMSHARED00001", { state: "detached" });
  ok(calls.some(c => c.method === "DELETE" && c.path === "/admin/team/recADMSHARED00001"), "remove");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await page.close();
}

// Manager: no Team area
{
  const { page, errors } = await open("Manager", { ...G, canManageTeam: false });
  await page.click(".nav-tab:has-text('Settings')");
  ok((await page.$$eval(".set-tab", b => b.map(x => x.innerText.trim()))).join("|") === "Profile|Page|Requests|Messages", "manager: no Team area");
  ok(!(await page.$("#set-area-team")), "no team panel in the page");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await page.close();
}

// Network admin: owners and network admins by default
{
  const { page, errors, calls } = await open("Network Admin", G);
  await page.click(".nav-tab:has-text('Network')");
  await page.waitForSelector("#net-admins .net-row");
  const names = async () => (await page.$$eval("#net-admins .net-row .card-title", e => e.map(x => x.textContent.trim()))).join("|");
  ok(await names() === "Nina Net|Olivia Owner", "default: owners + network admins (active): " + await names());
  ok(/Last active 2h ago/.test(await page.textContent("#net-admins")) && /Hasn't signed in yet/.test(await page.textContent("#net-admins")), "network list shows last active");
  ok(/Showing 2 of 5/.test(await page.textContent("#net-admin-count")), "says how many are hidden");
  await page.screenshot({ path: "shot-network-admins-owners.png" });
  await page.click("#net-admin-count a");
  ok((await names()).split("|").length === 5, "Show everyone");
  await page.selectOption("#net-admin-role", "Volunteer");
  ok(await names() === "Vic Volunteer", "role filter");
  await page.selectOption("#net-admin-role", "inactive");
  ok(/Otto Off/.test(await names()), "turned-off admins");
  // Edit a gemach from the Network tab
  await page.click("#ng-row-recA button:has-text('Edit')");
  ok(await page.inputValue("#eg-name") === G.name && await page.isDisabled("#eg-slug") && await page.inputValue("#eg-email") === "whm@x", "edit sheet filled; web address locked while live");
  await page.fill("#eg-name", "WH Medical Gemach");
  await page.fill("#eg-order", "3");
  await page.screenshot({ path: "shot-network-edit-gemach.png" });
  await page.click("#eg-submit-btn");
  await page.waitForFunction(() => /WH Medical Gemach/.test(document.getElementById("net-gemachs").textContent));
  const pg = calls.filter(c => c.method === "PATCH" && c.path === "/admin/network/gemachs/recA").at(-1);
  ok(pg && JSON.stringify(pg.body) === JSON.stringify({ name: "WH Medical Gemach", displayOrder: 3 }), "only changed fields sent: " + JSON.stringify(pg?.body));
  ok((await page.textContent("#gemach-switcher")).includes("WH Medical Gemach"), "switcher shows the new name");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await page.close();
}
await browser.close();
