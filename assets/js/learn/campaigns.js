/*
 * /learn/team/campaigns/ : training campaigns for a team (learning Worker /api/org/:orgId/campaigns*;
 * wirewalk-institute-worker ai/plans/org-agreements-2026-10.md sections 6.2, 6.4 and 7).
 *
 *   /learn/team/campaigns/                     choose a team you manage
 *   /learn/team/campaigns/?org=<id>            that team's campaigns
 *   /learn/team/campaigns/?org=<id>&new=1      create a campaign (saved as a draft)
 *   /learn/team/campaigns/?org=<id>&c=<id>     one campaign: plan and launch (draft), progress, CSV,
 *                                              people, seat shortfall invoice, cancel
 *
 * Seats come from the team's seat pools. A shortfall is never charged by itself: an invoice is
 * requested only when a manager ticks the explicit invoice option, and the request goes to the
 * sales inbox through the portal inquiry endpoint, as the team page's invoice requests do.
 * Until the Worker serves these routes (404 or 503), the page says campaigns are not switched on.
 * Every price comes from the Worker (which asks billing); nothing here computes one.
 * Everything from the API is rendered as text (WL.h), never as HTML.
 */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  var cfgEl = document.getElementById("wl-team-config");
  var ENQUIRY = cfgEl ? cfgEl.getAttribute("data-enquiry") : "";
  var SITE = cfgEl ? (cfgEl.getAttribute("data-site") || "").replace(/\/+$/, "") : "";
  var enc = encodeURIComponent;
  var PO_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,59}$/;
  /* A hint only (the Worker decides): the message goes out by email, so links and web addresses are refused there. */
  var LINK_RE = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|io|ai|co|info|biz|app|dev|us|uk|de|fr|ly|me)\b|@)/i;
  var DATE_STYLE = { width: "100%", "min-height": "46px", padding: "10px 14px", "border-radius": "10px", border: "1px solid var(--wl-line2)",
    background: "var(--wl-surface)", color: "var(--wl-tx)", font: "400 16px/1.4 var(--wl-sans)", "color-scheme": "light dark" };

  function req(method, path, body, opts) { return API.request(method, path, body, opts); }
  function teamUrl(orgId) { return "/learn/team/?org=" + enc(orgId); }
  function listUrl(orgId) { return "/learn/team/campaigns/?org=" + enc(orgId); }
  function campUrl(orgId, id) { return listUrl(orgId) + "&c=" + enc(id); }
  function base(orgId) { return "/api/org/" + enc(orgId) + "/campaigns"; }
  function head(eyebrow, title, lead) {
    return h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, eyebrow), h("h1", { class: "wl-display" }, title),
      lead ? h("p", { class: "wl-lead" }, lead) : null);
  }
  function section(title, id) {
    return h("section", { class: "wl-section wl-card-plain", "aria-labelledby": id }, h("h2", { id: id, class: "wl-h3" }, title));
  }
  function tableOf(headers, rows) {
    var thead = h("tr", null, headers.map(function (x) { return h("th", { scope: "col" }, x); }));
    return h("div", { class: "wl-table-wrap" }, h("table", null, h("thead", null, thead), h("tbody", null, rows)));
  }
  function itemTitle(kind, id) { return kind === "program" ? W.programTitle(id) : W.courseTitle(id); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  /* The feature is not deployed yet: no route (404) or no tables (503 not_configured). */
  function missing(err) { return !!err && (err.status === 404 || err.status === 503); }
  function notAvailable(org) {
    W.mount(h("div", { class: "wl-narrow" }, head("Team", "Training campaigns"),
      W.notice("info", "Not available yet", "Training campaigns are being switched on. Until then you can give seats to people on your team page, and email sales@wirewalk.com if you need help planning a rollout.",
        [org ? W.btn("Back to " + org.name, { href: teamUrl(org.id) }) : W.btn("Your teams", { href: "/learn/team/" })])));
  }
  /* "YYYY-MM-DD" is a calendar date: shown as that day wherever the reader is. */
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
    return m ? W.fmtDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : W.fmtDate(v);
  }
  function isoDay(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  var STATUS = { draft: ["Draft", ""], active: ["Active", "ok"], closed: ["Closed", ""], canceled: ["Canceled", "bad"] };
  function statusChip(s) { var x = STATUS[s] || [s || "unknown", ""]; return W.chip(x[0], x[1]); }
  var PERSON = { pending_join: ["Invited, not joined yet", "warn"], awaiting_seat: ["Waiting for a seat", "warn"], assigned: ["Assigned", "ok"], removed: ["Removed", ""] };
  function personChip(s) { var x = PERSON[s] || [s || "unknown", ""]; return W.chip(x[0], x[1]); }
  function whatOf(c) {
    if (c.kind === "program" && c.programId) return W.programTitle(c.programId);
    var ids = Array.isArray(c.courses) ? c.courses.map(function (x) { return typeof x === "string" ? x : (x && (x.id || x.courseId)); }) : [];
    return ids.length ? ids.map(function (id) { return W.courseTitle(id); }).join(", ") : "";
  }

  /* ------------------------------------------------------------------ boot */
  function load() {
    if (!W.requireAuth()) return;
    var orgId = W.param("org"), cid = W.param("c");
    W.loading("Loading your teams…");
    req("GET", "/api/org").then(function (list) {
      if (!list.available) return notAvailable(null);
      var managed = list.orgs.filter(function (o) { return o.role === "owner" || o.role === "manager"; });
      if (!orgId) return pickTeam(managed);
      var org = managed.filter(function (o) { return o.id === orgId; })[0];
      if (!org) {
        W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Team not found", "It does not exist, or you are not one of its managers.",
          [W.btn("Your teams", { href: "/learn/team/" })], { h1: true })));
        return;
      }
      if (W.param("new") === "1") return createView(org);
      if (cid) return detailView(org, cid);
      listView(org);
    }, function (err) { if (err.status !== 401) W.mount(W.errorView(err, load)); });
  }

  function pickTeam(managed) {
    W.setTitle("Training campaigns");
    var parts = [head("Team", "Training campaigns", "Assign a program or courses to people in your team, with a due date, reminders and a progress report.")];
    var s = section("Choose a team", "c-pick");
    if (!managed.length) s.appendChild(h("p", { class: "wl-hint" }, "Campaigns belong to a team you own or manage. ", h("a", { href: "/learn/team/" }, "Create or open a team"), " first."));
    managed.forEach(function (o) {
      s.appendChild(h("div", { class: "wl-list-row" }, h("div", { class: "wl-grow" }, h("strong", null, o.name), " ", W.chip(o.role, o.role === "owner" ? "ac" : "")),
        W.btn("Campaigns", { href: listUrl(o.id), class: "wl-btn-sm" })));
    });
    parts.push(s);
    W.mount(h("div", { class: "wl-narrow" }, parts));
  }

  /* ------------------------------------------------------------------ list */
  function listView(org) {
    W.setTitle("Training campaigns · " + org.name);
    W.loading("Loading campaigns…");
    req("GET", base(org.id)).then(function (d) {
      if (d && d.available === false) return notAvailable(org);
      var rows = Array.isArray(d) ? d : (d && d.campaigns) || [];
      var parts = [head("Team · " + org.name, "Training campaigns", "Each campaign assigns a program or courses to a list of people, with a start date, a due date and reminders. Seats come from this team's seats.")];
      parts.push(h("div", { class: "wl-actions" }, W.btn("New campaign", { href: listUrl(org.id) + "&new=1" }), W.btn("Back to the team", { href: teamUrl(org.id), class: "wl-btn-ghost" })));
      var s = section("Campaigns", "c-list");
      if (!rows.length) s.appendChild(h("p", { class: "wl-hint" }, "No campaigns yet."));
      else s.appendChild(tableOf(["Name", "Status", "Training", "Due", "People", "Completed", ""], rows.map(function (c) {
        var k = c.counts || c;
        var people = num(k.assignees != null ? k.assignees : k.total);
        return h("tr", null, h("td", null, c.name), h("td", null, statusChip(c.status)), h("td", null, whatOf(c) || "—"), h("td", null, day(c.dueOn) || "—"),
          h("td", null, String(people) + (num(k.awaitingSeat) ? " · " + num(k.awaitingSeat) + " waiting for a seat" : "") + (num(k.pendingJoin) ? " · " + num(k.pendingJoin) + " not joined" : "")),
          h("td", null, String(num(k.completed)) + (num(k.overdue) ? " · " + num(k.overdue) + " overdue" : "")),
          h("td", null, W.btn("Open", { href: campUrl(org.id, c.id), class: "wl-btn-sm wl-btn-ghost" })));
      })));
      parts.push(s);
      W.mount(h("div", null, parts));
    }, function (err) {
      if (err.status === 401) return;
      if (missing(err)) return notAvailable(org);
      W.mount(W.errorView(err, function () { listView(org); }));
    });
  }

  /* ---------------------------------------------------------- people input */
  /* Emails pasted or a CSV file, as on the team page's invitation form. */
  function peopleInput(idPrefix) {
    var ta = h("textarea", { id: idPrefix + "-emails", rows: "4", placeholder: "ana@company.com, ben@company.com", "aria-describedby": idPrefix + "-emails-hint" });
    var file = h("input", { type: "file", id: idPrefix + "-csv", accept: ".csv,text/csv,text/plain", "aria-describedby": idPrefix + "-csv-hint" });
    var csvText = "";
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) { csvText = ""; return; }
      if (f.size > 200000) { W.toast("That file is too large (200 KB at most).", "bad"); file.value = ""; return; }
      var r = new FileReader();
      r.onload = function () { csvText = String(r.result || ""); W.toast("CSV loaded.", "ok"); };
      r.readAsText(f);
    });
    return {
      el: [h("div", { class: "wl-field" }, h("label", { for: idPrefix + "-emails" }, "Email addresses", h("span", { class: "wl-opt" }, " (optional)")), ta,
          h("p", { class: "wl-hint", id: idPrefix + "-emails-hint" }, "Separate with commas, spaces or new lines. People who are not in the team yet get an invitation to join it.")),
        h("div", { class: "wl-field" }, h("label", { for: idPrefix + "-csv" }, "Or upload a CSV", h("span", { class: "wl-opt" }, " (optional)")), file,
          h("p", { class: "wl-hint", id: idPrefix + "-csv-hint" }, "Any column with email addresses; other columns are ignored."))],
      value: function () { return { emails: ta.value.trim() || undefined, csv: csvText || undefined }; },
      empty: function () { return !ta.value.trim() && !csvText; },
      reset: function () { ta.value = ""; file.value = ""; csvText = ""; }
    };
  }

  /* ---------------------------------------------------------------- create */
  function createView(org) {
    W.setTitle("New campaign · " + org.name);
    var cat = W.catalog();
    var courseIds = Object.keys(cat.courses).filter(function (id) { return cat.courses[id].s === "on_sale"; });
    var progIds = Object.keys(cat.programs).filter(function (id) { return cat.programs[id].s === "on_sale"; });

    var name = W.field({ label: "Campaign name", name: "name", required: true, maxlength: "120", hint: "Shown to the people you assign, for example “AI foundations for the finance team”. No links or addresses." });
    var kCourses = h("input", { type: "radio", name: "kind", value: "course", id: "n-k-course", checked: true });
    var kProgram = h("input", { type: "radio", name: "kind", value: "program", id: "n-k-program", disabled: !progIds.length });
    var kind = h("fieldset", { class: "wl-choice" }, h("legend", null, "What to assign"),
      h("label", { class: "wl-choice-opt", for: "n-k-course" }, kCourses, h("span", null, h("strong", null, "Courses"), h("span", { class: "wl-hint" }, "One or more courses; each person needs a seat in each course."))),
      h("label", { class: "wl-choice-opt", for: "n-k-program" }, kProgram, h("span", null, h("strong", null, "A certification program"), h("span", { class: "wl-hint" }, "One program seat per person covers all of its courses."))));

    var filter = h("input", { type: "text", id: "n-filter", placeholder: "Filter by code or title", autocomplete: "off", spellcheck: "false" });
    var picked = h("p", { class: "wl-hint", "aria-live": "polite" }, "No course chosen yet.");
    var boxes = courseIds.map(function (id) {
      var cb = h("input", { type: "checkbox", value: id, id: "n-c-" + id });
      var row = h("label", { class: "wl-list-row", for: "n-c-" + id, style: { display: "flex", gap: "10px", "align-items": "flex-start", cursor: "pointer" } },
        cb, h("span", null, h("span", { class: "wl-code" }, id), " ", cat.courses[id].t));
      return { id: id, cb: cb, row: row, text: (id + " " + cat.courses[id].t).toLowerCase() };
    });
    var scroll = h("div", { role: "group", "aria-labelledby": "n-courses-l", style: { "max-height": "320px", overflow: "auto", border: "1px solid var(--wl-line2)", "border-radius": "10px", padding: "4px 12px" } },
      boxes.map(function (b) { return b.row; }));
    function countPicked() {
      var n = boxes.filter(function (b) { return b.cb.checked; }).length;
      picked.textContent = n ? W.plural(n, "course") + " chosen." : "No course chosen yet.";
    }
    boxes.forEach(function (b) { b.cb.addEventListener("change", countPicked); });
    filter.addEventListener("input", function () {
      var q = filter.value.trim().toLowerCase();
      boxes.forEach(function (b) { b.row.hidden = !!q && b.text.indexOf(q) < 0; });
    });
    var coursePick = h("div", { class: "wl-field" }, h("span", { id: "n-courses-l", class: "wl-strong" }, "Courses"),
      h("label", { class: "wl-sr", for: "n-filter" }, "Filter courses"), filter, scroll, picked);
    var prog = h("select", { id: "n-program" }, progIds.map(function (id) { return h("option", { value: id }, cat.programs[id].t); }));
    var progPick = h("div", { class: "wl-field", hidden: true }, h("label", { for: "n-program" }, "Program"), prog);
    function syncKind() { var p = kProgram.checked; coursePick.hidden = p; progPick.hidden = !p; }
    [kCourses, kProgram].forEach(function (x) { x.addEventListener("change", syncKind); });

    var people = peopleInput("n");
    var auto = h("input", { type: "checkbox", id: "n-auto", name: "autoDomain" });
    var autoRow = h("div", { class: "wl-ack" }, auto, h("label", { for: "n-auto" }, "Also assign people who join this team later with a verified address at your company domain"));

    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    var start = h("input", { type: "date", id: "n-start", min: isoDay(new Date()), style: DATE_STYLE, "aria-describedby": "n-start-hint" });
    var due = h("input", { type: "date", id: "n-due", required: true, min: isoDay(tomorrow), style: DATE_STYLE, "aria-describedby": "n-due-hint" });
    var dates = h("div", { class: "wl-two" },
      h("div", { class: "wl-field" }, h("label", { for: "n-start" }, "Start date", h("span", { class: "wl-opt" }, " (optional)")), start,
        h("p", { class: "wl-hint", id: "n-start-hint" }, "Empty: when you launch it.")),
      h("div", { class: "wl-field" }, h("label", { for: "n-due" }, "Due date"), due,
        h("p", { class: "wl-hint", id: "n-due-hint" }, "At least a day after the start; due at the end of that day, US Eastern time.")));

    var msg = h("textarea", { id: "n-msg", rows: "3", maxlength: "500", "aria-describedby": "n-msg-hint" });
    var msgHint = h("p", { class: "wl-hint", id: "n-msg-hint" }, "Optional, up to 500 characters, included in the assignment email as a message from your team. No links, web or email addresses.");
    msg.addEventListener("input", function () {
      var bad = LINK_RE.test(msg.value);
      msgHint.textContent = bad ? "This looks like it contains a link or an address. Messages are sent by email, so links and addresses are not allowed; please remove it."
                                : "Optional, up to 500 characters, included in the assignment email as a message from your team. No links, web or email addresses.";
      msgHint.className = bad ? "wl-hint wl-tone-warn" : "wl-hint";
    });
    var rem = h("input", { type: "checkbox", id: "n-rem", name: "remindersEnabled", checked: true });
    var remRow = h("div", { class: "wl-ack" }, rem, h("label", { for: "n-rem" }, "Email reminders a week and a day before the due date, and once if overdue"));

    var form = h("form", { class: "wl-form", novalidate: true, "aria-labelledby": "n-h" },
      name, kind, coursePick, progPick, people.el, autoRow, dates,
      h("div", { class: "wl-field" }, h("label", { for: "n-msg" }, "Message to the people you assign", h("span", { class: "wl-opt" }, " (optional)")), msg, msgHint),
      remRow,
      h("p", { class: "wl-hint" }, "Creating a campaign saves a draft. Nothing is sent and no seat is given until you launch it from the next screen, where you see whether your seats are enough."),
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn" }, "Save draft"), W.btn("Cancel", { href: listUrl(org.id), class: "wl-btn-ghost" })));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = form.querySelector('[name="name"]').value.trim();
      if (nm.length < 2) { W.formError(form, "Give the campaign a name."); return; }
      var isProg = kProgram.checked;
      var courses = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.id; });
      if (!isProg && !courses.length) { W.formError(form, "Choose at least one course."); filter.focus(); return; }
      if (isProg && !prog.value) { W.formError(form, "Choose a program."); prog.focus(); return; }
      if (!due.value) { W.formError(form, "Choose a due date."); due.focus(); return; }
      if (start.value && start.value >= due.value) { W.formError(form, "The due date must be at least a day after the start date."); due.focus(); return; }
      W.formError(form, "");
      var p = people.value();
      var body = { name: nm, kind: isProg ? "program" : "course", courses: isProg ? undefined : courses, programId: isProg ? prog.value : undefined,
        emails: p.emails, csv: p.csv, autoDomain: auto.checked, dueOn: due.value, message: msg.value.trim() || undefined, remindersEnabled: rem.checked };
      if (start.value) { var sp = start.value.split("-"); body.startAt = new Date(Number(sp[0]), Number(sp[1]) - 1, Number(sp[2])).toISOString(); }
      W.busy(form.querySelector("[type=submit]"), req("POST", base(org.id), body), "Saving…").then(function (d) {
        var c = (d && d.campaign) || d || {};
        if (!c.id) { W.formError(form, "The campaign was saved, but the server did not return it. Open the campaign list to continue."); return; }
        try { window.history.replaceState(null, "", campUrl(org.id, c.id)); } catch (x) { /* ignore */ }
        W.toast("Draft saved.", "ok");
        detailView(org, c.id);
      }, function (err) {
        if (missing(err)) { notAvailable(org); return; }
        W.formError(form, err.message);
      });
    });
    W.mount(h("div", { class: "wl-narrow" }, head("Team · " + org.name, "New training campaign"),
      h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "n-h" }, h("h2", { id: "n-h", class: "wl-h3" }, "Campaign"), form)));
    syncKind();
  }

  /* ---------------------------------------------------------------- detail */
  function detailView(org, cid) {
    W.loading("Loading the campaign…");
    req("GET", base(org.id) + "/" + enc(cid)).then(function (d) { renderDetail(org, d); }, function (err) {
      if (err.status === 401) return;
      if (err.status === 503) return notAvailable(org);
      W.mount(W.errorView(err, function () { detailView(org, cid); }, { notFound: { title: "Campaign not found",
        body: "It does not exist, it belongs to another team, or training campaigns are not switched on yet.", href: listUrl(org.id), label: "Campaigns" } }));
    });
  }

  function renderDetail(org, d) {
    var c = (d && d.campaign) || d || {};
    var assignees = (d && (d.assignees || c.assignees)) || [];
    var reload = function () { detailView(org, c.id); };
    W.setTitle(c.name + " · " + org.name);
    var parts = [head("Training campaign · " + org.name, c.name), h("p", { class: "wl-crumbs" }, h("a", { href: listUrl(org.id) }, "All campaigns"), " · ", h("a", { href: teamUrl(org.id) }, "Team"))];
    var inv = W.param("invoice");
    if (inv) parts.push(W.notice("ok", "Invoice requested", "Your request " + inv + " is recorded and our team has been notified. Nothing is charged until you pay the invoice; seats are given to the people waiting as soon as it is paid."));
    parts.push(h("dl", { class: "wl-facts" },
      h("div", null, h("dt", null, "Status"), h("dd", null, statusChip(c.status))),
      h("div", null, h("dt", null, c.kind === "program" ? "Program" : "Courses"), h("dd", null, whatOf(c) || "—")),
      h("div", null, h("dt", null, "Starts"), h("dd", null, c.startAt ? W.fmtDate(c.startAt) : "When launched")),
      h("div", null, h("dt", null, "Due"), h("dd", null, day(c.dueOn) || "—")),
      h("div", null, h("dt", null, "Reminders"), h("dd", null, c.remindersEnabled === false || c.remindersEnabled === 0 ? "Off" : "On")),
      h("div", null, h("dt", null, "People"), h("dd", null, String(assignees.filter(function (a) { return a.status !== "removed"; }).length)))));
    if (c.message) parts.push(h("p", { class: "wl-hint" }, "Message to the people assigned: “" + c.message + "”"));

    var live = c.status === "draft" || c.status === "active";
    if (c.status === "draft") parts.push(planSection(org, c, assignees, reload));
    if (c.status !== "draft") parts.push(progressSection(org, c));
    if (c.status === "active" && assignees.some(function (a) { return a.status === "awaiting_seat"; })) parts.push(shortfallSection(org, c));
    parts.push(peopleSection(org, c, assignees, live, reload));
    if (live) parts.push(cancelSection(org, c, reload));
    W.mount(h("div", null, parts));
  }

  /* Plan rows: one per course (or one for a program), with the invoice option per row or for the whole plan. */
  function planRows(p) { return (p && (p.courses || p.groups || p.lines)) || []; }
  function planInvoice(p) {
    var rows = planRows(p), top = (p && p.invoice) || null;
    var per = rows.map(function (r) { return r.invoice; }).filter(Boolean);
    var possible = top ? !!top.possible : per.some(function (x) { return x.possible; });
    var qty = top && top.quantity != null ? num(top.quantity) : per.reduce(function (s, x) { return s + (x.possible ? num(x.quantity) : 0); }, 0);
    var min = top && top.minQuantity != null ? num(top.minQuantity) : per.reduce(function (m, x) { return Math.max(m, num(x.minQuantity)); }, 0);
    var quote = top ? top.quote : per.length === 1 ? per[0].quote : null;
    return { possible: possible, quantity: qty, minQuantity: min, quote: quote || null };
  }
  function planTable(p) {
    var rows = planRows(p);
    return tableOf(["Course or program", "People", "Already have access", "Free seats", "Short"], rows.map(function (r) {
      var id = r.courseId || r.programId || r.id;
      return h("tr", null, h("td", null, r.title || itemTitle(r.of || (r.programId ? "program" : "course"), id)), h("td", null, String(num(r.needed))),
        h("td", null, String(num(r.alreadyHaveAccess))), h("td", null, String(num(r.seatsFree))),
        h("td", null, num(r.shortfall) ? W.chip(String(num(r.shortfall)), "warn") : "0"));
    }));
  }
  function poField(id) {
    var input = h("input", { id: id, type: "text", maxlength: "60", autocomplete: "off", spellcheck: "false", "aria-describedby": id + "-hint" });
    return { input: input, el: h("div", { class: "wl-field" }, h("label", { for: id }, "Purchase order number", h("span", { class: "wl-opt" }, " (if your organization uses one)")), input,
      h("p", { class: "wl-hint", id: id + "-hint" }, "Printed on the invoice. Letters, digits, spaces and . _ / - only.")) };
  }

  function planSection(org, c, assignees, reload) {
    var s = section("Plan and launch", "c-plan");
    var body = h("div", null, W.spinner("Checking your seats…"));
    s.appendChild(body);
    req("GET", base(org.id) + "/" + enc(c.id) + "/plan").then(function (p) {
      W.clear(body);
      var rows = planRows(p);
      var short = p && p.shortfall != null ? num(p.shortfall) : rows.reduce(function (t, r) { return t + num(r.shortfall); }, 0);
      if (rows.length) body.appendChild(planTable(p));
      if (!assignees.filter(function (a) { return a.status !== "removed"; }).length && !c.autoDomain)
        body.appendChild(h("p", { class: "wl-hint" }, "No one is in this campaign yet. Add people below before you launch."));
      var inv = planInvoice(p), ask = null, po = null;
      if (short > 0) {
        body.appendChild(W.notice("warn", W.plural(short, "seat") + " short",
          "People without a seat stay “waiting for a seat” and get their courses as soon as the team has a free seat."));
        if (inv.possible) {
          ask = h("input", { type: "checkbox", id: "p-inv" });
          po = poField("p-po");
          po.el.hidden = true;
          ask.addEventListener("change", function () { po.el.hidden = !ask.checked; });
          var total = inv.quote && ((inv.quote.formatted && inv.quote.formatted.total) || (inv.quote.total != null ? W.money(inv.quote.total) : ""));
          body.appendChild(h("div", { class: "wl-ack" }, ask, h("label", { for: "p-inv" }, "Request an invoice for " + W.plural(inv.quantity, "seat") + " (nothing is charged now)")));
          body.appendChild(h("p", { class: "wl-hint" }, (inv.minQuantity > short ? "Your organization's agreement invoices at least " + W.plural(inv.minQuantity, "seat") + "; the extra seats stay in your team. " : "") +
            (total ? "Billing's price for these seats: " + total + ". " : "") + "We send the invoice; seats are given to the people waiting once it is paid."));
          body.appendChild(po.el);
        } else {
          var one = rows.length === 1 ? rows[0] : null;
          var oneId = one && (one.courseId || one.programId || one.id);
          var oneKind = one && (one.of || (one.programId || c.kind === "program" ? "program" : "course"));
          body.appendChild(h("p", { class: "wl-hint" }, "Buy more seats first",
            one ? [": ", h("a", { href: "/learn/team/?org=" + enc(org.id) + "&buy=" + enc(oneKind + ":" + oneId) + "&qty=" + Math.max(5, short) }, "buy " + W.plural(Math.max(5, short), "seat") + " of " + itemTitle(oneKind, oneId))] : [" on ", h("a", { href: teamUrl(org.id) }, "your team page")],
            ", or launch now and add seats later. Invoicing a shortfall on agreed terms needs an ", h("a", { href: "/teams/enterprise/" }, "organization agreement"), "."));
        }
      } else if (rows.length) {
        body.appendChild(h("p", { class: "wl-hint" }, "Your team has enough seats for everyone in this campaign."));
      }
      var err = h("div", { role: "alert", class: "wl-form-error", hidden: true });
      var go = h("button", { type: "button", class: "wl-btn" }, "Launch campaign");
      go.addEventListener("click", function () {
        err.hidden = true;
        var invoice = !!(ask && ask.checked), poNumber = po ? po.input.value.trim() : "";
        if (invoice && poNumber && !PO_RE.test(poNumber)) { err.textContent = "Use letters, digits, spaces and . _ / - in the purchase order number (60 characters at most)."; err.hidden = false; po.input.focus(); return; }
        if (!window.confirm("Launch “" + c.name + "”? People who are not in the team yet get an invitation, seats are given to everyone the team has seats for, and from the start date each person is emailed that the training is assigned." +
          (invoice ? " An invoice request for " + W.plural(inv.quantity, "seat") + " is sent to our team; nothing is charged now." : ""))) return;
        W.busy(go, req("POST", base(org.id) + "/" + enc(c.id) + "/launch", { invoiceShortfall: invoice, poNumber: invoice && poNumber ? poNumber : undefined }), "Launching…").then(function (r) {
          var enq = enquiryOf(r);
          if (enq) return sendEnquiry(org.id, c.id, enq, r);
          W.toast("Campaign launched.", "ok");
          reload();
        }, function (e) {
          err.textContent = e.message; err.hidden = false;
          if (e.data && e.data.field === "poNumber" && po) { po.el.hidden = false; po.input.focus(); }
        });
      });
      body.appendChild(err);
      body.appendChild(h("div", { class: "wl-actions" }, go));
    }, function (e) {
      W.clear(body).appendChild(h("p", { class: "wl-tone-warn" }, missing(e) ? "The seat plan is not available yet." : e.message));
    });
    return s;
  }

  /* An active campaign whose people are still waiting for seats (for example people who joined later). */
  function shortfallSection(org, c) {
    var s = section("People waiting for a seat", "c-short");
    var body = h("div", null, W.spinner("Checking your seats…"));
    s.appendChild(body);
    req("GET", base(org.id) + "/" + enc(c.id) + "/plan").then(function (p) {
      W.clear(body);
      var rows = planRows(p);
      if (rows.length) body.appendChild(planTable(p));
      var inv = planInvoice(p);
      if (!inv.possible) {
        body.appendChild(h("p", { class: "wl-hint" }, "Buy more seats on ", h("a", { href: teamUrl(org.id) }, "your team page"),
          ": people waiting get them automatically within about 15 minutes. Invoicing on agreed terms needs an ", h("a", { href: "/teams/enterprise/" }, "organization agreement"), "."));
        return;
      }
      var min = Math.max(1, inv.minQuantity || 1);
      var qty = h("input", { type: "number", id: "s-qty", min: String(min), max: "1000", step: "1", inputmode: "numeric", value: String(Math.max(min, inv.quantity || min)), "aria-describedby": "s-qty-hint" });
      var po = poField("s-po");
      var ok = h("input", { type: "checkbox", id: "s-ok" });
      var err = h("div", { role: "alert", class: "wl-form-error", hidden: true });
      var go = h("button", { type: "button", class: "wl-btn", disabled: true }, "Request the invoice");
      ok.addEventListener("change", function () { go.disabled = !ok.checked; });
      body.appendChild(h("div", { class: "wl-field" }, h("label", { for: "s-qty" }, "Seats to invoice"), qty,
        h("p", { class: "wl-hint", id: "s-qty-hint" }, "At least " + W.plural(min, "seat") + " under your organization's agreement; extra seats stay in your team.")));
      body.appendChild(po.el);
      body.appendChild(h("div", { class: "wl-ack" }, ok, h("label", { for: "s-ok" }, "Request an invoice for these seats (nothing is charged now)")));
      body.appendChild(err);
      body.appendChild(h("div", { class: "wl-actions" }, go));
      go.addEventListener("click", function () {
        err.hidden = true;
        var n = Number(qty.value), poNumber = po.input.value.trim();
        if (!Number.isInteger(n) || n < min || n > 1000) { err.textContent = "Choose " + min + " to 1000 seats."; err.hidden = false; qty.focus(); return; }
        if (poNumber && !PO_RE.test(poNumber)) { err.textContent = "Use letters, digits, spaces and . _ / - in the purchase order number (60 characters at most)."; err.hidden = false; po.input.focus(); return; }
        W.busy(go, req("POST", base(org.id) + "/" + enc(c.id) + "/shortfall-invoice", { quantity: n, poNumber: poNumber || undefined }), "Recording the request…").then(function (r) {
          var enq = enquiryOf(r);
          if (enq) return sendEnquiry(org.id, c.id, enq, r);
          W.toast("Invoice requested.", "ok");
          detailView(org, c.id);
        }, function (e) { err.textContent = e.message; err.hidden = false; });
      });
    }, function (e) { W.clear(body).appendChild(h("p", { class: "wl-tone-warn" }, missing(e) ? "The seat plan is not available yet." : e.message)); });
    return s;
  }

  /* Progress for the campaign's courses only. A course the person already had before it was
     assigned shows progress only after they chose to share it (the Worker enforces this). */
  var COURSE = { pending_join: "Not joined yet", awaiting_seat: "Waiting for a seat", not_started: "Not started", started: "In progress",
    lessons_complete: "Lessons done", passed: "Passed", not_shared: "Has access; progress not shared" };
  var EXAM = { passed: "Passed", in_progress: "In progress", not_passed_yet: "Not passed yet", not_started: "Not started", no_exam: "No exam" };
  function progressSection(org, c) {
    var s = section("Progress", "c-prog");
    var body = h("div", null, W.spinner("Loading progress…"));
    var dl = W.btn("Download CSV", { class: "wl-btn-sm wl-btn-ghost" });
    dl.addEventListener("click", function () {
      var t = API.token.get();
      W.busy(dl, fetch(API.base() + base(org.id) + "/" + enc(c.id) + "/progress.csv", { headers: { Authorization: "Bearer " + t }, mode: "cors", credentials: "omit", cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("Export failed (" + r.status + ")."); return r.blob(); })
        .then(function (b) {
          var url = URL.createObjectURL(b);
          var a = h("a", { href: url, download: "campaign-progress-" + new Date().toISOString().slice(0, 10) + ".csv" });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }), "Preparing…").catch(function (e) { W.toast(e.message, "bad"); });
    });
    s.appendChild(h("p", { class: "wl-hint" }, "Only this campaign's courses are shown. ", dl));
    s.appendChild(body);
    req("GET", base(org.id) + "/" + enc(c.id) + "/progress").then(function (p) {
      W.clear(body);
      var sm = (p && p.summary) || {};
      body.appendChild(h("dl", { class: "wl-facts" },
        h("div", null, h("dt", null, "Assigned"), h("dd", null, String(num(sm.assigned)))),
        h("div", null, h("dt", null, "Started"), h("dd", null, String(num(sm.started)))),
        h("div", null, h("dt", null, "Average lessons done"), h("dd", null, Math.round(num(sm.avgLessonsPct != null ? sm.avgLessonsPct : sm.averageLessonsPct)) + "%")),
        h("div", null, h("dt", null, "Exams passed"), h("dd", null, String(num(sm.examsPassed)))),
        h("div", null, h("dt", null, "Certificates"), h("dd", null, String(num(sm.certificates)))),
        h("div", null, h("dt", null, "Overdue"), h("dd", null, num(sm.overdue) ? W.chip(String(num(sm.overdue)), "bad") : "0"))));
      var people = (p && (p.assignees || p.rows || p.members)) || [];
      var rows = [];
      people.forEach(function (m) {
        var who = h("td", null, m.name || m.email || "—", m.overdue ? [" ", W.chip("overdue", "bad")] : null, m.completedAt ? [" ", W.chip("completed", "ok")] : null);
        var courses = Array.isArray(m.courses) ? m.courses : [];
        if (!courses.length) { rows.push(h("tr", null, who, h("td", { colspan: "4", class: "wl-hint" }, (PERSON[m.status] || [m.status || "—"])[0]))); return; }
        courses.forEach(function (x, i) {
          var hidden = x.status === "not_shared";
          var ex = x.exam || {};
          var exText = hidden ? "—" : (EXAM[ex.status] || ex.status || "—") + (ex.bestScore != null ? " · best " + ex.bestScore + "%" : "") +
            (ex.attemptsUsed || ex.attempts ? " · " + W.plural(num(ex.attemptsUsed || ex.attempts), "attempt") : "");
          var cert = !hidden && x.certificate && x.certificate.id ? h("a", { href: "/verify/?id=" + enc(x.certificate.id) }, x.certificate.id) : "—";
          rows.push(h("tr", null, i === 0 ? who : h("td", null, ""),
            h("td", null, x.title || W.courseTitle(x.courseId || x.id), h("span", { class: "wl-hint" }, " · " + (COURSE[x.status] || x.status || ""))),
            h("td", null, hidden || x.lessonsTotal == null ? "—" : num(x.lessonsDone) + " / " + num(x.lessonsTotal)),
            h("td", null, exText), h("td", null, cert)));
        });
      });
      if (!rows.length) body.appendChild(h("p", { class: "wl-hint" }, "No one to report on yet."));
      else body.appendChild(tableOf(["Person", "Course", "Lessons", "Exam", "Certificate"], rows));
    }, function (e) { W.clear(body).appendChild(h("p", { class: "wl-tone-warn" }, missing(e) ? "Progress reports are not available yet." : e.message)); });
    return s;
  }

  function peopleSection(org, c, assignees, live, reload) {
    var s = section("People", "c-people");
    var current = assignees.filter(function (a) { return a.status !== "removed"; });
    var release = h("input", { type: "checkbox", id: "c-release" });
    if (live && current.length && c.status === "active")
      s.appendChild(h("div", { class: "wl-ack" }, release, h("label", { for: "c-release" }, "When I remove someone, also release the seats this campaign gave them (they lose access to those courses)")));
    if (!current.length) s.appendChild(h("p", { class: "wl-hint" }, c.autoDomain ? "No one yet. People who join the team with a verified address at your domain are added automatically." : "No one yet."));
    else s.appendChild(tableOf(["Person", "Status", "Added", ""], current.map(function (a) {
      var x = null;
      if (live) {
        x = W.btn("Remove", { class: "wl-btn-sm wl-btn-ghost" });
        x.addEventListener("click", function () {
          var rel = c.status === "active" && release.checked;
          if (!window.confirm("Remove " + (a.name || a.email) + " from this campaign?" + (rel ? " The seats this campaign gave them are released and they lose access to those courses." : " Seats already given stay with them."))) return;
          W.busy(x, req("DELETE", base(org.id) + "/" + enc(c.id) + "/assignees/" + enc(a.id), { releaseSeats: rel }))
            .then(function () { W.toast("Removed.", "ok"); reload(); }, function (e) { W.toast(e.message, "bad"); });
        });
      }
      return h("tr", null, h("td", null, a.name ? [a.name, h("span", { class: "wl-hint" }, " " + a.email)] : a.email),
        h("td", null, personChip(a.status), a.source === "domain" ? h("span", { class: "wl-hint" }, " · joined by domain") : null),
        h("td", null, a.addedAt ? W.fmtDate(a.addedAt) : "—"), h("td", null, x));
    })));
    if (!live) return s;
    var people = peopleInput("a");
    var out = h("div", { "aria-live": "polite" });
    var b = h("button", { type: "button", class: "wl-btn" }, "Add people");
    b.addEventListener("click", function () {
      if (people.empty()) { W.clear(out).appendChild(W.notice("error", "No one to add", "Paste email addresses or choose a CSV file.")); return; }
      W.busy(b, req("POST", base(org.id) + "/" + enc(c.id) + "/assignees", people.value()), "Adding…").then(function (r) {
        var added = (r && (r.added || r.assignees)) || [], skipped = (r && r.skipped) || [];
        W.clear(out).appendChild(W.notice(added.length ? "ok" : "info", W.plural(added.length, "person", "people") + " added",
          skipped.length ? h("ul", null, skipped.map(function (x) { return h("li", null, (x.email || "") + " — " + (x.why || x.reason || "")); })) : null));
        people.reset();
        setTimeout(reload, 1500);
      }, function (e) { W.clear(out).appendChild(W.notice("error", "Not added", e.message)); });
    });
    s.appendChild(h("h3", { class: "wl-h4" }, "Add people"));
    people.el.forEach(function (x) { s.appendChild(x); });
    s.appendChild(h("div", { class: "wl-actions" }, b));
    s.appendChild(out);
    if (c.status === "active") s.appendChild(h("p", { class: "wl-hint" }, "People you add now get a seat if the team has one free; otherwise they wait for one."));
    return s;
  }

  function cancelSection(org, c, reload) {
    var s = section("Cancel the campaign", "c-cancel");
    s.appendChild(h("p", { class: "wl-hint" }, c.status === "draft" ? "Nothing has been sent for this draft." :
      "Canceling stops reminders and automatic assignment. Seats already given stay with people, and progress stays in their accounts."));
    var b = W.btn(c.status === "draft" ? "Cancel this draft" : "Cancel campaign", { class: "wl-btn-ghost" });
    b.addEventListener("click", function () {
      if (!window.confirm("Cancel “" + c.name + "”? This cannot be undone.")) return;
      W.busy(b, req("POST", base(org.id) + "/" + enc(c.id) + "/cancel", {}), "Canceling…").then(function () { W.toast("Campaign canceled.", "ok"); reload(); },
        function (e) { W.toast(e.message, "bad"); });
    });
    s.appendChild(h("div", { class: "wl-actions" }, b));
    return s;
  }

  /* ----------------------------------------------------------- invoice mail */
  /* Billing recorded the invoice request(s) (status invoice_requested). One inquiry goes to the
     sales inbox through the portal endpoint, the same channel as the team page; several requests
     (one per course) are combined into one inquiry, as only one form can be sent. */
  function enquiryOf(r) {
    if (!r) return null;
    if (r.enquiry && typeof r.enquiry === "object") return r.enquiry;
    var list = Array.isArray(r.enquiries) ? r.enquiries.filter(function (x) { return x && typeof x === "object"; }) : [];
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var first = Object.assign({}, list[0]);
    first.message = list.map(function (x) { return String(x.message || ""); }).join("\n\n");
    first.purchase_id = list.map(function (x) { return x.purchase_id; }).filter(Boolean).join(", ");
    first.seats = String(list.reduce(function (t, x) { return t + num(x.seats); }, 0));
    return first;
  }
  function sendEnquiry(orgId, cid, enq, r) {
    var ref = enq.purchase_id || (r && (r.purchaseId || (Array.isArray(r.purchaseIds) ? r.purchaseIds.join(", ") : ""))) || "";
    var back = SITE + campUrl(orgId, cid) + "&invoice=" + enc(ref);
    if (!ENQUIRY) {
      W.mount(h("div", { class: "wl-narrow" }, head("Training campaign", "Invoice requested"),
        W.notice("ok", "Your request " + ref + " is recorded", "Email sales@wirewalk.com with this reference and your billing details; seats are given to the people waiting once the invoice is paid.",
          [W.btn("Back to the campaign", { href: campUrl(orgId, cid) })])));
      return;
    }
    var form = h("form", { method: "POST", action: ENQUIRY, hidden: true });
    var fields = Object.assign({}, enq, { _next: back, _honey: "" });
    Object.keys(fields).forEach(function (k) { form.appendChild(h("input", { type: "hidden", name: k, value: String(fields[k] == null ? "" : fields[k]) })); });
    document.body.appendChild(form);
    form.submit();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
