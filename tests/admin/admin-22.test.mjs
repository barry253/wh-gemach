// Logo upload: the logo is saved as a 512×512 PNG (not WebP), because it is also the gemach's
// link-preview picture and WhatsApp doesn't reliably show WebP there. Settings → Profile → upload sends logo.png.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, canManageTeam: true, primaryContact: "Text", phone: "5165551212", rawTemplates: {}, templates: {}, placeholders: [] };
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], uploads = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const rq = r.request(), p = new URL(rq.url()).pathname;
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/gemach/logo") {
    const body = rq.postDataBuffer() || Buffer.alloc(0);
    const head = body.toString("latin1");
    uploads.push({ filename: (head.match(/filename="([^"]+)"/) || [])[1], type: (head.match(/Content-Type: (image\/[a-z]+)/i) || [])[1], png: head.includes("\x89PNG") });
    return J({ logoUrl: "https://whgemachs.org/assets/gemachs/wh-medical/logo.png" });
  }
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  return J([]);
});
await page.addInitScript(() => {
  localStorage.setItem("gemach_token", "fake.token.x");
  localStorage.setItem("gemach_slug", "wh-medical");
});
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);

// A WebP source (made in the browser) comes out as PNG
const out = await page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = c.height = 600;
  const x = c.getContext("2d"); x.fillStyle = "#1B3A4B"; x.fillRect(0, 0, 600, 600); x.fillStyle = "#E0A63A"; x.fillRect(150, 150, 300, 300);
  const webp = await new Promise(res => c.toBlob(res, "image/webp", 0.9));
  const r = await prepareLogo(new File([webp], "logo.webp", { type: "image/webp" }));
  if (r.error) return { error: r.error };
  const bmp = await createImageBitmap(r.blob);
  return { type: r.blob.type, w: bmp.width, h: bmp.height, srcType: webp.type };
});
ok(out.srcType === "image/webp", "test image is a WebP");
ok(out.type === "image/png" && out.w === 512 && out.h === 512, "WebP logo comes out as a 512×512 PNG " + JSON.stringify(out));

// Upload from Settings sends logo.png
await page.click(".nav-tab:has-text('Settings')");
await page.waitForSelector("#logo-file", { state: "attached", timeout: 5000 });
const png = await page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = c.height = 300;
  c.getContext("2d").fillRect(0, 0, 300, 300);
  const b = await new Promise(res => c.toBlob(res, "image/jpeg", 0.9));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
await page.setInputFiles("#logo-file", { name: "logo.jpg", mimeType: "image/jpeg", buffer: Buffer.from(png) });
await page.waitForFunction(() => /Logo updated/.test(document.getElementById("logo-status")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
ok(uploads.length === 1 && uploads[0].filename === "logo.png" && uploads[0].type === "image/png" && uploads[0].png, "upload sends logo.png " + JSON.stringify(uploads));
ok(!errors.length, "no page errors " + JSON.stringify(errors));
await browser.close();
