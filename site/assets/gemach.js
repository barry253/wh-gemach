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
  var openEnded = false;
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
    if (v) Object.keys(v).forEach(function (k) { root.style.setProperty(k, v[k]); appliedVars.push(k); });
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

  function renderHeader() {
    var g = gemach;
    applyTheme(g);
    applyFavicon(g);
    var logo = W.safeUrl(g.logoUrl);
    var h1 = "<h1>" + esc(g.name) + "</h1>";
    $("g-head").innerHTML =
      (g.category ? '<span class="chip">' + esc(g.category) + "</span>" : "") +
      (logo ? '<div class="g-title"><img class="g-logo" src="' + esc(logo) + '" alt="' + esc(g.name) + '" width="80" height="80" decoding="async" />' + h1 + "</div>" : h1) +
      (g.tagline ? '<p class="tagline">' + esc(g.tagline) + "</p>" : "") +
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
    if (contact.length) side.push('<div><div class="info-label">Contact</div><div>' + contact.join("<br>") + "</div></div>");
    var web = W.safeUrl(g.website);
    if (web) side.push('<div><div class="info-label">Website</div><a href="' + esc(web) + '" target="_blank" rel="noopener">' + esc(W.prettyUrl(web)) + "</a></div>");
    var don = W.safeUrl(g.donationUrl);
    if (don) side.push('<div><div class="info-label">Support this gemach</div><a class="btn btn-sm" href="' + esc(don) + '" target="_blank" rel="noopener">' + W.ICONS.heart + "Donate</a></div>");
    if (!desc && !side.length) return "";
    return '<section class="info-panel' + (desc && side.length ? " has-side" : "") + '" aria-label="About this gemach">' +
      (desc ? '<div class="prose">' + desc + "</div>" : "") +
      (side.length ? '<div class="info-side">' + side.join("") + "</div>" : "") + "</section>";
  }

  function isV3(g) { return !!g && ("requestStyle" in g || "depositRequired" in g || "gemachInfo" in g); }
  function style() { return W.requestStyle(gemach); }

  function depositHtml(g) {
    return "<strong>" + W.ICONS.info + "Deposit required</strong>" +
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

  function availBadge(it) {
    if (W.isDirectory(gemach)) return '<span class="badge badge-dir">Contact to check</span>';
    if (style() === "Appointment") return "";
    var n = Math.max(0, it.availableCount || 0);
    return n > 0 ? '<span class="badge badge-ok">' + n + " available</span>"
                 : '<span class="badge badge-out">All on loan</span>';
  }

  function itemRow(it) {
    var dir = W.isDirectory(gemach);
    var id = esc(it.id);
    var photo = it.photoUrl && W.safeUrl(it.photoUrl) ? it.photoUrl : null;
    var thumb = photo
      ? '<button type="button" class="item-thumb" data-photo="' + id + '" aria-label="View photo of ' + esc(it.name) + '"><img src="' + esc(photo) + '" alt="" loading="lazy" width="92" height="72" /></button>'
      : '<div class="item-thumb" aria-hidden="true">' + W.ICONS.photo + "</div>";
    var units = typeof it.totalUnits === "number" && it.totalUnits > 0 && !dir
      ? '<div class="item-units">' + W.plural(it.totalUnits, "unit") + " in the gemach</div>" : "";
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
      '<div class="item-content"><div class="item-top"><div><div class="item-name">' + esc(it.name) + "</div>" + units + "</div>" +
      availBadge(it) + "</div>" + desc + "</div>" + check + "</li>";
  }

  function renderInventory() {
    var dir = W.isDirectory(gemach);
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
    items.forEach(function (it) {
      var b = it.categoryId && byCat[it.categoryId] ? byCat[it.categoryId] : other;
      b.items.push(it);
    });
    Object.keys(byCat).forEach(function (k) { if (byCat[k].items.length) order.push(byCat[k]); });
    if (other.items.length) order.push(other);
    var showHeads = order.length > 1 || order[0] !== other;

    var st = style();
    html += '<div class="inv-head"><h2 class="section-title">' + (dir || st !== "Dates" ? "Items" : "Equipment") + "</h2>" +
      (dir || st === "Appointment" ? "" : '<span class="section-sub">Availability updates in real time</span>') + "</div>";
    var help = {
      Dates: "Tap the items you need, then send one request. Items on loan can still be requested — the gemach will let you know.",
      Event: "Tap the items you need, then send one request with your " + esc(eventLabel().toLowerCase()) + ". Items on loan can still be requested — the gemach will let you know.",
      Appointment: "Browse the collection, then request an appointment to come see it in person. Selecting items you’d like to see is optional."
    };
    html += dir
      ? '<div class="notice">This gemach is listed in our directory. To borrow, contact them directly using the buttons above.</div>'
      : '<p class="inv-help">' + help[st] + "</p>";
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
    selected.forEach(function (id) { if (!ids.has(id) || W.isDirectory(gemach)) selected.delete(id); });
    $("g-body").innerHTML = infoPanel() + gemachInfoSection() + renderInventory();
    updateCTA();
    handleType();
  }

  function handleType() {
    if (typeHandled || !wantType || !items.length) return;
    var it = items.filter(function (i) { return i.id === wantType; })[0];
    if (!it) { typeHandled = loadedFresh; return; }
    typeHandled = true;
    if (!W.isDirectory(gemach)) { selected.add(it.id); syncRow(it.id); updateCTA(); }
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
    var appt = !!gemach && style() === "Appointment";
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

  $("g-body").addEventListener("click", function (e) {
    var t = e.target;
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
      var out = !appt && !(it.availableCount > 0);
      return '<label class="item-check-label' + (on ? " checked" : "") + '">' +
        '<input type="checkbox" name="modal-items" value="' + esc(it.id) + '"' + (on ? " checked" : "") + " />" +
        "<span>" + esc(it.name) + (out ? "<small>Currently on loan</small>" : "") + "</span></label>";
    };
    var chosen = items.filter(function (it) { return selected.has(it.id); });
    var rest = items.filter(function (it) { return !selected.has(it.id); });
    $("modal-items-grid").innerHTML =
      (chosen.length ? '<div class="items-grid">' + chosen.map(label).join("") + "</div>" : "") +
      (rest.length ? (chosen.length || appt
        ? '<details class="items-more"><summary>' + (chosen.length ? "Add more items" : "Choose items you’d like to see") + '</summary><div class="items-grid">' + rest.map(label).join("") + "</div></details>"
        : '<div class="items-grid">' + rest.map(label).join("") + "</div>") : "");
    $("form-view").hidden = false;
    $("success-view").hidden = true;
    hideError();
    var btn = $("btn-submit"); btn.disabled = false; btn.textContent = submitLabel();
    modal.hidden = false; modal.classList.add("open"); lockScroll(true);
    setTimeout(function () { $("f-name").focus(); }, 30);
  }
  function closeModal() {
    modal.classList.remove("open"); modal.hidden = true; lockScroll(false);
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  $("btn-open-modal").addEventListener("click", openModal);
  $("modal-close").addEventListener("click", closeModal);
  $("success-done").addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  modal.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); trap(e, modal); });
  $("modal-items-grid").addEventListener("change", function (e) {
    var cb = e.target;
    if (cb.name !== "modal-items") return;
    cb.closest("label").classList.toggle("checked", cb.checked);
    toggleItem(cb.value, cb.checked);
  });

  function setOpenEnded(val) {
    openEnded = val;
    $("date-fields").hidden = val;
    $("open-msg").hidden = !val;
    $("btn-dates").setAttribute("aria-pressed", val ? "false" : "true");
    $("btn-open").setAttribute("aria-pressed", val ? "true" : "false");
  }
  $("btn-dates").addEventListener("click", function () { setOpenEnded(false); });
  $("btn-open").addEventListener("click", function () { setOpenEnded(true); });

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
    $("f-times").required = appt;
    var dep = !!gemach.depositRequired;
    $("deposit-group").hidden = !dep;
    $("f-deposit").required = dep;
    if (dep) $("deposit-form-info").innerHTML = depositHtml(gemach);
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
  $("f-deposit").addEventListener("change", function () {
    $("deposit-line").classList.remove("invalid"); this.removeAttribute("aria-invalid");
  });
  function checkEventDate(v, required) {
    if (!v) return required ? "Please enter your " + eventLabel().toLowerCase() + "." : "";
    if (!W.parseYMD(v)) return "Please enter a valid date.";
    if (v < W.todayNY()) return "The " + eventLabel().toLowerCase() + " can’t be in the past.";
    if (v > W.maxEventDate()) return "The " + eventLabel().toLowerCase() + " must be within the next 2 years.";
    return "";
  }

  function showError(msg, field) {
    var el = $("error-msg"); el.textContent = msg; el.hidden = false;
    if (!field && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
  }
  function hideError() {
    $("error-msg").hidden = true;
    $("deposit-line").classList.remove("invalid");
    var inv = modal.querySelectorAll('[aria-invalid="true"]');
    for (var i = 0; i < inv.length; i++) inv[i].removeAttribute("aria-invalid");
  }

  function gemachContactLine() {
    var bits = [];
    if (gemach.phone) bits.push(gemach.phone);
    if (gemach.email) bits.push(gemach.email);
    return bits.length ? " You can also reach the gemach at " + bits.join(" or ") + "." : " Please email " + W.CONTACT_EMAIL + ".";
  }

  $("form-view").addEventListener("input", function (e) {
    if (e.target.getAttribute("aria-invalid") === "true") { e.target.removeAttribute("aria-invalid"); $("error-msg").hidden = true; }
  });
  $("form-view").addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();
    var name = $("f-name").value.trim();
    var phone = $("f-phone").value.trim();
    var email = $("f-email").value.trim();
    var preferredContact = $("f-contact").value;
    var notes = $("f-notes").value.trim();
    var neededFrom = openEnded ? "" : $("f-from").value;
    var neededUntil = openEnded ? "" : $("f-until").value;
    var ids = Array.prototype.map.call(modal.querySelectorAll('input[name="modal-items"]:checked'), function (cb) { return cb.value; });

    if (!name) return showError("Please enter your name.", $("f-name"));
    if (!phone) return showError("Please enter your phone number.", $("f-phone"));
    if (phone.replace(/\D/g, "").length < 10) return showError("Please enter a phone number with area code.", $("f-phone"));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("That email address doesn’t look right.", $("f-email"));
    if (preferredContact === "Email" && !email) return showError("Please add your email, since that’s the best way to reach you.", $("f-email"));
    var st = style();
    var body = { gemach: gemach.slug || slug, name: name, phone: phone, itemsRequested: ids };
    if (st === "Appointment") {
      var times = $("f-times").value.trim();
      var party = $("f-party").value.trim();
      var evA = $("f-event").value;
      if (!times) return showError("Please let the gemach know when you’d like to come.", $("f-times"));
      if (party && !(/^\d+$/.test(party) && +party >= 1 && +party <= 20)) return showError("Number of people should be between 1 and 20.", $("f-party"));
      var errA = checkEventDate(evA, false);
      if (errA) return showError(errA, $("f-event"));
      body.preferredTimes = times;
      if (party) body.partySize = +party;
      if (evA) body.eventDate = evA;
    } else if (st === "Event") {
      if (!ids.length) return showError("Please select at least one item.");
      var evE = $("f-event").value;
      var errE = checkEventDate(evE, true);
      if (errE) return showError(errE, $("f-event"));
      body.eventDate = evE;
    } else {
      if (!ids.length) return showError("Please select at least one item.");
      if (neededFrom && neededUntil && neededUntil < neededFrom) return showError("The “until” date is before the “from” date.", $("f-until"));
      body.openEnded = openEnded;
      if (neededFrom) body.neededFrom = neededFrom;
      if (neededUntil) body.neededUntil = neededUntil;
    }
    if (gemach.depositRequired) {
      if (!$("f-deposit").checked) {
        $("deposit-line").classList.add("invalid");
        return showError("Please confirm you understand a deposit is required.", $("f-deposit"));
      }
      body.depositAck = true;
    }
    if (email) body.email = email;
    if (preferredContact) body.preferredContact = preferredContact;
    if (notes) body.notes = notes;

    var btn = $("btn-submit");
    btn.disabled = true; btn.textContent = "Sending…";

    W.fetchJSON("/submit-request", { method: "POST", body: body, retry: false, timeout: 20000 }).then(function (data) {
      if (!data || !data.success) throw new Error((data && data.error) || "failed");
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
      $("form-view").reset(); setOpenEnded(false); updateEventSummary();
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
