/* [ellery] Public surfaces: the course finder and the help desk.
 *
 * Course finder ([data-ellery-finder]: home page, /go/ pages): POST /api/ai/finder. Ellery
 * recommends course ids; each becomes a course card built from the site's own catalog data
 * (#wia-catalog) whose price is a [data-price-for] placeholder filled from GET /api/catalog by
 * site.js (window.WIAPrices). Prices never come from model text.
 *
 * Help desk ([data-ellery-help]: /faq/ and the learner dashboard): POST /api/ai/help, grounded in
 * the help pages only. While the AI is paused the Worker answers from a keyword match over the
 * FAQ, so help still works. "Report an error / contact support" hands the question to a person
 * (POST /api/ai/help/handoff), only when the visitor presses it.
 *
 * Anonymous visitors complete a Cloudflare Turnstile check when the Worker asks for one (after a
 * few questions an hour). Conversations stay in the page; signed assistant turns go back as history.
 */
(function () {
  "use strict";
  var E = window.Ellery;
  if (!E) return;
  var h = E.h;

  function catalog() {
    var node = document.getElementById("wia-catalog");
    if (!node) return { courses: {}, tracks: {}, levels: {} };
    try { return JSON.parse(node.textContent); } catch (e) { return { courses: {}, tracks: {}, levels: {} }; }
  }

  /* ---------------- shared chat runner ---------------- */
  function conversation(root, o) {
    var history = [], conversationId = null, busy = false, lastQuestion = "";
    var human = E.humanCheck();
    var log = E.chatLog({ ariaLabel: o.logLabel });
    var comp = E.composer({ id: o.id + "-in", label: o.inputLabel, labelHidden: !!o.labelHidden, maxLength: 1000, placeholder: o.placeholder, mic: false, onSend: send });
    var notices = h("div", { class: "ell-notices" });
    var chips = o.suggestions ? h("div", { class: "ell-quick", role: "group", "aria-label": "Suggestions" }, o.suggestions.map(function (s) {
      return E.btn(s, { class: "ell-chip", onclick: function () { send(s); } });
    })) : null;
    E.add(root, [log.el, notices, chips, comp.el, human.el]);
    function send(text) {
      if (busy) return;
      busy = true; lastQuestion = text;
      log.user(text); comp.clear(); E.clear(notices);
      if (chips) chips.hidden = true;
      var msg = log.assistant(E.aiWho());
      comp.setBusy(true);
      var body = { message: text, history: history.slice(-6) };
      if (conversationId) body.conversationId = conversationId;
      var tok = human.token(); if (tok !== undefined) body.turnstile = tok;
      E.request("POST", o.path, body, { auth: "optional" }).then(function (d) {
        if (d.conversationId) conversationId = d.conversationId;
        if (d.notice === "redacted") notices.appendChild(E.redactedNote());
        o.render(msg, d, text);
        if (d.turn && d.turn.sig) history.push({ role: "user", text: text }, { role: "assistant", text: d.turn.text, sig: d.turn.sig });
        human.reset();
      }, function (err) {
        var s = E.describe(err, o.mode);
        if (err.reason === "turnstile") { human.show(); comp.input.value = text; }
        msg.fail(E.stateBox(s, s.kind === "error" || s.kind === "offline" ? function () { send(text); } : null));
        if (s.kind === "paused" || s.kind === "quota") comp.setDisabled(s.title + ".");
      }).then(function () { busy = false; comp.setBusy(false); if (!comp.input.disabled) comp.focus(); });
    }
    return { comp: comp, last: function () { return lastQuestion; }, log: log };
  }

  /* ---------------- course finder ---------------- */
  function finder(root) {
    if (root.getAttribute("data-ellery-ready")) return;
    root.setAttribute("data-ellery-ready", "1");
    var cat = catalog();
    var body = h("div", { class: "ell-finder-body" }, E.spinner("Loading the course finder…"));
    var heading = root.getAttribute("data-heading");
    E.add(root, h("div", { class: "ell-finder-card" },
      h("div", { class: "ell-finder-head" },
        h("h2", { class: "ell-finder-t", id: "ell-finder-t" }, E.icon(E.ICONS.spark, 18), " ", heading || ["Not sure where to start? Ask ", E.nameText()]),
        h("p", { class: "ell-hint" }, h("span", { class: "ell-badge" }, E.labelText()), " Tell ", E.nameText(), " your role and goal and get two or three courses to start with. AI can be wrong; prices come from our catalog, not from ", E.nameText(), ".")),
      body));
    root.setAttribute("aria-labelledby", "ell-finder-t");
    E.status().then(function (st) {
      E.clear(body);
      if (st.paused) { body.appendChild(E.stateBox(E.blockedBy(st, "finder"))); return; }
      if (st.modes && st.modes.finder && !st.modes.finder.enabled) { root.hidden = true; return; }
      conversation(body, { id: "ell-finder", mode: "finder", path: "/api/ai/finder", logLabel: "Course finder conversation",
        inputLabel: "What do you want to learn?", labelHidden: true, placeholder: "e.g. I manage a finance team that is starting to use Copilot",
        suggestions: root.getAttribute("data-suggestions") ? root.getAttribute("data-suggestions").split("|") : ["I'm new to AI and want the basics", "My team is rolling out Microsoft 365 Copilot", "I build apps on top of LLM APIs"],
        render: function (msg, d) {
          msg.finish(d.intro || "");
          var recs = (d.recommendations || []).filter(function (r) { return r && /^[a-z0-9-]{2,60}$/.test(r.id); });
          if (recs.length) {
            var grid = h("div", { class: "ell-recs" }, recs.map(function (r) { return card(cat, r); }));
            msg.body.appendChild(grid);
            if (window.WIAPrices) window.WIAPrices.fill(grid);
          }
          if (d.followUp) msg.body.appendChild(h("p", { class: "ell-follow" }, d.followUp));
          msg.foot.appendChild(E.feedback("finder"));
        } });
    }, function () { E.clear(body).appendChild(E.stateBox(E.describe({ reason: "network", message: E.name() + " couldn't load. Browse the catalog instead." }))); });
  }

  function card(cat, r) {
    var c = (cat.courses || {})[r.id] || {};
    var level = (cat.levels || {})[c.l] || c.l || "";
    var track = (cat.tracks || {})[c.k] || "";
    var url = "/courses/" + encodeURIComponent(r.id) + "/";
    return h("article", { class: "ell-rec", "data-course": r.id },
      h("div", { class: "ell-rec-top" }, h("span", { class: "ell-code" }, r.id),
        h("span", { class: "price", "data-price-for": r.id, "data-kind": "course" }, h("span", { class: "fallback" }, c.s === "waitlist" ? "Waitlist" : "See the course page"))),
      h("h3", { class: "ell-rec-t" }, h("a", { href: url }, c.t || r.id)),
      level || track ? h("p", { class: "ell-hint" }, [level, track].filter(Boolean).join(" · ")) : null,
      r.why ? h("p", { class: "ell-rec-why" }, r.why) : null,
      h("a", { class: "ell-rec-go", href: url }, "View course", h("span", { "aria-hidden": "true" }, " →")));
  }

  /* ---------------- help desk ---------------- */
  function helpdesk(root) {
    if (root.getAttribute("data-ellery-ready")) return;
    root.setAttribute("data-ellery-ready", "1");
    var compact = root.getAttribute("data-compact") === "1";
    var body = h("div", { class: "ell-help-body" });
    var head = h("div", { class: "ell-finder-head" },
      h("h2", { class: "ell-finder-t", id: "ell-help-t" }, E.icon(E.ICONS.spark, 18), " " + (root.getAttribute("data-heading") || "Ask the help desk")),
      h("p", { class: "ell-hint" }, h("span", { class: "ell-badge" }, E.labelText()), " Answers come from our help pages. AI can be wrong; for anything about your account or a payment, contact support."));
    var wrap = h("div", { class: "ell-finder-card ell-help" }, head, body);
    root.setAttribute("aria-labelledby", "ell-help-t");
    if (compact) {
      var det = h("details", { class: "ell-help-det" }, h("summary", null, "Need help? Ask the help desk"), wrap);
      root.appendChild(det);
      det.addEventListener("toggle", function () { if (det.open && !body.firstChild) fill(); });
    } else { root.appendChild(wrap); fill(); }

    function fill() {
      body.appendChild(E.spinner("Loading the help desk…"));
      E.status().then(function (st) { go(st); }, function () { go(null); });
    }
    function go(st) {
      E.clear(body);
      if (st && st.paused) body.appendChild(h("p", { class: "ell-notice" }, E.name(st) + " is resting, so answers come straight from our FAQ for now."));
      var conv = conversation(body, { id: "ell-help", mode: "helpdesk", path: "/api/ai/help", logLabel: "Help desk conversation",
        inputLabel: "Your question", placeholder: "e.g. How many exam attempts do I get?",
        render: function (msg, d) {
          msg.finish(d.answer || "");
          if (d.fallback) msg.foot.appendChild(h("p", { class: "ell-hint" }, "Answered from our FAQ."));
          if (d.handoff) msg.foot.appendChild(E.btn(d.handoff === "errata" ? "Report an error in a course" : "Contact support", { class: "ell-btn-sm", onclick: function () { openHandoff(d.handoff); } }));
          else if (!d.fallback) msg.foot.appendChild(E.feedback("helpdesk"));
        } });
      var handBox = h("div", { class: "ell-handoff-box" });
      var handBtn = E.btn("Report an error / contact support", { class: "ell-btn-ghost ell-btn-sm", "aria-expanded": "false", onclick: function () { openHandoff("support"); } });
      E.add(body, [h("div", { class: "ell-actions" }, handBtn), handBox]);

      function openHandoff(kind) {
        handBtn.setAttribute("aria-expanded", "true");
        E.clear(handBox).appendChild(handoffForm(kind, conv.last(), function () { E.clear(handBox); handBtn.setAttribute("aria-expanded", "false"); handBtn.focus(); }));
        var f = handBox.querySelector("input, textarea"); if (f) f.focus();
      }
    }
  }

  /** "Report an error / contact support": a person answers by email. */
  function handoffForm(kind, question, onClose) {
    var signed = !!(window.WIAApi && window.WIAApi.signedIn());
    var human = E.humanCheck();
    var id = "ell-ho";
    var kSupport = h("input", { type: "radio", name: id + "-k", id: id + "-ks", value: "support", checked: kind !== "errata" });
    var kErrata = h("input", { type: "radio", name: id + "-k", id: id + "-ke", value: "errata", checked: kind === "errata" });
    var course = h("input", { id: id + "-c", class: "ell-input", type: "text", maxlength: "40", placeholder: "e.g. prm-201", autocomplete: "off", spellcheck: "false" });
    var courseWrap = h("div", { class: "ell-field", hidden: kind !== "errata" }, h("label", { for: id + "-c" }, "Course code"), course,
      h("p", { class: "ell-hint" }, "Shown at the top of each course page."));
    var msg = h("textarea", { id: id + "-m", class: "ell-input", rows: "4", maxlength: "2000" });
    msg.value = question || "";
    var email = signed ? null : h("input", { id: id + "-e", class: "ell-input", type: "email", autocomplete: "email", maxlength: "200" });
    var status = h("p", { class: "ell-hint", role: "status", "aria-live": "polite" });
    var send = E.btn("Send to a person");
    var form = h("form", { class: "ell-handoff", novalidate: true, "aria-labelledby": id + "-t" },
      h("h3", { id: id + "-t", class: "ell-h" }, "Hand this to a person"),
      h("fieldset", { class: "ell-radios" }, h("legend", null, "What do you need?"),
        h("label", { for: id + "-ks" }, kSupport, " Help from support"), h("label", { for: id + "-ke" }, kErrata, " Report an error in a course")),
      courseWrap,
      h("div", { class: "ell-field" }, h("label", { for: id + "-m" }, "Message"), msg),
      email ? h("div", { class: "ell-field" }, h("label", { for: id + "-e" }, "Your email", h("span", { class: "ell-hint" }, " (so we can reply)")), email) : null,
      human.el, status,
      h("div", { class: "ell-actions" }, send, E.btn("Cancel", { class: "ell-btn-ghost", onclick: onClose })));
    if (!signed) human.show();
    [kSupport, kErrata].forEach(function (r) { r.addEventListener("change", function () { courseWrap.hidden = !kErrata.checked; }); });
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    send.addEventListener("click", function (e) { e.preventDefault(); submit(); });
    function submit() {
      var k = kErrata.checked ? "errata" : "support";
      var b = { kind: k, message: msg.value.trim() };
      if (b.message.length < 2) { status.textContent = "Describe what you need."; msg.focus(); return; }
      if (k === "errata") { b.courseId = course.value.trim().toLowerCase(); if (!/^[a-z0-9-]{2,40}$/.test(b.courseId)) { status.textContent = "Enter the course code, for example prm-201."; course.focus(); return; } }
      if (email) { b.email = email.value.trim(); if (k === "support" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) { status.textContent = "Add an email address so a person can reply."; email.focus(); return; } }
      var tok = human.token(); if (tok !== undefined) b.turnstile = tok;
      send.disabled = true; send.textContent = "Sending…";
      E.request("POST", "/api/ai/help/handoff", b, { auth: "optional" }).then(function () {
        E.clear(form).appendChild(h("div", { class: "ell-state ell-tone-info", role: "status", tabindex: "-1" },
          h("strong", { class: "ell-state-t" }, "Sent"),
          h("p", null, k === "errata" ? "Thanks. Our editors check every report and correct the course when it's wrong." : "Thanks. A person will reply by email, usually within one business day.")));
        form.firstChild.focus();
      }, function (err) {
        status.textContent = err.message; human.reset();
        send.disabled = false; send.textContent = "Send to a person";
      });
    }
    return form;
  }

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-ellery-finder]"), finder);
    Array.prototype.forEach.call(document.querySelectorAll("[data-ellery-help]"), helpdesk);
  }
  window.ElleryPublic = { finder: finder };   // [onboard] the dashboard's first-run view adds a finder after load
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
