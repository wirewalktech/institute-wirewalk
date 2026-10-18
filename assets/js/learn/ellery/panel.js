/* [ellery] /learn/lesson/ : "Ellery · AI instructor" panel.
 *
 * A side panel (role="complementary") at 1024px and wider; a bottom sheet (role="dialog",
 * aria-modal, focus trapped, Esc closes, focus returns to the opener) below that.
 * Tabs: Ask (POST /api/ai/tutor, streamed), Practice (POST /api/ai/practice) and, only on lessons
 * that have one, Sandbox (GET/POST /api/ai/sandbox, streamed). Also adds:
 *   - "Ask Ellery" to the lesson toolbar (listen.js adds "Listen" to the same toolbar),
 *   - a "Practice this lesson" card under the mark-complete box,
 *   - end-of-lesson cards for the role-plays and graded exercises that use this lesson.
 * The client never sends lesson text: the Worker loads it after checking enrollment. The
 * conversation lives only in this page (signed assistant turns are sent back as history).
 * States: loading, quota reached, paused, not available on this course, exam in progress, offline.
 */
(function () {
  "use strict";
  var E = window.Ellery;
  if (!E) return;
  var h = E.h;
  var INDUSTRIES = [["finance", "Finance"], ["healthcare", "Healthcare"], ["public-sector", "Public sector"], ["retail", "Retail"],
    ["manufacturing", "Manufacturing"], ["legal", "Legal"], ["education", "Education"], ["technology", "Technology"],
    ["logistics", "Logistics"], ["professional-services", "Professional services"]];
  var L = null, st = null, panel = null, opener = null, mq = null, tabs = {}, current = "ask", ready = null;

  function start(info) {
    if (L || !info || !info.courseId) return;
    L = info;
    toolbar();
    ready = E.status(L.courseId).then(function (s) { st = s; }, function () { st = null; });
    ready.then(afterStatus);
  }

  /* ---------------- toolbar + launchers ---------------- */
  function toolbar() {
    var bar = document.querySelector(".ell-toolbar");
    if (!bar) {
      var head = document.querySelector(".wl-lesson-head");
      if (!head) return null;
      bar = h("div", { class: "ell-toolbar", role: "group", "aria-label": "Lesson tools" });
      head.appendChild(bar);
    }
    var askT = h("span", null, "Ask " + E.name());
    var ask = h("button", { type: "button", class: "ell-tool ell-tool-ask", "aria-haspopup": "dialog", "aria-controls": "ell-panel", "aria-expanded": "false",
      onclick: function () { open("ask", ask); } }, E.icon(E.ICONS.spark, 17), askT);
    bar.insertBefore(ask, bar.firstChild);
    var fabT = h("span", { class: "ell-fab-t" }, "Ask " + E.name());
    var fab = h("button", { type: "button", class: "ell-fab", "aria-label": "Ask " + E.name() + ", the AI instructor", "aria-controls": "ell-panel", "aria-expanded": "false",
      onclick: function () { open("ask", fab); } }, E.icon(E.ICONS.spark, 20), fabT);
    document.body.appendChild(fab);
    /* the persona name is admin-editable: relabel once status has answered */
    window.addEventListener("ellery:persona", function () {
      askT.textContent = "Ask " + E.name(); fabT.textContent = "Ask " + E.name();
      fab.setAttribute("aria-label", "Ask " + E.name() + ", the AI instructor");
    });
    return bar;
  }

  function afterStatus() {
    practiceCard();
    coachCards();
  }

  function practiceCard() {
    var box = document.getElementById("complete-box");
    if (!box || document.getElementById("ell-practice-card")) return;
    var blocked = E.blockedBy(st, "practice", L.courseId);
    if (blocked && blocked.kind === "unavailable") return;
    var b = E.btn("Practice this lesson", { class: "ell-btn-ghost", onclick: function () { open("practice", b); } });
    box.parentNode.insertBefore(h("section", { id: "ell-practice-card", class: "ell-card", "aria-labelledby": "ell-pc-t" },
      h("div", { class: "ell-card-text" },
        h("h2", { id: "ell-pc-t", class: "ell-card-t" }, "Check your understanding"),
        h("p", null, E.name(st) + " writes a few fresh practice questions from this lesson. Practice only, not part of certification.")),
      b), box.nextSibling);
  }

  /** Role-plays and graded exercises that list this lesson (paid courses only). */
  function coachCards() {
    if (!st || !st.course || st.examOpen || st.paused) return;
    var m = st.course.modes || {};
    var jobs = [];
    if (m.roleplay) jobs.push(E.request("GET", "/api/ai/scenarios?courseId=" + encodeURIComponent(L.courseId), undefined, { auth: true })
      .then(function (d) { return (d.scenarios || []).filter(function (s) { return (s.lessons || []).indexOf(L.ref) >= 0; })
        .map(function (s) { return { kind: "Practice conversation", title: s.title, sub: s.summary, minutes: s.minutes, href: "/learn/roleplay/?c=" + encodeURIComponent(L.courseId) + "&s=" + encodeURIComponent(s.id) }; }); }, function () { return []; }));
    if (m.exercise) jobs.push(E.request("GET", "/api/ai/exercises?courseId=" + encodeURIComponent(L.courseId), undefined, { auth: true })
      .then(function (d) { return (d.exercises || []).filter(function (x) { return (x.lessons || []).indexOf(L.ref) >= 0; })
        .map(function (x) { return { kind: "Graded exercise", title: x.title, sub: x.kind === "code" ? "Code exercise" + (x.language ? " · " + x.language : "") : "Writing exercise", minutes: x.minutes, href: "/learn/exercise/?c=" + encodeURIComponent(L.courseId) + "&x=" + encodeURIComponent(x.id) }; }); }, function () { return []; }));
    if (!jobs.length) return;
    Promise.all(jobs).then(function (lists) {
      var items = [].concat.apply([], lists);
      if (!items.length) return;
      var anchor = document.getElementById("ell-practice-card") || document.getElementById("complete-box");
      if (!anchor) return;
      anchor.parentNode.insertBefore(h("section", { class: "ell-card ell-card-coach", "aria-labelledby": "ell-cc-t" },
        h("div", { class: "ell-card-text" },
          h("h2", { id: "ell-cc-t", class: "ell-card-t" }, "Put this lesson to work"),
          E.practiceLabel("Not part of certification. Feedback is AI-generated and can be wrong."),
          h("ul", { class: "ell-coach-list" }, items.map(function (it) {
            return h("li", null, h("a", { href: it.href }, h("span", { class: "ell-kind" }, it.kind), h("strong", null, it.title),
              h("span", { class: "ell-hint" }, (it.minutes ? "About " + it.minutes + " minutes · " : "") + (it.sub || ""))));
          })))), anchor.nextSibling);
    });
  }

  /* ---------------- panel shell ---------------- */
  function isSheet() { return !(mq && mq.matches); }
  function build() {
    if (panel) return panel;
    mq = window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
    var title = h("h2", { id: "ell-panel-t", class: "ell-panel-t" }, E.icon(E.ICONS.spark, 18), h("span", null, E.label(st)));
    var close = h("button", { type: "button", class: "ell-icon-btn ell-close", "aria-label": "Close " + E.name(st), onclick: function () { hide(); } }, E.icon(E.ICONS.close, 18));
    var grow = h("button", { type: "button", class: "ell-icon-btn ell-expand", "aria-label": "Expand to full height", "aria-pressed": "false",
      onclick: function () { var on = !panel.classList.contains("is-full"); panel.classList.toggle("is-full", on); grow.setAttribute("aria-pressed", on ? "true" : "false"); } }, E.icon(E.ICONS.expand, 16));
    var tablist = h("div", { class: "ell-tabs", role: "tablist", "aria-label": E.name(st) + " modes" });
    var body = h("div", { class: "ell-panel-body" });
    panel = h("section", { id: "ell-panel", class: "ell-panel", "aria-labelledby": "ell-panel-t", hidden: true },
      h("div", { class: "ell-grab", "aria-hidden": "true" }),
      h("header", { class: "ell-panel-head" },
        h("div", null, title, h("p", { class: "ell-panel-sub" }, "AI can be wrong. Check answers against the lesson.")),
        h("div", { class: "ell-panel-btns" }, grow, close)),
      tablist, body);
    var backdrop = h("div", { class: "ell-backdrop", hidden: true, onclick: function () { hide(); } });
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    panel._backdrop = backdrop;

    addTab(tablist, body, "ask", "Ask", askTab);
    addTab(tablist, body, "practice", "Practice", practiceTab);
    if (st && st.course && st.course.modes && st.course.modes.sandbox && !st.examOpen && !st.paused) {
      E.request("GET", "/api/ai/sandbox?courseId=" + encodeURIComponent(L.courseId) + "&lesson=" + encodeURIComponent(L.ref), undefined, { auth: true })
        .then(function (d) { if (d && d.available) addTab(tablist, body, "sandbox", "Sandbox", function (p) { sandboxTab(p, d); }); }, function () { /* no sandbox tab */ });
    }
    tablist.addEventListener("keydown", function (e) {
      var keys = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
      if (!(e.key in keys)) return;
      e.preventDefault();
      var ids = Object.keys(tabs), i = ids.indexOf(current);
      var k = keys[e.key];
      var next = k === "first" ? ids[0] : k === "last" ? ids[ids.length - 1] : ids[(i + k + ids.length) % ids.length];
      select(next); tabs[next].tab.focus();
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); hide(); return; }
      if (e.key === "Tab" && isSheet()) trap(e);
    });
    /* Esc also closes when focus fell back to the page (a button that was busy lost it). */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || panel.hidden) return;
      var a = document.activeElement;
      if (!a || a === document.body || isSheet()) { e.preventDefault(); hide(); }
    });
    if (mq) { var onMq = function () { if (!panel.hidden) layout(); }; if (mq.addEventListener) mq.addEventListener("change", onMq); else mq.addListener(onMq); }
    if (window.visualViewport) {
      var vv = window.visualViewport;
      var onVv = function () { var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); panel.style.setProperty("--ell-kb", kb + "px"); };
      vv.addEventListener("resize", onVv); vv.addEventListener("scroll", onVv);
    }
    return panel;
  }

  function addTab(tablist, body, id, text, fill) {
    var tab = h("button", { type: "button", role: "tab", id: "ell-tab-" + id, "aria-controls": "ell-tp-" + id, "aria-selected": "false", tabindex: "-1", class: "ell-tab",
      onclick: function () { select(id); } }, text);
    var pane = h("div", { role: "tabpanel", id: "ell-tp-" + id, "aria-labelledby": "ell-tab-" + id, class: "ell-pane", hidden: true, tabindex: "-1" });
    tablist.appendChild(tab); body.appendChild(pane);
    tabs[id] = { tab: tab, pane: pane, fill: fill, filled: false };
    if (id === current && !panel.hidden) select(id);
  }
  function select(id) {
    if (!tabs[id]) id = "ask";
    current = id;
    Object.keys(tabs).forEach(function (k) {
      var t = tabs[k], on = k === id;
      t.tab.setAttribute("aria-selected", on ? "true" : "false"); t.tab.tabIndex = on ? 0 : -1; t.pane.hidden = !on;
      if (on && !t.filled) { t.filled = true; t.fill(t.pane); }
    });
  }
  function layout() {
    var sheet = isSheet();
    panel.classList.toggle("is-sheet", sheet);
    panel.classList.toggle("is-side", !sheet);
    if (sheet) { panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); }
    else { panel.setAttribute("role", "complementary"); panel.removeAttribute("aria-modal"); }
    panel._backdrop.hidden = !sheet;
    document.documentElement.classList.toggle("ell-side-open", !sheet);
    document.documentElement.classList.toggle("ell-sheet-open", sheet);
  }
  function open(tab, from) {
    var who = from || document.activeElement;
    if (!st && ready) { if (from) from.setAttribute("aria-busy", "true"); ready.then(function () { if (from) from.removeAttribute("aria-busy"); show(tab, who); }); return; }
    show(tab, who);
  }
  function show(tab, from) {
    build();
    opener = from || document.activeElement;
    panel.hidden = false;
    layout();
    select(tab || current);
    expanded(true);
    var focusTarget = tabs[current] && tabs[current].pane.querySelector("textarea:not([disabled]), button:not([disabled]), input:not([disabled])");
    (focusTarget || tabs[current].tab).focus();
  }
  function hide() {
    if (!panel || panel.hidden) return;
    panel.hidden = true; panel._backdrop.hidden = true;
    document.documentElement.classList.remove("ell-side-open", "ell-sheet-open");
    expanded(false);
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }
  function expanded(on) {
    Array.prototype.forEach.call(document.querySelectorAll('[aria-controls="ell-panel"]'), function (b) { b.setAttribute("aria-expanded", on ? "true" : "false"); });
  }
  function trap(e) {
    var f = Array.prototype.filter.call(panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------------- Ask ---------------- */
  function askTab(pane) {
    var blocked = E.blockedBy(st, "tutor", L.courseId);
    var history = [];               // [{role:"user", text}, {role:"assistant", text, sig}]
    var lastQuestion = "";
    var ctl = null;
    var quota = h("p", { class: "ell-quota", role: "status" });
    var notices = h("div", { class: "ell-notices" });
    var log = E.chatLog({ ariaLabel: "Conversation with " + E.name(st) + " about this lesson" });
    var scope = h("select", { id: "ell-scope", class: "ell-select" },
      h("option", { value: "lesson" }, "This lesson"), h("option", { value: "module" }, "This module"), h("option", { value: "course" }, "The whole course"));
    var industry = h("select", { id: "ell-ind", class: "ell-select" }, h("option", { value: "" }, "Choose an industry"),
      INDUSTRIES.map(function (x) { return h("option", { value: x[0] }, x[1]); }));
    var industryWrap = h("div", { class: "ell-field ell-ind", hidden: true }, h("label", { for: "ell-ind" }, "Example from"), industry);
    var quick = h("div", { class: "ell-quick", role: "group", "aria-label": "Ask again differently" },
      E.btn("Explain differently", { class: "ell-chip", onclick: function () { ask(lastQuestion || "Explain the main idea of this lesson.", "different"); } }),
      E.btn("Simpler", { class: "ell-chip", onclick: function () { ask(lastQuestion || "Explain the main idea of this lesson.", "simpler"); } }),
      E.btn("Example from my industry", { class: "ell-chip", "aria-expanded": "false", onclick: function (e) {
        var b = e.currentTarget;
        if (industryWrap.hidden) { industryWrap.hidden = false; b.setAttribute("aria-expanded", "true"); industry.focus(); return; }
        if (!industry.value) { industry.focus(); return; }
        ask(lastQuestion || "Explain the main idea of this lesson.", "example", industry.value);
      } }));
    industry.addEventListener("change", function () { if (industry.value) ask(lastQuestion || "Explain the main idea of this lesson.", "example", industry.value); });
    var comp = E.composer({ id: "ell-ask", label: "Ask about this lesson", labelHidden: true, maxLength: 2000,
      placeholder: "Ask anything about this lesson", onSend: function (t) { ask(t, "default"); } });
    var fresh = E.btn("New conversation", { class: "ell-btn-sm ell-btn-ghost", onclick: function () {
      if (ctl) ctl.abort();
      history = []; lastQuestion = ""; log.clear(); E.clear(notices); comp.focus();
    } });
    var report = h("a", { class: "ell-report", href: "/errata/?c=" + encodeURIComponent(L.courseId) + "&l=" + encodeURIComponent(L.idx),
      "data-errata-course": L.courseId, "data-errata-lesson": String(L.idx), "data-errata-title": L.title }, "Report a problem with this lesson");

    E.add(pane, [E.firstUse("tutor", E.name(st) + " answers from this lesson and won't help with exam questions."),
      h("div", { class: "ell-row ell-scope-row" }, h("div", { class: "ell-field" }, h("label", { for: "ell-scope" }, "Answer from"), scope), industryWrap),
      log.el, notices, quick, comp.el, h("div", { class: "ell-pane-foot" }, quota, fresh), h("p", { class: "ell-hint" }, report)]);

    if (blocked) { showBlocked(blocked); }
    else {
      log.note(h("div", { class: "ell-msg ell-msg-ai ell-hello" }, h("div", { class: "ell-who" }, E.aiWho()),
        h("div", { class: "ell-body" }, h("p", null, "Hi, I'm " + E.name(st) + ". Ask me about “" + L.title + "”. I'll answer from the lesson and point you to the section I used."))));
      showQuota(st && st.modes && st.modes.tutor);
    }

    function showQuota(q) {
      if (q && typeof q.remaining === "number") quota.textContent = q.remaining + (q.remaining === 1 ? " question" : " questions") + " left today.";
    }
    function showBlocked(s) {
      E.clear(notices).appendChild(E.stateBox(s));
      var hard = s.kind !== "error" && s.kind !== "offline";
      comp.setDisabled(hard ? s.title + "." : null);
      Array.prototype.forEach.call(quick.querySelectorAll("button"), function (b) { b.disabled = hard; });
    }

    function ask(text, style, ind) {
      if (ctl) return;
      if (style === "default") lastQuestion = text;
      var shown = style === "default" ? text : style === "simpler" ? "Simpler, please: " + text : style === "different" ? "Explain it differently: " + text
        : "Give me an example from " + (INDUSTRIES.filter(function (x) { return x[0] === ind; })[0] || ["", "my industry"])[1].toLowerCase() + ": " + text;
      log.user(shown);
      comp.clear();
      E.clear(notices);
      var msg = log.assistant(E.aiWho(), { lessonRef: L.ref });
      ctl = window.AbortController ? new AbortController() : null;
      comp.setBusy(true, ctl ? function () { ctl.abort(); } : null);
      var body = { courseId: L.courseId, lesson: L.idx, scope: scope.value, message: text, style: style, history: history.slice(-6) };
      if (style === "example") body.industry = ind;
      E.request("POST", "/api/ai/tutor", body, { auth: true, stream: true, signal: ctl ? ctl.signal : undefined, onEvent: function (name, d) {
        if (name === "meta") { if (d.quota) showQuota(d.quota); if (d.notice === "redacted") notices.appendChild(E.redactedNote()); }
        else if (name === "delta") msg.append(d.text || "");
        else if (name === "retract") { msg.replace(""); }
      } }).then(function (r) {
        var d = r.done || {};
        msg.finish(d.text || "", { citations: d.citations || [], lessonRef: L.ref });
        if (r.retracted) msg.foot.appendChild(h("p", { class: "ell-hint" }, E.name(st) + " won't produce text that matches the course exam, so it withdrew this answer. " +
          "Ask about the underlying idea instead."));
        if (d.stopReason === "assessment_like") msg.foot.appendChild(h("p", { class: "ell-hint" }, "Nothing was used from your daily allowance."));
        if (d.truncated) msg.foot.appendChild(h("p", { class: "ell-hint" }, "That answer hit its length limit. Ask a narrower follow-up for the rest."));
        if (d.turn && d.turn.sig) history.push({ role: "user", text: text }, { role: "assistant", text: d.turn.text, sig: d.turn.sig });
        if (d.stopReason !== "assessment_like" && d.stopReason !== "refused" && d.stopReason !== "retracted") msg.foot.appendChild(E.feedback("tutor"));
      }, function (err) {
        var s = E.describe(err, "tutor");
        if (err.reason === "aborted") { msg.fail(h("p", { class: "ell-hint" }, "Stopped. Ask again whenever you like.")); return; }
        msg.fail(E.stateBox(s, s.kind === "error" || s.kind === "offline" ? function () { ask(text, style, ind); } : null));
        if (s.kind !== "error" && s.kind !== "offline") showBlocked(s);
      }).then(function () {
        ctl = null; comp.setBusy(false);
        if (!comp.input.disabled) comp.focus();
      });
    }
  }

  /* ---------------- Practice ---------------- */
  function practiceTab(pane) {
    var blocked = E.blockedBy(st, "practice", L.courseId);
    if (blocked) { pane.appendChild(E.stateBox(blocked)); return; }
    E.practice(pane, { courseId: L.courseId, lesson: L.ref, lessonRef: L.ref, title: "this lesson" });
  }

  /* ---------------- Sandbox ---------------- */
  function sandboxTab(pane, info) {
    var blocked = E.blockedBy(st, "sandbox", L.courseId);
    if (blocked) { pane.appendChild(E.stateBox(blocked)); return; }
    var uid = "ell-sb";
    var prompt = h("textarea", { id: uid + "-p", class: "ell-input", rows: "6", maxlength: String(info.maxPromptChars || 6000), placeholder: "Write your prompt here" });
    var system = info.allowLearnerSystem ? h("textarea", { id: uid + "-s", class: "ell-input", rows: "3", maxlength: String(info.maxSystemChars || 3000) }) : null;
    var follow = [];
    for (var i = 1; i < (info.turns || 1); i++) follow.push(h("textarea", { id: uid + "-f" + i, class: "ell-input", rows: "2", maxlength: String(info.maxPromptChars || 6000) }));
    var coach = h("input", { type: "checkbox", id: uid + "-c", checked: true });
    var runBtn = E.btn("Run prompt");
    var runOut = h("div", { class: "ell-sb-out", "aria-busy": "false" });
    var coachOut = h("div", { class: "ell-sb-coach" });
    var checks = h("ul", { class: "ell-checks" });
    var announcer = h("div", { class: "ell-sr", role: "status", "aria-live": "polite" });
    var fbSlot = h("div", { class: "ell-sb-fb" });
    var stopBtn = E.btn("Stop", { class: "ell-btn-ghost ell-stop", hidden: true });
    var ctl = null;
    stopBtn.addEventListener("click", function () { if (ctl) ctl.abort(); });
    var results = h("div", { class: "ell-sb-results", hidden: true },
      h("h3", { class: "ell-h" }, "What the model produced"), runOut, checks,
      h("h3", { class: "ell-h" }, E.name(st) + "'s coaching"), coachOut, fbSlot);
    var useStarter = info.starterMaterial ? E.btn("Paste the starter material", { class: "ell-btn-sm ell-btn-ghost", onclick: function () {
      prompt.value = (prompt.value ? prompt.value + "\n\n" : "") + info.starterMaterial; prompt.focus(); } }) : null;

    E.add(pane, [E.practiceLabel("Not part of certification. Output is AI-generated and can be wrong."),
      info.vendorNote ? h("p", { class: "ell-notice" }, info.vendorNote) : null,
      h("p", { class: "ell-hint" }, "Try the technique from this lesson on a real model. Use invented data: no real names, customers or secrets. Your prompt isn't stored."),
      info.technique ? h("p", null, h("strong", null, "Technique: "), info.technique) : null,
      info.starterTask ? h("div", { class: "ell-task" }, h("strong", null, "Your task"), E.md(info.starterTask)) : null,
      info.starterMaterial ? h("details", { class: "ell-details" }, h("summary", null, "Starter material"), h("pre", { class: "ell-pre", tabindex: "0" }, h("code", { text: info.starterMaterial })), useStarter) : null,
      system ? h("div", { class: "ell-field" }, h("label", { for: uid + "-s" }, "System prompt (optional)"), system) : null,
      h("div", { class: "ell-field" }, h("label", { for: uid + "-p" }, "Your prompt"), prompt),
      follow.map(function (f, n) { return h("div", { class: "ell-field" }, h("label", { for: f.id }, "Follow-up " + (n + 1) + " (optional)"), f); }),
      h("label", { class: "ell-check", for: uid + "-c" }, coach, " Coach me on the result"),
      h("div", { class: "ell-actions" }, runBtn, stopBtn), results, announcer]);

    runBtn.addEventListener("click", function () {
      var text = prompt.value.trim();
      if (text.length < 2) { prompt.focus(); return; }
      results.hidden = false;
      E.clear(runOut).appendChild(E.spinner("Running your prompt…")); E.clear(coachOut); E.clear(checks); E.clear(fbSlot);
      runOut.setAttribute("aria-busy", "true");
      runBtn.disabled = true; runBtn.textContent = "Running…";
      ctl = window.AbortController ? new AbortController() : null;
      stopBtn.hidden = !ctl;
      announcer.textContent = "Running your prompt.";
      var raw = { run: "", coach: "" };
      var body = { courseId: L.courseId, lesson: L.ref, prompt: text, coach: coach.checked,
        followUps: follow.map(function (f) { return f.value.trim(); }).filter(Boolean) };
      if (system && system.value.trim()) body.system = system.value.trim();
      E.request("POST", "/api/ai/sandbox", body, { auth: true, stream: true, signal: ctl ? ctl.signal : undefined, onEvent: function (name, d) {
        if (name === "meta" && d.notice === "redacted") pane.insertBefore(E.redactedNote(), results);
        if (name === "retract") { raw.run = ""; E.clear(runOut); }
        if (name === "delta") {
          var part = d.part === "coach" ? "coach" : "run";
          raw[part] += d.text || "";
          var target = part === "coach" ? coachOut : runOut;
          E.clear(target).appendChild(part === "run" ? h("pre", { class: "ell-pre ell-run", tabindex: "0" }, h("code", { text: raw.run })) : E.md(raw.coach));
        }
      } }).then(function (r) {
        var d = r.done || {};
        E.clear(runOut).appendChild(h("pre", { class: "ell-pre ell-run", tabindex: "0" }, h("code", { text: d.run || raw.run })));
        E.clear(coachOut).appendChild(d.coach ? E.md(d.coach) : h("p", { class: "ell-hint" }, coach.checked ? "No coaching this time." : "Coaching was off for this run."));
        (d.checks || []).forEach(function (c) {
          var names = { json_parse: "Output parses as JSON", contains_canary: "Ignored the instruction hidden in the material" };
          checks.appendChild(h("li", { class: c.passed ? "ell-ok" : "ell-bad" }, h("strong", null, c.passed ? "Pass: " : "Not yet: "), names[c.id] || c.id));
        });
        if (d.stopReason === "assessment_like") E.clear(runOut).appendChild(E.md(d.text || ""));
        if (d.stopReason === "retracted") E.clear(runOut).appendChild(h("p", { class: "ell-hint" }, "The output came too close to the course exam, so it was withdrawn. Try the technique on a different task."));
        else if (d.stopReason !== "assessment_like") fbSlot.appendChild(E.feedback("sandbox"));          // a fresh rating row for every run
        announcer.textContent = "Run finished. " + (d.coach ? "Coaching is below the output." : "");
      }, function (err) {
        if (err.reason === "aborted") { E.clear(runOut).appendChild(h("p", { class: "ell-hint" }, "Stopped. Run it again whenever you like.")); announcer.textContent = "Stopped."; return; }
        E.clear(runOut).appendChild(E.stateBox(E.describe(err, "sandbox")));
        announcer.textContent = err.message;
      }).then(function () {
        ctl = null; stopBtn.hidden = true;
        runOut.setAttribute("aria-busy", "false"); runBtn.disabled = false; runBtn.textContent = "Run again";
        if (!document.activeElement || document.activeElement === document.body) runBtn.focus();
      });
    });
  }

  if (window.WLLesson) start(window.WLLesson);
  else document.addEventListener("wl:lesson", function (e) { start(e.detail); });
})();
