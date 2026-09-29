/* Home page: directory, category tiles, client-side search */
(function () {
  "use strict";
  var W = window.WHG;
  var esc = W.escapeHtml;

  var $ = function (id) { return document.getElementById(id); };
  var qInput = $("q"), form = $("search-form"), clearBtn = $("search-clear");
  var mini = $("mini-bar"), qMini = $("q-mini");
  var catGrid = $("cat-grid"), gemachList = $("gemach-list");
  var resultsSection = $("results-section"), resultsEl = $("results"), resultsCount = $("results-count");

  var data = null;          // directory payload
  var index = [];           // searchable entries
  var state = { q: "", cat: "" };
  var typingTimer = null;
  var searchPushed = false; // whether the current typing session already has a history entry

  // ── Text normalization / matching ──
  var STOP = { a:1, an:1, the:1, for:1, i:1, im:1, need:1, needs:1, needed:1, to:1, borrow:1, of:1, my:1, some:1, and:1, with:1, me:1, looking:1, want:1, please:1, any:1, who:1, has:1, have:1, do:1, you:1, is:1, there:1 };
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function tokens(q) {
    var t = norm(q).split(" ").filter(Boolean);
    var kept = t.filter(function (w) { return !STOP[w]; });
    return kept.length ? kept : t;
  }
  function variants(tok) {
    var v = [tok];
    if (tok.length > 4 && /ies$/.test(tok)) v.push(tok.slice(0, -3) + "y");
    if (tok.length > 4 && /(ches|shes|xes|sses)$/.test(tok)) v.push(tok.slice(0, -2));
    if (tok.length > 3 && /s$/.test(tok) && !/ss$/.test(tok)) v.push(tok.slice(0, -1));
    return v;
  }
  function lev1(a, b) { // true if edit distance <= 1
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  }
  /** "Size 8 Color Navy Gold" from an item's filter values, so searches like "navy gown" or "size 8" find it. */
  function attrText(it) {
    var a = it && it.attributes;
    if (!a || typeof a !== "object") return "";
    return Object.keys(a).map(function (k) { return k + " " + (Array.isArray(a[k]) ? a[k].join(" ") : ""); }).join(" ");
  }
  function makeHay(parts) {
    var text = norm(parts.join(" "));
    return { text: " " + text + " ", compact: text.replace(/ /g, ""), words: text.split(" ") };
  }
  function tokMatch(tok, hay) {
    var vs = variants(tok);
    for (var i = 0; i < vs.length; i++) {
      if (hay.text.indexOf(vs[i]) !== -1 || hay.compact.indexOf(vs[i]) !== -1) return 2;
    }
    if (tok.length >= 5) { // small typo tolerance
      for (var k = 0; k < hay.words.length; k++) {
        var w = hay.words[k];
        if (w.length >= 4 && lev1(tok, w)) return 1;
      }
    }
    return 0;
  }

  // ── Data helpers ──
  function catById(id) {
    for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i];
    return null;
  }
  function catSlug(c) { return norm(c.name).replace(/ /g, "-"); }
  function findCat(key) {
    if (!key) return null;
    for (var i = 0; i < data.categories.length; i++) {
      var c = data.categories[i];
      if (catSlug(c) === key || c.id === key) return c;
    }
    return null;
  }

  function buildIndex() {
    index = [];
    data.gemachs.forEach(function (g, gi) {
      g._order = gi;
      g._dir = W.isDirectory(g);
      g._style = W.requestStyle(g);
      g._appt = g._style === "Appointment";
      g.items = Array.isArray(g.items) ? g.items : [];
      g._hay = makeHay([g.name, g.tagline, g.category, g.description, g.communityName]);
      g.items.forEach(function (it, ii) {
        var c = it.categoryId ? catById(it.categoryId) : null;
        index.push({
          g: g, item: it, cat: c, order: ii,
          nameHay: makeHay([it.name]),
          hay: makeHay([it.name, it.description, c && c.name, c && (c.keywords || []).join(" "), g.name, attrText(it)])
        });
      });
    });
  }

  // ── Rendering: tiles ──
  function renderTiles() {
    var stats = {};
    index.forEach(function (e) {
      if (!e.cat) return;
      var s = stats[e.cat.id] || (stats[e.cat.id] = { gemachs: {}, avail: 0, items: 0 });
      s.gemachs[e.g.id] = 1;
      s.items++;
      if (!e.g._dir && !e.g._appt) s.avail += Math.max(0, e.item.availableCount || 0);
    });
    var cats = data.categories.filter(function (c) { return stats[c.id]; })
      .sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" }); }); // A–Z
    $("cats-section").hidden = cats.length === 0;
    catGrid.innerHTML = cats.map(function (c) {
      var s = stats[c.id], ng = Object.keys(s.gemachs).length;
      var sel = state.cat && catSlug(c) === state.cat;
      var meta = W.plural(ng, "gemach") + (s.avail ? ' · <span class="ok">' + s.avail + " available</span>" : "");
      return '<li><button type="button" class="cat-tile" data-cat="' + esc(catSlug(c)) + '" aria-pressed="' + (sel ? "true" : "false") + '">' +
        '<span class="cat-icon" aria-hidden="true">' + esc(c.icon || "•") + "</span>" +
        '<span class="cat-name">' + esc(c.name) + "</span>" +
        '<span class="cat-meta">' + meta + "</span></button></li>";
    }).join("");
  }

  // ── Rendering: gemach cards ──
  function sums(g) {
    var total = 0, avail = 0;
    g.items.forEach(function (it) {
      total += typeof it.totalUnits === "number" ? it.totalUnits : 1;
      avail += Math.max(0, it.availableCount || 0);
    });
    return { total: total, avail: avail };
  }
  function quickLinks(g) {
    var acts = W.contactActions(g);
    if (acts) {
      return acts.map(function (a) {
        return '<a class="btn btn-sm' + (a.primary ? " btn-primary" : (a.type === "WhatsApp" ? " btn-wa" : "")) + '" href="' + esc(a.href) + '"' +
          (a.ext ? ' target="_blank" rel="noopener"' : "") + ' aria-label="' + esc(a.label + " " + g.name) + '" data-contact="' + a.type + '">' +
          W.ICONS[a.icon] + a.label + "</a>";
      }).join("");
    }
    var out = [];
    var tel = W.telHref(g.phone), wa = W.waHref(g.whatsapp);
    if (tel) out.push('<a class="btn btn-sm" href="' + tel + '" aria-label="Call ' + esc(g.name) + '">' + W.ICONS.phone + "Call</a>");
    if (wa) out.push('<a class="btn btn-sm btn-wa" href="' + wa + '" target="_blank" rel="noopener" aria-label="WhatsApp ' + esc(g.name) + '">' + W.ICONS.whatsapp + "WhatsApp</a>");
    if (g.email && (g._dir || out.length < 2)) out.push('<a class="btn btn-sm" href="mailto:' + esc(g.email) + '" aria-label="Email ' + esc(g.name) + '">' + W.ICONS.mail + "Email</a>");
    return out.join("");
  }
  function renderGemachs() {
    if (!data.gemachs.length) {
      gemachList.innerHTML = '<li class="empty-state"><p>No gemachs are listed yet. Want to list yours? Email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></li>";
      return;
    }
    gemachList.innerHTML = data.gemachs.map(function (g) {
      var meta = [];
      if (g.category) meta.push('<span class="chip">' + esc(g.category) + "</span>");
      if (g._appt && !g._dir) {
        meta.push('<span class="stat">' + (g.items.length ? "<strong>" + W.plural(g.items.length, "item") + "</strong> · " : "") + "By appointment</span>");
      } else if (g._dir) {
        meta.push('<span class="stat">' + (g.items.length ? W.plural(g.items.length, "item") + " listed · " : "") + "Contact directly for availability</span>");
      } else if (g.items.length) {
        var s = sums(g);
        meta.push('<span class="stat"><strong>' + W.plural(s.total, "item") + "</strong> · " +
          (s.avail ? '<span class="ok">' + s.avail + " available</span>" : "all on loan right now") + "</span>");
      }
      if (g._style === "Event") meta.push('<span class="tag">For events</span>');
      var phoneLine = "";
      var logo = W.safeUrl(g.logoUrl);
      var avatar = logo
        ? '<img class="g-avatar" src="' + esc(logo) + '" alt="' + esc(g.name) + '" width="48" height="48" loading="lazy" decoding="async" />'
        : '<span class="g-avatar g-initials" aria-hidden="true">' + esc(W.initials(g)) + "</span>";
      return '<li><article class="gemach-card" data-slug="' + esc(g.slug) + '">' +
        '<div class="gemach-head">' + avatar + '<h3><a href="' + W.gemachUrl(g.slug) + '">' + esc(g.name) + "</a></h3></div>" +
        (g.tagline ? '<p class="gemach-tagline">' + esc(g.tagline) + "</p>" : "") +
        '<div class="gemach-meta">' + meta.join("") + phoneLine + "</div>" +
        '<div class="gemach-actions">' + quickLinks(g) + "</div>" +
        "</article></li>";
    }).join("");
    // Per-card theme colors via CSSOM (CSP forbids inline style attributes)
    var cards = gemachList.querySelectorAll(".gemach-card");
    for (var i = 0; i < cards.length; i++) {
      var g = data.gemachs[i];
      var t = W.validHex(g.themeColor) || W.DEFAULT_THEME;
      cards[i].style.setProperty("--card-t", W.stripeColor(g));
      if (t !== W.DEFAULT_THEME) {
        cards[i].style.setProperty("--card-on", W.onColor(W.stripeColor(g)));
      }
    }
  }

  // ── Search ──
  function search() {
    var toks = tokens(state.q);
    var cat = findCat(state.cat);
    var partial = false;

    function run(mode) {
      var hits = [];
      index.forEach(function (e) {
        if (cat && (!e.cat || e.cat.id !== cat.id)) return;
        if (!toks.length) { hits.push({ e: e, score: 0 }); return; }
        var score = 0, matched = 0;
        for (var i = 0; i < toks.length; i++) {
          var m = tokMatch(toks[i], e.hay);
          if (m) { matched++; score += m + (tokMatch(toks[i], e.nameHay) ? 3 : 0); }
          else if (mode === "all") return;
        }
        if (matched) hits.push({ e: e, score: score + matched * 2 });
      });
      return hits;
    }
    var hits = run("all");
    if (!hits.length && toks.length > 1) { hits = run("any"); partial = hits.length > 0; }

    // gemach-level matches (e.g. directory gemachs with no items), only for text search without category
    var gemachOnly = [];
    if (toks.length && !cat) {
      data.gemachs.forEach(function (g) {
        var ok = toks.every(function (t) { return tokMatch(t, g._hay); });
        if (ok && !hits.some(function (h) { return h.e.g === g; })) gemachOnly.push(g);
      });
    }

    var groups = {};
    hits.forEach(function (h) {
      var g = h.e.g;
      var grp = groups[g.id] || (groups[g.id] = { g: g, rows: [], best: 0 });
      grp.rows.push(h);
      grp.best = Math.max(grp.best, h.score);
    });
    gemachOnly.forEach(function (g) { groups[g.id] = { g: g, rows: [], best: 0 }; });

    var list = Object.keys(groups).map(function (k) { return groups[k]; });
    list.forEach(function (grp) {
      grp.hasAvail = !grp.g._dir && !grp.g._appt && grp.rows.some(function (h) { return h.e.item.availableCount > 0 || h.e.item.tracking === "addon"; });
      grp.rows.sort(function (a, b) {
        var ok = function (x) { return x.e.item.availableCount > 0 || x.e.item.tracking === "addon" ? 1 : 0; };
        var aa = ok(a), bb = ok(b);
        return (bb - aa) || (b.score - a.score) || (a.e.order - b.e.order);
      });
    });
    list.sort(function (a, b) {
      return ((b.hasAvail ? 1 : 0) - (a.hasAvail ? 1 : 0)) ||
        ((a.g._dir ? 1 : 0) - (b.g._dir ? 1 : 0)) ||
        (b.best - a.best) || (a.g._order - b.g._order);
    });
    return { groups: list, count: hits.length, partial: partial, cat: cat };
  }

  // ── Searches that come up empty are logged (no personal info) so the network can see unmet needs ──
  var logTimer = null, logged = {};
  function scheduleSearchLog(outcome, cat) {
    clearTimeout(logTimer);
    var q = state.q.trim();
    if (!outcome || q.length < 3 || /@/.test(q) || (q.match(/\d/g) || []).length >= 5) return;
    logTimer = setTimeout(function () {
      if (state.q.trim() !== q) return;
      var key = q.toLowerCase() + "|" + outcome;
      if (logged[key]) return;
      logged[key] = 1;
      try {
        fetch(W.API_BASE + "/public/search-log", {
          method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ q: q, outcome: outcome, category: cat ? cat.name : undefined }),
        }).catch(function () {});
      } catch (e) {}
    }, 2000);
  }
  function searchOutcome(r) {
    if (!state.q.trim()) return null;
    if (!r.groups.length) return "none";
    if (r.partial || !r.count) return null;
    var allOut = r.groups.every(function (grp) { return !grp.g._dir && !grp.g._appt && !grp.hasAvail; });
    return allOut ? "all-on-loan" : null;
  }

  function badge(g, it) {
    if (g._dir) return '<span class="badge badge-dir">Contact to check</span>';
    if (g._appt) return '<span class="badge badge-appt">By appointment</span>';
    if (it.tracking === "addon") return '<span class="badge badge-addon">Add-on</span>';
    var n = Math.max(0, it.availableCount || 0);
    return n > 0 ? '<span class="badge badge-ok">' + n + " available</span>"
                 : '<span class="badge badge-out">All on loan</span>';
  }

  function renderResults() {
    var active = !!(state.q.trim() || state.cat);
    document.body.classList.toggle("filtering", active);
    resultsSection.hidden = !active;
    $("search-hint").hidden = active;
    clearBtn.hidden = !state.q;
    if (!active) { clearTimeout(logTimer); resultsEl.innerHTML = ""; return; }

    var r = search();
    scheduleSearchLog(searchOutcome(r), r.cat);
    var what = [];
    if (state.q.trim()) what.push("“" + esc(state.q.trim()) + "”");
    if (r.cat) what.push(esc(r.cat.name));
    $("clear-filters").textContent = state.q.trim() && r.cat ? "Clear all" : (r.cat ? "Show all categories" : "Clear search");

    if (!r.groups.length) {
      resultsCount.innerHTML = "No matches for " + what.join(" in ");
      resultsEl.innerHTML = '<div class="empty-state"><div class="big" aria-hidden="true">🔎</div>' +
        "<h3>We couldn’t find that</h3>" +
        "<p>Try a simpler word (like “walker” or “crib”), check the spelling, or browse the categories above.</p>" +
        '<p>Still can’t find it? Email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL +
        "</a> — someone in the community may be able to help.</p></div>";
      return;
    }

    var nG = r.groups.length;
    resultsCount.innerHTML = (r.partial ? "Partial matches for " : "") +
      (r.count ? "<strong>" + W.plural(r.count, "item") + "</strong>" + " from " : "") +
      "<strong>" + W.plural(nG, "gemach") + "</strong>" + (what.length && !r.partial ? " for " + what.join(" in ") : (r.partial ? " " + what.join(" in ") : ""));

    resultsEl.innerHTML = r.groups.map(function (grp) {
      var g = grp.g;
      var rows = grp.rows.map(function (h) {
        var it = h.e.item, c = h.e.cat;
        var thumb = it.photoUrl && W.safeUrl(it.photoUrl)
          ? '<img src="' + esc(it.photoUrl) + '" alt="" loading="lazy" width="44" height="44" />'
          : '<span aria-hidden="true">' + esc((c && c.icon) || "📦") + "</span>";
        return '<li><a class="result-row" href="' + W.gemachUrl(g.slug, it.id) + '">' +
          '<span class="result-thumb">' + thumb + "</span>" +
          '<span class="result-main"><span class="result-name">' + esc(it.name) + "</span>" +
          (c ? '<span class="result-sub">' + esc(c.name) + "</span>" : "") + '<span class="sr-only"> at ' + esc(g.name) + "</span></span>" +
          badge(g, it) + W.ICONS.chevron + "</a></li>";
      }).join("");
      if (!grp.rows.length) {
        rows = '<li><a class="result-row" href="' + W.gemachUrl(g.slug) + '">' +
          '<span class="result-thumb"><span aria-hidden="true">🏠</span></span>' +
          '<span class="result-main"><span class="result-name">View gemach &amp; contact info</span>' +
          '<span class="result-sub">' + esc(g.tagline || g.name) + "</span></span>" +
          (g._dir ? '<span class="badge badge-dir">Directory</span>' : "") + W.ICONS.chevron + "</a></li>";
      }
      return '<section class="result-group" aria-label="' + esc(g.name) + '">' +
        '<div class="result-group-head"><h3>' + esc(g.name) + "</h3>" +
        '<a href="' + W.gemachUrl(g.slug) + '">View gemach</a></div>' +
        '<ul class="result-list">' + rows + "</ul></section>";
    }).join("");
  }

  function renderAll() {
    renderTiles();
    renderGemachs();
    renderResults();
    revealActiveChip();
  }

  // ── URL state ──
  function readUrl() {
    var p = new URLSearchParams(location.search);
    state.q = p.get("q") || "";
    state.cat = p.get("cat") || "";
    if (qInput.value !== state.q) qInput.value = state.q;
  }
  function writeUrl(push) {
    var p = new URLSearchParams();
    if (state.q.trim()) p.set("q", state.q.trim());
    if (state.cat) p.set("cat", state.cat);
    var url = location.pathname + (p.toString() ? "?" + p.toString() : "");
    if (url === location.pathname + location.search) return;
    if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
  }
  function update(push) {
    writeUrl(push);
    if (qMini && qMini.value !== state.q) qMini.value = state.q;
    if (data) renderResults(); else clearBtn.hidden = !state.q;
    if (data) syncTilePressed();
  }
  function revealActiveChip() {
    if (!document.body.classList.contains("filtering")) return;
    var el = catGrid.querySelector('.cat-tile[aria-pressed="true"]');
    if (!el) return;
    var li = el.parentNode;
    catGrid.scrollLeft = Math.max(0, li.offsetLeft - (catGrid.clientWidth - li.offsetWidth) / 2);
  }
  function syncTilePressed() {
    var tiles = catGrid.querySelectorAll(".cat-tile");
    for (var i = 0; i < tiles.length; i++) tiles[i].setAttribute("aria-pressed", tiles[i].getAttribute("data-cat") === state.cat ? "true" : "false");
  }

  // ── Compact bar: slides in once the big search box has scrolled out of view ──
  if (mini && qMini && "IntersectionObserver" in window) {
    var miniOn = false;
    var showMini = function (on) {
      if (on === miniOn) return;
      if (!on && document.activeElement === qMini) return; // don't yank it away mid-typing
      miniOn = on;
      mini.classList.toggle("show", on);
      mini.setAttribute("aria-hidden", on ? "false" : "true");
      qMini.tabIndex = on ? 0 : -1;
      mini.querySelector(".mini-brand").tabIndex = on ? 0 : -1;
    };
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      showMini(!e.isIntersecting && e.boundingClientRect.bottom < 0);
    }).observe(form);
    qMini.addEventListener("blur", function () {
      var r = form.getBoundingClientRect();
      if (r.bottom >= 0) showMini(false);
    });
    qMini.addEventListener("input", function () {
      qInput.value = qMini.value;
      qInput.dispatchEvent(new Event("input"));
    });
    qInput.addEventListener("input", function () { if (qMini.value !== qInput.value) qMini.value = qInput.value; });
    $("mini-form").addEventListener("submit", function (e) {
      e.preventDefault();
      qInput.value = qMini.value;
      qMini.blur();
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
    });
  }

  // ── Events ──
  qInput.addEventListener("input", function () {
    state.q = qInput.value;
    clearBtn.hidden = !state.q;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () {
      var push = !searchPushed && !!state.q.trim();
      if (push) searchPushed = true;
      if (!state.q.trim()) searchPushed = false;
      update(push);
    }, 140);
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearTimeout(typingTimer);
    state.q = qInput.value;
    update(!searchPushed);
    searchPushed = false;
    qInput.blur();
    if (state.q.trim()) resultsSection.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  clearBtn.addEventListener("click", function () {
    qInput.value = ""; state.q = ""; searchPushed = false; update(true); qInput.focus();
  });
  $("clear-filters").addEventListener("click", function () {
    qInput.value = ""; state.q = ""; state.cat = ""; searchPushed = false; update(true);
    qInput.focus();
  });
  $("search-hint").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-q]");
    if (!b) return;
    qInput.value = state.q = b.getAttribute("data-q");
    searchPushed = false;
    update(true);
  });
  catGrid.addEventListener("click", function (e) {
    var t = e.target.closest(".cat-tile");
    if (!t) return;
    var c = t.getAttribute("data-cat");
    var wasFiltering = document.body.classList.contains("filtering");
    state.cat = state.cat === c ? "" : c;
    searchPushed = false;
    update(true);
    if (!wasFiltering && state.cat) {
      $("cats-section").scrollIntoView({ block: "start", behavior: "smooth" });
      var sel = catGrid.querySelector('.cat-tile[aria-pressed="true"]');
      if (sel) sel.focus({ preventScroll: true });
    }
    revealActiveChip();
  });
  window.addEventListener("popstate", function () {
    readUrl(); searchPushed = false;
    if (data) { renderResults(); syncTilePressed(); revealActiveChip(); }
  });

  // ── Boot ──
  readUrl();
  clearBtn.hidden = !state.q;
  if (state.q || state.cat) {
    document.body.classList.add("filtering");
    resultsSection.hidden = false;
    $("search-hint").hidden = true;
    resultsEl.innerHTML = '<div class="sk sk-row"></div>';
  }

  function show(d) { data = d; buildIndex(); renderAll(); }
  var cached = W.readDirCache();
  if (cached) { try { show(cached); } catch (e) { data = null; } }

  W.loadDirectory().then(show, function () {
    if (data) return; // keep cached view
    var msg = '<div class="empty-state"><div class="big" aria-hidden="true">📡</div><h3>We couldn’t load the directory</h3>' +
      "<p>Please check your connection and try again.</p>" +
      '<p><button type="button" class="btn btn-primary" id="retry">Try again</button></p>' +
      '<p>Or email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></div>";
    $("cats-section").hidden = true;
    document.body.classList.remove("filtering");
    resultsSection.hidden = true;
    gemachList.outerHTML = '<div id="gemach-list">' + msg + "</div>";
    var r = document.getElementById("retry");
    if (r) r.addEventListener("click", function () { location.reload(); });
  });
})();
