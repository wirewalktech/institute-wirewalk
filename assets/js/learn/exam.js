/* /learn/exam/?c=<course> : rules screen, timed exam, submission and module-level results.
 * Answers live in memory and in sessionStorage (per attempt) so a reload resumes them.
 * Correct answers are never shown: the Worker never sends them. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  var cid = (W.param("c") || "").toLowerCase();
  var MODE_KEY = "wia_exam_mode";

  var info = null;          // GET /api/courses/:id response
  var ex = null;            // {attemptId, deadline, minutes, questions}
  var st = { answers: {}, flags: {}, cur: 0, mode: "one" };
  var tick = null, submitting = false, submitted = false, warned = {};

  /* ---- clock ----
   * The Worker grades a submission that arrives later than deadline + 60 s as unanswered, so
   * the countdown must follow the SERVER's clock, not the learner's. A fresh start response
   * carries deadline = serverNow + minutes, which gives the offset between the two clocks; it
   * is kept per attempt (localStorage) so a resume in another tab or after a reload uses it.
   * If the Worker ever sends serverTime/now, that wins. Auto-submit fires a few seconds before
   * zero, and well before zero when the tab has been hidden long enough for browsers to
   * throttle timers to once a minute. */
  var AUTO_LEAD_MS = 4000, HIDDEN_LEAD_MS = 50000, HIDDEN_THROTTLE_MS = 4 * 60000;
  var offset = 0, hiddenSince = null;
  function now() { return Date.now() + offset; }
  function offsetKey(aid) { return "wia_exam_off_" + aid; }
  function computeOffset(r, fresh, sentAt, recvAt) {
    var local = Math.round((sentAt + recvAt) / 2);
    var srv = Date.parse(r.serverTime || r.now || "");
    if (!isNaN(srv)) return srv - local;
    var stored = null;
    try { stored = localStorage.getItem(offsetKey(r.attemptId)); } catch (e) { /* blocked */ }
    if (stored !== null && !isNaN(Number(stored))) return Number(stored);
    var dl = Date.parse(r.deadline);
    if (fresh && !isNaN(dl) && r.minutes > 0) {
      var off = (dl - r.minutes * 60000) - local;
      try { localStorage.setItem(offsetKey(r.attemptId), String(off)); } catch (e) { /* blocked */ }
      return off;
    }
    return 0;
  }
  function leftMs() {
    var left = Date.parse(ex.deadline) - now();
    /* No attempt can have more than its time limit left: caps the damage of a slow clock on a
       resume where no offset is known. */
    if (ex.minutes > 0) left = Math.min(left, ex.minutes * 60000);
    return left;
  }
  function autoLead() {
    return (document.hidden && hiddenSince && Date.now() - hiddenSince > HIDDEN_THROTTLE_MS) ? HIDDEN_LEAD_MS : AUTO_LEAD_MS;
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenSince = Date.now(); return; }
    hiddenSince = null;
    if (ex && !submitted) updateTimer();
  });
  function startExam(fresh) {
    var sentAt = Date.now();
    return API.startExam(cid).then(function (r) { r._off = computeOffset(r, fresh, sentAt, Date.now()); return r; });
  }

  function storeKey() { return "wia_exam_" + ex.attemptId; }
  function persist() { W.ss(storeKey(), { answers: st.answers, flags: st.flags, cur: st.cur }); }
  function prefMode() { try { return localStorage.getItem(MODE_KEY) === "all" ? "all" : "one"; } catch (e) { return "one"; } }
  function savePrefMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* ignore */ } }

  function title() { return (info && info.course && info.course.title) || W.courseTitle(cid); }

  /* ------------------------------------------------------------ load + gate */
  function load() {
    if (!/^[a-z0-9-]{2,60}$/.test(cid)) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "No exam selected", "Open the exam from your course page.", [W.btn("Go to dashboard", { href: "/learn/" })])));
      return;
    }
    if (!W.requireAuth()) return;
    W.loading("Loading exam…");
    API.course(cid).then(function (d) { info = d; gate(); }, function (err) {
      if (err.status === 401) return;
      if (err.status === 403) {
        W.mount(h("div", { class: "wl-narrow" }, W.notice("info", "You are not enrolled in this course", "Enroll to take its exam.",
          [W.btn("About this course", { href: W.publicCourseUrl(cid) })])));
        return;
      }
      W.mount(W.errorView(err, load));
    });
  }

  function back() { return W.btn("Back to course", { href: W.courseUrl(cid), class: "wl-btn-ghost" }); }

  function gate() {
    var exam = info.exam || {}, prog = info.progress || {};
    W.setTitle("Exam · " + title());
    if (exam.openAttempt) return resumeScreen(exam.openAttempt);
    if (exam.passed || (info.certificate && !info.certificate.expired)) {   // [freshness] expired: recertification
      return W.mount(h("div", { class: "wl-narrow" }, head(),
        W.notice("ok", "You have passed this exam", exam.bestScore != null ? "Best score: " + exam.bestScore + "%." : null,
          [info.certificate ? W.btn("View certificate", { href: W.certUrl(info.certificate.id) }) : null, back()].filter(Boolean))));
    }
    if (!exam.eligible) {
      return W.mount(h("div", { class: "wl-narrow" }, head(),
        W.notice(exam.reason === "no_attempts_left" ? "error" : "info", W.examSummary(exam, prog).text, W.reasonDetail(exam, prog),
          [exam.reason === "complete_lessons" ? W.btn("Continue the course", { href: W.courseUrl(cid) }) : back()])));
    }
    rules();
  }

  function head() {
    return h("header", { class: "wl-pagehead" },
      h("nav", { class: "wl-crumbs", "aria-label": "Breadcrumb" },
        h("a", { href: "/learn/" }, "My learning"), h("span", { "aria-hidden": "true" }, " / "),
        h("a", { href: W.courseUrl(cid) }, title())),
      h("p", { class: "wl-eyebrow" }, "Exam"),
      h("h1", { class: "wl-display" }, title()));
  }

  function rules() {
    var cfg = (info.course && info.course.exam) || {}, exam = info.exam || {};
    var left = Math.max(0, (exam.attemptsAllowed || cfg.attempts || 0) - (exam.attemptsUsed || 0));
    var mode = prefMode();
    var ack = h("input", { type: "checkbox", id: "ack", required: true });
    var start = W.btn("Start the exam", { disabled: true });
    ack.addEventListener("change", function () { start.disabled = !ack.checked; });
    var modeOne = h("input", { type: "radio", name: "mode", id: "mode-one", value: "one", checked: mode === "one" });
    var modeAll = h("input", { type: "radio", name: "mode", id: "mode-all", value: "all", checked: mode === "all" });
    start.addEventListener("click", function () {
      var m = modeAll.checked ? "all" : "one"; savePrefMode(m);
      W.busy(start, startExam(true), "Starting…").then(function (r) { begin(r, m); }, function (e) {
        W.toast(e.message, "bad");
        if (e.status === 403 || e.status === 409) load();
      });
    });
    W.mount(h("div", { class: "wl-narrow" }, head(),
      h("dl", { class: "wl-facts wl-facts-big" },
        h("div", null, h("dt", null, "Questions"), h("dd", null, String(cfg.questions || "—"))),
        h("div", null, h("dt", null, "Time limit"), h("dd", null, (cfg.minutes || "—") + " min")),
        h("div", null, h("dt", null, "Pass mark"), h("dd", null, (cfg.passPct || "—") + "%")),
        h("div", null, h("dt", null, "Attempts left"), h("dd", null, String(left)))),
      h("section", { class: "wl-rules", "aria-labelledby": "h-rules" },
        h("h2", { id: "h-rules", class: "wl-h3" }, "Before you start"),
        h("ul", { class: "wl-ticks" },
          h("li", null, "The timer starts when you press Start and keeps running if you close the page. Come back to this page to resume before time runs out."),
          h("li", null, "Some questions have one correct answer; others say “select all that apply”. A multi-select question counts only if you choose exactly the right set."),
          h("li", null, "Your answers are kept in this browser tab until you submit. When time runs out, the answers you have chosen are submitted automatically a few seconds before the clock reaches zero."),
          h("li", null, "Results show your score and how you did in each module. Correct answers are never shown."),
          h("li", null, "If you do not pass, the next attempt opens 24 hours later."),
          h("li", null, "Work on your own. The certificate states that you completed the course and passed its assessment."))),
      h("fieldset", { class: "wl-choice" },
        h("legend", null, "How would you like to see the questions?"),
        h("label", { for: "mode-one", class: "wl-choice-opt" }, modeOne, h("span", null, h("strong", null, "One at a time"), h("span", { class: "wl-hint" }, "Focused, with a question map."))),
        h("label", { for: "mode-all", class: "wl-choice-opt" }, modeAll, h("span", null, h("strong", null, "All on one page"), h("span", { class: "wl-hint" }, "Scroll through every question.")))),
      h("div", { class: "wl-ack" }, ack, h("label", { for: "ack" }, "I have read the rules and I am ready to start the timed exam.")),
      h("div", { class: "wl-actions" }, start, back())));
  }

  function resumeScreen(open) {
    var b = W.btn("Resume the exam");
    b.addEventListener("click", function () {
      W.busy(b, startExam(false), "Resuming…").then(function (r) { begin(r, prefMode()); }, function (e) { W.toast(e.message, "bad"); load(); });
    });
    W.mount(h("div", { class: "wl-narrow" }, head(),
      W.notice("warn", "Your exam is in progress", "The timer is still running. It ends " + W.fmtDateTime(open.deadline) + ". Answers you chose in this browser tab are restored.", [b])));
  }

  /* ------------------------------------------------------------ the exam */
  function begin(r, mode) {
    ex = r;
    offset = r._off || 0;
    var saved = W.ss(storeKey()) || {};
    st = { answers: saved.answers || {}, flags: saved.flags || {}, cur: Math.min(saved.cur || 0, r.questions.length - 1), mode: mode };
    submitting = false; submitted = false; warned = {};
    window.addEventListener("beforeunload", beforeUnload);
    renderExam();
    clearInterval(tick);
    tick = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function beforeUnload(e) {
    if (submitted || !ex) return;
    e.preventDefault();
    e.returnValue = "Your exam is in progress. The timer keeps running if you leave.";
    return e.returnValue;
  }

  function answeredCount() {
    return ex.questions.filter(function (q) { var a = st.answers[q.n]; return a && a.length; }).length;
  }

  var els = {};
  function renderExam() {
    W.setTitle("Exam in progress · " + title());
    els.timer = h("span", { class: "wl-timer-v" }, "--:--");
    els.timerBox = h("div", { class: "wl-timer", role: "timer", "aria-label": "Time remaining" }, h("span", { class: "wl-timer-k" }, "Time left"), els.timer);
    els.sr = h("div", { class: "wl-sr", "aria-live": "assertive" });
    els.count = h("span", { class: "wl-exam-count" });
    var toggle = h("button", { type: "button", class: "wl-btn wl-btn-ghost wl-btn-sm" }, st.mode === "one" ? "All questions" : "One at a time");
    toggle.addEventListener("click", function () { st.mode = st.mode === "one" ? "all" : "one"; savePrefMode(st.mode); renderExam(); });
    var submit = W.btn("Submit…", { class: "wl-btn-sm" });
    submit.addEventListener("click", confirmSubmit);

    var bar = h("div", { class: "wl-exam-bar" },
      h("div", { class: "wl-exam-bar-in" },
        h("div", { class: "wl-grow wl-exam-bar-t" }, h("h1", { class: "wl-exam-h1" }, title()), els.count),
        els.timerBox, toggle, submit));

    els.nav = h("nav", { class: "wl-qmap", "aria-label": "Question map" });
    els.body = h("div", { class: "wl-exam-body" });
    W.mount(h("div", { class: "wl-exam" }, bar, els.sr,
      h("div", { class: "wl-exam-grid" + (st.mode === "all" ? " is-all" : "") },
        h("aside", { class: "wl-exam-side" }, h("h2", { class: "wl-h4" }, "Questions"), els.nav,
          h("p", { class: "wl-hint wl-qlegend" }, h("span", { class: "wl-qdot is-ans" }), " answered ", h("span", { class: "wl-qdot is-flag" }), " flagged")),
        els.body)));
    renderBody();
    updateTimer();
  }

  function renderBody() {
    W.clear(els.body);
    if (st.mode === "all") {
      ex.questions.forEach(function (q, i) { els.body.appendChild(questionCard(q, i)); });
      els.body.appendChild(h("div", { class: "wl-actions wl-exam-end" }, W.btn("Review and submit", { onclick: confirmSubmit })));
    } else {
      var i = st.cur, q = ex.questions[i];
      var prev = W.btn("← Previous", { class: "wl-btn-ghost", disabled: i === 0 });
      var next = i < ex.questions.length - 1 ? W.btn("Next →") : W.btn("Review and submit");
      prev.addEventListener("click", function () { go(i - 1); });
      next.addEventListener("click", function () { if (i < ex.questions.length - 1) go(i + 1); else confirmSubmit(); });
      els.body.appendChild(questionCard(q, i));
      els.body.appendChild(h("div", { class: "wl-exam-pager" }, prev, h("span", { class: "wl-hint" }, (i + 1) + " / " + ex.questions.length), next));
    }
    renderMap();
  }

  function go(i, focus) {
    if (i < 0 || i >= ex.questions.length) return;
    if (st.mode === "all") {
      var card = document.getElementById("q-" + ex.questions[i].n);
      if (card) { card.scrollIntoView({ behavior: "smooth", block: "start" }); var leg = card.querySelector("legend"); if (leg) leg.focus({ preventScroll: true }); }
      st.cur = i; persist(); renderMap();
      return;
    }
    st.cur = i; persist(); renderBody();
    var l = els.body.querySelector("legend"); if (l && focus !== false) l.focus();
    var top = els.body.getBoundingClientRect().top + window.scrollY - 120;
    if (window.scrollY > top) window.scrollTo(0, top);
  }

  function questionCard(q, i) {
    var multi = q.type === "multi";
    var chosen = st.answers[q.n] || [];
    var name = "q" + q.n;
    var flag = h("button", { type: "button", class: "wl-flag" + (st.flags[q.n] ? " is-on" : ""), "aria-pressed": String(!!st.flags[q.n]) }, st.flags[q.n] ? "Flagged" : "Flag for review");
    flag.addEventListener("click", function () {
      st.flags[q.n] = !st.flags[q.n]; if (!st.flags[q.n]) delete st.flags[q.n];
      flag.classList.toggle("is-on", !!st.flags[q.n]); flag.setAttribute("aria-pressed", String(!!st.flags[q.n]));
      flag.textContent = st.flags[q.n] ? "Flagged" : "Flag for review";
      persist(); renderMap();
    });
    var opts = h("div", { class: "wl-options" }, q.options.map(function (text, oi) {
      var id = name + "-o" + oi;
      var input = h("input", { type: multi ? "checkbox" : "radio", name: name, id: id, value: String(oi), checked: chosen.indexOf(oi) >= 0 });
      input.addEventListener("change", function () {
        var cur = (st.answers[q.n] || []).slice();
        if (multi) {
          if (input.checked) { if (cur.indexOf(oi) < 0) cur.push(oi); } else cur = cur.filter(function (x) { return x !== oi; });
          cur.sort(function (a, b) { return a - b; });
        } else cur = [oi];
        if (cur.length) st.answers[q.n] = cur; else delete st.answers[q.n];
        persist(); renderMap();
      });
      return h("label", { for: id, class: "wl-option" }, input,
        h("span", { class: "wl-option-k", "aria-hidden": "true" }, String.fromCharCode(65 + oi)),
        h("span", { class: "wl-option-t" }, text));
    }));
    return h("fieldset", { class: "wl-q", id: "q-" + q.n },
      h("div", { class: "wl-q-head" },
        h("span", { class: "wl-q-n" }, "Question " + (i + 1) + " of " + ex.questions.length),
        multi ? h("span", { class: "wl-chip wl-chip-ac" }, "Select all that apply") : null,
        flag),
      h("legend", { class: "wl-q-stem", tabindex: "-1" }, h("span", { class: "wl-sr" }, "Question " + (i + 1) + ". "), q.stem,
        multi ? h("span", { class: "wl-sr" }, " Select all that apply.") : null),
      opts);
  }

  function renderMap() {
    if (!els.nav) return;
    W.clear(els.nav);
    var list = h("ol", { class: "wl-qgrid", role: "list" });
    ex.questions.forEach(function (q, i) {
      var a = st.answers[q.n] && st.answers[q.n].length, f = st.flags[q.n];
      var b = h("button", { type: "button", class: "wl-qbtn" + (a ? " is-ans" : "") + (f ? " is-flag" : "") + (i === st.cur ? " is-cur" : ""),
        "aria-current": i === st.cur ? "step" : null,
        "aria-label": "Question " + (i + 1) + (a ? ", answered" : ", not answered") + (f ? ", flagged" : "") }, String(i + 1));
      b.addEventListener("click", function () { go(i); });
      list.appendChild(h("li", null, b));
    });
    els.nav.appendChild(list);
    if (els.count) els.count.textContent = answeredCount() + " of " + ex.questions.length + " answered";
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return (hh ? hh + ":" + p(mm) : p(mm)) + ":" + p(ss);
  }

  function updateTimer() {
    if (!ex || !els.timer) return;
    var left = leftMs();
    els.timer.textContent = fmtClock(left);
    els.timerBox.classList.toggle("is-low", left <= 5 * 60000);
    els.timerBox.classList.toggle("is-crit", left <= 60000);
    [10, 5, 1].forEach(function (m) {
      if (left <= m * 60000 && left > (m * 60000 - 5000) && !warned[m]) {
        warned[m] = true;
        els.sr.textContent = m + (m === 1 ? " minute" : " minutes") + " remaining.";
        if (m <= 5) W.toast(m + (m === 1 ? " minute" : " minutes") + " left.", "warn");
      }
    });
    if (left <= autoLead() && !submitting && !submitted) {
      clearInterval(tick);
      els.sr.textContent = "Time is up. Submitting your answers.";
      doSubmit(true);
    }
  }

  /* ------------------------------------------------------------ submit */
  function confirmSubmit() {
    var total = ex.questions.length, done = answeredCount();
    var unanswered = ex.questions.map(function (q, i) { return (st.answers[q.n] && st.answers[q.n].length) ? null : i + 1; }).filter(Boolean);
    var flagged = ex.questions.map(function (q, i) { return st.flags[q.n] ? i + 1 : null; }).filter(Boolean);
    var dlg = h("dialog", { class: "wl-dialog", "aria-labelledby": "dlg-t", "aria-describedby": "dlg-d" });
    var yes = W.btn("Submit my answers");
    var no = W.btn("Keep working", { class: "wl-btn-ghost" });
    W.append(dlg, [
      h("h2", { id: "dlg-t", class: "wl-h3" }, "Submit your exam?"),
      h("div", { id: "dlg-d" },
        h("p", null, "You have answered ", h("strong", null, done + " of " + total), " questions."),
        unanswered.length ? h("p", { class: "wl-tone-warn" }, "Unanswered: " + listNums(unanswered) + ". Unanswered questions count as incorrect.") : null,
        flagged.length ? h("p", null, "Flagged for review: " + listNums(flagged) + ".") : null,
        h("p", { class: "wl-hint" }, "After you submit you cannot change your answers.")),
      h("div", { class: "wl-actions" }, yes, no)]);
    document.body.appendChild(dlg);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    no.addEventListener("click", close);
    dlg.addEventListener("cancel", function () { setTimeout(function () { dlg.remove(); }, 0); });
    yes.addEventListener("click", function () { close(); doSubmit(false); });
    if (dlg.showModal) dlg.showModal(); else if (window.confirm("Submit your exam now?")) { close(); doSubmit(false); } else close();
    no.focus();
  }
  function capital(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  function listNums(a) { return a.length > 12 ? a.slice(0, 12).join(", ") + " and " + (a.length - 12) + " more" : a.join(", "); }

  function doSubmit(auto) {
    if (submitting || submitted) return;
    submitting = true;
    var answers = {};
    ex.questions.forEach(function (q) { answers[String(q.n)] = (st.answers[q.n] || []).slice(); });
    W.loading(auto ? "Time is up — submitting your answers…" : "Submitting your answers…");
    API.submitAttempt(ex.attemptId, answers).then(function (r) {
      submitted = true; submitting = false;
      clearInterval(tick);
      window.removeEventListener("beforeunload", beforeUnload);
      W.ss(storeKey(), null);
      results(r, auto);
    }, function (e) {
      submitting = false;
      if (e.status === 401) return;
      /* The request may have reached the Worker and been graded even though the response was
         lost. Re-check before telling the learner nothing was submitted. */
      API.course(cid).then(function (d) {
        var open = d && d.exam && d.exam.openAttempt;
        if (open && open.attemptId && open.attemptId !== ex.attemptId) open = null;
        if (!open) return received(d);
        submitFailed(e, auto);
      }, function () { submitFailed(e, auto); });
    });
  }

  /** The attempt is closed on the server: it was received and graded. */
  function received(d) {
    submitted = true;
    clearInterval(tick);
    window.removeEventListener("beforeunload", beforeUnload);
    W.ss(storeKey(), null);
    var exam = (d && d.exam) || {};
    var body = exam.passed
      ? "You passed" + (exam.bestScore != null ? " with " + exam.bestScore + "%" : "") + ". Your certificate is on your course page."
      : "The connection dropped before your result arrived. Open the course page to see your result and when your next attempt opens.";
    W.setTitle("Exam received · " + title());
    W.mount(h("div", { class: "wl-narrow" }, W.notice(exam.passed ? "ok" : "info", "Your exam was received", body,
      [W.btn("See your result", { href: W.courseUrl(cid) })], { h1: true })));
  }

  /** The attempt is confirmed still open (or we could not check): nothing was graded yet. */
  function submitFailed(e, auto) {
    var retry = W.btn("Try submitting again");
    retry.addEventListener("click", function () { doSubmit(auto); });
    var backBtn = W.btn("Back to my answers", { class: "wl-btn-ghost" });
    backBtn.addEventListener("click", function () { renderExam(); clearInterval(tick); tick = setInterval(updateTimer, 1000); });
    var clientErr = e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
    W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Your answers were not submitted yet", e.message +
      " Your answers are still saved in this tab. Keep this page open and try again.",
      clientErr ? [retry, W.btn("Back to course", { href: W.courseUrl(cid), class: "wl-btn-ghost" })] : [retry, backBtn], { h1: true })));
  }

  function results(r, auto) {
    W.setTitle((r.passed ? "Passed" : "Result") + " · " + title());
    var mods = r.moduleScores || [];
    var late = !!r.late;
    var hero = h("div", { class: "wl-result " + (r.passed ? "is-pass" : "is-fail") },
      h("div", { class: "wl-score", "aria-hidden": "true" }, h("span", { class: "wl-score-v" }, String(r.scorePct)), h("span", { class: "wl-score-u" }, "%")),
      h("div", null,
        h("p", { class: "wl-eyebrow" }, r.passed ? "Passed" : "Not passed this time"),
        h("h1", { class: "wl-display", tabindex: "-1", id: "res-h" }, r.passed ? "Congratulations — you passed." : "You scored " + r.scorePct + "%."),
        h("p", { class: "wl-lead" }, "Your score is " + r.scorePct + "%. The pass mark is " + r.passPct + "%.")));
    var notes = [];
    if (late) notes.push(W.notice("warn", "Submitted after the deadline", r.message ? capital(r.message) + "." : "This attempt arrived after the time limit, so it was graded as unanswered."));
    else if (auto) notes.push(W.notice("info", "Time ran out", "Your answers were submitted automatically when the timer reached zero."));

    var breakdown = h("section", { class: "wl-section", "aria-labelledby": "h-mods" },
      h("h2", { id: "h-mods", class: "wl-h3" }, "How you did by module"),
      h("ul", { class: "wl-modscores", role: "list" }, mods.map(function (m) {
        var p = W.pct(m.correct, m.total);
        return h("li", null,
          h("div", { class: "wl-modscore-t" }, h("span", null, "Module " + m.module + ": " + m.title), h("strong", null, m.correct + "/" + m.total)),
          h("div", { class: "wl-bar" + (p >= (r.passPct || 0) ? " is-ok" : " is-weak"), role: "img", "aria-label": m.correct + " of " + m.total + " correct (" + p + "%)" }, h("span", { style: { width: p + "%" } })));
      })),
      h("p", { class: "wl-hint" }, "Correct answers are not shown. Use the modules with lower scores to decide which lessons to review."));

    var next = [];
    if (r.passed) {
      if (r.certificate) next.push(W.btn("View your certificate", { href: W.certUrl(r.certificate.id) }));
      next.push(W.btn("Back to my learning", { href: "/learn/", class: "wl-btn-ghost" }));
    } else {
      var msg;
      if (r.attemptsLeft > 0) msg = "You have " + W.plural(r.attemptsLeft, "attempt") + " left." + (r.nextAttemptAt ? " Your next attempt opens " + W.fmtDateTime(r.nextAttemptAt) + "." : "");
      else msg = "You have no attempts left for this exam. Contact sales@wirewalk.com if you would like an administrator to review your options.";
      notes.push(W.notice(r.attemptsLeft > 0 ? "info" : "error", r.attemptsLeft > 0 ? "Review and try again" : "No attempts left", msg));
      next.push(W.btn("Review the lessons", { href: W.courseUrl(cid) }));
    }
    W.mount(h("div", { class: "wl-narrow" }, hero, notes, breakdown, h("div", { class: "wl-actions" }, next)));
    var hd = document.getElementById("res-h"); if (hd) hd.focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
