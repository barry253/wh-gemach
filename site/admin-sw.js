// Service worker for the admin app (registered by admin.html with scope /admin).
// It only shows push notifications and opens the right admin page when one is tapped:
// no fetch handler, so it never caches or changes how admin loads.
// Messages come from the worker (worker/src/push.js): { title, body, url, tag, event, icon }.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

/** Only ever open our own admin page. */
function adminUrl(u) {
  try {
    const x = new URL(u || "/admin", self.location.origin);
    return x.origin === self.location.origin && x.pathname.startsWith("/admin") ? x.pathname + x.search : "/admin";
  } catch (e) {
    return "/admin";
  }
}

self.addEventListener("push", event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { body: event.data ? event.data.text() : "" }; }
  const jobs = [self.registration.showNotification(d.title || "Gemach Admin", {
    body: d.body || "",
    icon: d.icon || "/assets/brand/admin-icon-192.png",
    badge: "/assets/brand/admin-badge-96.png",   // Android status bar
    tag: d.tag || undefined,                     // same tag replaces the earlier one
    renotify: !!d.tag,
    timestamp: Date.now(),
    data: { url: adminUrl(d.url) },
  })];
  // A dot on the home-screen icon until admin is opened (admin then shows the real count).
  if (d.event === "request" && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge().catch(() => {}));
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = adminUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find(w => { try { return new URL(w.url).pathname.startsWith("/admin"); } catch (e) { return false; } });
    if (win) {
      // Admin is already open: bring it forward and let it go to the page (no reload unless the gemach changes).
      try { await win.focus(); } catch (e) { /* ignore */ }
      win.postMessage({ type: "open-url", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
