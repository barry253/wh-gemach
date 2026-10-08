/* Borrower manage page: /r/<token> — check on a request, cancel it, or say the items are ready to return. No login. */
(function () {
  "use strict";
  var W = window.WHG;
  var esc = W.escapeHtml;
  var $ = function (id) { return document.getElementById(id); };

  var m = location.pathname.match(/^\/r\/([^/?#]+)/);
  var token = m ? decodeURIComponent(m[1]) : (new URLSearchParams(location.search).get("t") || "");
  var data = null, busy = false, confirming = null, flash = "";

  var STATUS = {
    waiting:     ["Waiting for the gemach", "The gemach has your request and will be in touch.", "st-wait"],
    confirmed:   ["Confirmed", "Your items are reserved.", "st-ok"],
    appointment: ["Appointment confirmed", "", "st-ok"],
    out:         ["Picked up", "Enjoy — let the gemach know when you’re ready to return.", "st-ok"],
    returned:    ["Returned", "Thank you for returning everything!", "st-done"],
    visited:     ["Visit complete", "Thank you for coming in.", "st-done"],
    closed:      ["Closed", "", "st-done"],
    cancelled:   ["Cancelled", "This request was cancelled.", "st-done"],
    declined:    ["Not available", "The gemach couldn’t fill this request.", "st-done"]
  };
  var LOAN_STATUS = { Reserved: "Reserved", Active: "Picked up", Returned: "Returned", Cancelled: "Cancelled" };

  function applyTheme(g) {
    var v = W.themeVars(g), root = document.documentElement;
    Object.keys(v).forEach(function (k) { root.style.setProperty(k, v[k]); });
  }
  function contactRow(g, onDark) {
    var acts = W.contactActions(g) || [];
    if (!acts.length) return "";
    return '<div class="contact-row">' + acts.map(function (a) {
      return '<a class="btn ' + (onDark ? "btn-on-dark" + (a.primary ? " btn-solid" : "") : (a.primary ? "btn-primary" : "")) + '" href="' + esc(a.href) + '"' +
        (a.ext ? ' target="_blank" rel="noopener"' : "") + ">" + W.ICONS[a.icon] + esc(a.label) + "</a>";
    }).join("") + "</div>";
  }
  function day(s) { return s ? W.fmtDay(s, true) : ""; }
  function whenAppt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function qty(name, n) { return esc(name || "Item") + (n && n > 1 ? " × " + esc(n) : ""); }

  function renderHead() {
    var g = data.gemach;
    applyTheme(g);
    $("m-back").href = W.gemachUrl(g.slug);
    $("m-back").innerHTML = '<span aria-hidden="true">←</span> ' + esc(g.name);
    $("m-head").innerHTML = '<h1 class="g-name">' + (data.request.type === "Appointment" ? "Your appointment request" : "Your request") + "</h1>" +
      (data.request.requestId ? '<p class="tagline">Request ' + esc(data.request.requestId) + "</p>" : "") + contactRow(g, true);
    document.title = "Your request — " + g.name;
  }

  function actionsHtml() {
    var c = data.can || {}, out = [];
    if (c.cancel) {
      if (confirming === "cancel") {
        var what = data.request.status === "waiting" ? "your request" : data.request.type === "Appointment" ? "your appointment" : "your reservation";
        out.push('<div class="m-confirm" role="group" aria-label="Confirm cancel"><p><strong>Cancel ' + what + "?</strong> " +
          (data.request.status === "waiting" ? "The gemach will be told." : "The items go back to the gemach for others, and the gemach will be told.") + "</p>" +
          '<div class="m-actions"><button type="button" class="btn btn-danger" data-act="cancel-yes"' + (busy ? " disabled" : "") + ">" + (busy ? "Cancelling…" : "Yes, cancel") + "</button>" +
          '<button type="button" class="btn" data-act="cancel-no"' + (busy ? " disabled" : "") + ">Keep it</button></div></div>");
      } else {
        out.push('<button type="button" class="btn" data-act="cancel">' + (data.request.status === "waiting" ? "Cancel request" : data.request.type === "Appointment" ? "Cancel appointment" : "Cancel reservation") + "</button>");
      }
    }
    if (c.readyToReturn) {
      out.push('<button type="button" class="btn btn-primary" data-act="ready"' + (busy ? " disabled" : "") + ">" + (busy ? "Sending…" : "I’m ready to return it") + "</button>");
    }
    if (!out.length) return "";
    return '<div class="m-actions-wrap">' + (confirming ? "" : '<h2 class="m-h2">What would you like to do?</h2>') +
      (confirming ? out.join("") : '<div class="m-actions">' + out.join("") + "</div>") +
      (c.readyToReturn && !confirming ? '<p class="field-hint">This lets the gemach know so they can arrange the return with you.</p>' : "") + "</div>";
  }

  function render() {
    renderHead();
    var r = data.request, st = STATUS[r.status] || STATUS.closed;
    var rows = [];
    if (r.type === "Appointment") {
      if (r.appointmentAt) rows.push(["Appointment", esc(whenAppt(r.appointmentAt))]);
      if (r.eventDate) rows.push([esc(data.gemach.eventLabel || "Event date"), esc(day(r.eventDate))]);
    } else {
      if (r.eventDate) rows.push([esc(data.gemach.eventLabel || "Event date"), esc(day(r.eventDate))]);
      if (r.neededFrom) rows.push(["Dates", esc(day(r.neededFrom)) + " → " + (r.neededUntil ? esc(day(r.neededUntil)) : r.openEnded ? "open-ended" : "—")]);
    }
    var items = r.items.length ? '<ul class="m-items">' + r.items.map(function (i) {
      return "<li>" + qty(i.name, i.quantity) + (i.addon ? ' <span class="badge badge-addon">Add-on</span>' : "") + "</li>";
    }).join("") + "</ul>" : "";
    var loans = (data.loans || []).filter(function (l) { return l.status !== "Cancelled" || r.status === "cancelled"; });
    var loanRows = loans.length && r.status !== "waiting" ? '<ul class="m-loans">' + loans.map(function (l) {
      var sub = l.status === "Active"
        ? (l.dateBorrowed ? "Picked up " + esc(day(l.dateBorrowed)) : "Picked up") + (l.expectedReturn ? " · due back " + esc(day(l.expectedReturn)) : "")
        : l.status === "Reserved" ? (l.reservationStart ? "From " + esc(day(l.reservationStart)) + (l.reservationEnd ? " to " + esc(day(l.reservationEnd)) : "") : "")
        : "";
      return '<li><div><div class="m-loan-name">' + qty(l.itemName, l.quantity) + "</div>" + (sub ? '<div class="m-loan-sub">' + sub + "</div>" : "") + "</div>" +
        '<span class="badge ' + (l.status === "Active" ? "badge-ok" : l.status === "Reserved" ? "badge-soon" : "badge-dir") + '">' + esc(LOAN_STATUS[l.status] || l.status || "") + "</span>" +
        (l.readyToReturnAt ? '<span class="badge badge-ok">Gemach notified</span>' : "") + "</li>";
    }).join("") + "</ul>" : "";

    $("m-body").innerHTML =
      (flash ? '<div class="notice notice-ok m-flash" role="status">' + esc(flash) + "</div>" : "") +
      (data.test ? '<div class="test-banner" role="note"><strong>Test request</strong> <span>Sent from the gemach’s test link — it isn’t a real loan.</span></div>' : "") +
      '<section class="m-card" aria-labelledby="m-status">' +
        (r.firstName ? '<p class="m-hi">Hi ' + esc(r.firstName) + ",</p>" : "") +
        '<p class="m-status ' + st[2] + '" id="m-status">' + esc(st[0]) + "</p>" +
        (st[1] ? '<p class="m-status-sub">' + esc(st[1]) + "</p>" : "") +
        (rows.length ? '<dl class="m-facts">' + rows.map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>"; }).join("") + "</dl>" : "") +
        (items ? '<h2 class="m-h2">' + (r.type === "Appointment" ? (loanRows ? "Items you asked to see" : "Items you’d like to see") : "Items") + "</h2>" + items : "") +
        (loanRows ? '<h2 class="m-h2">' + (r.type === "Appointment" ? "What you borrowed" : "Status by item") + "</h2>" + loanRows : "") +
        (data.partlyOut ? '<p class="field-hint">Some items are already picked up; cancelling releases only the ones still reserved.</p>' : "") +
        actionsHtml() +
      "</section>" +
      '<section class="m-help"><h2 class="m-h2">Need something else?</h2><p>To change dates or ask a question, contact ' + esc(data.gemach.name) + " directly.</p>" +
        contactRow(data.gemach, false) + "</section>" +
      '<p class="m-private">This page is private to you. Please don’t share the link.</p>';
  }

  function renderError(msg, expired) {
    $("m-head").innerHTML = "<h1 class=\"g-name\">" + (expired ? "This link has expired" : "We couldn’t open this link") + "</h1>";
    $("m-body").innerHTML = '<div class="empty-state"><div class="big" aria-hidden="true">' + (expired ? "⌛" : "🔗") + "</div>" +
      "<p>" + esc(msg) + "</p>" +
      '<p><a class="btn btn-primary" href="/">See all gemachs</a></p>' +
      '<p>Questions? Email <a href="mailto:' + W.CONTACT_EMAIL + '">' + W.CONTACT_EMAIL + "</a>.</p></div>";
  }

  function load() {
    if (!/^rec[A-Za-z0-9]{14}\.[A-Za-z0-9_-]{22}$/.test(token)) { renderError("This link isn’t complete. Please use the full link you were sent."); return; }
    W.fetchJSON("/public/manage/" + encodeURIComponent(token), { timeout: 20000 }).then(function (d) {
      data = d; render();
    }).catch(function (e) {
      if (e && (e.status === 404 || e.status === 410)) {
        if (e.status === 410) W.me.removeRequest(location.origin + "/r/" + token);
        renderError(e.message || "Please contact the gemach.", e.status === 410);
      } else renderError("Please check your connection and try again.");
    });
  }

  function post(action, doneMsg) {
    busy = true; render();
    W.fetchJSON("/public/manage/" + encodeURIComponent(token) + "/" + action, { method: "POST", body: {}, retry: false, timeout: 20000 }).then(function (d) {
      busy = false; confirming = null;
      if (d && d.request) data = d;
      flash = doneMsg;
      render();
      var f = document.querySelector(".m-flash"); if (f) { f.setAttribute("tabindex", "-1"); f.focus(); }
    }).catch(function (e) {
      busy = false; confirming = null;
      flash = "";
      render();
      var box = document.querySelector(".m-actions-wrap") || $("m-body");
      var p = document.createElement("p");
      p.className = "error-msg"; p.setAttribute("role", "alert");
      p.textContent = (e && e.message && e.status < 500 ? e.message : "That didn’t go through. Please try again, or contact the gemach.");
      box.appendChild(p);
    });
  }

  $("m-body").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b || busy) return;
    var act = b.getAttribute("data-act");
    if (act === "cancel") { confirming = "cancel"; flash = ""; render(); var y = document.querySelector('[data-act="cancel-yes"]'); if (y) y.focus(); }
    else if (act === "cancel-no") { confirming = null; render(); }
    else if (act === "cancel-yes") post("cancel", "Cancelled. The gemach has been told.");
    else if (act === "ready") post("ready", "Thanks — the gemach has been told and will be in touch to arrange the return.");
  });

  load();
})();
