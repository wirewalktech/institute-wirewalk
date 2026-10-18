/*
 * /learn/team/ : teams and seats (learning Worker /api/org/*, /api/seats/quote).
 *
 *   /learn/team/                      your teams, invitations, teams you can join by domain, create a team
 *   /learn/team/?org=<id>             manage one team (owner/manager): seats, members, invitations,
 *                                     domains, progress and CSV export, seat purchases
 *   /learn/team/#join=<token>         accept an emailed invitation (older links: ?join=)
 *   /learn/team/?buy=course:<id>&qty=N    buy seats (from "Buy for your team" on course and program pages)
 *   /learn/team/?org=<id>&session=cs_  back from Stripe: waits for the payment, then shows the seats
 *   (training campaigns live on /learn/team/campaigns/, assets/js/learn/campaigns.js)
 *
 * Every price comes from the Worker (which asks billing); nothing here computes one.
 * Everything from the API is rendered as text (WL.h), never as HTML.
 */
(function () {
  "use strict";
  /* [review-fixes] The invitation token arrives in the fragment (#join=, never sent to a server,
     a Referer or a pixel); older links used ?join=. It is removed from the address bar at once. */
  function takeJoin() {
    var v = "";
    try { v = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("join") || ""; } catch (e) { v = ""; }
    if (!v) { try { v = new URLSearchParams(location.search).get("join") || ""; } catch (e) { v = ""; } }
    if (v) {
      try {
        var q = new URLSearchParams(location.search); q.delete("join");
        var rest = q.toString();
        history.replaceState(history.state, "", location.pathname + (rest ? "?" + rest : ""));
      } catch (e) { /* ignore */ }
      /* Kept for this tab only, so it survives the sign-in redirect (which keeps no fragment). */
      try { sessionStorage.setItem("wia_join", v); } catch (e) { /* storage blocked */ }
    } else {
      try { v = sessionStorage.getItem("wia_join") || ""; } catch (e) { v = ""; }
    }
    return v || null;
  }
  function forgetJoin() { try { sessionStorage.removeItem("wia_join"); } catch (e) { /* ignore */ } }
  var API = window.WIAApi, W = window.WL, h = W.h;
  /* [org-agreements] The invoice minimum comes from billing's seat quote (invoiceMinSeats,
     invoiceAvailable), because an organization's agreement can lower it. DEFAULT_INVOICE_MIN is
     only what is shown before the first quote arrives, or when billing does not send it yet. */
  var MIN = 5, MAX = 1000, DEFAULT_INVOICE_MIN = 25;
  var PO_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,59}$/;
  var cfgEl = document.getElementById("wl-team-config");
  var ENQUIRY = cfgEl ? cfgEl.getAttribute("data-enquiry") : "";
  var SITE = cfgEl ? (cfgEl.getAttribute("data-site") || "").replace(/\/+$/, "") : "";
  var enc = encodeURIComponent;

  function req(method, path, body, opts) { return API.request(method, path, body, opts); }
  function teamUrl(orgId) { return "/learn/team/?org=" + enc(orgId); }
  function head(eyebrow, title, lead) {
    return h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, eyebrow), h("h1", { class: "wl-display" }, title),
      lead ? h("p", { class: "wl-lead" }, lead) : null);
  }
  function section(title, id) {
    return h("section", { class: "wl-section wl-card-plain", "aria-labelledby": id }, h("h2", { id: id, class: "wl-h3" }, title));
  }
  function itemTitle(kind, id) { return kind === "program" ? W.programTitle(id) : W.courseTitle(id); }
  function tableOf(headers, rows) {
    var thead = h("tr", null, headers.map(function (x) { return h("th", { scope: "col" }, x); }));
    return h("div", { class: "wl-table-wrap" }, h("table", null, h("thead", null, thead), h("tbody", null, rows)));
  }
  function notAvailable() {
    W.mount(h("div", { class: "wl-narrow" }, head("Team", "Team seats"),
      W.notice("info", "Not available yet", "Team seats are being switched on. In the meantime, email sales@wirewalk.com and we will set your team up.",
        [W.btn("Team enquiries", { href: "/teams/" })])));
  }

  /* ------------------------------------------------------------------ boot */
  function load() {
    var join = takeJoin();
    if (!W.requireAuth()) return;
    var buy = W.param("buy"), org = W.param("org");
    if (join) return joinByToken(join);
    W.loading("Loading your teams…");
    req("GET", "/api/org").then(function (list) {
      if (!list.available) return notAvailable();
      if (buy) return buyView(list, buy);
      if (org) return orgView(list, org);
      overview(list);
    }, function (err) { if (err.status !== 401) W.mount(W.errorView(err, load)); });
  }

  function joinByToken(token) {
    W.loading("Accepting the invitation…");
    req("POST", "/api/org/join", { token: token }).then(function (d) {
      forgetJoin();
      try { window.history.replaceState(null, "", teamUrl(d.org.id)); } catch (e) { /* ignore */ }
      W.mount(h("div", { class: "wl-narrow" }, head("Team", "You joined " + d.org.name),
        W.notice("ok", "Welcome to the team", "A manager can now give you a seat in a course or program. It will appear on your dashboard as soon as they do.",
          [W.btn("Go to your dashboard", { href: "/learn/" })])));
    }, function (err) {
      if (err.status === 401) return;
      forgetJoin();
      W.mount(h("div", { class: "wl-narrow" }, head("Team", "Invitation"),
        W.notice("error", "We could not accept this invitation", err.message, [W.btn("Your teams", { href: "/learn/team/", class: "wl-btn-ghost" })])));
    });
  }

  /* -------------------------------------------------------------- overview */
  function overview(list) {
    W.setTitle("Team");
    var managed = list.orgs.filter(function (o) { return o.role !== "member"; });
    var parts = [head("Team", "Your teams", "Buy seats for a team, invite people, give them courses and follow their progress.")];
    var mine = section("Teams you belong to", "t-mine");
    if (!list.orgs.length) mine.appendChild(h("p", { class: "wl-hint" }, "You are not in a team yet."));
    list.orgs.forEach(function (o) {
      mine.appendChild(h("div", { class: "wl-list-row" },
        h("div", { class: "wl-grow" }, h("strong", null, o.name), " ", W.chip(o.role, o.role === "owner" ? "ac" : "")),
        o.role === "member" ? leaveBtn(o) : W.btn("Manage", { href: teamUrl(o.id), class: "wl-btn-sm" })));
    });
    parts.push(mine);
    if (list.invitations.length || list.joinable.length) {
      var inv = section("Invitations", "t-inv");
      list.invitations.forEach(function (o) {
        var b = W.btn("Accept", { class: "wl-btn-sm" });
        b.addEventListener("click", function () {
          W.busy(b, req("POST", "/api/org/" + enc(o.id) + "/accept", {})).then(function () { W.toast("You joined " + o.name + ".", "ok"); load(); },
            function (e) { W.toast(e.message, "bad"); });
        });
        inv.appendChild(h("div", { class: "wl-list-row" }, h("div", { class: "wl-grow" }, h("strong", null, o.name), " invited you"), b));
      });
      if (list.invitations.length && !list.emailVerified)
        inv.appendChild(h("p", { class: "wl-hint" }, "Use the link in the invitation email, or ", h("a", { href: "/learn/account/" }, "verify your email"), " to accept here."));
      list.joinable.forEach(function (o) {
        var b = W.btn("Join", { class: "wl-btn-sm" });
        b.addEventListener("click", function () {
          W.busy(b, req("POST", "/api/org/" + enc(o.id) + "/join", {})).then(function () { W.toast("You joined " + o.name + ".", "ok"); load(); },
            function (e) { W.toast(e.message, "bad"); });
        });
        inv.appendChild(h("div", { class: "wl-list-row" }, h("div", { class: "wl-grow" }, h("strong", null, o.name),
          h("span", { class: "wl-hint" }, " — open to verified @" + o.domain + " addresses")), b));
      });
      parts.push(inv);
    }
    parts.push(createTeamSection(list, function (org) { window.location.assign(teamUrl(org.id)); }));
    if (managed.length) parts.push(h("p", { class: "wl-hint" }, "To buy seats, use “Buy for your team” on any ", h("a", { href: "/courses/" }, "course"), " or ",
      h("a", { href: "/programs/" }, "program"), " page, or the Seats section of a team you manage."));
    W.mount(h("div", { class: "wl-narrow" }, parts));
  }

  function leaveBtn(o) {
    var b = W.btn("Leave", { class: "wl-btn-sm wl-btn-ghost" });
    b.addEventListener("click", function () {
      if (!window.confirm("Leave " + o.name + "? Any seat you hold from this team is released and you lose access to those courses.")) return;
      W.busy(b, req("POST", "/api/org/" + enc(o.id) + "/leave", {})).then(function () { W.toast("You left " + o.name + ".", "ok"); load(); },
        function (e) { W.toast(e.message, "bad"); });
    });
    return b;
  }

  function createTeamSection(list, done) {
    var s = section("Create a team", "t-new");
    if (!list.emailVerified) {
      s.appendChild(h("p", { class: "wl-hint" }, "Creating a team needs a verified email address. ", h("a", { href: "/learn/account/" }, "Verify your email"), " first."));
      return s;
    }
    var form = h("form", { class: "wl-form", novalidate: true },
      W.field({ label: "Team or company name", name: "name", required: true, maxlength: "120", autocomplete: "organization" }),
      W.field({ label: "Billing email", name: "billingEmail", type: "email", optional: true, maxlength: "200",
        hint: "Where invoices should go, if you pay by invoice." }),
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn" }, "Create team")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.querySelector('[name="name"]').value.trim(), be = form.querySelector('[name="billingEmail"]').value.trim();
      if (name.length < 2) { W.formError(form, "Give the team a name."); return; }
      W.formError(form, "");
      W.busy(form.querySelector("[type=submit]"), req("POST", "/api/org", { name: name, billingEmail: be || null }), "Creating…")
        .then(function (d) { done(d.org); }, function (err) { W.formError(form, err.message); });
    });
    s.appendChild(form);
    return s;
  }

  /* --------------------------------------------------------------- buying */
  function parseBuy(v) {
    var m = /^(course|program):([a-z0-9-]{1,60})$/.exec(String(v || ""));
    return m ? { kind: m[1], id: m[2] } : null;
  }

  function buyView(list, buyParam, presetOrg) {
    var item = parseBuy(buyParam);
    W.setTitle("Buy seats");
    if (!item) { W.mount(h("div", { class: "wl-narrow" }, head("Team", "Buy seats"), W.notice("error", "Choose a course or program first", null, [W.btn("Browse courses", { href: "/courses/" })]))); return; }
    var managed = list.orgs.filter(function (o) { return o.role === "owner" || o.role === "manager"; });
    var title = itemTitle(item.kind, item.id);
    var parts = [head("Team seats", "Buy " + title + " for your team",
      "Each seat gives one team member the " + (item.kind === "program" ? "program's courses" : "course") + ", with their own progress, exam attempts and certificate. You choose who gets a seat after paying.")];
    if (!managed.length) {
      parts.push(W.notice("info", "First, create your team", "Seats belong to a team that you own or manage."));
      parts.push(createTeamSection(list, function () { load(); }));
      W.mount(h("div", { class: "wl-narrow" }, parts));
      return;
    }
    var qty0 = parseInt(W.param("qty"), 10);
    var orgSel = h("select", { id: "b-org", name: "org" }, managed.map(function (o) { return h("option", { value: o.id, selected: (presetOrg || W.param("org")) === o.id }, o.name); }));
    var qty = h("input", { id: "b-qty", type: "number", min: String(MIN), max: String(MAX), step: "1", inputmode: "numeric", value: String(qty0 >= MIN && qty0 <= MAX ? qty0 : MIN) });
    var code = h("input", { id: "b-code", type: "text", maxlength: "40", autocomplete: "off", spellcheck: "false" });
    var payCard = h("input", { type: "radio", name: "pay", value: "card", checked: true, id: "b-card" });
    var payInv = h("input", { type: "radio", name: "pay", value: "invoice", id: "b-inv" });
    var invNote = h("p", { class: "wl-hint" });
    /* [org-agreements] Purchase order number, shown for invoice payment; required when the
       organization's agreement asks for one and has no blanket PO on file. */
    var po = h("input", { id: "b-po", type: "text", maxlength: "60", autocomplete: "off", spellcheck: "false", "aria-describedby": "b-po-hint" });
    var poHint = h("p", { class: "wl-hint", id: "b-po-hint" }, "Printed on the invoice. Letters, digits, spaces and . _ / - only.");
    var poLabel = h("label", { for: "b-po" }, "Purchase order number", h("span", { class: "wl-opt" }, " (optional)"));
    var poWrap = h("div", { class: "wl-field", hidden: true }, poLabel, po, poHint);
    var agreementBox = h("div", { "aria-live": "polite" });
    var priceBox = h("div", { class: "wl-totals", "aria-live": "polite" });
    var err = h("div", { role: "alert", class: "wl-form-error", hidden: true });
    var go = h("button", { type: "button", class: "wl-btn wl-btn-block", disabled: true }, "Check out");
    var quote = null, seq = 0, timer = null;
    var invMin = DEFAULT_INVOICE_MIN, agreement = null, orgTerms = {};

    function n() { var v = Number(qty.value); return Number.isInteger(v) ? v : NaN; }
    /* The org's agreement for buyers (GET /api/org/:id/agreement, managers only): used for the
       blanket-PO flag. Not deployed yet (404/503) or no agreement: null, and the page works as before. */
    function loadTerms(orgId) {
      if (Object.prototype.hasOwnProperty.call(orgTerms, orgId)) return Promise.resolve(orgTerms[orgId]);
      return req("GET", "/api/org/" + enc(orgId) + "/agreement", undefined, { quiet401: true }).then(function (r) {
        orgTerms[orgId] = (r && r.agreement) || null;
        return orgTerms[orgId];
      }, function () { orgTerms[orgId] = null; return null; });
    }
    function poRequired() {
      var t = orgTerms[orgSel.value];
      return !!(agreement && agreement.poRequired && !(t && t.hasBlanketPo));
    }
    function setInvoice(available) {
      payInv.disabled = !available;
      if (!available && payInv.checked) payCard.checked = true;
      var terms = agreement && agreement.invoiceAllowed && agreement.paymentTermsDays ? " Payment terms: net " + agreement.paymentTermsDays + " days." : "";
      invNote.textContent = available ? "Pay by invoice: we record the order, our team sends the invoice, and the seats appear once it is paid." + terms
                                      : "Invoice payment is available from " + invMin + " seats.";
    }
    function syncPay() {
      var invoice = payInv.checked && !payInv.disabled;
      poWrap.hidden = !invoice;
      var req0 = poRequired();
      W.clear(poLabel).appendChild(document.createTextNode("Purchase order number"));
      poLabel.appendChild(req0 ? h("span", { class: "wl-opt" }, " (required by your organization's agreement)") : h("span", { class: "wl-opt" }, " (optional)"));
      po.required = invoice && req0;
      var t = orgTerms[orgSel.value];
      poHint.textContent = (t && t.hasBlanketPo ? "Leave empty to use the purchase order on file for your agreement. " : "") + "Printed on the invoice. Letters, digits, spaces and . _ / - only.";
      if (quote) {
        var f = quote.formatted || {};
        go.textContent = invoice ? "Request an invoice for " + (f.total || W.money(quote.total)) : "Pay " + (f.total || W.money(quote.total)) + " securely";
      }
    }
    function showAgreement() {
      W.clear(agreementBox);
      if (!agreement || !agreement.label) return;
      var bits = [];
      if (agreement.invoiceAllowed) bits.push("invoice from " + W.plural(agreement.invoiceMinSeats || invMin, "seat") + (agreement.paymentTermsDays ? ", net " + agreement.paymentTermsDays + " days" : ""));
      if (agreement.poRequired) bits.push(orgTerms[orgSel.value] && orgTerms[orgSel.value].hasBlanketPo ? "purchase order on file" : "purchase order number required");
      agreementBox.appendChild(W.notice("info", "Your organization's agreement: " + agreement.label,
        (bits.length ? bits.join("; ") + ". " : "") + "It is one offer among the others: the single best price below applies."));
    }
    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = n(), my = ++seq, orgId = orgSel.value;
        quote = null; go.disabled = true;
        /* Until billing answers, the last known minimum decides; the quote then says exactly. */
        setInvoice(q >= invMin);
        syncPay();
        if (!(q >= MIN && q <= MAX)) { W.clear(priceBox).appendChild(h("p", { class: "wl-hint" }, "Choose " + MIN + " to " + MAX + " seats.")); return; }
        W.clear(priceBox).appendChild(W.spinner("Pricing…"));
        Promise.all([
          req("POST", "/api/seats/quote", { id: item.id, of: item.kind, quantity: q, orgId: orgId, code: code.value.trim() || undefined }, { auth: "optional" }),
          loadTerms(orgId)
        ]).then(function (res) {
          var d = res[0];
          if (my !== seq) return;
          quote = d;
          agreement = d.agreement && typeof d.agreement === "object" ? d.agreement : null;
          if (Number.isInteger(d.invoiceMinSeats) && d.invoiceMinSeats > 0) invMin = d.invoiceMinSeats;
          setInvoice(typeof d.invoiceAvailable === "boolean" ? d.invoiceAvailable : q >= invMin);
          showAgreement();
          var l = (d.lines || [])[0] || {};
          var f = d.formatted || {};
          W.clear(priceBox).appendChild(h("dl", { class: "wl-facts" },
            h("div", null, h("dt", null, "List price per seat"), h("dd", null, f.unit || W.money(l.unit))),
            l.discountLabel ? h("div", null, h("dt", null, l.discountLabel), h("dd", null, "−" + W.money(l.unitDiscount) + " per seat")) : null,
            h("div", null, h("dt", null, "Price per seat"), h("dd", null, f.unitPrice || W.money(l.unitPrice))),
            h("div", null, h("dt", null, "Seats"), h("dd", null, String(l.quantity))),
            h("div", null, h("dt", null, h("strong", null, "Total")), h("dd", null, h("strong", null, f.total || W.money(d.total))))));
          if (d.code && d.code.status && d.code.status !== "applied")
            priceBox.appendChild(h("p", { class: "wl-hint" }, d.code.status === "better_offer_applied" ? "Your code works, but a better offer is already applied." : "That code does not apply to this order."));
          priceBox.appendChild(h("p", { class: "wl-hint" }, "Team pricing, program bundles, your organization's agreement and discount codes do not add up: the single best one applies, as for any order."));
          go.disabled = false;
          syncPay();
        }, function (e) {
          if (my !== seq) return;
          W.clear(priceBox).appendChild(h("p", { class: "wl-tone-warn" }, e.message));
        });
      }, 250);
    }
    [qty, code].forEach(function (x) { x.addEventListener("input", refresh); });
    [payCard, payInv].forEach(function (x) { x.addEventListener("change", refresh); });
    orgSel.addEventListener("change", function () { agreement = null; invMin = DEFAULT_INVOICE_MIN; W.clear(agreementBox); refresh(); });

    go.addEventListener("click", function () {
      if (!quote) return;
      err.hidden = true;
      var orgId = orgSel.value, invoice = payInv.checked && !payInv.disabled;
      var poNumber = invoice ? po.value.trim() : "";
      if (invoice && poNumber && !PO_RE.test(poNumber)) { err.textContent = "Use letters, digits, spaces and . _ / - in the purchase order number (60 characters at most)."; err.hidden = false; po.focus(); return; }
      if (invoice && !poNumber && poRequired()) { err.textContent = "Your organization's agreement needs a purchase order number for an invoice."; err.hidden = false; po.focus(); return; }
      var p = req("POST", "/api/org/" + enc(orgId) + "/seats/checkout",
        { id: item.id, of: item.kind, quantity: n(), code: code.value.trim() || undefined, payment: invoice ? "invoice" : "card",
          poNumber: poNumber || undefined, cancelPath: "/learn/team/" });
      W.busy(go, p, invoice ? "Recording the request…" : "Starting checkout…").then(function (d) {
        if (d.invoice) return sendEnquiry(orgId, d);
        var u;
        try { u = new URL(d.url); } catch (e) { u = null; }
        if (!u || u.protocol !== "https:") { err.textContent = "Checkout could not be started. Please try again."; err.hidden = false; return; }
        go.disabled = true; go.textContent = "Redirecting to Stripe…";
        window.location.assign(u.href);
      }, function (e) {
        err.textContent = e.message; err.hidden = false;
        if (e.data && e.data.field === "poNumber") { poWrap.hidden = false; po.focus(); }
      });
    });

    var orgField = managed.length > 1
      ? h("div", { class: "wl-field" }, h("label", { for: "b-org" }, "Team"), orgSel)
      : h("p", null, "Team: ", h("strong", null, managed[0].name));
    parts.push(h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "b-h" },
      h("h2", { id: "b-h", class: "wl-h3" }, title),
      orgField,
      h("div", { class: "wl-field" }, h("label", { for: "b-qty" }, "Number of seats"), qty,
        h("p", { class: "wl-hint" }, MIN + " to " + MAX + ". Volume pricing applies automatically; the price below is the one checkout charges.")),
      h("div", { class: "wl-field" }, h("label", { for: "b-code" }, "Discount code", h("span", { class: "wl-opt" }, " (optional)")), code),
      /* [org-agreements] .wl-choice options (the lesson-tick class .wl-check drew the labels as 20px circles). */
      h("fieldset", { class: "wl-choice" }, h("legend", null, "Payment"),
        h("label", { class: "wl-choice-opt", for: "b-card" }, payCard, h("span", null, "Card, now (Stripe)")),
        h("label", { class: "wl-choice-opt", for: "b-inv" }, payInv, h("span", null, "Invoice / purchase order"))),
      invNote,
      poWrap, agreementBox, priceBox, err, go,
      h("p", { class: "wl-hint" }, "Need something else, such as a written quote first? ", h("a", { href: "/teams/#enquiry" }, "Ask us"),
        ", or ask about ", h("a", { href: "/teams/enterprise/" }, "pricing for your organization"), ".")));
    W.mount(h("div", { class: "wl-narrow" }, parts));
    refresh();
  }

  /* The invoice request was recorded by billing (status invoice_requested). Send it to
     the sales inbox through the portal's inquiry endpoint, the same channel as /teams/. */
  function sendEnquiry(orgId, d) {
    var back = SITE + "/learn/team/?org=" + enc(orgId) + "&invoice=" + enc(d.purchaseId);
    if (!ENQUIRY) {
      W.mount(h("div", { class: "wl-narrow" }, head("Team seats", "Invoice requested"),
        W.notice("ok", "Your request " + d.purchaseId + " is recorded", "Email sales@wirewalk.com with this reference and your billing details; seats appear once the invoice is paid.",
          [W.btn("Back to your team", { href: teamUrl(orgId) })])));
      return;
    }
    var form = h("form", { method: "POST", action: ENQUIRY, hidden: true });
    var fields = Object.assign({}, d.enquiry || {}, { _next: back, _honey: "" });
    Object.keys(fields).forEach(function (k) { form.appendChild(h("input", { type: "hidden", name: k, value: String(fields[k] == null ? "" : fields[k]) })); });
    document.body.appendChild(form);
    form.submit();
  }

  /* -------------------------------------------------------------- one team */
  function orgView(list, orgId) {
    var mine = list.orgs.filter(function (o) { return o.id === orgId; })[0];
    if (mine && mine.role === "member") {
      W.mount(h("div", { class: "wl-narrow" }, head("Team", mine.name),
        W.notice("info", "You are a member of this team", "Seats the team gives you appear on your dashboard.", [W.btn("Dashboard", { href: "/learn/" }), leaveBtn(mine)])));
      return;
    }
    var session = W.param("session");
    if (session && /^cs_[A-Za-z0-9_]{1,200}$/.test(session)) return awaitPayment(list, orgId, session);
    W.loading("Loading the team…");
    req("GET", "/api/org/" + enc(orgId)).then(function (d) { renderOrg(list, d); }, function (err) {
      if (err.status === 401) return;
      W.mount(W.errorView(err, function () { orgView(list, orgId); }, { notFound: { title: "Team not found", body: "It does not exist, or you are not one of its managers.", href: "/learn/team/", label: "Your teams" } }));
    });
  }

  function awaitPayment(list, orgId, session) {
    var started = Date.now();
    W.mount(h("div", { class: "wl-narrow wl-center-block" }, h("div", { class: "wl-pulse", "aria-hidden": "true" }),
      h("h1", { class: "wl-display" }, "Confirming your payment…"), h("p", { class: "wl-lead" }, "Your seats appear as soon as Stripe confirms the payment.")));
    (function poll() {
      API.purchaseBySession(session).then(function (p) {
        if (p.status === "paid") {
          try { window.history.replaceState(null, "", teamUrl(orgId)); } catch (e) { /* ignore */ }
          W.toast("Payment confirmed. Your seats are ready.", "ok");
          return req("GET", "/api/org/" + enc(orgId)).then(function (d) { renderOrg(list, d); });
        }
        if (Date.now() - started > 120000) {
          W.mount(h("div", { class: "wl-narrow" }, W.notice("warn", "Still waiting for Stripe", "This can take a few minutes. Reload this page later; if the seats have not appeared within an hour, email sales@wirewalk.com.",
            [W.btn("Open the team", { href: teamUrl(orgId) })])));
          return;
        }
        setTimeout(poll, 3000);
      }, function (e) { if (e.status !== 401) W.mount(W.errorView(e, function () { awaitPayment(list, orgId, session); })); });
    })();
  }

  function renderOrg(list, d) {
    var org = d.org, owner = d.role === "owner";
    W.setTitle(org.name);
    var reload = function () { req("GET", "/api/org/" + enc(org.id)).then(function (x) { renderOrg(list, x); }, function (e) { W.toast(e.message, "bad"); }); };
    var parts = [head("Team · " + d.role, org.name)];
    var inv = W.param("invoice");
    if (inv) parts.push(W.notice("ok", "Invoice requested", "Your request " + inv + " is recorded and our team has been notified. Seats appear here once the invoice is paid."));
    if (!d.mailConfigured) parts.push(W.notice("warn", "Invitation email is not switched on yet", "Invitations are recorded, but no email goes out. Invited people can accept from their Team page once they sign in with the invited address and verify it."));

    var joinedMembers = d.members.filter(function (m) { return m.status === "joined"; });
    parts.push(seatsSection(org, d, joinedMembers, reload));
    parts.push(membersSection(org, d, owner, reload));
    parts.push(inviteSection(org, owner, reload));
    if (owner) parts.push(domainsSection(org, reload));
    parts.push(campaignsSection(org));
    parts.push(progressSection(org));
    parts.push(purchasesSection(d));
    W.mount(h("div", null, parts));
  }

  function seatsSection(org, d, joinedMembers, reload) {
    var s = section("Seats", "o-seats");
    var buy = h("form", { class: "wl-form-row", action: "/learn/team/", method: "get" });
    var pick = h("select", { name: "buy", "aria-label": "Course or program" });
    var cat = W.catalog();
    var progIds = Object.keys(cat.programs).filter(function (id) { return cat.programs[id].s === "on_sale"; });
    var courseIds = Object.keys(cat.courses).filter(function (id) { return cat.courses[id].s === "on_sale"; });
    if (progIds.length) pick.appendChild(h("optgroup", { label: "Programs" }, progIds.map(function (id) { return h("option", { value: "program:" + id }, cat.programs[id].t); })));
    pick.appendChild(h("optgroup", { label: "Courses" }, courseIds.map(function (id) { return h("option", { value: "course:" + id }, id + " — " + cat.courses[id].t); })));
    buy.appendChild(h("input", { type: "hidden", name: "org", value: org.id }));
    buy.appendChild(pick);
    buy.appendChild(h("button", { type: "submit", class: "wl-btn wl-btn-sm" }, "Buy seats"));
    if (!d.pools.length) s.appendChild(h("p", { class: "wl-hint" }, "No seats yet. Buy seats in a course or program, then give them to members here."));
    d.pools.forEach(function (p) {
      var holders = joinedMembers.filter(function (m) { return m.seats.indexOf(p.id) >= 0; });
      var free = joinedMembers.filter(function (m) { return m.seats.indexOf(p.id) < 0; });
      var state = p.revoked ? W.chip("revoked", "bad") : p.expired ? W.chip("expired", "warn") : W.chip(p.seatsUsed + " of " + p.seatsTotal + " used", p.seatsFree ? "ok" : "warn");
      var box = h("div", { class: "wl-card-plain wl-section" }, h("p", null, h("strong", null, p.title), " ", h("span", { class: "wl-hint" }, p.kind), " ", state));
      if (!p.revoked && !p.expired && p.seatsFree > 0 && free.length) {
        var sel = h("select", { "aria-label": "Member to give a seat" }, free.map(function (m) { return h("option", { value: m.id }, (m.name || m.email) + (m.name ? " (" + m.email + ")" : "")); }));
        var b = W.btn("Give a seat", { class: "wl-btn-sm" });
        b.addEventListener("click", function () {
          W.busy(b, req("POST", "/api/org/" + enc(org.id) + "/seats/assign", { poolId: p.id, memberId: sel.value }))
            .then(function () { W.toast("Seat given.", "ok"); reload(); }, function (e) { W.toast(e.message, "bad"); });
        });
        box.appendChild(h("div", { class: "wl-form-row" }, sel, b));
      } else if (!p.revoked && p.seatsFree > 0 && !free.length) {
        box.appendChild(h("p", { class: "wl-hint" }, "Invite people below; once they join you can give them a seat."));
      }
      holders.forEach(function (m) {
        var u = W.btn("Release", { class: "wl-btn-sm wl-btn-ghost" });
        u.addEventListener("click", function () {
          if (!window.confirm("Release " + (m.name || m.email) + "'s seat? They lose access to the course(s) it gave them; their progress is kept if the seat is given back.")) return;
          W.busy(u, req("POST", "/api/org/" + enc(org.id) + "/seats/unassign", { poolId: p.id, memberId: m.id }))
            .then(function () { W.toast("Seat released.", "ok"); reload(); }, function (e) { W.toast(e.message, "bad"); });
        });
        box.appendChild(h("div", { class: "wl-list-row" }, h("span", { class: "wl-grow" }, m.name || m.email), p.revoked ? null : u));
      });
      s.appendChild(box);
    });
    s.appendChild(h("p", { class: "wl-hint" }, "Buy more seats:"));
    s.appendChild(buy);
    return s;
  }

  function membersSection(org, d, owner, reload) {
    var s = section("Members and invitations", "o-mem");
    var rows = d.members.map(function (m) {
      var actions = h("div", { class: "wl-actions" });
      if (m.role !== "owner") {
        if (m.status === "invited") {
          var rs = W.btn("Resend", { class: "wl-btn-sm wl-btn-ghost" });
          rs.addEventListener("click", function () {
            W.busy(rs, req("POST", "/api/org/" + enc(org.id) + "/invites/" + enc(m.id) + "/resend", {}))
              .then(function (r) { W.toast(r.mail === "sent" ? "Invitation sent again." : "Invitation renewed; email " + r.mail.replace(/_/g, " ") + ".", r.mail === "sent" ? "ok" : "warn"); }, function (e) { W.toast(e.message, "bad"); });
          });
          actions.appendChild(rs);
        }
        if (owner && m.status === "joined") {
          var to = m.role === "manager" ? "member" : "manager";
          var rb = W.btn(m.role === "manager" ? "Make member" : "Make manager", { class: "wl-btn-sm wl-btn-ghost" });
          rb.addEventListener("click", function () {
            W.busy(rb, req("PATCH", "/api/org/" + enc(org.id) + "/members/" + enc(m.id), { role: to })).then(reload, function (e) { W.toast(e.message, "bad"); });
          });
          actions.appendChild(rb);
        }
        if (owner || m.role === "member") {
          var x = W.btn(m.status === "invited" ? "Withdraw" : "Remove", { class: "wl-btn-sm wl-btn-ghost" });
          x.addEventListener("click", function () {
            if (!window.confirm((m.status === "invited" ? "Withdraw the invitation to " : "Remove ") + (m.name || m.email) + "?" + (m.seats.length ? " Their seats are released and they lose access to those courses." : ""))) return;
            W.busy(x, req("DELETE", "/api/org/" + enc(org.id) + "/members/" + enc(m.id))).then(function () { W.toast("Done.", "ok"); reload(); }, function (e) { W.toast(e.message, "bad"); });
          });
          actions.appendChild(x);
        }
      }
      return h("tr", null, h("td", null, m.name || "—"), h("td", null, m.email), h("td", null, W.chip(m.role, m.role === "owner" ? "ac" : "")),
        h("td", null, m.status === "joined" ? W.chip("joined", "ok") : W.chip("invited", "warn")), h("td", null, String(m.seats.length)), h("td", null, actions));
    });
    s.appendChild(tableOf(["Name", "Email", "Role", "Status", "Seats", ""], rows));
    return s;
  }

  function inviteSection(org, owner, reload) {
    var s = section("Invite people", "o-inv");
    var ta = h("textarea", { id: "i-emails", rows: "4", placeholder: "ana@company.com, ben@company.com" });
    var file = h("input", { type: "file", id: "i-csv", accept: ".csv,text/csv,text/plain" });
    var csvText = "";
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) { csvText = ""; return; }
      if (f.size > 200000) { W.toast("That file is too large (200 KB at most).", "bad"); file.value = ""; return; }
      var r = new FileReader();
      r.onload = function () { csvText = String(r.result || ""); W.toast("CSV loaded.", "ok"); };
      r.readAsText(f);
    });
    var role = owner ? h("select", { id: "i-role" }, h("option", { value: "member" }, "Member"), h("option", { value: "manager" }, "Manager")) : null;
    var out = h("div", { "aria-live": "polite" });
    var b = h("button", { type: "button", class: "wl-btn" }, "Send invitations");
    b.addEventListener("click", function () {
      var body = { emails: ta.value, csv: csvText || undefined, role: role ? role.value : "member" };
      W.busy(b, req("POST", "/api/org/" + enc(org.id) + "/invites", body), "Sending…").then(function (r) {
        W.clear(out);
        var sent = r.invited.filter(function (i) { return i.mail === "sent"; }).length;
        out.appendChild(W.notice(r.invited.length ? "ok" : "info", r.invited.length + " invited" + (r.invited.length ? ", " + sent + " emailed" : ""),
          r.skipped.length ? h("ul", null, r.skipped.map(function (x) { return h("li", null, x.email + " — " + x.why); })) : null));
        ta.value = ""; file.value = ""; csvText = "";
        setTimeout(reload, 1500);
      }, function (e) { W.clear(out).appendChild(W.notice("error", "Not sent", e.message)); });
    });
    s.appendChild(h("div", { class: "wl-field" }, h("label", { for: "i-emails" }, "Email addresses"), ta,
      h("p", { class: "wl-hint" }, "Separate with commas, spaces or new lines. Up to 200 at a time.")));
    s.appendChild(h("div", { class: "wl-field" }, h("label", { for: "i-csv" }, "Or upload a CSV", h("span", { class: "wl-opt" }, " (optional)")), file,
      h("p", { class: "wl-hint" }, "Any column with email addresses; other columns are ignored.")));
    if (role) s.appendChild(h("div", { class: "wl-field" }, h("label", { for: "i-role" }, "Invite as"), role));
    s.appendChild(h("div", { class: "wl-actions" }, b));
    s.appendChild(out);
    s.appendChild(h("p", { class: "wl-hint" }, "Each person gets an email with a join link. They sign in (or create an account) with that address to accept."));
    return s;
  }

  function domainsSection(org, reload) {
    var s = section("Company domain", "o-dom");
    s.appendChild(h("p", { class: "wl-hint" }, "Verify a domain you control and anyone who signs in with a verified address at it can join this team themselves (as a member, without a seat until you give one)."));
    org.domains.forEach(function (d) {
      var row = h("div", { class: "wl-card-plain wl-section" }, h("p", null, h("strong", null, d.domain), " ", d.verified ? W.chip("verified", "ok") : W.chip("not verified", "warn")));
      if (!d.verified && d.record) {
        row.appendChild(h("p", { class: "wl-hint" }, "Add this DNS TXT record at your DNS provider, then check it:"));
        row.appendChild(h("dl", { class: "wl-facts" },
          h("div", null, h("dt", null, "Type"), h("dd", null, "TXT")),
          h("div", null, h("dt", null, "Name"), h("dd", { class: "wl-mono" }, d.record.name)),
          h("div", null, h("dt", null, "Value"), h("dd", { class: "wl-mono" }, d.record.value))));
        var cp = W.btn("Copy value", { class: "wl-btn-sm wl-btn-ghost" });
        cp.addEventListener("click", function () { W.copyText(d.record.value).then(function () { W.toast("Copied.", "ok"); }, function () { W.toast("Copy failed; select the value instead.", "bad"); }); });
        var chk = W.btn("Check now", { class: "wl-btn-sm" });
        chk.addEventListener("click", function () {
          W.busy(chk, req("POST", "/api/org/" + enc(org.id) + "/domains/" + enc(d.domain) + "/verify", {}), "Checking…").then(function (r) {
            if (r.verified) { W.toast(d.domain + " is verified.", "ok"); reload(); }
            else W.toast(r.detail || "Not found yet.", "warn");
          }, function (e) { W.toast(e.message, "bad"); });
        });
        row.appendChild(h("div", { class: "wl-actions" }, chk, cp));
      }
      var rm = W.btn("Remove", { class: "wl-btn-sm wl-btn-ghost" });
      rm.addEventListener("click", function () {
        if (!window.confirm("Remove " + d.domain + "? People can no longer join by it; current members stay.")) return;
        W.busy(rm, req("DELETE", "/api/org/" + enc(org.id) + "/domains/" + enc(d.domain))).then(reload, function (e) { W.toast(e.message, "bad"); });
      });
      row.appendChild(rm);
      s.appendChild(row);
    });
    var input = h("input", { id: "d-new", type: "text", placeholder: "company.com", maxlength: "253", autocomplete: "off", spellcheck: "false" });
    var add = W.btn("Add domain", { class: "wl-btn-sm" });
    add.addEventListener("click", function () {
      W.busy(add, req("POST", "/api/org/" + enc(org.id) + "/domains", { domain: input.value.trim() })).then(reload, function (e) { W.toast(e.message, "bad"); });
    });
    s.appendChild(h("div", { class: "wl-form-row" }, h("label", { class: "wl-sr", for: "d-new" }, "Domain"), input, add));
    return s;
  }

  /* [org-agreements] Training campaigns are managed on their own page. */
  function campaignsSection(org) {
    var s = section("Training campaigns", "o-camp");
    s.appendChild(h("p", { class: "wl-hint" }, "Assign a program or courses to a list of people with a due date. Seats come from this team; people get reminders, and you get a progress report for the assigned courses."));
    s.appendChild(h("div", { class: "wl-actions" }, W.btn("Training campaigns", { href: "/learn/team/campaigns/?org=" + enc(org.id), class: "wl-btn-sm" })));
    return s;
  }

  function progressSection(org) {
    var s = section("Progress", "o-prog");
    var body = h("div", null, W.spinner("Loading progress…"));
    var dl = W.btn("Download CSV", { class: "wl-btn-sm wl-btn-ghost" });
    dl.addEventListener("click", function () {
      var t = API.token.get();
      W.busy(dl, fetch(API.base() + "/api/org/" + enc(org.id) + "/progress.csv", { headers: { Authorization: "Bearer " + t }, mode: "cors", credentials: "omit", cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("Export failed (" + r.status + ")."); return r.blob(); })
        .then(function (b) {
          var url = URL.createObjectURL(b);
          var a = h("a", { href: url, download: "team-progress-" + new Date().toISOString().slice(0, 10) + ".csv" });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }), "Preparing…").catch(function (e) { W.toast(e.message, "bad"); });
    });
    s.appendChild(h("p", { class: "wl-hint" }, "Only the courses this team's seats gave each person are shown. ", dl));
    s.appendChild(body);
    req("GET", "/api/org/" + enc(org.id) + "/progress").then(function (p) {
      W.clear(body);
      var sm = p.summary;
      body.appendChild(h("p", null, W.plural(sm.members, "member") + " · " + W.plural(sm.seatCourses, "seat course") + " · " +
        sm.lessonsComplete + " with all lessons done · " + W.plural(sm.examsPassed, "exam") + " passed · " + W.plural(sm.certificates, "certificate")));
      var rows = [];
      var label = { passed: "Passed", in_progress: "In progress", not_passed_yet: "Not passed yet", not_started: "Not started", no_exam: "No exam" };
      p.members.forEach(function (m) {
        if (!m.courses.length) rows.push(h("tr", null, h("td", null, m.name || m.email), h("td", { colspan: "4", class: "wl-hint" }, "No seat yet")));
        m.courses.forEach(function (c, i) {
          rows.push(h("tr", null, h("td", null, i === 0 ? (m.name || m.email) : ""), h("td", null, c.title, c.access ? null : h("span", { class: "wl-hint" }, " (no access)")),
            h("td", null, c.lessonsDone + " / " + c.lessonsTotal),
            h("td", null, (label[c.exam.status] || c.exam.status) + (c.exam.bestScore != null ? " · best " + c.exam.bestScore + "%" : "") + (c.exam.attemptsUsed ? " · " + W.plural(c.exam.attemptsUsed, "attempt") : "")),
            h("td", null, c.certificate ? h("a", { href: "/verify/?id=" + enc(c.certificate.id) }, c.certificate.id) : "—")));
        });
      });
      body.appendChild(tableOf(["Member", "Course", "Lessons", "Exam", "Certificate"], rows));
    }, function (e) { W.clear(body).appendChild(h("p", { class: "wl-tone-warn" }, e.message)); });
    return s;
  }

  function purchasesSection(d) {
    var s = section("Seat purchases", "o-pur");
    if (!d.purchases.length) { s.appendChild(h("p", { class: "wl-hint" }, "None yet.")); return s; }
    var label = { created: "awaiting payment", paid: "paid", invoice_requested: "invoice requested", canceled: "canceled", refunded: "refunded", disputed: "disputed", failed: "failed", expired: "expired" };
    s.appendChild(tableOf(["Date", "Seats", "Total", "Status", "Reference"], d.purchases.map(function (p) {
      return h("tr", null, h("td", null, W.fmtDate(p.createdAt)), h("td", null, (p.quantity || "?") + " × " + itemTitle(p.of, p.refId)),
        h("td", null, W.money(p.total)), h("td", null, label[p.status] || p.status), h("td", { class: "wl-mono" }, p.id));
    })));
    return s;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
