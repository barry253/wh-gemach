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

  // ── v3: contact buttons (contract: primary then secondary) ──
  // Returns null when the payload predates v3 (no primaryContact key) so callers keep legacy rendering.
  function us10(s) {
    var d = digits(s);
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.length === 10 ? d : (d || "");
  }
  // International form without "+": US 10-digit numbers get the 1 prefix; anything else is used as entered.
  function intl(d) { return d.length === 10 ? "1" + d : d; }
  function contactAction(g, type, opts) {
    var ph = us10(g.phone), waOwn = us10(g.whatsapp);
    var wa = waOwn || ((opts && opts.strictWhatsApp) ? "" : ph);
    switch (type) {
      case "Call": return ph ? { type: type, label: "Call", icon: "phone", href: "tel:+" + intl(ph) } : null;
      case "Text": return ph ? { type: type, label: "Text", icon: "sms", href: "sms:+" + intl(ph) } : null;
      case "WhatsApp": return wa ? { type: type, label: "WhatsApp", icon: "whatsapp", href: "https://wa.me/" + intl(wa), ext: true } : null;
      case "Email": return g.email ? { type: type, label: "Email", icon: "mail", href: "mailto:" + String(g.email).trim() } : null;
    }
    return null;
  }
  var CONTACT_TYPES = ["Call", "Text", "WhatsApp", "Email"];
  function contactActions(g) {
    if (!g || !("primaryContact" in g)) return null; // v2 payload → legacy
    var out = [];
    var p = CONTACT_TYPES.indexOf(g.primaryContact) >= 0 ? g.primaryContact : null;
    var s = CONTACT_TYPES.indexOf(g.secondaryContact) >= 0 ? g.secondaryContact : null;
    var want = [];
    if (p) want.push(p);
    else {
      // Fallback: first available of WhatsApp, Call, Email (and, when no secondary is set either, the next one)
      // WhatsApp only counts here when a WhatsApp number is actually set (a plain phone may be a landline).
      var avail = ["WhatsApp", "Call", "Email"].filter(function (t) { return contactAction(g, t, { strictWhatsApp: true }); });
      if (avail[0]) want.push(avail[0]);
      if (!s && avail[1]) want.push(avail[1]);
    }
    if (s && want.indexOf(s) < 0) want.push(s);
    want.forEach(function (t) { var a = contactAction(g, t); if (a && out.length < 2) out.push(a); });
    if (out[0]) out[0].primary = true;
    return out;
  }

  // ── v3: request style / event date math ──
  function requestStyle(g) {
    if (isDirectory(g)) return "Directory";
    var s = g && g.requestStyle;
    return s === "Event" || s === "Appointment" ? s : "Dates";
  }
  function clampDays(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = 1;
    return Math.max(0, Math.min(14, n));
  }
  function parseYMD(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? d : null;
  }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  /** Contract rule: pickup = event − before; return = event + after; shabbosAdjust: Sat pickup → Fri, Sat return → Sun. */
  function eventWindow(dateStr, g) {
    var ev = parseYMD(dateStr);
    if (!ev) return null;
    var pick = addDays(ev, -clampDays(g.pickupDaysBefore));
    var ret = addDays(ev, clampDays(g.returnDaysAfter));
    if (g.shabbosAdjust) {
      if (pick.getUTCDay() === 6) pick = addDays(pick, -1);
      if (ret.getUTCDay() === 6) ret = addDays(ret, 1);
    }
    return { pickup: ymd(pick), ret: ymd(ret) };
  }
  function fmtDay(s, withYear) {
    var d = parseYMD(s);
    if (!d) return s;
    var o = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
    if (withYear) o.year = "numeric";
    return d.toLocaleDateString("en-US", o);
  }
  function todayNY() {
    try {
      var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      var get = function (t) { return p.filter(function (x) { return x.type === t; })[0].value; };
      return get("year") + "-" + get("month") + "-" + get("day");
    } catch (e) {
      var n = new Date();
      return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
    }
  }
  function maxEventDate() {
    var t = parseYMD(todayNY());
    var d = new Date(Date.UTC(t.getUTCFullYear() + 2, t.getUTCMonth(), t.getUTCDate()));
    if (d.getUTCDate() !== t.getUTCDate()) d = addDays(d, -d.getUTCDate()); // Feb 29 → Feb 28
    return ymd(d);
  }

  // ── v3: theme colors ──
  var DEFAULT_THEME = "#1B3A4B";
  function validHex(h) { return typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h.trim()) ? h.trim().toUpperCase() : null; }
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(c) { return "#" + c.map(function (v) { return ("0" + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join("").toUpperCase(); }
  function lum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var INK = "#1A1A1A";
  /** White if it reaches 4.5:1, otherwise whichever of white / near-black contrasts more. */
  function onColor(bg) {
    var w = contrast(bg, "#FFFFFF"), k = contrast(bg, INK);
    return w >= 4.5 || w >= k ? "#FFFFFF" : INK;
  }
  function toHsl(h) {
    var c = rgb(h).map(function (v) { return v / 255; });
    var mx = Math.max.apply(null, c), mn = Math.min.apply(null, c), l = (mx + mn) / 2, s = 0, hh = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hh = mx === c[0] ? (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0) : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
      hh /= 6;
    }
    return [hh, s, l];
  }
  function fromHsl(hh, s, l) {
    function f(n) { var k = (n + hh * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }
    return toHex([f(0), f(8), f(4)]);
  }
  /** Same hue, darkened until white text reaches 4.5:1 (for buttons / borders / links on white). */
  function strongOf(h) {
    if (contrast(h, "#FFFFFF") >= 4.5) return h;
    var x = toHsl(h), s = Math.max(x[1], 0.35), l = x[2], out = h;
    while (l > 0.05) { l -= 0.02; out = fromHsl(x[0], x[1] < 0.08 ? x[1] : s, l); if (contrast(out, "#FFFFFF") >= 4.5) break; }
    return out;
  }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return toHex([0, 1, 2].map(function (i) { return x[i] * t + y[i] * (1 - t); })); }
  function shade(h, amt) { var x = toHsl(h); return fromHsl(x[0], x[1], Math.max(0, Math.min(1, x[2] + amt))); }
  /** CSS custom properties for a gemach's theme; null when default (keeps today's look exactly). */
  function themeVars(g) {
    var t = validHex(g && g.themeColor) || DEFAULT_THEME;
    var acc = validHex(g && g.accentColor);
    if (t === DEFAULT_THEME && !acc) return null;
    var v = {};
    if (t !== DEFAULT_THEME) {
      var on = onColor(t), light = on !== "#FFFFFF";
      var strong = strongOf(t);
      v["--t"] = t;
      v["--t-on"] = on;
      v["--t-on-muted"] = light ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.85)";
      v["--t-glass"] = light ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.12)";
      v["--t-chip"] = light ? "rgba(0,0,0,.07)" : "rgba(255,255,255,.14)";
      v["--t-glass-2"] = light ? "rgba(255,255,255,.8)" : "rgba(255,255,255,.22)";
      v["--t-glass-b"] = light ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.28)";
      v["--t-glass-b2"] = light ? "rgba(0,0,0,.3)" : "rgba(255,255,255,.45)";
      v["--t-solid-bg"] = light ? strong : "#FFFFFF";
      v["--t-solid-fg"] = light ? "#FFFFFF" : t;
      v["--t-solid-hover"] = light ? shade(strong, -0.06) : mix(t, "#FFFFFF", 0.1);
      v["--t-strong"] = strong;
      v["--t-strong-2"] = shade(strong, lum(strong) < 0.02 ? 0.08 : -0.07);
      v["--t-tint"] = mix(strong, "#FFFFFF", 0.07);
      v["--t-tint-2"] = mix(strong, "#FFFFFF", 0.12);
      v["--t-border"] = mix(strong, "#FFFFFF", 0.4);
      v["--focus-c"] = strong;
      v["--t-ring"] = "rgba(" + rgb(strong).join(",") + ",.25)";
    }
    if (acc) v["--t-accent"] = acc;
    return v;
  }
  /** Stripe color for a home card (visible on white). */
  function stripeColor(g) {
    var t = validHex(g && g.themeColor) || DEFAULT_THEME;
    return contrast(t, "#FFFFFF") >= 1.6 ? t : strongOf(t);
  }
  function initials(g) {
    var stop = { the: 1, of: 1, and: 1, gemach: 1, gmach: 1, "g'mach": 1, "&": 1 };
    var comm = String((g && g.communityName) || "West Hempstead").toLowerCase().split(/\s+/);
    var words = String((g && g.name) || "").split(/\s+/).filter(function (w) { return w && !stop[w.toLowerCase()]; });
    var core = words.filter(function (w) { return comm.indexOf(w.toLowerCase()) < 0; });
    if (core.length) words = core;
    var s = words.slice(0, 2).map(function (w) { return (w.match(/[A-Za-z0-9֐-׿]/) || [""])[0].toUpperCase(); }).join("");
    return s || "G";
  }

  ICONS.sms = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  ICONS.info = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
  ICONS.clock = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

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
    contactActions: contactActions,
    requestStyle: requestStyle,
    eventWindow: eventWindow,
    parseYMD: parseYMD,
    fmtDay: fmtDay,
    todayNY: todayNY,
    maxEventDate: maxEventDate,
    validHex: validHex,
    contrast: contrast,
    onColor: onColor,
    strongOf: strongOf,
    themeVars: themeVars,
    stripeColor: stripeColor,
    initials: initials,
    DEFAULT_THEME: DEFAULT_THEME,
    ICONS: ICONS
  };
})();
