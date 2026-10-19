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

  // ── Text matching (shared with the gemach page, in site.js) ──
  var tokens = W.searchTokens, makeHay = W.makeHay, tokMatch = W.tokMatch, attrText = W.attrText, normText = W.normText;

  // ── Data helpers ──
  function catById(id) {
    for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i];
    return null;
  }
  var catSlug = W.catSlug;
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
      g._soon = W.isComingSoon(g);
      g._info = W.isInfoOnly(g);
      // Categories a gemach is listed under without item matches: its chosen "Browse categories",
      // plus (Coming soon) the categories of its preview items.
      g._cats = {};
      (Array.isArray(g.browseCategoryIds) ? g.browseCategoryIds : []).forEach(function (id) { if (catById(id)) g._cats[id] = 1; });
      if (g._soon) g.items.forEach(function (it) { if (it.categoryId && catById(it.categoryId)) g._cats[it.categoryId] = 1; });
      if (g._soon) return; // Coming soon: not in item search
      g.items.forEach(function (it, ii) {
        var c = it.categoryId ? catById(it.categoryId) : null;
        index.push({
          g: g, item: it, cat: c, order: ii,
          nameHay: makeHay([it.name]),
          ownHay: makeHay([it.name, it.searchWords, attrText(it)]),
          hay: makeHay([it.name, it.byline, it.searchWords, it.description, c && c.name, c && (c.keywords || []).join(" "), g.name, attrText(it)])
        });
      });
    });
  }

  // ── "Try:" chips under the search box: 4 random search terms that find something ──
  // Candidates per gemach (searchable gemachs only — Coming soon ones aren't in the index):
  //  • short item names that share a word with their category ("Rollator", "Navy gown",
  //    "Bride sweatshirt"); not book titles (items with a byline), names with digits or
  //    slashes, or long ones;
  //  • its items' filter values for things like Color, Type, Shape, Shelf, Yom Tov ("Velvet",
  //    "Chanukah") — not size/length/fit/age/sleeve/genre values, nor "For …" ones;
  //  • its browse categories' keywords that appear in an item's own name, search words or
  //    filter values ("crutches", "books"), so each chip really finds that kind of item.
  // One term from each of 4 random gemachs (fewer gemachs → filled from the rest).
  // Picked again on every page load; kept when fresher data arrives if still valid.
  var hintTerms = null;
  var HINT_SKIP_FILTER = /size|length|fit|age|sleeve|genre/i;
  function hintShort(t) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    return t && t.length <= 24 && t.split(" ").length <= 3 && !/[\d\/]/.test(t) ? t : "";
  }
  var catHays = {};
  function catHay(c) { return catHays[c.id] || (catHays[c.id] = makeHay([c.name, (c.keywords || []).join(" ")])); }
  function hintCandidates() {
    catHays = {};
    var byGemach = {}, seen = {};
    function add(gid, term) {
      term = hintShort(term);
      // "wheel chair" = "wheelchair", "ramps" = "ramp": item names are added first, so they win
      var key = normText(term).replace(/ /g, "").replace(/s$/, "");
      if (!key || key.length < 3 || seen[gid + "|" + key]) return;
      seen[gid + "|" + key] = 1;
      // Sentence case, keeping acronyms ("LED sticks", "Navy gown")
      term = term.split(" ").map(function (w) { return /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase(); }).join(" ");
      (byGemach[gid] = byGemach[gid] || []).push(term);
    }
    var entriesByGemach = {};
    index.forEach(function (e) {
      var gid = e.g.id || e.g.slug;
      (entriesByGemach[gid] = entriesByGemach[gid] || []).push(e);
    });
    Object.keys(entriesByGemach).forEach(function (gid) {
      var entries = entriesByGemach[gid], cats = {};
      entries.forEach(function (e) {
        var it = e.item;
        if (e.cat) cats[e.cat.id] = e.cat;
        if (!it.byline) {
          // Names only when they say what the thing is: a word shared with the item's category
          // ("Navy gown", "Calypso jacquard"), so pattern names like "Lynn" or "Poppy" are left out.
          var head = String(it.name || "").split(/\s[–—·-]\s|[,(]/)[0];
          if (!e.cat || tokens(head).some(function (t) { return tokMatch(t, catHay(e.cat)) === 2; })) add(gid, head);
        }
        var a = it.attributes;
        if (a && typeof a === "object") Object.keys(a).forEach(function (k) {
          if (HINT_SKIP_FILTER.test(k) || !Array.isArray(a[k])) return;
          a[k].forEach(function (v) { if (!/^for /i.test(v)) add(gid, v); });
        });
      });
      Object.keys(cats).forEach(function (id) {
        (cats[id].keywords || []).forEach(function (k) {
          var toks = tokens(hintShort(k));
          if (toks.length && entries.some(function (e) {
            return e.cat && e.cat.id === id && toks.every(function (t) { return tokMatch(t, e.ownHay) === 2; });
          })) add(gid, k);
        });
      });
    });
    return byGemach;
  }
  function pickRandom(list) { return list[Math.floor(Math.random() * list.length)]; }
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
    return list;
  }
  function renderHints() {
    var hint = $("search-hint");
    var byCat = hintCandidates(); // keyed by gemach
    var all = {};
    Object.keys(byCat).forEach(function (id) { byCat[id].forEach(function (t) { all[normText(t)] = 1; }); });
    // Keep the terms already shown when fresh data arrives, as long as they still find something.
    var keep = hintTerms && hintTerms.length && hintTerms.every(function (t) { return all[normText(t)]; });
    if (!keep) {
      var picked = [], cats = shuffle(Object.keys(byCat));
      cats.forEach(function (id) {
        if (picked.length >= 4) return;
        var t = pickRandom(byCat[id]);
        if (!picked.some(function (p) { return normText(p) === normText(t); })) picked.push(t);
      });
      if (picked.length < 4) {
        var rest = [];
        cats.forEach(function (id) { byCat[id].forEach(function (t) { if (!picked.some(function (p) { return normText(p) === normText(t); })) rest.push(t); }); });
        shuffle(rest).slice(0, 4 - picked.length).forEach(function (t) { picked.push(t); });
      }
      hintTerms = picked;
    }
    if (!hintTerms.length) { hint.classList.add("no-terms"); hint.classList.remove("picking"); return; }
    hint.classList.remove("no-terms");
    hint.innerHTML = "Try: " + hintTerms.map(function (t) {
      var label = t.charAt(0).toUpperCase() + t.slice(1);
      return '<button type="button" data-q="' + esc(t) + '">' + esc(label) + "</button>";
    }).join(" ");
    hint.classList.remove("picking");
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
    data.gemachs.forEach(function (g) {
      Object.keys(g._cats || {}).forEach(function (id) {
        var s = stats[id] || (stats[id] = { gemachs: {}, avail: 0, items: 0 });
        s.gemachs[g.id] = 1;
      });
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
  function renderGemachs() {
    if (!data.gemachs.length) {
      gemachList.innerHTML = '<li class="empty-state"><p>No gemachs are listed yet. Want to list yours? Email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></li>";
      return;
    }
    gemachList.innerHTML = data.gemachs.map(function (g) {
      var meta = [];
      if (g.category) meta.push('<span class="chip">' + esc(g.category) + "</span>");
      if (g._soon) meta.push('<span class="chip chip-soon">Coming soon</span>');
      if (g._info) {
        meta.push('<span class="stat">Contact for details</span>');
      } else if (g._soon) {
        meta.push('<span class="stat">' + (g.items.length ? W.plural(g.items.length, "item") + " to preview · " : "") + "Not taking requests yet</span>");
      } else if (g._appt && !g._dir) {
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
        ? '<img class="g-avatar" src="' + esc(logo) + '" alt="' + esc(g.name) + '" width="44" height="44" loading="lazy" decoding="async" />'
        : '<span class="g-avatar g-initials" aria-hidden="true">' + esc(W.initials(g)) + "</span>";
      return '<li><article class="gemach-card" data-slug="' + esc(g.slug) + '">' + avatar +
        '<div class="gemach-body"><h3><a href="' + W.gemachUrl(g.slug) + '">' + esc(g.name) + "</a></h3>" +
        (g.tagline ? '<p class="gemach-tagline">' + esc(g.tagline) + "</p>" : "") +
        '<div class="gemach-meta">' + meta.join("") + phoneLine + "</div></div>" +
        // No contact buttons on the home page (contact details are only on the gemach's own page, against scraping);
        // the whole card opens the gemach. The chevron is just the visual cue.
        '<span class="gemach-go" aria-hidden="true">' + W.ICONS.chevron + "</span>" +
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
    // A gemach listed under this category (its "Home page categories") whose items are filed under
    // other categories (e.g. a tablecloth gemach under Wedding & Simcha) shows its own items here,
    // not just a "View gemach" row.
    var inCat = {};
    if (cat) index.forEach(function (e) { if (e.cat && e.cat.id === cat.id) inCat[e.g.id] = 1; });
    function linkedOnly(g) { return !!(cat && g._cats && g._cats[cat.id] && !inCat[g.id]); }

    function run(mode) {
      var hits = [];
      index.forEach(function (e) {
        if (cat && (!e.cat || e.cat.id !== cat.id) && !linkedOnly(e.g)) return;
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
        if (g._soon) return; // Coming soon: not in text search
        var ok = toks.every(function (t) { return tokMatch(t, g._hay); });
        if (ok && !hits.some(function (h) { return h.e.g === g; })) gemachOnly.push(g);
      });
    }
    // Category browsing also lists gemachs linked to the category without matching items
    // (Info only, Coming soon). With a text search too, only ones whose details match (never Coming soon).
    if (cat) {
      data.gemachs.forEach(function (g) {
        if (!g._cats || !g._cats[cat.id] || hits.some(function (h) { return h.e.g === g; })) return;
        if (toks.length && (g._soon || !toks.every(function (t) { return tokMatch(t, g._hay); }))) return;
        gemachOnly.push(g);
      });
    }

    var groups = {};
    hits.forEach(function (h) {
      var g = h.e.g;
      var grp = groups[g.id] || (groups[g.id] = { g: g, rows: [], best: 0, linked: linkedOnly(g) });
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
        ((a.g._soon ? 1 : 0) - (b.g._soon ? 1 : 0)) ||
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

  // Rows shown per gemach before "See all N at …" (browsing a category vs. a typed search).
  var CAP_CATEGORY = 4, CAP_SEARCH = 6;
  /** "size and color" from the gemach's item filters (blank if it has none). */
  function filterNames(g) {
    var names = (Array.isArray(g.itemAttributes) ? g.itemAttributes : [])
      .map(function (d) { return String((d && d.name) || "").toLowerCase(); }).filter(Boolean);
    if (names.length < 2) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  function avatarHtml(g, size) {
    var logo = W.safeUrl(g.logoUrl);
    return logo
      ? '<img class="g-avatar" src="' + esc(logo) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" decoding="async" />'
      : '<span class="g-avatar g-initials" data-slug="' + esc(g.slug) + '" aria-hidden="true">' + esc(W.initials(g)) + "</span>";
  }
  /** Theme colors on initials avatars, via CSSOM (CSP forbids inline style attributes). */
  function paintInitials(root) {
    var els = root.querySelectorAll(".g-initials[data-slug]");
    for (var i = 0; i < els.length; i++) {
      var g = null, slug = els[i].getAttribute("data-slug");
      for (var j = 0; j < data.gemachs.length; j++) if (data.gemachs[j].slug === slug) g = data.gemachs[j];
      if (!g) continue;
      var t = W.validHex(g.themeColor) || W.DEFAULT_THEME;
      els[i].style.setProperty("--card-t", W.stripeColor(g));
      if (t !== W.DEFAULT_THEME) els[i].style.setProperty("--card-on", W.onColor(W.stripeColor(g)));
    }
  }

  // Browsing a category that several gemachs have: one row per gemach (name, count, See all) with a
  // strip of item tiles to swipe sideways, so every gemach shows on the first screen.
  var ROW_TILES = 10;
  function renderRows(r) {
    var scope = { cat: catSlug(r.cat), q: "" };
    resultsEl.innerHTML = '<div class="gem-rows">' + r.groups.map(function (grp) {
      var g = grp.g, n = grp.rows.length;
      // A gemach shown here through its Home page categories: its page isn't narrowed to this category.
      var link = n ? W.gemachScopeUrl(g.slug, grp.linked ? { cat: "", q: "" } : scope) : W.gemachUrl(g.slug);
      // No "N available" total here: for most gemachs it depends on the dates, which aren't chosen yet.
      var meta = n ? W.plural(n, "item")
        : esc(g._soon ? "Coming soon" : (g.tagline || "Contact for details"));
      var tiles = grp.rows.slice(0, ROW_TILES).map(function (h) {
        var it = h.e.item, c = h.e.cat;
        var hasPhoto = !!(it.photoUrl && W.safeUrl(it.photoUrl));
        var img = hasPhoto
          ? '<img src="' + esc(it.photoUrl) + '" alt="" loading="lazy" decoding="async" />'
          : '<span aria-hidden="true">' + esc((c && c.icon) || "📦") + "</span>";
        return '<li><a class="gem-tile" href="' + W.gemachUrl(g.slug, it.id) + '">' +
          '<span class="gem-tile-img' + (hasPhoto ? " has-photo" : "") + '">' + img + "</span>" +
          '<span class="gem-tile-name">' + esc(it.name) + '</span><span class="sr-only"> at ' + esc(g.name) + "</span>" +
          badge(g, it) + "</a></li>";
      }).join("");
      if (n > ROW_TILES) {
        tiles += '<li><a class="gem-tile gem-tile-more" href="' + link + '">See all ' + n +
          '<span class="sr-only"> at ' + esc(g.name) + "</span>" + W.ICONS.chevron + "</a></li>";
      }
      return '<section class="gem-row" id="rg-' + esc(g.slug) + '" aria-label="' + esc(g.name) + '">' +
        '<div class="gem-row-head">' + avatarHtml(g, 36) +
        '<div class="gem-row-title"><h3><a href="' + link + '">' + esc(g.name) + "</a></h3>" +
        '<p class="gem-row-meta">' + meta + "</p></div>" +
        '<a class="gem-row-all" href="' + link + '">' + (n ? "See all" : "View gemach") +
        '<span class="sr-only"> at ' + esc(g.name) + "</span>" + W.ICONS.chevron + "</a></div>" +
        (tiles ? '<ul class="gem-strip">' + tiles + "</ul>" : "") + "</section>";
    }).join("") + "</div>";
    paintInitials(resultsEl);
  }

  function renderResults() {
    var active = !!(state.q.trim() || state.cat);
    document.body.classList.toggle("filtering", active);
    resultsSection.hidden = !active;
    $("search-hint").hidden = active;
    clearBtn.hidden = !state.q;
    if (!active) { document.body.classList.remove("browsing-cat"); clearTimeout(logTimer); resultsEl.innerHTML = ""; return; }

    var r = search();
    scheduleSearchLog(searchOutcome(r), r.cat);
    var what = [];
    if (state.q.trim()) what.push("“" + esc(state.q.trim()) + "”");
    if (r.cat) what.push(esc(r.cat.name));
    // Browsing a category (no typed search): the tile scroller is hidden and the category name is the heading.
    var browsing = !!(r.cat && !state.q.trim());
    document.body.classList.toggle("browsing-cat", browsing);
    var title = $("results-title");
    title.innerHTML = browsing
      ? (r.cat.icon ? '<span class="cat-title-icon" aria-hidden="true">' + esc(r.cat.icon) + "</span>" : "") +
        '<span class="cat-title-name">' + esc(r.cat.name) + "</span>"
      : "Search results";
    title.className = browsing ? "cat-title" : "sr-only";
    $("clear-filters").textContent = state.q.trim() && r.cat ? "Clear all" : (r.cat ? "All categories" : "Clear search");

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
    if (browsing) {
      resultsCount.innerHTML = "<strong>" + W.plural(nG, "gemach") + "</strong>" + (r.count ? " · " + W.plural(r.count, "item") : "");
      if (nG > 1) { renderRows(r); return; }
    } else resultsCount.innerHTML = (r.partial ? "Partial matches for " : "") +
      (r.count ? "<strong>" + W.plural(r.count, "item") + "</strong>" + " from " : "") +
      "<strong>" + W.plural(nG, "gemach") + "</strong>" + (what.length && !r.partial ? " for " + what.join(" in ") : (r.partial ? " " + what.join(" in ") : ""));

    // Each gemach shows a short preview; the rest is one tap away on the gemach page, which opens
    // narrowed to the same category/search and has that gemach's own filters (size, color, …).
    var cap = r.cat ? CAP_CATEGORY : CAP_SEARCH;
    var scope = { cat: r.cat ? catSlug(r.cat) : "", q: r.partial ? "" : state.q };
    resultsEl.innerHTML = r.groups.map(function (grp) {
      // A gemach shown here through its Home page categories: its page isn't narrowed to this category.
      var g = grp.g, link = W.gemachScopeUrl(g.slug, grp.linked ? { cat: "", q: scope.q } : scope);
      var more = grp.rows.length > cap ? grp.rows.length : 0;
      var rows = grp.rows.slice(0, cap).map(function (h) {
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
      if (more) {
        rows += '<li><a class="result-row result-more" href="' + link + '">' +
          '<span class="result-main"><span class="result-name">See all ' + more + " at " + esc(g.name) + "</span>" +
          '<span class="result-sub">' + (filterNames(g) ? "Filter by " + esc(filterNames(g)) : "See everything") + " on the gemach’s page</span></span>" +
          W.ICONS.chevron + "</a></li>";
      }
      if (!grp.rows.length) {
        rows = '<li><a class="result-row" href="' + W.gemachUrl(g.slug) + '">' +
          '<span class="result-thumb"><span aria-hidden="true">🏠</span></span>' +
          '<span class="result-main"><span class="result-name">View gemach &amp; contact info</span>' +
          '<span class="result-sub">' + esc(g.tagline || g.name) + "</span></span>" +
          (g._soon ? '<span class="badge badge-soon">Coming soon</span>' : g._info ? '<span class="badge badge-dir">Info</span>' : g._dir ? '<span class="badge badge-dir">Directory</span>' : "") + W.ICONS.chevron + "</a></li>";
      }
      return '<section class="result-group" id="rg-' + esc(g.slug) + '" aria-label="' + esc(g.name) + '">' +
        '<div class="result-group-head"><h3><a href="' + link + '">' + esc(g.name) + "</a></h3>" +
        '<a href="' + link + '">View gemach</a></div>' +
        '<ul class="result-list">' + rows + "</ul></section>";
    }).join("");
  }

  // ── "Your requests": links saved on this device when the person ticked "Remember me" ──
  function renderMine() {
    var sec = $("my-requests");
    if (!sec) return;
    var list = W.me.requests();
    sec.hidden = !list.length;
    if (!list.length) return;
    $("my-requests-list").innerHTML = list.slice(0, 5).map(function (r) {
      var d = new Date(r.at);
      return '<li><a class="my-req" href="' + esc(r.url) + '"><span class="my-req-main"><strong>' + esc(r.gemach || "Gemach") + "</strong>" +
        '<span class="my-req-sub">' + esc(r.requestId || "") + (isNaN(d) ? "" : " · sent " + esc(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }))) + "</span></span>" +
        '<span class="my-req-go">View or cancel ' + W.ICONS.chevron + "</span></a></li>";
    }).join("");
  }
  if ($("my-requests-forget")) $("my-requests-forget").addEventListener("click", function () { W.me.forget(); renderMine(); });
  renderMine();

  function renderAll() {
    renderHints();
    renderTiles();
    renderGemachs();
    renderResults();
    revealActiveChip();
    layoutPeek();
  }

  // ── Phones: categories start collapsed (2 rows + a faded third row under "Show all") ──
  var PEEK_MAX = 6, phone = window.matchMedia ? window.matchMedia("(max-width: 639px)") : null;
  var catsOpen = false;
  try { catsOpen = sessionStorage.getItem("whg_cats_open") === "1"; } catch (e) { /* ignore */ }
  function layoutPeek() {
    var sec = $("cats-section"), n = catGrid.querySelectorAll(".cat-tile").length;
    var canCollapse = n > PEEK_MAX;
    sec.classList.toggle("cats-collapsed", canCollapse && !catsOpen);
    sec.classList.toggle("cats-expanded", canCollapse && catsOpen);
    $("cat-more-btn").firstChild.nodeValue = "Show all " + n + " categories ";
    if (!canCollapse || catsOpen || !phone || !phone.matches || document.body.classList.contains("filtering")) return;
    // Fade ends a little past the middle of the third row.
    var lis = catGrid.children, li = lis[PEEK_MAX - 2];
    if (!li) return;
    var top = li.getBoundingClientRect().top - catGrid.getBoundingClientRect().top;
    catGrid.style.setProperty("--peek-h", Math.round(top + li.offsetHeight * 0.55) + "px");
  }
  function setCatsOpen(open) {
    catsOpen = open;
    try { sessionStorage.setItem("whg_cats_open", open ? "1" : "0"); } catch (e) { /* ignore */ }
    layoutPeek();
    if (open) { var t = catGrid.children[PEEK_MAX]; /* first tile that was hidden */ var b = t && t.querySelector("button"); if (b) b.focus({ preventScroll: true }); }
    else { $("cat-more-btn").focus({ preventScroll: true }); var r = $("cats-section").getBoundingClientRect(); if (r.top < 0) $("cats-section").scrollIntoView({ block: "start" }); }
  }
  $("cat-more-btn").addEventListener("click", function () { setCatsOpen(true); });
  $("cat-less-btn").addEventListener("click", function () { setCatsOpen(false); });
  var peekRaf = 0;
  window.addEventListener("resize", function () { cancelAnimationFrame(peekRaf); peekRaf = requestAnimationFrame(layoutPeek); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutPeek);

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
    if (data) { syncTilePressed(); layoutPeek(); }
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
    var browsing = state.cat && !state.q.trim();
    qInput.value = ""; state.q = ""; state.cat = ""; searchPushed = false; update(true);
    // Back from a category: show the category list (no keyboard popping up on a phone).
    if (browsing) $("cats-section").scrollIntoView({ block: "start" });
    else qInput.focus();
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
    state.cat = state.cat === c ? "" : c;
    searchPushed = false;
    update(true);
    if (state.cat) {
      // The category heading replaces the tile list: start at the top with focus on the heading.
      window.scrollTo(0, 0);
      var h = $("results-title");
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
    revealActiveChip();
  });
  window.addEventListener("popstate", function () {
    readUrl(); searchPushed = false;
    if (data) { renderResults(); syncTilePressed(); revealActiveChip(); layoutPeek(); }
  });

  // ── Boot ──
  readUrl();
  clearBtn.hidden = !state.q;
  if (state.q || state.cat) {
    document.body.classList.add("filtering");
    if (state.cat && !state.q.trim()) document.body.classList.add("browsing-cat");
    resultsSection.hidden = false;
    $("search-hint").hidden = true;
    resultsEl.innerHTML = '<div class="sk sk-row"></div>';
  }

  function byName(a, b) { return String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base", numeric: true }); }
  function show(d) {
    data = d;
    if (Array.isArray(data.gemachs)) data.gemachs = data.gemachs.slice().sort(byName); // home page lists gemachs A–Z
    buildIndex(); renderAll();
  }
  var cached = W.readDirCache();
  if (cached) { try { show(cached); } catch (e) { data = null; } }

  W.loadDirectory().then(show, function () {
    if (data) return; // keep cached view
    if (W.loadFailed) W.loadFailed("directory");
    var msg = '<div class="empty-state"><div class="big" aria-hidden="true">📡</div><h3>We couldn’t load the directory</h3>' +
      "<p>Please check your connection and try again.</p>" +
      '<p><button type="button" class="btn btn-primary" id="retry">Try again</button></p>' +
      '<p>Or email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></div>";
    $("cats-section").hidden = true;
    document.body.classList.remove("filtering", "browsing-cat");
    resultsSection.hidden = true;
    gemachList.outerHTML = '<div id="gemach-list">' + msg + "</div>";
    var r = document.getElementById("retry");
    if (r) r.addEventListener("click", function () { location.reload(); });
  });
})();
