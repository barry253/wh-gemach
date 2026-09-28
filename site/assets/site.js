/* West Hempstead Gemachs — shared helpers (no framework) */
(function () {
  "use strict";

  var host = location.hostname || "";
  var API_BASE = /(^|\.)whgemachs\.org$/.test(host)
    ? "https://api.whgemachs.org"
    : "https://wh-gemach.barry253-0f5.workers.dev";

  var CONTACT_EMAIL = "whmedicalgemach@gmail.com";
  var DIR_CACHE_KEY = "whg:directory:v1";
  var DIR_CACHE_MAX_AGE = 5 * 60 * 1000; // used for instant paint only; always revalidated

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** fetch JSON with a timeout and one retry on network error / 5xx. */
  function fetchJSON(path, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 12000;
    var retries = opts.retry === false ? 0 : 1;
    var url = /^https?:/.test(path) ? path : API_BASE + path;

    function attempt(n) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;
      var init = {
        method: opts.method || "GET",
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl ? ctrl.signal : undefined
      };
      return fetch(url, init).then(function (res) {
        if (timer) clearTimeout(timer);
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (res.status >= 500 && n < retries) {
            return sleep(600).then(function () { return attempt(n + 1); });
          }
          if (!res.ok) {
            var err = new Error((data && data.error) || ("HTTP " + res.status));
            err.status = res.status; err.data = data;
            throw err;
          }
          return data;
        });
      }, function (e) {
        if (timer) clearTimeout(timer);
        if (n < retries) return sleep(600).then(function () { return attempt(n + 1); });
        var err = new Error("network");
        err.status = 0; err.cause = e;
        throw err;
      });
    }
    return attempt(0);
  }

  // ── Directory cache (sessionStorage; may be unavailable) ──
  function readDirCache() {
    try {
      var raw = sessionStorage.getItem(DIR_CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.data || !obj.t) return null;
      if (Date.now() - obj.t > DIR_CACHE_MAX_AGE) return null;
      return obj.data;
    } catch (e) { return null; }
  }
  function writeDirCache(data) {
    try { sessionStorage.setItem(DIR_CACHE_KEY, JSON.stringify({ t: Date.now(), data: data })); } catch (e) { /* ignore */ }
  }
  function clearDirCache() {
    try { sessionStorage.removeItem(DIR_CACHE_KEY); } catch (e) { /* ignore */ }
  }
  function loadDirectory() {
    return fetchJSON("/public/directory").then(function (data) {
      if (!data || !Array.isArray(data.gemachs)) throw new Error("bad directory");
      data.categories = Array.isArray(data.categories) ? data.categories : [];
      writeDirCache(data);
      return data;
    });
  }

  // ── Formatting ──
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function telHref(phone) {
    var d = digits(phone);
    if (!d) return null;
    if (d.length === 10) d = "1" + d;
    return "tel:+" + d;
  }
  function waHref(num) {
    var d = digits(num);
    if (!d) return null;
    if (d.length === 10) d = "1" + d; // US numbers
    return "https://wa.me/" + d;
  }
  function safeUrl(u) {
    if (!u) return null;
    try {
      var x = new URL(String(u).trim());
      return (x.protocol === "https:" || x.protocol === "http:") ? x.href : null;
    } catch (e) { return null; }
  }
  function prettyUrl(u) {
    try { var x = new URL(u); return (x.hostname.replace(/^www\./, "") + (x.pathname === "/" ? "" : x.pathname)).replace(/\/$/, ""); }
    catch (e) { return u; }
  }
  function linkify(escaped) {
    // operates on already-escaped text; only http(s) URLs
    return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, function (m) {
      var href = m.replace(/&amp;/g, "&");
      return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + m + "</a>";
    });
  }
  /** Markdown-ish: blank line → paragraph, single newline → <br>. HTML escaped. */
  function formatText(s) {
    var text = String(s || "").replace(/\r\n?/g, "\n").trim();
    if (!text) return "";
    return text.split(/\n\s*\n+/).map(function (p) {
      return "<p>" + linkify(escapeHtml(p.trim())).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function isDirectory(g) { return String((g && g.mode) || "Full").toLowerCase() === "directory"; }
  function gemachUrl(slug, typeId) {
    return "/g/" + encodeURIComponent(slug) + (typeId ? "?type=" + encodeURIComponent(typeId) : "");
  }

  // ── Icons (inline SVG strings) ──
  var ICONS = {
    phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92z"/></svg>',
    whatsapp: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41z"/></svg>',
    mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
    heart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    globe: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    chevron: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    photo: '<svg class="ph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
  };

  // ── Footer year ──
  function initFooter() {
    var y = document.querySelectorAll("[data-year]");
    for (var i = 0; i < y.length; i++) y[i].textContent = String(new Date().getFullYear());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFooter);
  else initFooter();

  window.WHG = {
    API_BASE: API_BASE,
    CONTACT_EMAIL: CONTACT_EMAIL,
    fetchJSON: fetchJSON,
    readDirCache: readDirCache,
    writeDirCache: writeDirCache,
    clearDirCache: clearDirCache,
    loadDirectory: loadDirectory,
    escapeHtml: escapeHtml,
    formatText: formatText,
    telHref: telHref,
    waHref: waHref,
    safeUrl: safeUrl,
    prettyUrl: prettyUrl,
    plural: plural,
    isDirectory: isDirectory,
    gemachUrl: gemachUrl,
    ICONS: ICONS
  };
})();
