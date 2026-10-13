/* Gemach page: profile, inventory, selection, request form */
(function () {
  "use strict";
  var W = window.WHG;
  var esc = W.escapeHtml;
  var $ = function (id) { return document.getElementById(id); };

  // ── Slug: /g/<slug> first, then ?g= ──
  function readSlug() {
    var m = location.pathname.match(/^\/g\/([^\/?#]+)\/?$/);
    if (m) { try { return decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return m[1].toLowerCase(); } }
    var q = new URLSearchParams(location.search).get("g");
    return q ? q.trim().toLowerCase() : "";
  }
  var slug = readSlug();
  var params = new URLSearchParams(location.search);
  var wantType = params.get("type") || "";
  // Test link (?test=<signature>): a gemach that isn't live yet opens and takes test requests.
  // Kept for this tab so the page still works if the address loses the ?test= part.
  var TEST_RE = /^[A-Za-z0-9_-]{22}$/;
  var testToken = (function () {
    var key = "whg_test:" + slug, t = params.get("test") || "";
    try {
      if (TEST_RE.test(t)) sessionStorage.setItem(key, t);
      else t = sessionStorage.getItem(key) || "";
    } catch (e) { /* storage blocked: use the address only */ }
    return TEST_RE.test(t) ? t : "";
  })();
  function inTestMode() { return !!(gemach && gemach.testMode && testToken); }
  var typeHandled = false;

  var gemach = null, items = [], categories = [];
  var selected = new Set();
  var attrFilter = {};        // { "Size": ["8","10"] } — values picked in the filter bar
  var sortBySize = false;
  var lastFocus = null;
  var loadedFresh = false;
  // Arriving from the home page's "See all N at …": ?cat=<category slug>&q=<search text> narrows the
  // inventory to what the person was looking at, until they tap "Show all items".
  var scopeCat = (params.get("cat") || "").trim().toLowerCase().slice(0, 80);
  var scopeQ = (params.get("q") || "").trim().slice(0, 100);

  // ── Render ──
  /** Header contact buttons (pills on the cream area under the band). */
  function contactButtons(g) {
    var links = contactLinks(g);
    if (!links.length) return "";
    return '<div class="contact-row">' + links.map(function (a, i) {
      return '<a class="btn g-cta' + (i === 0 ? " g-cta-solid" : "") + '" href="' + esc(a.href) + '"' +
        (a.ext ? ' target="_blank" rel="noopener"' : "") + ' data-contact="' + esc(a.type) + '">' + W.ICONS[a.icon] + esc(a.label) + "</a>";
    }).join("") + "</div>";
  }
  /** Slim bar once the header has scrolled away: logo, name, icon-only contact buttons. */
  function miniBar(g) {
    var links = contactLinks(g);
    return '<div class="wrap">' + logoHtml(g, "g-mini-logo") +
      '<a class="g-mini-name" href="#main" tabindex="-1">' + esc(g.name) + "</a>" +
      links.map(function (a) {
        return '<a class="g-mini-btn" href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener"' : "") +
          ' data-contact="' + esc(a.type) + '" aria-label="' + esc(a.label + " " + g.name) + '" tabindex="-1">' + W.ICONS[a.icon] + "</a>";
      }).join("") + "</div>";
  }
  var miniObs = null;
  function setupMini(g) {
    var bar = $("g-mini"), head = $("g-header");
    if (!bar || !head) return;
    bar.innerHTML = miniBar(g);
    bar.hidden = false;
    var show = function (on) {
      bar.classList.toggle("show", on);
      document.body.classList.toggle("mini-on", on);
      bar.setAttribute("aria-hidden", on ? "false" : "true");
      Array.prototype.forEach.call(bar.querySelectorAll("a"), function (el) { el.tabIndex = on ? 0 : -1; });
    };
    show(false);
    if (miniObs || !("IntersectionObserver" in window)) return;
    // Shown once the contact buttons (bottom of the header) have scrolled under the top edge.
    miniObs = new IntersectionObserver(function (ents) {
      var e = ents[0];
      show(!e.isIntersecting && e.boundingClientRect.top < 0);
    }, { threshold: 0 });
    miniObs.observe(head);
  }

  var appliedVars = [];
  function applyTheme(g) {
    var root = document.documentElement;
    appliedVars.forEach(function (k) { root.style.removeProperty(k); });
    appliedVars = [];
    var v = W.themeVars(g);
    Object.keys(v).forEach(function (k) { root.style.setProperty(k, v[k]); appliedVars.push(k); });
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute("content", W.validHex(g.themeColor) || W.DEFAULT_THEME);
  }
  function applyFavicon(g) {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    var logo = W.safeUrl(g && g.logoUrl);
    if (logo) { link.setAttribute("href", logo); link.removeAttribute("type"); }
    else { link.setAttribute("href", "/favicon.svg"); link.setAttribute("type", "image/svg+xml"); }
  }

  /** Split "West Hempstead Medical Gemach" into eyebrow + rest when it starts with the community name. */
  function nameHtml(g) {
    var name = String(g.name || ""), comm = String(g.communityName || "").trim();
    if (comm && name.length > comm.length + 1 && name.toLowerCase().indexOf(comm.toLowerCase() + " ") === 0) {
      return '<span class="g-eyebrow">' + esc(name.slice(0, comm.length)) + '</span> <span class="g-rest">' + esc(name.slice(comm.length + 1).trim()) + "</span>";
    }
    return esc(name);
  }
  /** Logo tile: the logo on white; a logo made for dark backgrounds on the band color; else initials. */
  function logoHtml(g, cls) {
    var dark = W.safeUrl(g.logoDarkUrl), light = W.safeUrl(g.logoUrl);
    if (dark && dark.indexOf("https:") !== 0) dark = null;
    var c = cls ? " " + cls : "";
    if (light) return '<img class="g-logo' + c + '" src="' + esc(light) + '" alt="' + esc(g.name) + '" width="112" height="112" decoding="async" />';
    if (dark) return '<img class="g-logo g-logo-bare' + c + '" src="' + esc(dark) + '" alt="' + esc(g.name) + '" width="112" height="112" decoding="async" />';
    return '<span class="g-logo g-logo-initials' + c + '" aria-hidden="true">' + esc(W.initials(g)) + "</span>";
  }

  function renderHeader() {
    var g = gemach;
    applyTheme(g);
    applyFavicon(g);
    var facts = shortInfo(g);
    $("g-head").innerHTML =
      logoHtml(g) +
      '<h1 class="g-name">' + nameHtml(g) + "</h1>" +
      (g.tagline ? '<p class="tagline">' + esc(g.tagline) + "</p>" : "") +
      (W.isComingSoon(g) ? '<span class="chip chip-soon">Coming soon</span>' : "") +
      contactButtons(g) +
      (facts ? '<div class="g-facts">' + facts + "</div>" : "");
    setupMini(g);
    document.title = g.name + " — West Hempstead Gemachs";
    var md = document.querySelector('meta[name="description"]');
    if (md && g.tagline) md.setAttribute("content", g.tagline);
    var ogt = document.querySelector('meta[property="og:title"]');
    if (ogt) ogt.setAttribute("content", g.name);
  }

  function infoPanel() {
    var g = gemach;
    var desc = W.formatText(g.description);
    var side = [];
    var v3 = isV3(g);
    if (g.hours && !v3) side.push('<div><div class="info-label">Hours</div><div>' + esc(g.hours).replace(/\r?\n/g, "<br>") + "</div></div>");
    // Numbers, addresses and links aren't printed on the page; the website is a button.
    // Contact buttons live in the header (and the slim bar), so they aren't repeated here.
    var web = W.safeUrl(g.website);
    if (web) side.push('<div><div class="info-label">Website</div><div class="info-ctas"><a class="btn btn-sm" href="' + esc(web) + '" target="_blank" rel="noopener" data-contact="Website">' + W.ICONS.globe + "Visit website</a></div></div>");
    // Donations: link only -> the Donate button opens it in a new tab.
    // Donation text (with or without a link) -> the Donate button opens it in a pop-up (see openDonate).
    var don = W.safeUrl(g.donationUrl);
    var hasInfo = !!String(g.donationInfo || "").trim();
    if (don || hasInfo) {
      side.push('<div class="support"><div class="info-label">Support this gemach</div>' +
        (hasInfo
          ? '<button type="button" class="btn btn-sm btn-pill" id="btn-donate" aria-haspopup="dialog">' + W.ICONS.heart + "Donate</button>"
          : '<a class="btn btn-sm btn-pill" href="' + esc(don) + '" target="_blank" rel="noopener">' + W.ICONS.heart + "Donate</a>") + "</div>");
    }
    if (!desc && !side.length) return "";
    return '<section class="info-panel' + (desc && side.length ? " has-side" : "") + '" aria-label="About this gemach">' +
      (desc ? '<div class="prose">' + desc + "</div>" : "") +
      (side.length ? '<div class="info-side">' + side.join("") + "</div>" : "") + "</section>";
  }

  /** Contact buttons: the gemach's chosen methods (v3), or Call / WhatsApp / Email from whatever is set (older payloads). */
  function contactLinks(g) {
    var acts = W.contactActions(g);
    if (acts) return acts;
    var out = [], tel = W.telHref(g.phone), wa = W.waHref(g.whatsapp);
    if (tel) out.push({ type: "Call", label: "Call", icon: "phone", href: tel });
    if (wa && W.telHref(g.whatsapp) !== tel) out.push({ type: "WhatsApp", label: "WhatsApp", icon: "whatsapp", href: wa, ext: true });
    if (g.email) out.push({ type: "Email", label: "Email", icon: "mail", href: "mailto:" + String(g.email).trim() });
    return out;
  }

  function isV3(g) { return !!g && ("requestStyle" in g || "depositRequired" in g || "gemachInfo" in g); }

  // ── Quantity items (e.g. 60 chairs): counted, not numbered; free count depends on the dates ──
  function isQty(it) { return !!it && it.tracking === "quantity"; }
  // Add-ons: made to order for purchase (e.g. a personalized sweatshirt) — never "on loan", paid separately.
  function isAddon(it) { return !!it && it.tracking === "addon"; }
  function money(n) { var x = Number(n); return isFinite(x) ? "$" + (x % 1 ? x.toFixed(2) : x) : ""; }
  var qtyVals = {}; // item id -> what the person typed (kept while the modal is re-rendered)

  /** Fewest free at any point of [from, to] (to = null: open-ended). Same rule as the server. */
  function qtyFree(it, from, to) {
    var total = Math.max(0, it.totalUnits || 0);
    var list = (it.bookings || []).filter(function (b) { return (to == null || b.from <= to) && (b.to == null || b.to >= from); });
    var points = [from].concat(list.map(function (b) { return b.from; }).filter(function (d) { return d > from; }));
    var peak = 0;
    points.forEach(function (p) {
      var used = 0;
      list.forEach(function (b) { if (b.from <= p && (b.to == null || b.to >= p)) used += b.qty; });
      if (used > peak) peak = used;
    });
    return Math.max(0, total - peak);
  }
  /** The dates the form currently asks for: { from, to } (to null = open-ended), or null if not chosen yet. */
  function formWindow() {
    var st = style();
    if (st === "Event") {
      var v = $("f-event").value;
      var w = v && W.parseYMD(v) ? W.eventWindow(v, gemach) : null;
      return w ? { from: w.pickup, to: w.ret } : null;
    }
    if (st !== "Dates") return null;
    var f = $("f-from").value, u = $("f-until").value;
    if (!W.parseYMD(f)) return null;
    return { from: f, to: W.parseYMD(u) && u > f ? u : null };
  }
  /** Rows of number inputs for the checked quantity items, with "N free for your dates". */
  function renderQty() {
    var group = $("qty-group"), list = $("qty-list");
    var ids = Array.prototype.map.call(modal.querySelectorAll('input[name="modal-items"]:checked'), function (cb) { return cb.value; });
    var qi = items.filter(function (it) { return (isQty(it) || isAddon(it)) && ids.indexOf(it.id) >= 0; });
    // The deposit is for borrowed items: hide it when only add-ons are chosen.
    var addonsOnly = ids.length > 0 && ids.every(function (id) { return isAddon(items.filter(function (x) { return x.id === id; })[0]); });
    var dep = !!gemach.depositRequired && !addonsOnly;
    $("deposit-group").hidden = !dep;
    $("f-deposit").required = dep;
    if (!qi.length || style() === "Appointment") { group.hidden = true; list.innerHTML = ""; return; }
    // keep what's typed; rebuild only when the set of rows changes
    var have = Array.prototype.map.call(list.querySelectorAll("[data-qty]"), function (i) { return i.getAttribute("data-qty"); }).join(",");
    if (have !== qi.map(function (it) { return it.id; }).join(",")) {
      list.innerHTML = qi.map(function (it) {
        var id = esc(it.id);
        var field = pkgSize(it) > 1
          ? '<select id="q-' + id + '" data-qty="' + id + '" aria-describedby="qn-' + id + '"><option value="">Choose…</option>' +
            pkgChoices(it).map(function (n) {
              var v = String(n);
              return '<option value="' + v + '"' + (qtyVals[it.id] === v ? " selected" : "") + ">" + n + " (" + esc(pkgCount(it, n / pkgSize(it))) + ")</option>";
            }).join("") + "</select>"
          : '<input type="number" id="q-' + id + '" data-qty="' + id + '" min="1" max="' + (isAddon(it) ? 500 : (it.totalUnits || 1)) + '" step="1" inputmode="numeric" value="' + esc(qtyVals[it.id] || (isAddon(it) ? "1" : "")) + '" aria-describedby="qn-' + id + '" />';
        return '<div class="qty-row"><label for="q-' + id + '">' + esc(it.name) + "</label>" + field +
          '<p class="qty-note" id="qn-' + id + '" aria-live="polite"></p></div>';
      }).join("");
    }
    group.hidden = false;
    updateQtyNotes();
  }
  function updateQtyNotes() {
    var w = formWindow();
    Array.prototype.forEach.call($("qty-list").querySelectorAll("[data-qty]"), function (inp) {
      var it = items.filter(function (x) { return x.id === inp.getAttribute("data-qty"); })[0];
      var note = $("qn-" + inp.getAttribute("data-qty"));
      if (!it || !note) return;
      var n = parseInt(inp.value, 10);
      var total = it.totalUnits || 0;
      var txt, warn = false;
      if (isAddon(it)) {
        note.textContent = it.price != null
          ? "Add-on · " + money(it.price) + " each" + (n > 1 ? " — " + money(it.price * n) + " for " + n : "") + " · paid separately"
          : "Add-on · made to order, paid separately";
        note.classList.remove("warn");
        return;
      }
      if (!it.bookings) txt = total + " in the gemach";
      else if (!w) txt = total + " in the gemach — choose your dates to see how many are free";
      else {
        var free = qtyFree(it, w.from, w.to);
        if (n > free) { warn = true; txt = "Only " + free + " free for your dates. You can still ask — the gemach will let you know what they can do."; }
        else txt = free + " of " + total + " free for your dates";
      }
      if (n > total) { warn = true; txt = "The gemach has " + total + " in total."; }
      if (pkgSize(it) > 1) txt = "Lent in " + unitsWord(it.packageUnit || "package") + " of " + pkgSize(it) + ". " + txt;
      note.textContent = txt;
      note.classList.toggle("warn", warn);
    });
  }
  function style() { return W.requestStyle(gemach); }

  // Quantity items lent in whole packages (it.packageSize > 1, e.g. bags of 6 tablecloths).
  // Counts are single pieces; borrowers choose 6, 12, … from a list.
  function pkgSize(it) { return isQty(it) && it.packageSize > 1 ? it.packageSize : 1; }
  function unitsWord(u) { return /(s|x|z|ch|sh)$/i.test(u) ? u + "es" : u + "s"; } // bag → bags, box → boxes
  function pkgCount(it, n) { var u = it.packageUnit || "package"; return W.plural(n, u, unitsWord(u)); }
  /** "Lent in bags of 6" */
  function pkgPhrase(it) { return "lent in " + unitsWord(it.packageUnit || "package") + " of " + pkgSize(it); }
  /** Whole packages that fit in what the gemach lends: [6, 12] */
  function pkgChoices(it) { var ps = pkgSize(it), out = []; for (var n = ps; n <= (it.totalUnits || 0); n += ps) out.push(n); return out; }

  function isPayment(g) { return !!g && g.chargeType === "Payment"; } // a fee, not a refundable deposit
  function depositHtml(g) {
    return "<strong>" + W.ICONS.info + (isPayment(g) ? "Payment required" : "Deposit required") + "</strong>" +
      (g.depositInfo ? '<div class="prose">' + W.formatText(g.depositInfo) + "</div>" : "");
  }
  /** Short "Gemach Info" (a few brief lines, no hours or deposit) goes in the header instead of its own box. */
  function shortInfo(g) {
    if (!isV3(g) || g.depositRequired || g.hours || W.isInfoOnly(g)) return "";
    var raw = String(g.gemachInfo || "").trim();
    if (!raw || raw.length > 200) return "";
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length > 4 || lines.some(function (l) { return l.length > 70; })) return "";
    return W.formatText(lines.join("\n"));
  }
  function gemachInfoSection() {
    var g = gemach;
    if (!isV3(g) || shortInfo(g)) return "";
    var parts = [];
    if (g.depositRequired) parts.push('<div class="deposit-callout" role="note">' + depositHtml(g) + "</div>");
    if (g.hours) parts.push('<div class="ginfo-row">' + W.ICONS.clock + '<div><div class="info-label">Hours</div><div>' + esc(g.hours).replace(/\r?\n/g, "<br>") + "</div></div></div>");
    var info = W.formatText(g.gemachInfo);
    if (info) parts.push('<div class="prose">' + info + "</div>");
    if (!parts.length) return "";
    return '<section class="ginfo" aria-labelledby="ginfo-title"><h2 id="ginfo-title">Gemach Info</h2>' + parts.join("") + "</section>";
  }

  function testModeBanner() {
    if (!inTestMode()) return "";
    return '<div class="test-banner" role="note"><strong>Test mode</strong> ' +
      "<span>This gemach isn’t open to the public yet. Requests sent from this page are tests, not real loans.</span></div>";
  }
  function comingSoonBanner() {
    if (inTestMode()) return testModeBanner();
    if (!W.isComingSoon(gemach)) return "";
    return '<div class="soon-banner" role="note"><strong>Coming soon</strong> ' +
      "<span>This gemach is getting ready and isn’t taking requests online yet. You’re welcome to contact them directly.</span></div>";
  }
  /** Info only: "General info" shown large, with hours, deposit and big contact buttons. */
  function infoOnlyBox() {
    var g = gemach;
    var info = W.formatText(g.gemachInfo);
    var acts = W.contactActions(g) || [];
    var btns = acts.map(function (a) {
      return '<a class="btn' + (a.primary ? " btn-primary" : (a.type === "WhatsApp" ? " btn-wa" : "")) + '" href="' + esc(a.href) + '"' +
        (a.ext ? ' target="_blank" rel="noopener"' : "") + ">" + W.ICONS[a.icon] + esc(a.label) + "</a>";
    }).join("");
    var rows = [];
    if (g.hours) rows.push('<div class="ginfo-row">' + W.ICONS.clock + '<div><div class="info-label">Hours</div><div>' + esc(g.hours).replace(/\r?\n/g, "<br>") + "</div></div></div>");
    if (g.depositRequired) rows.push('<div class="deposit-callout" role="note">' + depositHtml(g) + "</div>");
    return '<section class="info-only" aria-labelledby="io-title"><h2 id="io-title">How this gemach works</h2>' +
      (info ? '<div class="prose io-prose">' + info + "</div>" : '<p class="io-prose">Contact the gemach using the buttons below.</p>') +
      rows.join("") + (btns ? '<div class="io-actions">' + btns + "</div>" : "") + "</section>";
  }

  /** Listing-only gemachs can send borrowers to their own request form (e.g. a Google Form). https only. */
  function formUrl() {
    var g = gemach;
    if (!g || !W.isDirectory(g) || W.isComingSoon(g)) return null;
    var u = W.safeUrl(g.requestFormUrl);
    return u && /^https:/i.test(u) ? u : null;
  }
  function formNotice() {
    var u = formUrl();
    return '<div class="notice form-notice"><p>This gemach takes requests through its own form. Browse the items here, then open the form and list the ones you’d like.</p>' +
      '<a class="btn btn-primary" href="' + esc(u) + '" target="_blank" rel="noopener">Open the request form</a></div>';
  }

  function availBadge(it) {
    if (W.isComingSoon(gemach)) return "";
    if (formUrl()) return "";
    if (W.isDirectory(gemach)) return borrowNote() ? "" : '<span class="badge badge-dir">Contact to check</span>';
    if (isAddon(it)) return '<span class="badge badge-addon">Add-on' + (it.price != null ? " · " + money(it.price) : "") + "</span>";
    if (style() === "Appointment") return "";
    var n = Math.max(0, it.availableCount || 0);
    return n > 0 ? '<span class="badge badge-ok">' + n + " available</span>"
                 : '<span class="badge badge-out">All on loan</span>';
  }

  // ── Scope from the home page (?cat= / ?q=), matched the same way the home page searches ──
  var scopeMemo = null;
  function scopeCategory() {
    if (!scopeCat) return null;
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i];
      if (c && (W.catSlug(c) === scopeCat || String(c.id || "").toLowerCase() === scopeCat)) return c;
    }
    return null;
  }
  /** The ids of items in scope, or null when there's no scope (or nothing would match it — then show everything). */
  function scopeIds() {
    var key = scopeCat + "|" + scopeQ + "|" + items.length + "|" + categories.length;
    if (scopeMemo && scopeMemo.key === key) return scopeMemo.ids;
    var cat = scopeCategory(), toks = scopeQ ? W.searchTokens(scopeQ) : [];
    var ids = null, empty = false;
    if (cat || toks.length) {
      var catOf = {};
      categories.forEach(function (c) { if (c && c.id) catOf[c.id] = c; });
      var pool = items.filter(function (it) { return !cat || it.categoryId === cat.id; });
      var hays = pool.map(function (it) {
        var c = catOf[it.categoryId];
        return W.makeHay([it.name, it.byline, it.searchWords, it.description, c && c.name, c && (c.keywords || []).join(" "), gemach && gemach.name, W.attrText(it)]);
      });
      var run = function (mode) {
        return pool.filter(function (it, i) {
          if (!toks.length) return true;
          var hit = 0;
          for (var k = 0; k < toks.length; k++) {
            if (W.tokMatch(toks[k], hays[i])) hit++; else if (mode === "all") return false;
          }
          return hit > 0;
        });
      };
      var found = run("all");
      if (!found.length && toks.length > 1) found = run("any");
      if (found.length) { ids = {}; found.forEach(function (it) { ids[it.id] = 1; }); }
      else empty = true;
    }
    scopeMemo = { key: key, ids: ids, empty: empty, cat: cat };
    return ids;
  }
  function inScope(it) { var ids = scopeIds(); return !ids || !!ids[it.id]; }
  /** Items the page works with: everything, or just the ones in scope. */
  function pool() { return scopeIds() ? items.filter(inScope) : items; }
  function scopeNote(shown) {
    scopeIds();
    var m = scopeMemo, what = [];
    if (!m || (!m.ids && !m.empty)) return "";
    if (scopeQ) what.push("“" + esc(scopeQ) + "”");
    if (m.cat) what.push(esc(m.cat.name));
    var label = what.join(" in ");
    if (m.empty) {
      return '<div class="notice notice-info scope-note" role="status">Nothing here matches ' + label +
        ", so all of this gemach’s items are shown.</div>";
    }
    var total = items.filter(function (it) { return !isAddon(it); }).length;
    return '<div class="notice notice-info scope-note" role="status"><span>Showing <strong>' + W.plural(shown, "item") +
      "</strong> for " + label + (total > shown ? " (of " + total + ")" : "") + '.</span> <button type="button" class="btn-link" id="scope-clear">Show all items</button></div>';
  }
  function clearScope() {
    scopeCat = ""; scopeQ = ""; scopeMemo = null;
    try {
      var p = new URLSearchParams(location.search);
      p.delete("cat"); p.delete("q");
      var s2 = p.toString();
      history.replaceState(history.state, "", location.pathname + (s2 ? "?" + s2 : "") + location.hash);
    } catch (e) { /* ignore */ }
  }

  // ── Item filters (gemach-defined, e.g. Size / Color) ──
  function attrDefs() { return (gemach && Array.isArray(gemach.itemAttributes)) ? gemach.itemAttributes : []; }
  /** A gemach setting naming one of its filters (sections / holiday spotlight) → that filter, else null. */
  function defNamed(name) {
    if (!name) return null;
    var k = String(name).toLowerCase();
    return attrDefs().filter(function (d) { return d.name.toLowerCase() === k; })[0] || null;
  }
  function groupDef() { return defNamed(gemach && gemach.groupBy); }
  /** Filters shown on each item (the section filter is already the heading above it). */
  function shownDefs() { var gd = groupDef(); return attrDefs().filter(function (d) { return !gd || d.name !== gd.name; }); }
  function spotDef() { return defNamed(gemach && gemach.spotlightFilter); }

  // ── Catalog extras: byline, New tag, Featured / New / holiday strips, sections ──
  /** Today in New York as YYYY-MM-DD (tests can set window.WHG_TODAY). */
  function nyToday() {
    if (window.WHG_TODAY) return window.WHG_TODAY;
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function isNew(it) { return !!(it && it.newUntil && it.newUntil >= nyToday()); }
  function newTag(it) { return isNew(it) ? ' <span class="tag-new">New</span>' : ""; }
  function bylineHtml(it, cls) { return it.byline ? '<div class="' + cls + '">' + esc(it.byline) + "</div>" : ""; }
  function borrowNote() {
    var g = gemach;
    return g && W.isDirectory(g) && !W.isComingSoon(g) && !formUrl() && g.borrowNote ? String(g.borrowNote) : "";
  }
  function borrowNoteHtml() { return '<div class="notice borrow-note">' + W.formatRich(borrowNote()) + "</div>"; }

  // Holidays a spotlight filter's values can name (spellings compared without apostrophes / case).
  // m = Hebrew month names as Intl gives them; shown from LEAD days before the first day through the last.
  var HOLIDAYS = [
    { label: "Rosh Hashanah", m: ["Tishri"], d: 1, len: 2, names: ["rosh hashanah", "rosh hashana", "rosh hashono"] },
    { label: "Yom Kippur", m: ["Tishri"], d: 10, len: 1, names: ["yom kippur"] },
    { label: "Sukkos", m: ["Tishri"], d: 15, len: 9, names: ["sukkos", "sukkot", "succos", "succot", "simchas torah", "simchat torah"] },
    { label: "Chanukah", m: ["Kislev"], d: 25, len: 8, names: ["chanukah", "hanukkah", "chanuka", "hanukah", "hanuka"] },
    { label: "Tu B’Shvat", m: ["Shevat"], d: 15, len: 1, names: ["tu bshvat", "tu bishvat", "tu beshvat"] },
    { label: "Purim", m: ["Adar", "Adar II"], d: 14, len: 1, names: ["purim"] },
    { label: "Pesach", m: ["Nisan"], d: 15, len: 8, names: ["pesach", "passover"] },
    { label: "Lag BaOmer", m: ["Iyar"], d: 18, len: 1, names: ["lag baomer", "lag bomer"] },
    { label: "Shavuos", m: ["Sivan"], d: 6, len: 2, names: ["shavuos", "shavuot"] },
    { label: "Tisha B’Av", m: ["Av"], d: 9, len: 1, names: ["tisha bav", "tisha beav", "the three weeks", "three weeks"] }
  ];
  var LEAD = 30;
  function holKey(s) { return String(s || "").toLowerCase().replace(/[’'`‘]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  var holMemo = null;
  /** Holidays whose window (LEAD days before → last day) includes today: [{ h, off }], soonest first. off = days until it starts. */
  function holidaysNow() {
    var today = nyToday();
    if (holMemo && holMemo.day === today) return holMemo.list;
    var list = [];
    try {
      var fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: "UTC", month: "long", day: "numeric" });
      var base = Date.parse(today + "T12:00:00Z");
      for (var off = -10; off <= LEAD; off++) {
        var parts = fmt.formatToParts(new Date(base + off * 864e5)), mon = "", day = 0;
        parts.forEach(function (p) { if (p.type === "month") mon = p.value; if (p.type === "day") day = Number(p.value); });
        HOLIDAYS.forEach(function (h) {
          if (h.d === day && h.m.indexOf(mon) !== -1 && off + h.len - 1 >= 0) list.push({ h: h, off: off });
        });
      }
    } catch (e) { list = []; } // no Hebrew calendar in this browser: no spotlight
    holMemo = { day: today, list: list };
    return list;
  }
  /** The holiday strip: the soonest holiday in its window that has items tagged with it. */
  function spotlight() {
    var d = spotDef();
    if (!d) return null;
    var hols = holidaysNow();
    for (var i = 0; i < hols.length; i++) {
      var h = hols[i].h;
      var vals = d.values.filter(function (v) { return h.names.indexOf(holKey(v)) !== -1; });
      if (!vals.length) continue;
      var list = items.filter(function (it) {
        return !isAddon(it) && itemVals(it, d.name).some(function (v) { return vals.indexOf(v) !== -1; });
      });
      if (list.length) return { title: hols[i].off > 0 ? h.label + " is coming" : "For " + h.label, items: list, key: "spotlight" };
    }
    return null;
  }
  function stripCard(it) {
    var photo = it.photoUrl && W.safeUrl(it.photoUrl) ? it.photoUrl : null;
    return '<li><a class="strip-card" href="#row-' + esc(it.id) + '" data-jump="' + esc(it.id) + '">' +
      '<span class="strip-cover">' + (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy" />' : W.ICONS.photo) + "</span>" +
      '<span class="strip-name">' + esc(it.name) + "</span>" + (it.byline ? '<span class="strip-by">' + esc(it.byline) + "</span>" : "") + "</a></li>";
  }
  /** Spotlight / New / Featured strips (only while browsing everything: no search scope, no filters). */
  function stripsHtml() {
    if (scopeIds() || activeFilterCount()) return "";
    var strips = [], sp = spotlight();
    if (sp) strips.push(sp);
    var fresh = items.filter(function (it) { return !isAddon(it) && isNew(it); });
    if (fresh.length) strips.push({ title: "New releases", items: fresh, key: "new" });
    var feat = items.filter(function (it) { return !isAddon(it) && it.featured; });
    if (feat.length) strips.push({ title: "Featured", items: feat, key: "featured" });
    return strips.map(function (s) {
      return '<section class="strip strip-' + s.key + '" aria-label="' + esc(s.title) + '"><h3 class="strip-title">' + esc(s.title) +
        ' <span class="strip-n">' + s.items.length + "</span></h3>" +
        '<ul class="strip-list">' + s.items.map(stripCard).join("") + "</ul></section>";
    }).join("");
  }
  function flashRow(id) {
    var row = document.getElementById("row-" + id);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "auto" });
    row.classList.add("flash");
    setTimeout(function () { row.classList.remove("flash"); }, 2400);
  }
  function itemVals(it, name) { return (it.attributes && it.attributes[name]) || []; }
  function sizeDef() { return attrDefs().filter(function (d) { return /size/i.test(d.name); })[0] || null; }
  /** Filters worth showing: only values that some (non add-on) item actually has, in the gemach's order. */
  function usableDefs() {
    var gd = groupDef(); // shown as sections (with a jump bar), not as a filter
    return attrDefs().filter(function (d) { return !gd || d.name !== gd.name; }).map(function (d) {
      var used = {};
      pool().forEach(function (it) { if (!isAddon(it)) itemVals(it, d.name).forEach(function (v) { used[v] = 1; }); });
      return { name: d.name, values: d.values.filter(function (v) { return used[v]; }) };
    }).filter(function (d) { return d.values.length; });
  }
  /** skip: a filter name to ignore (used to work out which choices in that filter still have matches). */
  function passesFilter(it, skip) {
    if (isAddon(it)) return true; // add-ons aren't sized/colored; always listed
    return Object.keys(attrFilter).every(function (name) {
      if (name === skip) return true;
      var want = attrFilter[name];
      if (!want || !want.length) return true;
      var have = itemVals(it, name);
      return want.some(function (v) { return have.indexOf(v) !== -1; });
    });
  }
  function sizeRank(it) {
    var d = sizeDef();
    if (!d) return 1e9;
    var v = itemVals(it, d.name);
    var best = 1e9;
    v.forEach(function (x) { var i = d.values.indexOf(x); if (i !== -1 && i < best) best = i; });
    return best;
  }
  function activeFilterCount() {
    return Object.keys(attrFilter).reduce(function (n, k) { return n + (attrFilter[k] || []).length; }, 0);
  }
  /** Per filter: how many items have each choice, given the picks in the *other* filters (0 → grayed out)
      (OR within a filter, so picking size 8 never rules out size 10). */
  function facetCounts(defs) {
    var base = pool().filter(function (it) { return !isAddon(it); });
    return defs.map(function (d) {
      var c = {};
      base.forEach(function (it) {
        if (passesFilter(it, d.name)) itemVals(it, d.name).forEach(function (v) { c[v] = (c[v] || 0) + 1; });
      });
      return c;
    });
  }
  // Filter sections start folded shut; the ones opened are remembered per gemach on this device.
  function openKey() { return "whg_afopen:" + (gemach && gemach.slug || ""); }
  function openSet() {
    try { var f = JSON.parse(localStorage.getItem(openKey()) || "[]"); return Array.isArray(f) ? f : []; } catch (e) { return []; }
  }
  function saveOpen(list) {
    try { localStorage.setItem(openKey(), JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function setOpen(name, open) {
    var f = openSet().filter(function (x) { return x !== name; });
    if (open) f.push(name);
    saveOpen(f);
  }
  function filterBar(defs, shown, total) {
    if (!defs.length) return "";
    var sd = sizeDef(), counts = facetCounts(defs), opened = openSet();
    var rows = defs.map(function (d, i) {
      var on = attrFilter[d.name] || [];
      var shut = opened.indexOf(d.name) === -1;
      var sum = on.length ? on.join(", ") : "Any";
      return '<div class="af-row' + (shut ? " af-shut" : "") + '" role="group" aria-label="Filter by ' + esc(d.name) + '">' +
        '<button type="button" class="af-name" data-fold="' + i + '" aria-expanded="' + !shut + '" aria-controls="af-c' + i + '">' +
          '<span class="af-label">' + esc(d.name) + '</span><span class="af-sum' + (on.length ? " af-sum-on" : "") + '">' + esc(sum) + "</span>" + W.ICONS.chevron + "</button>" +
        '<div class="af-chips" id="af-c' + i + '"' + (shut ? " hidden" : "") + ">" + d.values.map(function (v, j) {
          var pressed = on.indexOf(v) !== -1;
          var n = counts[i][v] || 0;
          var dead = !n && !pressed; // nothing left with this choice; picked ones stay tappable so they can be cleared
          return '<button type="button" class="af-chip" data-fa="' + i + '" data-fv="' + j + '" aria-pressed="' + pressed + '"' + (dead ? " disabled" : "") +
            '><span class="af-v">' + esc(v) + "</span></button>";
        }).join("") + "</div></div>";
    }).join("");
    var n = activeFilterCount();
    var sort = sd && defs.some(function (d) { return d.name === sd.name; })
      ? '<label class="af-sort">Sort <select id="af-sort"><option value="">As listed</option><option value="size"' + (sortBySize ? " selected" : "") + ">By " + esc(sd.name.toLowerCase()) + ", smallest first</option></select></label>" : "";
    var allOpen = defs.every(function (d) { return opened.indexOf(d.name) !== -1; });
    var head = '<div class="af-head"><span class="af-title">Filters</span>' +
      '<button type="button" class="af-all" id="af-all" data-open="' + (allOpen ? "0" : "1") + '">' + (allOpen ? "Collapse all" : "Expand all") + "</button></div>";
    return '<div class="af-bar" id="af-bar">' + head + '<div class="af-rows">' + rows + "</div>" +
      '<div class="af-foot"><span class="af-count" role="status">' + (n ? "Showing " + shown + " of " + total : W.plural(total, "item")) + "</span>" +
      (n ? '<button type="button" class="af-clear" id="af-clear">Clear filters</button>' : "") + sort + "</div></div>";
  }

  function itemRow(it) {
    var dir = !W.acceptsRequests(gemach); // directory, coming soon: browse only
    var id = esc(it.id);
    var photo = it.photoUrl && W.safeUrl(it.photoUrl) ? it.photoUrl : null;
    var thumb = photo
      ? '<button type="button" class="item-thumb" data-photo="' + id + '" aria-label="View ' + (photoList(it).length > 1 ? photoList(it).length + " photos" : "photo") + " of " + esc(it.name) + '"><img src="' + esc(photo) + '" alt="" loading="lazy" width="92" height="72" />' +
        (photoList(it).length > 1 ? '<span class="thumb-count" aria-hidden="true">' + W.ICONS.photo + photoList(it).length + "</span>" : "") + "</button>"
      : '<div class="item-thumb" aria-hidden="true">' + W.ICONS.photo + "</div>";
    var attrs = shownDefs().map(function (d) {
      var v = itemVals(it, d.name);
      return v.length ? '<span class="ia"><span class="ia-k">' + esc(d.name) + "</span> " + esc(v.join(", ")) + "</span>" : "";
    }).filter(Boolean).join("");
    attrs = attrs ? '<div class="item-attrs">' + attrs + "</div>" : "";
    var units = isAddon(it) ? '<div class="item-units">Made to order · paid separately' + (dir ? "" : " · choose how many when you request") + "</div>"
      : typeof it.totalUnits === "number" && it.totalUnits > 0 && !dir
      ? '<div class="item-units">' + (isQty(it) ? it.totalUnits : W.plural(it.totalUnits, "unit")) + " in the gemach" +
        (pkgSize(it) > 1 ? " · " + esc(pkgPhrase(it)) : "") +
        (isQty(it) ? " · choose how many when you request" : "") + "</div>" : "";
    var desc = it.description
      ? '<button type="button" class="item-desc-toggle" aria-expanded="false" aria-controls="desc-' + id + '"><span class="arr" aria-hidden="true">▸</span> Details</button>' +
        '<div class="item-desc" id="desc-' + id + '" hidden>' + esc(it.description).replace(/\r?\n/g, "<br>") + "</div>"
      : "";
    var sel = selected.has(it.id);
    var check = dir ? "" :
      '<label class="item-check"><input type="checkbox" data-id="' + id + '"' + (sel ? " checked" : "") +
      ' aria-label="Select ' + esc(it.name) + '" /></label>';
    return '<li class="item-row' + (dir ? "" : " selectable") + (sel ? " selected" : "") + '" id="row-' + id + '" data-id="' + id + '">' +
      thumb +
      '<div class="item-content"><div class="item-top"><div><div class="item-name">' + esc(it.name) + newTag(it) + "</div>" + bylineHtml(it, "item-byline") + attrs + units + "</div>" +
      availBadge(it) + "</div>" + desc + "</div>" + check + "</li>";
  }

  // ── Item views: List (rows), Grid (photo tiles), Photos (large, swipe through an item's photos) ──
  var VIEWS = ["List", "Grid", "Photos"];
  var VIEW_ICONS = {
    List: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="6" height="6" rx="1"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 6h8M13 9h5M13 16h8M13 19h5"/></svg>',
    Grid: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
    Photos: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="3" width="16" height="14" rx="1.5"/><path d="M8 21h8"/></svg>'
  };
  var VIEW_NAMES = { List: "List", Grid: "Grid", Photos: "Large photos" };
  function anyPhotos() { return items.some(function (it) { return photoList(it).length > 0; }); }
  function viewKey() { return "whg_view:" + (gemach && gemach.slug || ""); }
  /** The visitor's own choice (remembered per gemach on this device), else the gemach's default. No photos at all: List. */
  function currentView() {
    if (!anyPhotos()) return "List";
    var v = null;
    try { v = localStorage.getItem(viewKey()); } catch (e) { /* ignore */ }
    if (VIEWS.indexOf(v) !== -1) return v;
    return gemach && VIEWS.indexOf(gemach.itemView) !== -1 ? gemach.itemView : "List";
  }
  function viewSwitcher(v) {
    if (!anyPhotos()) return "";
    return '<div class="view-seg" role="group" aria-label="Show items as">' + VIEWS.map(function (x) {
      return '<button type="button" class="view-btn" data-view="' + x + '" aria-pressed="' + (x === v) + '" aria-label="' + VIEW_NAMES[x] + '" title="' + VIEW_NAMES[x] + '">' + VIEW_ICONS[x] + "</button>";
    }).join("") + "</div>";
  }
  function attrsLine(it) {
    var v = shownDefs().map(function (d) { var x = itemVals(it, d.name); return x.length ? d.name + " " + x.join(", ") : ""; }).filter(Boolean);
    return v.length ? '<div class="tile-attrs">' + esc(v.join(" · ")) + "</div>" : "";
  }
  function checkBox(it, cls) {
    return '<label class="item-check' + (cls ? " " + cls : "") + '"><input type="checkbox" data-id="' + esc(it.id) + '"' + (selected.has(it.id) ? " checked" : "") +
      ' aria-label="Select ' + esc(it.name) + '" /></label>';
  }
  function itemTile(it) {
    var dir = !W.acceptsRequests(gemach), id = esc(it.id), list = photoList(it), n = list.length, sel = selected.has(it.id);
    var media = n
      ? '<button type="button" class="tile-photo" data-photo="' + id + '" aria-label="View ' + (n > 1 ? n + " photos" : "photo") + " of " + esc(it.name) + '"><img src="' + esc(list[0]) + '" alt="" loading="lazy" /></button>' +
        (n > 1 ? '<span class="tile-count" aria-hidden="true">' + W.ICONS.photo + n + "</span>" : "")
      : '<div class="tile-photo tile-nophoto" aria-hidden="true">' + W.ICONS.photo + "</div>";
    return '<li class="item-tile' + (dir ? "" : " selectable") + (sel ? " selected" : "") + '" id="row-' + id + '" data-id="' + id + '">' +
      '<div class="tile-media">' + media + (dir ? "" : checkBox(it, "tile-check")) + "</div>" +
      '<div class="tile-name">' + esc(it.name) + newTag(it) + "</div>" + bylineHtml(it, "tile-byline") + attrsLine(it) +
      '<div class="tile-meta">' + availBadge(it) + "</div></li>";
  }
  function itemPost(it) {
    var dir = !W.acceptsRequests(gemach), id = esc(it.id), list = photoList(it), n = list.length, sel = selected.has(it.id);
    var media = n
      ? '<div class="post-track">' + list.map(function (u, k) {
          return '<button type="button" class="post-photo" data-photo="' + id + '" data-pi="' + k + '" aria-label="View ' + esc(it.name) + (n > 1 ? ", photo " + (k + 1) + " of " + n : "") + '">' +
            '<img src="' + esc(u) + '" alt="" loading="lazy" /></button>';
        }).join("") + "</div>" +
        (n > 1 ? '<span class="post-num" aria-hidden="true">1/' + n + "</span>" +
          '<button type="button" class="post-nav prev" data-step="-1" aria-label="Previous photo" hidden>‹</button>' +
          '<button type="button" class="post-nav next" data-step="1" aria-label="Next photo">›</button>' : "")
      : '<div class="post-nophoto" aria-hidden="true">' + W.ICONS.photo + "</div>";
    var dots = n > 1 ? '<div class="post-dots" aria-hidden="true">' + list.map(function (_, k) { return "<span" + (k ? "" : ' class="on"') + "></span>"; }).join("") + "</div>" : "";
    var units = isAddon(it) ? '<div class="item-units">Made to order · paid separately</div>'
      : typeof it.totalUnits === "number" && it.totalUnits > 0 && !dir
      ? '<div class="item-units">' + (isQty(it) ? it.totalUnits : W.plural(it.totalUnits, "unit")) + " in the gemach" + (pkgSize(it) > 1 ? " · " + esc(pkgPhrase(it)) : "") + "</div>" : "";
    var d = it.description ? String(it.description) : "";
    var long = d.length > 110 || /\n/.test(d);
    var desc = d ? '<p class="post-desc' + (long ? " clamp" : "") + '" id="desc-' + id + '">' + esc(d).replace(/\r?\n/g, "<br>") + "</p>" +
      (long ? '<button type="button" class="post-more" aria-controls="desc-' + id + '" aria-expanded="false">more</button>' : "") : "";
    var add = dir ? "" : '<label class="post-add"><input type="checkbox" data-id="' + id + '"' + (sel ? " checked" : "") + ' aria-label="Add ' + esc(it.name) + ' to your request" />' +
      '<span class="pa-off" aria-hidden="true">+ Add to request</span><span class="pa-on" aria-hidden="true">✓ Added to your request</span></label>';
    return '<li class="item-post' + (sel ? " selected" : "") + '" id="row-' + id + '" data-id="' + id + '">' +
      '<div class="post-media">' + media + "</div>" + dots +
      '<div class="post-body"><div class="item-top"><div class="item-name">' + esc(it.name) + newTag(it) + "</div>" + availBadge(it) + "</div>" +
      bylineHtml(it, "item-byline") + attrsLine(it) + units + desc + add + "</div></li>";
  }
  function updateTrack(tr) {
    var post = tr.closest(".item-post");
    if (!post || !tr.clientWidth) return;
    var n = tr.children.length, i = Math.max(0, Math.min(n - 1, Math.round(tr.scrollLeft / tr.clientWidth)));
    var num = post.querySelector(".post-num"); if (num) num.textContent = (i + 1) + "/" + n;
    var dots = post.querySelectorAll(".post-dots span");
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle("on", k === i);
    var prev = post.querySelector(".post-nav.prev"), next = post.querySelector(".post-nav.next");
    if (prev) prev.hidden = i === 0;
    if (next) next.hidden = i === n - 1;
  }

  function renderInventory() {
    var dir = !W.acceptsRequests(gemach);
    var soon = W.isComingSoon(gemach) && !W.isDirectory(gemach);
    var html = "";
    if (!items.length) {
      if (formUrl()) return formNotice();
      if (borrowNote()) return borrowNoteHtml();
      html = '<div class="notice notice-info">' + (dir
        ? "Please contact this gemach directly to borrow — use the call, WhatsApp or email buttons above."
        : "This gemach hasn’t listed its items online yet. Please contact them directly using the buttons above.") + "</div>";
      return html;
    }
    // group by category (in category displayOrder); uncategorized last
    var byCat = {}, order = [];
    categories.forEach(function (c, i) { byCat[c.id] = { c: c, items: [], i: i }; });
    var other = { c: { name: "Other", icon: "📦" }, items: [], i: 9999 };
    var addons = { c: { name: "Add-ons (for purchase)", icon: "🛍" }, items: [], i: 10000 };
    // Drop filter picks that no longer match anything offered.
    var defs = usableDefs();
    Object.keys(attrFilter).forEach(function (k) {
      var d = defs.filter(function (x) { return x.name === k; })[0];
      attrFilter[k] = d ? attrFilter[k].filter(function (v) { return d.values.indexOf(v) !== -1; }) : [];
      if (!attrFilter[k].length) delete attrFilter[k];
    });
    var scoped = pool();
    var listed = scoped.filter(passesFilter);
    if (sortBySize && sizeDef()) {
      listed = listed.map(function (it, i) { return { it: it, i: i, r: sizeRank(it) }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.it; });
    }
    var counted = scoped.filter(function (it) { return !isAddon(it); });
    var gd = groupDef();
    if (gd) { // sections by the gemach's chosen filter, in its order (an item with several values goes under the first)
      var shelves = gd.values.map(function (v, i) { return { c: { name: v }, items: [], i: i, shelf: true }; });
      other = { c: { name: "More" }, items: [], i: 9999, shelf: true };
      listed.forEach(function (it) {
        if (isAddon(it)) { addons.items.push(it); return; }
        var best = -1;
        itemVals(it, gd.name).forEach(function (v) { var j = gd.values.indexOf(v); if (j !== -1 && (best === -1 || j < best)) best = j; });
        (best === -1 ? other : shelves[best]).items.push(it);
      });
      shelves.forEach(function (s) { if (s.items.length) order.push(s); });
    } else {
      listed.forEach(function (it) {
        var b = isAddon(it) ? addons : it.categoryId && byCat[it.categoryId] ? byCat[it.categoryId] : other;
        b.items.push(it);
      });
      Object.keys(byCat).forEach(function (k) { if (byCat[k].items.length) order.push(byCat[k]); });
    }
    if (other.items.length) order.push(other);
    if (addons.items.length) order.push(addons);
    var showHeads = order.length > 1 || order[0] !== other || !!gd;

    var st = style(), view = currentView();
    html += '<div class="inv-head"><div class="inv-title"><h2 class="section-title" id="inv-title" tabindex="-1">Gemach Inventory</h2>' +
      (dir || st === "Appointment" ? "" : '<span class="section-sub">Availability updates in real time</span>') + "</div>" + viewSwitcher(view) + "</div>";
    var help = {
      Dates: "Tap the items you need, then send one request. Items on loan can still be requested — the gemach will let you know.",
      Event: "Tap the items you need, then send one request with your " + esc(eventLabel().toLowerCase()) + ". Items on loan can still be requested — the gemach will let you know.",
      Appointment: "Browse the collection, then request an appointment to come see it in person. Selecting items you’d like to see is optional."
    };
    html += soon
      ? '<p class="inv-help">A preview of what this gemach will lend. It isn’t taking requests online yet — contact them using the buttons above.</p>'
      : formUrl()
      ? formNotice()
      : borrowNote()
      ? borrowNoteHtml()
      : dir
      ? '<div class="notice">This gemach is listed in our directory. To borrow, contact them directly using the buttons above.</div>'
      : '<p class="inv-help">' + help[st] + "</p>";
    html += scopeNote(counted.length);
    html += stripsHtml();
    html += filterBar(defs, listed.filter(function (it) { return !isAddon(it); }).length, counted.length);
    if (gd && order.length > 1) {
      html += '<nav class="shelf-nav" aria-label="Jump to a section">' + order.map(function (b, k) {
        return '<a class="shelf-link" href="#sec-' + k + '" data-sec="' + k + '">' + esc(b.c.name) + ' <span class="shelf-n">' + b.items.length + "</span></a>";
      }).join("") + "</nav>";
    }
    if (activeFilterCount() && !listed.some(function (it) { return !isAddon(it); })) {
      html += '<div class="notice notice-info af-none">Nothing matches these filters. <button type="button" class="af-clear" id="af-clear-2">Clear filters</button></div>';
    }
    html += order.map(function (b, k) {
      if (b.shelf) {
        return '<section class="cat-block shelf-block" id="sec-' + k + '" aria-labelledby="sec-h-' + k + '"><h3 id="sec-h-' + k + '">' + esc(b.c.name) +
          ' <span class="shelf-n">' + b.items.length + "</span></h3>" +
          '<ul class="item-list' + (view === "List" ? "" : " item-" + view.toLowerCase()) + '">' +
          b.items.map(view === "Grid" ? itemTile : view === "Photos" ? itemPost : itemRow).join("") + "</ul></section>";
      }
      return '<section class="cat-block" aria-label="' + esc(b.c.name) + '">' +
        (showHeads ? '<h3><span class="ci" aria-hidden="true">' + esc(b.c.icon || "•") + "</span>" + esc(b.c.name) + "</h3>" : "") +
        '<ul class="item-list' + (view === "List" ? "" : " item-" + view.toLowerCase()) + '">' +
        b.items.map(view === "Grid" ? itemTile : view === "Photos" ? itemPost : itemRow).join("") + "</ul></section>";
    }).join("");
    return html;
  }

  function render() {
    renderHeader();
    // drop selections that no longer exist / directory mode
    var ids = new Set(items.map(function (i) { return i.id; }));
    selected.forEach(function (id) { if (!ids.has(id) || !W.acceptsRequests(gemach)) selected.delete(id); });
    if (W.isInfoOnly(gemach)) { // Info only: a large info box with contact details; no items, no requests
      $("g-body").innerHTML = comingSoonBanner() + infoOnlyBox() + infoPanel();
      updateCTA();
      return;
    }
    $("g-body").innerHTML = comingSoonBanner() + infoPanel() + gemachInfoSection() +
      '<div id="inv-wrap"' + (gemach && gemach.photoShape === "Portrait" ? ' class="photos-portrait"' : "") + ">" + renderInventory() + "</div>";
    updateCTA();
    handleType();
  }

  function handleType() {
    if (typeHandled || !wantType || !items.length) return;
    var it = items.filter(function (i) { return i.id === wantType; })[0];
    if (!it) { typeHandled = loadedFresh; return; }
    typeHandled = true;
    if (W.acceptsRequests(gemach)) { selected.add(it.id); syncRow(it.id); updateCTA(); }
    requestAnimationFrame(function () { flashRow(it.id); });
  }

  function renderNotFound() {
    document.title = "Gemach not found — West Hempstead Gemachs";
    $("g-head").innerHTML = "<h1>We couldn’t find that gemach</h1>" +
      '<p class="tagline">The link may be out of date, or the gemach may no longer be listed.</p>';
    $("g-body").innerHTML = '<div class="empty-state">' +
      '<div class="big" aria-hidden="true">🧭</div><h3>Let’s get you back on track</h3>' +
      "<p>Browse all the gemachs in West Hempstead, or search for the item you need.</p>" +
      '<p><a class="btn btn-primary" href="/">See all gemachs</a></p>' +
      '<p>Think something’s wrong? Email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></div>";
    var m = document.createElement("meta"); m.name = "robots"; m.content = "noindex"; document.head.appendChild(m);
  }

  function renderLoadError() {
    $("g-head").innerHTML = "<h1>Something went wrong</h1><p class=\"tagline\">We couldn’t load this gemach right now.</p>";
    $("g-body").innerHTML = '<div class="empty-state"><div class="big" aria-hidden="true">📡</div>' +
      "<h3>Please try again</h3><p>Check your connection and reload the page.</p>" +
      '<p><button type="button" class="btn btn-primary" id="retry">Try again</button></p>' +
      '<p>Or email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></div>";
    $("retry").addEventListener("click", function () { location.reload(); });
  }

  // ── Selection ──
  function syncRow(id) {
    var row = document.getElementById("row-" + id);
    if (!row) return;
    var on = selected.has(id);
    row.classList.toggle("selected", on);
    var chk = row.querySelector('input[type="checkbox"]');
    if (chk) chk.checked = on;
  }
  /** Network → Analytics counts which items people look at (not on test-link pages). */
  function trackItem(kind, id) {
    if (testToken || !gemach || !W.track) return;
    W.track({ kind: kind, gemach: gemach.slug || slug, item: id });
  }
  function toggleItem(id, force) {
    var on = typeof force === "boolean" ? force : !selected.has(id);
    if (on) { selected.add(id); trackItem("item-pick", id); } else selected.delete(id);
    syncRow(id);
    updateCTA();
  }
  function updateCTA() {
    var form = formUrl();
    if (form) { // Listing only + request form: the bar just opens the gemach's form
      $("cta-count").textContent = "Found what you need?";
      $("cta-suffix").hidden = true;
      $("cta-clear").hidden = true;
      $("sticky-cta").classList.add("visible", "always");
      document.body.classList.add("has-cta");
      $("btn-open-modal").textContent = "Open the request form";
      return;
    }
    $("sticky-cta").classList.remove("always");
    var n = selected.size;
    var appt = W.acceptsRequests(gemach) && style() === "Appointment";
    $("cta-count").textContent = appt && !n ? "Visit by appointment" : (n === 1 ? "1 item" : n + " items");
    $("cta-suffix").hidden = appt && !n;
    $("cta-clear").hidden = n === 0;
    var cta = $("sticky-cta");
    var show = n > 0 || appt;
    cta.classList.toggle("visible", show);
    cta.classList.toggle("always", appt && n === 0);
    document.body.classList.toggle("has-cta", show);
    $("btn-open-modal").textContent = appt ? "Request an appointment" : "Request selected items";
  }
  function eventLabel() {
    var l = gemach && typeof gemach.eventLabel === "string" ? gemach.eventLabel.trim() : "";
    return l || "Event date";
  }

  function rerenderInventory(focusSel) {
    var wrap = $("inv-wrap");
    if (!wrap) return;
    wrap.innerHTML = renderInventory();
    if (focusSel) { var f = wrap.querySelector(focusSel); if (f) f.focus(); }
  }
  $("g-body").addEventListener("change", function (e) {
    if (e.target.id !== "af-sort") return;
    sortBySize = e.target.value === "size";
    rerenderInventory("#af-sort");
  });

  $("g-body").addEventListener("click", function (e) {
    var t = e.target;
    var chip = t.closest(".af-chip");
    if (chip) {
      var d = usableDefs()[Number(chip.getAttribute("data-fa"))];
      if (!d) return;
      var v = d.values[Number(chip.getAttribute("data-fv"))];
      var list = attrFilter[d.name] || [];
      attrFilter[d.name] = list.indexOf(v) !== -1 ? list.filter(function (x) { return x !== v; }) : list.concat([v]);
      rerenderInventory('.af-chip[data-fa="' + chip.getAttribute("data-fa") + '"][data-fv="' + chip.getAttribute("data-fv") + '"]');
      return;
    }
    var fold = t.closest(".af-name[data-fold]");
    if (fold) {
      var fd = usableDefs()[Number(fold.getAttribute("data-fold"))];
      if (!fd) return;
      setOpen(fd.name, fold.getAttribute("aria-expanded") !== "true");
      rerenderInventory('.af-name[data-fold="' + fold.getAttribute("data-fold") + '"]');
      return;
    }
    var all = t.closest("#af-all");
    if (all) {
      saveOpen(all.getAttribute("data-open") === "1" ? usableDefs().map(function (d) { return d.name; }) : []);
      rerenderInventory("#af-all");
      return;
    }
    if (t.closest(".af-clear")) { attrFilter = {}; rerenderInventory("#af-bar .af-chip"); return; }
    if (t.closest("#scope-clear")) { clearScope(); rerenderInventory("#inv-title"); return; }
    var jump = t.closest("[data-jump]");
    if (jump) { e.preventDefault(); flashRow(jump.getAttribute("data-jump")); return; }
    var vb = t.closest(".view-btn");
    if (vb) {
      var v = vb.getAttribute("data-view");
      try { localStorage.setItem(viewKey(), v); } catch (err) { /* ignore */ }
      rerenderInventory('.view-btn[data-view="' + v + '"]');
      return;
    }
    var nav = t.closest(".post-nav");
    if (nav) {
      var tr = nav.parentNode.querySelector(".post-track");
      if (tr) tr.scrollBy({ left: Number(nav.getAttribute("data-step")) * tr.clientWidth, behavior: "smooth" });
      return;
    }
    var more = t.closest(".post-more");
    if (more) {
      var pd = document.getElementById(more.getAttribute("aria-controls"));
      var open = more.getAttribute("aria-expanded") !== "true";
      if (pd) pd.classList.toggle("clamp", !open);
      more.setAttribute("aria-expanded", open ? "true" : "false");
      more.textContent = open ? "less" : "more";
      return;
    }
    var photoBtn = t.closest("[data-photo]");
    if (photoBtn) {
      var it = items.filter(function (i) { return i.id === photoBtn.getAttribute("data-photo"); })[0];
      if (it) {
        openLightbox(photoList(it), it.name, photoBtn, Number(photoBtn.getAttribute("data-pi")) || 0, it.description);
        trackItem("item-photos", it.id);
      }
      return;
    }
    var descBtn = t.closest(".item-desc-toggle");
    if (descBtn) {
      var d = document.getElementById(descBtn.getAttribute("aria-controls"));
      var open = descBtn.getAttribute("aria-expanded") !== "true";
      descBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (d) d.hidden = !open;
      return;
    }
    if (t.closest("a, button")) return;
    var chk = t.closest('input[type="checkbox"][data-id]');
    if (chk) { toggleItem(chk.getAttribute("data-id"), chk.checked); return; }
    if (t.closest(".item-check, .post-add")) return; // label click forwards to checkbox
    var row = t.closest(".item-row.selectable, .item-tile.selectable");
    if (row) toggleItem(row.getAttribute("data-id"));
  });

  var trackRaf = 0;
  $("g-body").addEventListener("scroll", function (e) {
    var tr = e.target;
    if (!tr.classList || !tr.classList.contains("post-track")) return;
    cancelAnimationFrame(trackRaf);
    trackRaf = requestAnimationFrame(function () { updateTrack(tr); });
  }, true);

  $("cta-clear").addEventListener("click", function () {
    var ids = Array.from(selected); selected.clear();
    ids.forEach(syncRow); updateCTA();
  });

  // ── Dialog helpers (focus trap / escape) ──
  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }
  function trap(e, root) {
    if (e.key !== "Tab") return;
    var f = focusables(root);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function lockScroll(on) { document.documentElement.style.overflow = on ? "hidden" : ""; }

  // ── Donate pop-up (only when the gemach has donation text) ──
  var donateModal = null;
  function openDonate(opener) {
    var g = gemach || {};
    var don = W.safeUrl(g.donationUrl);
    if (!donateModal) {
      donateModal = document.createElement("div");
      donateModal.className = "modal-overlay";
      donateModal.id = "donate-modal";
      donateModal.hidden = true;
      donateModal.innerHTML = '<div class="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="donate-title">' +
        '<button type="button" class="modal-close" id="donate-close" aria-label="Close">×</button>' +
        '<h2 id="donate-title">Support this gemach</h2>' +
        '<div class="donation-info" id="donate-body"></div><div class="donate-actions" id="donate-actions"></div></div>';
      document.body.appendChild(donateModal);
      $("donate-close").addEventListener("click", closeDonate);
      donateModal.addEventListener("click", function (e) { if (e.target === donateModal) closeDonate(); });
      donateModal.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDonate(); trap(e, donateModal); });
    }
    $("donate-title").textContent = "Support " + (g.name || "this gemach");
    $("donate-body").innerHTML = W.formatRich(g.donationInfo);
    $("donate-actions").innerHTML = don
      ? '<a class="btn btn-primary" href="' + esc(don) + '" target="_blank" rel="noopener">' + W.ICONS.heart + "Donate online</a>"
      : "";
    lastFocus = opener || document.activeElement;
    donateModal.hidden = false; donateModal.classList.add("open"); lockScroll(true);
    setTimeout(function () { $("donate-close").focus(); }, 30);
  }
  function closeDonate() {
    if (!donateModal) return;
    donateModal.classList.remove("open"); donateModal.hidden = true; lockScroll(false);
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#btn-donate");
    if (b) openDonate(b);
  });

  // ── Lightbox ──
  var lb = $("lightbox");
  // ── Photo viewer: one photo or a gallery (swipe / arrows / ← → keys) ──
  /** An item's photos in order (cover first); only our own safe links. */
  function photoList(it) {
    var list = Array.isArray(it.photos) && it.photos.length ? it.photos : (it.photoUrl ? [it.photoUrl] : []);
    return list.filter(function (u) { return W.safeUrl(u); });
  }
  var gal = { list: [], i: 0, name: "" };
  function showPhoto(i) {
    var n = gal.list.length;
    gal.i = (i + n) % n;
    $("lightbox-img").src = gal.list[gal.i];
    $("lightbox-img").alt = gal.name + (n > 1 ? " — photo " + (gal.i + 1) + " of " + n : "");
    $("lightbox-count").textContent = n > 1 ? (gal.i + 1) + " of " + n : "";
    var dots = $("lightbox-dots").children;
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle("on", k === gal.i);
    if (n > 1) { var pre = new Image(); pre.src = gal.list[(gal.i + 1) % n]; } // next one ready
  }
  function openLightbox(list, name, opener, start, desc) {
    lastFocus = opener || document.activeElement;
    gal = { list: Array.isArray(list) ? list : [list], i: 0, name: name };
    var many = gal.list.length > 1;
    $("lightbox-caption").textContent = name;
    // The item's description under its name (text only; line breaks kept by CSS).
    var d = typeof desc === "string" ? desc.trim() : "";
    $("lightbox-desc").textContent = d;
    $("lightbox-desc").hidden = !d;
    lb.classList.toggle("has-desc", !!d);
    $("lightbox-prev").hidden = $("lightbox-next").hidden = !many;
    $("lightbox-dots").innerHTML = many ? gal.list.map(function () { return "<span></span>"; }).join("") : "";
    showPhoto(Math.min(start || 0, gal.list.length - 1));
    lb.hidden = false; lb.classList.add("open"); lockScroll(true);
    document.body.classList.add("lb-open");
    (many ? $("lightbox-next") : $("lightbox-close")).focus();
  }
  function closeLightbox() {
    lb.classList.remove("open"); lb.hidden = true; lockScroll(false);
    document.body.classList.remove("lb-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("lightbox-close").addEventListener("click", closeLightbox);
  $("lightbox-prev").addEventListener("click", function () { showPhoto(gal.i - 1); });
  $("lightbox-next").addEventListener("click", function () { showPhoto(gal.i + 1); });
  lb.addEventListener("click", function (e) {
    if (e.target === lb) closeLightbox();
    else if (e.target === $("lightbox-img") && gal.list.length < 2) closeLightbox(); // with a gallery, tapping the photo doesn't close it
  });
  // Keys work while the viewer is open even if focus has left it (e.g. after tapping the photo).
  document.addEventListener("keydown", function (e) {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight" && gal.list.length > 1) { e.preventDefault(); showPhoto(gal.i + 1); }
    else if (e.key === "ArrowLeft" && gal.list.length > 1) { e.preventDefault(); showPhoto(gal.i - 1); }
    else if (e.key === "Tab" && !lb.contains(document.activeElement)) { e.preventDefault(); $("lightbox-close").focus(); }
    else trap(e, lb);
  });
  // Swipe left / right on phones
  var touchX = null, touchY = null;
  lb.addEventListener("touchstart", function (e) { if (e.touches.length === 1) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; } }, { passive: true });
  lb.addEventListener("touchend", function (e) {
    if (touchX === null || gal.list.length < 2) return;
    var dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) showPhoto(gal.i + (dx < 0 ? 1 : -1));
  });

  // ── Modal ──
  var modal = $("modal");
  function openModal() {
    if (!W.acceptsRequests(gemach)) return;
    lastFocus = document.activeElement;
    var st = style();
    var appt = st === "Appointment";
    $("modal-title").textContent = appt ? "Request an appointment" : "Request from " + gemach.name;
    $("modal-subtitle").textContent = appt
      ? "Tell " + gemach.name + " when you’d like to come. They’ll contact you to confirm a time."
      : "The gemach will contact you to confirm and arrange pickup.";
    configureForm(st);
    var label = function (it) {
      var on = selected.has(it.id);
      var out = !appt && !isAddon(it) && !(it.availableCount > 0);
      return '<label class="item-check-label' + (on ? " checked" : "") + '">' +
        '<input type="checkbox" name="modal-items" value="' + esc(it.id) + '"' + (on ? " checked" : "") + " />" +
        "<span>" + esc(it.name) + (out ? "<small>Currently on loan</small>" : "") +
        (isAddon(it) ? "<small>Add-on" + (it.price != null ? " · " + money(it.price) + " each" : "") + "</small>" : "") + "</span></label>";
    };
    var chosen = items.filter(function (it) { return selected.has(it.id); });
    var rest = items.filter(function (it) { return !selected.has(it.id); });
    $("modal-items-grid").innerHTML =
      (chosen.length ? '<div class="items-grid">' + chosen.map(label).join("") + "</div>" : "") +
      (rest.length ? (chosen.length || appt
        ? '<details class="items-more"><summary>' + (chosen.length ? "Add more items" : "Choose items you’d like to see") + '</summary><div class="items-grid">' + rest.map(label).join("") + "</div></details>"
        : '<div class="items-grid">' + rest.map(label).join("") + "</div>") : "");
    renderQty();
    prefillMe();
    $("form-view").hidden = false;
    $("success-view").hidden = true;
    hideError();
    tsLoad().then(tsMount); // spam check starts while they fill in the form
    var btn = $("btn-submit"); btn.disabled = false; btn.textContent = submitLabel();
    modal.hidden = false; modal.classList.add("open"); lockScroll(true);
    setTimeout(function () { if (!modal.contains(document.activeElement) || document.activeElement === modal) $("f-name").focus(); }, 30);
  }
  // ── Remember me (opt-in, unchecked by default) ──
  function prefillMe() {
    var d = W.me.load();
    $("remember-saved").hidden = !d;
    if (!d) return;
    $("f-remember").checked = true;
    if (!$("f-name").value) $("f-name").value = d.name || "";
    if (!$("f-phone").value) $("f-phone").value = d.phone || "";
    if (!$("f-email").value) $("f-email").value = d.email || "";
    if (!$("f-contact").value && d.preferredContact && $("f-contact").querySelector('option[value="' + d.preferredContact.replace(/[^A-Za-z]/g, "") + '"]')) $("f-contact").value = d.preferredContact;
    updateEmailReq();
  }
  $("forget-me").addEventListener("click", function () {
    W.me.forget();
    ["f-name", "f-phone", "f-email"].forEach(function (id) { $(id).value = ""; });
    $("f-contact").value = "";
    $("f-remember").checked = false;
    $("remember-saved").hidden = true;
    updateEmailReq();
    $("f-name").focus();
  });

  function closeModal() {
    modal.classList.remove("open"); modal.hidden = true; lockScroll(false);
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  $("btn-open-modal").addEventListener("click", function (e) {
    var form = formUrl();
    if (form) { window.open(form, "_blank", "noopener"); return; }
    openModal(e);
  });
  $("modal-close").addEventListener("click", closeModal);
  $("success-done").addEventListener("click", closeModal);
  $("manage-copy").addEventListener("click", function () {
    var url = $("manage-link").href, btn = $("manage-copy");
    var done = function (ok) { btn.textContent = ok ? "Copied ✓" : "Copy failed — long-press the button above"; };
    try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
  });
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  modal.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); trap(e, modal); });
  $("modal-items-grid").addEventListener("change", function (e) {
    var cb = e.target;
    if (cb.name !== "modal-items") return;
    cb.closest("label").classList.toggle("checked", cb.checked);
    toggleItem(cb.value, cb.checked);
    renderQty();
  });
  $("qty-list").addEventListener("change", function (e) { if (e.target.tagName === "SELECT") onQtyInput(e); });
  $("qty-list").addEventListener("input", onQtyInput);
  function onQtyInput(e) {
    var id = e.target.getAttribute("data-qty");
    if (!id) return;
    qtyVals[id] = e.target.value;
    if (e.target.getAttribute("aria-invalid") === "true") clearFieldError(e.target);
    updateQtyNotes();
  }
  ["f-from", "f-until", "f-event"].forEach(function (id) {
    $(id).addEventListener("input", updateQtyNotes);
    $(id).addEventListener("change", updateQtyNotes);
  });

  function submitLabel() { return style() === "Appointment" ? "Send appointment request" : "Send request"; }
  var NOTES_PH = $("f-notes").getAttribute("placeholder");
  function configureForm(st) {
    var appt = st === "Appointment", ev = st === "Event";
    $("items-legend").innerHTML = appt
      ? 'Items I’d like to see <span class="opt">(optional)</span>'
      : 'Items requested <span class="req" aria-hidden="true">*</span>';
    $("dates-group").hidden = st !== "Dates";
    $("appt-group").hidden = !appt;
    $("event-group").hidden = !(ev || appt);
    $("event-label").textContent = eventLabel();
    $("event-req").hidden = !ev;
    $("event-opt").hidden = !appt;
    var fe = $("f-event");
    fe.min = W.todayNY(); fe.max = W.maxEventDate();
    fe.required = ev;
    updateDateMins();
    updateEmailReq();
    $("f-times").required = appt;
    var dep = !!gemach.depositRequired;
    $("deposit-group").hidden = !dep;
    $("f-deposit").required = dep;
    if (dep) $("deposit-form-info").innerHTML = depositHtml(gemach);
    $("deposit-ack-text").textContent = isPayment(gemach) ? "I understand payment is required" : "I understand a deposit is required";
    $("form-note-purpose").textContent = appt ? "your appointment" : "the loan";
    $("f-notes").setAttribute("placeholder", appt ? "e.g. sizes, colors or styles you’re interested in"
      : ev ? "e.g. anything specific you’re looking for" : NOTES_PH);
    updateEventSummary();
  }
  function updateEventSummary() {
    var box = $("event-summary");
    var v = $("f-event").value;
    var w = style() === "Event" && v ? W.eventWindow(v, gemach) : null;
    if (!w) { box.hidden = true; box.textContent = ""; return; }
    box.innerHTML = "<span>Pick up <b>" + esc(W.fmtDay(w.pickup)) + "</b></span> <span aria-hidden=\"true\">·</span> <span>Return <b>" + esc(W.fmtDay(w.ret)) + "</b></span>";
    box.hidden = false;
  }
  $("f-event").addEventListener("input", updateEventSummary);
  $("f-event").addEventListener("change", updateEventSummary);
  function checkEventDate(v, required) {
    if (!v) return required ? "Please enter your " + eventLabel().toLowerCase() + "." : "";
    if (!W.parseYMD(v)) return "Please enter a valid date.";
    if (v < W.todayNY()) return "The " + eventLabel().toLowerCase() + " can’t be in the past.";
    if (v > W.maxEventDate()) return "The " + eventLabel().toLowerCase() + " must be within the next 2 years.";
    return "";
  }

  // ── Dates style: live min/max ──
  function updateDateMins() {
    var today = W.todayNY(), max = W.maxEventDate();
    var f = $("f-from"), u = $("f-until");
    f.min = today; f.max = max;
    var from = W.parseYMD(f.value) && f.value >= today ? f.value : today;
    u.min = W.addDaysYMD(from, 1);
  }
  $("f-from").addEventListener("input", updateDateMins);
  $("f-from").addEventListener("change", updateDateMins);

  // ── Email becomes required when it's the best way to reach you ──
  function updateEmailReq() {
    var need = $("f-contact").value === "Email";
    $("email-opt").hidden = need;
    $("email-req").hidden = !need;
    $("f-email").required = need;
  }
  $("f-contact").addEventListener("change", function () {
    updateEmailReq();
    if ($("f-contact").value !== "Email" && !$("f-email").value.trim()) clearFieldError($("f-email"));
  });

  // ── Phone: format as you type / paste, and on blur ──
  var phone = $("f-phone");
  phone.addEventListener("input", function (e) {
    if (e.inputType && /^delete/.test(e.inputType)) return;   // don't fight deletions
    var raw = phone.value;
    var caret = typeof phone.selectionStart === "number" ? phone.selectionStart : raw.length;
    var atEnd = caret >= raw.length;
    var out = W.formatPhone(raw);
    if (out === raw) return;
    var digitsBefore = raw.slice(0, caret).replace(/\D/g, "").length;
    if (raw.replace(/\D/g, "").length > out.replace(/\D/g, "").length) digitsBefore = Math.max(0, digitsBefore - 1); // dropped leading 1
    phone.value = out;
    var pos = out.length;
    if (!atEnd) {
      pos = 0;
      for (var seen = 0; pos < out.length && seen < digitsBefore; pos++) if (/\d/.test(out.charAt(pos))) seen++;
    }
    try { phone.setSelectionRange(pos, pos); } catch (err) { /* some input types disallow */ }
  });
  phone.addEventListener("blur", function () {
    var out = W.formatPhone(phone.value.trim());
    if (out !== phone.value) phone.value = out;
  });

  // ── Inline field errors ──
  function errAnchor(field) {
    if (field.id === "f-deposit") return $("deposit-group");
    if (field.name === "modal-items") return $("items-group");
    if (field.hasAttribute && field.hasAttribute("data-qty")) return field.closest(".qty-row");
    return field.closest(".form-group") || field.parentNode;
  }
  function errKey(field) { return field.name === "modal-items" ? "items" : field.id; }
  function setFieldError(field, msg) {
    var key = errKey(field), id = "err-" + key;
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("p");
      el.className = "field-error"; el.id = id;
      errAnchor(field).appendChild(el);
    }
    el.innerHTML = W.ICONS.info + esc(msg);
    el.hidden = false;
    var targets = field.name === "modal-items" ? modal.querySelectorAll('input[name="modal-items"]') : [field];
    Array.prototype.forEach.call(targets, function (t) {
      if (t.name !== "modal-items") t.setAttribute("aria-invalid", "true");
      var db = (t.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (db.indexOf(id) < 0) { db.push(id); t.setAttribute("aria-describedby", db.join(" ")); }
    });
    if (field.id === "f-deposit") $("deposit-line").classList.add("invalid");
    if (field.name === "modal-items") $("items-group").classList.add("invalid");
  }
  function clearFieldError(field) {
    var key = errKey(field), id = "err-" + key;
    var el = document.getElementById(id);
    if (el) el.remove();
    var targets = field.name === "modal-items" ? modal.querySelectorAll('input[name="modal-items"]') : [field];
    Array.prototype.forEach.call(targets, function (t) {
      t.removeAttribute("aria-invalid");
      var db = (t.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (x) { return x && x !== id; });
      if (db.length) t.setAttribute("aria-describedby", db.join(" ")); else t.removeAttribute("aria-describedby");
    });
    if (field.id === "f-deposit") $("deposit-line").classList.remove("invalid");
    if (field.name === "modal-items") $("items-group").classList.remove("invalid");
  }

  function showError(msg) {
    var el = $("error-msg"); el.textContent = msg; el.hidden = false;
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }
  function hideError() {
    $("error-msg").hidden = true;
    var errs = modal.querySelectorAll(".field-error");
    for (var i = errs.length - 1; i >= 0; i--) errs[i].remove();
    $("deposit-line").classList.remove("invalid");
    $("items-group").classList.remove("invalid");
    var inv = modal.querySelectorAll("[aria-describedby]");
    for (var j = 0; j < inv.length; j++) {
      var db = inv[j].getAttribute("aria-describedby").split(/\s+/).filter(function (x) { return x && x.indexOf("err-") !== 0; });
      if (db.length) inv[j].setAttribute("aria-describedby", db.join(" ")); else inv[j].removeAttribute("aria-describedby");
    }
    var bad = modal.querySelectorAll('[aria-invalid="true"]');
    for (var k = 0; k < bad.length; k++) bad[k].removeAttribute("aria-invalid");
  }

  function gemachContactLine() {
    var bits = [];
    if (gemach.phone) bits.push(gemach.phone);
    if (gemach.email) bits.push(gemach.email);
    return bits.length ? " You can also reach the gemach at " + bits.join(" or ") + "." : " Please email " + W.CONTACT_EMAIL + ".";
  }

  function onFieldEdit(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.name === "modal-items") { if (modal.querySelector('input[name="modal-items"]:checked')) clearFieldError(t); }
    else if (t.getAttribute("aria-invalid") === "true" || t.id === "f-deposit") clearFieldError(t);
    if (t.id === "f-from" && $("f-until").getAttribute("aria-invalid") === "true") clearFieldError($("f-until"));
    $("error-msg").hidden = true;
  }
  $("form-view").addEventListener("input", onFieldEdit);
  $("form-view").addEventListener("change", onFieldEdit);

  /** Validate everything, show all inline errors, focus the first. Returns the request body or null. */
  function validate() {
    var errs = [];
    function bad(field, msg) { errs.push(field); setFieldError(field, msg); }
    var st = style();
    var name = $("f-name").value.trim();
    var ph = W.formatPhone($("f-phone").value.trim());
    if (ph !== $("f-phone").value) $("f-phone").value = ph;
    var email = $("f-email").value.trim();
    var preferredContact = $("f-contact").value;
    var notes = $("f-notes").value.trim();
    var ids = Array.prototype.map.call(modal.querySelectorAll('input[name="modal-items"]:checked'), function (cb) { return cb.value; });

    if (!name) bad($("f-name"), "Please enter your name.");
    var pe = W.phoneError(ph);
    if (pe) bad($("f-phone"), pe);
    if (!preferredContact) bad($("f-contact"), "Please choose the best way to reach you.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad($("f-email"), "That email address doesn’t look right.");
    else if (preferredContact === "Email" && !email) bad($("f-email"), "Please add your email, since that’s the best way to reach you.");

    var body = { gemach: gemach.slug || slug, name: name, phone: ph, itemsRequested: ids };
    var firstItem = modal.querySelector('input[name="modal-items"]');
    if (st !== "Appointment" && !ids.length && firstItem) bad(firstItem, "Please select at least one item.");
    if (st !== "Appointment") {
      var quantities = {};
      Array.prototype.forEach.call($("qty-list").querySelectorAll("[data-qty]"), function (inp) {
        var it = items.filter(function (x) { return x.id === inp.getAttribute("data-qty"); })[0];
        if (!it || ids.indexOf(it.id) < 0) return;
        var v = inp.value.trim(), n = +v;
        if (!v) bad(inp, "How many " + it.name + " do you need?");
        else if (pkgSize(it) > 1 && n % pkgSize(it)) bad(inp, "Please choose " + pkgSize(it) + ", " + (pkgSize(it) * 2) + "…");
        else if (!/^\d+$/.test(v) || n < 1) bad(inp, "Please enter a whole number, 1 or more.");
        else if (isAddon(it) && n > 500) bad(inp, "Please enter 500 or fewer.");
        else if (!isAddon(it) && it.totalUnits && n > it.totalUnits) bad(inp, "The gemach has " + it.totalUnits + " " + it.name + " in total.");
        else quantities[it.id] = n;
      });
      if (Object.keys(quantities).length) body.quantities = quantities;
    }

    if (st === "Appointment") {
      var times = $("f-times").value.trim();
      var party = $("f-party").value.trim();
      var evA = $("f-event").value;
      if (!times) bad($("f-times"), "Please let the gemach know when you’d like to come.");
      if (party && !(/^\d+$/.test(party) && +party >= 1 && +party <= 20)) bad($("f-party"), "Number of people should be between 1 and 20.");
      var errA = checkEventDate(evA, false);
      if (errA) bad($("f-event"), errA);
      body.preferredTimes = times;
      if (party) body.partySize = +party;
      if (evA) body.eventDate = evA;
    } else if (st === "Event") {
      var evE = $("f-event").value;
      var errE = checkEventDate(evE, true);
      if (errE) bad($("f-event"), errE);
      body.eventDate = evE;
    } else {
      var from = $("f-from").value, until = $("f-until").value;
      var today = W.todayNY();
      var fromOk = false;
      if (!from) bad($("f-from"), $("f-from").validity && $("f-from").validity.badInput ? "Please enter a valid date." : "Please choose the date you need it from.");
      else if (!W.parseYMD(from)) bad($("f-from"), "Please enter a valid date.");
      else if (from < today) bad($("f-from"), "This date is in the past — please choose today or later.");
      else if (from > W.maxEventDate()) bad($("f-from"), "Please choose a date within the next 2 years.");
      else fromOk = true;
      if (until) {
        if (!W.parseYMD(until)) bad($("f-until"), "Please enter a valid date.");
        else if (fromOk && until <= from) bad($("f-until"), "The return date needs to be after " + W.fmtDay(from) + ".");
      } else if ($("f-until").validity && $("f-until").validity.badInput) bad($("f-until"), "Please enter a valid date.");
      body.openEnded = !until;
      if (from) body.neededFrom = from;
      if (until) body.neededUntil = until;
    }
    if (gemach.depositRequired && !$("deposit-group").hidden) {
      if (!$("f-deposit").checked) bad($("f-deposit"), isPayment(gemach) ? "Please confirm you understand payment is required." : "Please confirm you understand a deposit is required.");
      body.depositAck = true;
    }
    if (errs.length) {
      var f = errs[0];
      if (f.name === "modal-items") { var d = f.closest("details"); if (d) d.open = true; }
      f.focus();
      if (f.scrollIntoView) f.scrollIntoView({ block: "center" });
      return null;
    }
    if (email) body.email = email;
    var hp = $("f-hp"); if (hp && hp.value) body.website = hp.value; // hidden field only bots fill in
    if (inTestMode()) body.testToken = testToken;
    body.preferredContact = preferredContact;
    if (notes) body.notes = notes;
    return body;
  }

  $("form-view").addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();
    var st = style();
    var body = validate();
    if (!body) return;

    var btn = $("btn-submit");
    btn.disabled = true; btn.textContent = "Sending…";

    tsToken().then(function (tok) {
      if (ts.key && !tok) {
        var te = new Error(ts.failed
          ? "The security check couldn’t load (an ad blocker can cause this). Please allow challenges.cloudflare.com, or try another browser."
          : "The security check under the form hasn’t finished yet — please wait a moment and send again.");
        te.status = 400; throw te;
      }
      if (tok) body.turnstileToken = tok;
      return W.fetchJSON("/submit-request", { method: "POST", body: body, retry: false, timeout: 20000 });
    }).then(function (data) {
      if (!data || !data.success) throw new Error((data && data.error) || "failed");
      var link = typeof data.manageUrl === "string" && /^https:\/\//.test(data.manageUrl) ? data.manageUrl : null;
      if ($("f-remember").checked) {
        W.me.save({ name: body.name, phone: $("f-phone").value.trim(), email: body.email || "", preferredContact: body.preferredContact });
        if (link) W.me.addRequest({ url: link, gemach: gemach.name, requestId: data.requestId });
      } else if (W.me.load()) {
        W.me.forget(); // they unticked "Remember me"
      }
      $("manage-box").hidden = !link;
      if (link) {
        $("manage-link").href = link;
        $("manage-copy").textContent = "Copy link";
        $("manage-hint").textContent = (body.email ? "We also emailed it to you. " : "Save it — bookmark it or send it to yourself. ") + "Please don’t share it.";
      }
      $("form-view").hidden = true;
      $("success-view").hidden = false;
      if (st === "Appointment") {
        $("success-title").textContent = "Appointment request sent";
        $("success-text").textContent = "Thank you! " + gemach.name + " will contact you to confirm a time.";
      } else {
        $("success-title").textContent = "Request sent";
        $("success-text").textContent = "Thank you! " + gemach.name + " will be in touch to confirm and arrange pickup.";
      }
      if (data.test) $("success-text").textContent += " (This was a test request — it isn’t a real loan.)";
      $("success-title").focus();
      var had = Array.from(selected); selected.clear(); had.forEach(syncRow); updateCTA();
      qtyVals = {};
      $("form-view").reset(); updateEventSummary(); updateEmailReq(); updateDateMins();
      $("qty-list").innerHTML = ""; $("qty-group").hidden = true;
      W.clearDirCache();
      refresh();
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = submitLabel();
      if (err && err.status >= 400 && err.status < 500 && err.message) showError(err.message + gemachContactLine());
      else showError("We couldn’t send your request." + gemachContactLine());
    }).then(tsReset); // a token works once: get a fresh one for the next send
  });

  // ── Spam protection: Cloudflare Turnstile ──
  // Only once the worker has its keys (GET /public/config gives the site key). The widget is invisible unless
  // Cloudflare wants the visitor to tick a box; the form waits up to 15 s for its token when they press Send.
  var ts = { key: null, id: null, token: null, waiters: [], loading: false, failed: false, config: null };
  function tsLoad() { // asked once, when the form is first opened (most visitors never open it)
    return ts.config || (ts.config = W.fetchJSON("/public/config").then(function (c) {
      ts.key = c && typeof c.turnstileSiteKey === "string" && c.turnstileSiteKey ? c.turnstileSiteKey : null;
    }).catch(function () { ts.config = null; /* try again next time; meanwhile send without a token (the worker decides) */ }));
  }
  function tsMount() {
    if (!ts.key || ts.id !== null || ts.loading) return;
    var box = $("ts-box");
    if (!box) return;
    ts.loading = true;
    var render = function () {
      ts.loading = false;
      try {
        ts.id = window.turnstile.render(box, {
          sitekey: ts.key, action: "request", appearance: "interaction-only", theme: "light",
          callback: function (t) { ts.token = t; var w = ts.waiters; ts.waiters = []; w.forEach(function (f) { f(t); }); },
          "expired-callback": function () { ts.token = null; },
          "error-callback": function () { ts.token = null; },
        });
      } catch (e) { ts.failed = true; }
    };
    if (window.turnstile) { render(); return; }
    var sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    sc.async = true;
    sc.onload = render;
    sc.onerror = function () { ts.loading = false; ts.failed = true; var w = ts.waiters; ts.waiters = []; w.forEach(function (f) { f(null); }); };
    document.head.appendChild(sc);
  }
  function tsToken() {
    return tsLoad().then(tsTokenNow);
  }
  function tsTokenNow() {
    if (!ts.key) return Promise.resolve(null);
    tsMount();
    if (ts.token) return Promise.resolve(ts.token);
    if (ts.failed) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 15000);
      ts.waiters.push(function (t) { if (!done) { done = true; clearTimeout(timer); resolve(t); } });
    });
  }
  function tsReset() {
    ts.token = null;
    if (ts.id !== null && window.turnstile) { try { window.turnstile.reset(ts.id); } catch (e) { /* ignore */ } }
  }

  // ── Data ──
  function fromDirectory() {
    var d = W.readDirCache();
    if (!d) return false;
    var g = (d.gemachs || []).filter(function (x) { return String(x.slug).toLowerCase() === slug; })[0];
    if (!g) return false;
    gemach = g; items = g.items || []; categories = d.categories || [];
    render();
    return true;
  }
  function refresh() {
    return W.fetchJSON("/public/gemach/" + encodeURIComponent(slug) + (testToken ? "?test=" + encodeURIComponent(testToken) : "")).then(function (d) {
      if (!d || !d.gemach) { var e = new Error("bad"); e.status = 404; throw e; }
      if (d.gemach.testMode && !document.querySelector('meta[name="robots"]')) {
        var m = document.createElement("meta"); m.name = "robots"; m.content = "noindex"; document.head.appendChild(m);
      }
      gemach = d.gemach; items = Array.isArray(d.items) ? d.items : []; categories = Array.isArray(d.categories) ? d.categories : [];
      loadedFresh = true;
      render();
    });
  }

  if (!slug) { renderNotFound(); return; }
  var hadCache = testToken ? false : fromDirectory(); // test link: wait for the test-mode page instead
  refresh().catch(function (err) {
    if (err && err.status === 404) { gemach = null; renderNotFound(); return; }
    if (!hadCache) { renderLoadError(); if (W.loadFailed) W.loadFailed("gemach"); }
  });
})();
