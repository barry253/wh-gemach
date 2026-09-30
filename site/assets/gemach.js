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
  var typeHandled = false;

  var gemach = null, items = [], categories = [];
  var selected = new Set();
  var attrFilter = {};        // { "Size": ["8","10"] } — values picked in the filter bar
  var sortBySize = false;
  var lastFocus = null;
  var loadedFresh = false;

  // ── Render ──
  function contactButtons(g) {
    var acts = W.contactActions(g);
    if (acts) {
      if (!acts.length) return "";
      return '<div class="contact-row">' + acts.map(function (a) {
        return '<a class="btn btn-on-dark' + (a.primary ? " btn-solid" : "") + '" href="' + esc(a.href) + '"' +
          (a.ext ? ' target="_blank" rel="noopener"' : "") + ' data-contact="' + a.type + '">' + W.ICONS[a.icon] + a.label + "</a>";
      }).join("") + "</div>";
    }
    var out = [];
    var tel = W.telHref(g.phone), wa = W.waHref(g.whatsapp);
    if (tel) out.push('<a class="btn btn-on-dark btn-solid" href="' + tel + '">' + W.ICONS.phone + "Call</a>");
    if (wa) out.push('<a class="btn btn-on-dark" href="' + wa + '" target="_blank" rel="noopener">' + W.ICONS.whatsapp + "WhatsApp</a>");
    if (g.email) out.push('<a class="btn btn-on-dark" href="mailto:' + esc(g.email) + '">' + W.ICONS.mail + "Email</a>");
    return out.length ? '<div class="contact-row">' + out.join("") + "</div>" : "";
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
  function logoHtml(g) {
    var dark = W.safeUrl(g.logoDarkUrl), light = W.safeUrl(g.logoUrl);
    if (dark && dark.indexOf("https:") !== 0) dark = null;
    if (dark) return '<img class="g-logo g-logo-bare" src="' + esc(dark) + '" alt="' + esc(g.name) + '" width="48" height="48" decoding="async" />';
    if (light) return '<img class="g-logo" src="' + esc(light) + '" alt="' + esc(g.name) + '" width="56" height="56" decoding="async" />';
    return '<span class="g-logo g-logo-initials" aria-hidden="true">' + esc(W.initials(g)) + "</span>";
  }

  function renderHeader() {
    var g = gemach;
    applyTheme(g);
    applyFavicon(g);
    $("g-head").innerHTML =
      (g.category ? '<span class="chip">' + esc(g.category) + "</span>" : "") +
      (W.isComingSoon(g) ? '<span class="chip chip-soon">Coming soon</span>' : "") +
      '<div class="g-lockup">' + logoHtml(g) +
        '<div class="g-lockup-text"><h1 class="g-name">' + nameHtml(g) + "</h1>" +
        (g.tagline ? '<p class="tagline">' + esc(g.tagline) + "</p>" : "") + "</div></div>" +
      contactButtons(g);
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
    var contact = [];
    var acts = W.contactActions(g);
    if (acts) {
      acts.forEach(function (a) {
        var shown = a.type === "Email" ? g.email : (a.type === "WhatsApp" ? (g.whatsapp || g.phone) : g.phone);
        contact.push('<span class="info-sub">' + esc(a.label) + ':</span> <a href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(shown) + "</a>");
      });
    } else if (g.phone) { var tel = W.telHref(g.phone); contact.push(tel ? '<a href="' + tel + '">' + esc(g.phone) + "</a>" : esc(g.phone)); }
    if (!acts && g.whatsapp && W.waHref(g.whatsapp) && W.telHref(g.whatsapp) !== W.telHref(g.phone)) {
      contact.push('WhatsApp: <a href="' + W.waHref(g.whatsapp) + '" target="_blank" rel="noopener">' + esc(g.whatsapp) + "</a>");
    }
    if (!acts && g.email) contact.push('<a href="mailto:' + esc(g.email) + '">' + esc(g.email) + "</a>");
    if (contact.length && !W.isInfoOnly(g)) side.push('<div><div class="info-label">Contact</div><div>' + contact.join("<br>") + "</div></div>"); // Info only: already in the big box
    var web = W.safeUrl(g.website);
    if (web) side.push('<div><div class="info-label">Website</div><a href="' + esc(web) + '" target="_blank" rel="noopener">' + esc(W.prettyUrl(web)) + "</a></div>");
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
    var have = Array.prototype.map.call(list.querySelectorAll("input[data-qty]"), function (i) { return i.getAttribute("data-qty"); }).join(",");
    if (have !== qi.map(function (it) { return it.id; }).join(",")) {
      list.innerHTML = qi.map(function (it) {
        var id = esc(it.id);
        return '<div class="qty-row"><label for="q-' + id + '">' + esc(it.name) + "</label>" +
          '<input type="number" id="q-' + id + '" data-qty="' + id + '" min="1" max="' + (isAddon(it) ? 500 : (it.totalUnits || 1)) + '" step="1" inputmode="numeric" value="' + esc(qtyVals[it.id] || (isAddon(it) ? "1" : "")) + '" aria-describedby="qn-' + id + '" />' +
          '<p class="qty-note" id="qn-' + id + '" aria-live="polite"></p></div>';
      }).join("");
    }
    group.hidden = false;
    updateQtyNotes();
  }
  function updateQtyNotes() {
    var w = formWindow();
    Array.prototype.forEach.call($("qty-list").querySelectorAll("input[data-qty]"), function (inp) {
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
      note.textContent = txt;
      note.classList.toggle("warn", warn);
    });
  }
  function style() { return W.requestStyle(gemach); }

  function isPayment(g) { return !!g && g.chargeType === "Payment"; } // a fee, not a refundable deposit
  function depositHtml(g) {
    return "<strong>" + W.ICONS.info + (isPayment(g) ? "Payment required" : "Deposit required") + "</strong>" +
      (g.depositInfo ? '<div class="prose">' + W.formatText(g.depositInfo) + "</div>" : "");
  }
  function gemachInfoSection() {
    var g = gemach;
    if (!isV3(g)) return "";
    var parts = [];
    if (g.depositRequired) parts.push('<div class="deposit-callout" role="note">' + depositHtml(g) + "</div>");
    if (g.hours) parts.push('<div class="ginfo-row">' + W.ICONS.clock + '<div><div class="info-label">Hours</div><div>' + esc(g.hours).replace(/\r?\n/g, "<br>") + "</div></div></div>");
    var info = W.formatText(g.gemachInfo);
    if (info) parts.push('<div class="prose">' + info + "</div>");
    if (!parts.length) return "";
    return '<section class="ginfo" aria-labelledby="ginfo-title"><h2 id="ginfo-title">Gemach Info</h2>' + parts.join("") + "</section>";
  }

  function comingSoonBanner() {
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
      var shown = a.type === "Email" ? g.email : (a.type === "WhatsApp" ? (g.whatsapp || g.phone) : g.phone);
      return '<a class="btn' + (a.primary ? " btn-primary" : (a.type === "WhatsApp" ? " btn-wa" : "")) + '" href="' + esc(a.href) + '"' +
        (a.ext ? ' target="_blank" rel="noopener"' : "") + ">" + W.ICONS[a.icon] + esc(a.label) + (shown ? ' <span class="io-detail">' + esc(shown) + "</span>" : "") + "</a>";
    }).join("");
    var rows = [];
    if (g.hours) rows.push('<div class="ginfo-row">' + W.ICONS.clock + '<div><div class="info-label">Hours</div><div>' + esc(g.hours).replace(/\r?\n/g, "<br>") + "</div></div></div>");
    if (g.depositRequired) rows.push('<div class="deposit-callout" role="note">' + depositHtml(g) + "</div>");
    return '<section class="info-only" aria-labelledby="io-title"><h2 id="io-title">How this gemach works</h2>' +
      (info ? '<div class="prose io-prose">' + info + "</div>" : '<p class="io-prose">Contact the gemach using the buttons below.</p>') +
      rows.join("") + (btns ? '<div class="io-actions">' + btns + "</div>" : "") + "</section>";
  }

  function availBadge(it) {
    if (W.isComingSoon(gemach)) return "";
    if (W.isDirectory(gemach)) return '<span class="badge badge-dir">Contact to check</span>';
    if (isAddon(it)) return '<span class="badge badge-addon">Add-on' + (it.price != null ? " · " + money(it.price) : "") + "</span>";
    if (style() === "Appointment") return "";
    var n = Math.max(0, it.availableCount || 0);
    return n > 0 ? '<span class="badge badge-ok">' + n + " available</span>"
                 : '<span class="badge badge-out">All on loan</span>';
  }

  // ── Item filters (gemach-defined, e.g. Size / Color) ──
  function attrDefs() { return (gemach && Array.isArray(gemach.itemAttributes)) ? gemach.itemAttributes : []; }
  function itemVals(it, name) { return (it.attributes && it.attributes[name]) || []; }
  function sizeDef() { return attrDefs().filter(function (d) { return /size/i.test(d.name); })[0] || null; }
  /** Filters worth showing: only values that some (non add-on) item actually has, in the gemach's order. */
  function usableDefs() {
    return attrDefs().map(function (d) {
      var used = {};
      items.forEach(function (it) { if (!isAddon(it)) itemVals(it, d.name).forEach(function (v) { used[v] = 1; }); });
      return { name: d.name, values: d.values.filter(function (v) { return used[v]; }) };
    }).filter(function (d) { return d.values.length; });
  }
  function passesFilter(it) {
    if (isAddon(it)) return true; // add-ons aren't sized/colored; always listed
    return Object.keys(attrFilter).every(function (name) {
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
  function filterBar(defs, shown, total) {
    if (!defs.length) return "";
    var sd = sizeDef();
    var rows = defs.map(function (d, i) {
      var on = attrFilter[d.name] || [];
      return '<div class="af-row" role="group" aria-label="Filter by ' + esc(d.name) + '"><span class="af-name">' + esc(d.name) + "</span>" +
        '<div class="af-chips">' + d.values.map(function (v, j) {
          var pressed = on.indexOf(v) !== -1;
          return '<button type="button" class="af-chip" data-fa="' + i + '" data-fv="' + j + '" aria-pressed="' + pressed + '">' + esc(v) + "</button>";
        }).join("") + "</div></div>";
    }).join("");
    var n = activeFilterCount();
    var sort = sd && defs.some(function (d) { return d.name === sd.name; })
      ? '<label class="af-sort">Sort <select id="af-sort"><option value="">As listed</option><option value="size"' + (sortBySize ? " selected" : "") + ">By " + esc(sd.name.toLowerCase()) + ", smallest first</option></select></label>" : "";
    return '<div class="af-bar" id="af-bar">' + rows +
      '<div class="af-foot"><span class="af-count" role="status">' + (n ? "Showing " + shown + " of " + total : W.plural(total, "item")) + "</span>" +
      (n ? '<button type="button" class="af-clear" id="af-clear">Clear filters</button>' : "") + sort + "</div></div>";
  }

  function itemRow(it) {
    var dir = !W.acceptsRequests(gemach); // directory, coming soon: browse only
    var id = esc(it.id);
    var photo = it.photoUrl && W.safeUrl(it.photoUrl) ? it.photoUrl : null;
    var thumb = photo
      ? '<button type="button" class="item-thumb" data-photo="' + id + '" aria-label="View photo of ' + esc(it.name) + '"><img src="' + esc(photo) + '" alt="" loading="lazy" width="92" height="72" /></button>'
      : '<div class="item-thumb" aria-hidden="true">' + W.ICONS.photo + "</div>";
    var attrs = attrDefs().map(function (d) {
      var v = itemVals(it, d.name);
      return v.length ? '<span class="ia"><span class="ia-k">' + esc(d.name) + "</span> " + esc(v.join(", ")) + "</span>" : "";
    }).filter(Boolean).join("");
    attrs = attrs ? '<div class="item-attrs">' + attrs + "</div>" : "";
    var units = isAddon(it) ? '<div class="item-units">Made to order · paid separately' + (dir ? "" : " · choose how many when you request") + "</div>"
      : typeof it.totalUnits === "number" && it.totalUnits > 0 && !dir
      ? '<div class="item-units">' + (isQty(it) ? it.totalUnits : W.plural(it.totalUnits, "unit")) + " in the gemach" +
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
      '<div class="item-content"><div class="item-top"><div><div class="item-name">' + esc(it.name) + "</div>" + attrs + units + "</div>" +
      availBadge(it) + "</div>" + desc + "</div>" + check + "</li>";
  }

  function renderInventory() {
    var dir = !W.acceptsRequests(gemach);
    var soon = W.isComingSoon(gemach) && !W.isDirectory(gemach);
    var html = "";
    if (!items.length) {
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
    var listed = items.filter(passesFilter);
    if (sortBySize && sizeDef()) {
      listed = listed.map(function (it, i) { return { it: it, i: i, r: sizeRank(it) }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.it; });
    }
    var counted = items.filter(function (it) { return !isAddon(it); });
    listed.forEach(function (it) {
      var b = isAddon(it) ? addons : it.categoryId && byCat[it.categoryId] ? byCat[it.categoryId] : other;
      b.items.push(it);
    });
    Object.keys(byCat).forEach(function (k) { if (byCat[k].items.length) order.push(byCat[k]); });
    if (other.items.length) order.push(other);
    if (addons.items.length) order.push(addons);
    var showHeads = order.length > 1 || order[0] !== other;

    var st = style();
    html += '<div class="inv-head"><h2 class="section-title">' + (dir || st !== "Dates" ? "Items" : "Equipment") + "</h2>" +
      (dir || st === "Appointment" ? "" : '<span class="section-sub">Availability updates in real time</span>') + "</div>";
    var help = {
      Dates: "Tap the items you need, then send one request. Items on loan can still be requested — the gemach will let you know.",
      Event: "Tap the items you need, then send one request with your " + esc(eventLabel().toLowerCase()) + ". Items on loan can still be requested — the gemach will let you know.",
      Appointment: "Browse the collection, then request an appointment to come see it in person. Selecting items you’d like to see is optional."
    };
    html += soon
      ? '<p class="inv-help">A preview of what this gemach will lend. It isn’t taking requests online yet — contact them using the buttons above.</p>'
      : dir
      ? '<div class="notice">This gemach is listed in our directory. To borrow, contact them directly using the buttons above.</div>'
      : '<p class="inv-help">' + help[st] + "</p>";
    html += filterBar(defs, listed.filter(function (it) { return !isAddon(it); }).length, counted.length);
    if (activeFilterCount() && !listed.some(function (it) { return !isAddon(it); })) {
      html += '<div class="notice notice-info af-none">Nothing matches these filters. <button type="button" class="af-clear" id="af-clear-2">Clear filters</button></div>';
    }
    html += order.map(function (b) {
      return '<section class="cat-block" aria-label="' + esc(b.c.name) + '">' +
        (showHeads ? '<h3><span class="ci" aria-hidden="true">' + esc(b.c.icon || "•") + "</span>" + esc(b.c.name) + "</h3>" : "") +
        '<ul class="item-list">' + b.items.map(itemRow).join("") + "</ul></section>";
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
    $("g-body").innerHTML = comingSoonBanner() + infoPanel() + gemachInfoSection() + '<div id="inv-wrap">' + renderInventory() + "</div>";
    updateCTA();
    handleType();
  }

  function handleType() {
    if (typeHandled || !wantType || !items.length) return;
    var it = items.filter(function (i) { return i.id === wantType; })[0];
    if (!it) { typeHandled = loadedFresh; return; }
    typeHandled = true;
    if (W.acceptsRequests(gemach)) { selected.add(it.id); syncRow(it.id); updateCTA(); }
    var row = document.getElementById("row-" + it.id);
    if (row) {
      requestAnimationFrame(function () {
        row.scrollIntoView({ block: "center", behavior: "auto" });
        row.classList.add("flash");
        setTimeout(function () { row.classList.remove("flash"); }, 2400);
      });
    }
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
  function toggleItem(id, force) {
    var on = typeof force === "boolean" ? force : !selected.has(id);
    if (on) selected.add(id); else selected.delete(id);
    syncRow(id);
    updateCTA();
  }
  function updateCTA() {
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
    if (t.closest(".af-clear")) { attrFilter = {}; rerenderInventory("#af-bar .af-chip"); return; }
    var photoBtn = t.closest("[data-photo]");
    if (photoBtn) {
      var it = items.filter(function (i) { return i.id === photoBtn.getAttribute("data-photo"); })[0];
      if (it) openLightbox(it.photoUrl, it.name, photoBtn);
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
    if (t.closest(".item-check")) return; // label click forwards to checkbox
    var row = t.closest(".item-row.selectable");
    if (row) toggleItem(row.getAttribute("data-id"));
  });

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
  function openLightbox(url, name, opener) {
    lastFocus = opener || document.activeElement;
    $("lightbox-img").src = url;
    $("lightbox-img").alt = name;
    $("lightbox-caption").textContent = name;
    lb.hidden = false; lb.classList.add("open"); lockScroll(true);
    $("lightbox-close").focus();
  }
  function closeLightbox() {
    lb.classList.remove("open"); lb.hidden = true; lockScroll(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("lightbox-close").addEventListener("click", closeLightbox);
  lb.addEventListener("click", function (e) { if (e.target === lb || e.target === $("lightbox-img")) closeLightbox(); });
  lb.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLightbox(); trap(e, lb); });

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
  $("btn-open-modal").addEventListener("click", openModal);
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
  $("qty-list").addEventListener("input", function (e) {
    var id = e.target.getAttribute("data-qty");
    if (!id) return;
    qtyVals[id] = e.target.value;
    if (e.target.getAttribute("aria-invalid") === "true") clearFieldError(e.target);
    updateQtyNotes();
  });
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
      Array.prototype.forEach.call($("qty-list").querySelectorAll("input[data-qty]"), function (inp) {
        var it = items.filter(function (x) { return x.id === inp.getAttribute("data-qty"); })[0];
        if (!it || ids.indexOf(it.id) < 0) return;
        var v = inp.value.trim(), n = +v;
        if (!v) bad(inp, "How many " + it.name + " do you need?");
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

    W.fetchJSON("/submit-request", { method: "POST", body: body, retry: false, timeout: 20000 }).then(function (data) {
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
    });
  });

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
    return W.fetchJSON("/public/gemach/" + encodeURIComponent(slug)).then(function (d) {
      if (!d || !d.gemach) { var e = new Error("bad"); e.status = 404; throw e; }
      gemach = d.gemach; items = Array.isArray(d.items) ? d.items : []; categories = Array.isArray(d.categories) ? d.categories : [];
      loadedFresh = true;
      render();
    });
  }

  if (!slug) { renderNotFound(); return; }
  var hadCache = fromDirectory();
  refresh().catch(function (err) {
    if (err && err.status === 404) { gemach = null; renderNotFound(); return; }
    if (!hadCache) renderLoadError();
  });
})();
