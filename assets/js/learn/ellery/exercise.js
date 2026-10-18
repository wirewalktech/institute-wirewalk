/* [ellery] /learn/exercise/?c=<course>&x=<exercise> : graded exercise (practice only).
 *
 * GET /api/ai/exercises (public fields: task, starter, rubric criteria and points) and
 * POST /api/ai/exercises/:id/submit (progress events, then per-criterion feedback; the server
 * clamps and totals the scores). Nothing is stored on the server: the last submission and its
 * feedback stay in this browser (localStorage "wia_ex_<id>") so learners can iterate.
 * Practice only, not part of certification. Code is read, never run. */
(function () {
  "use strict";
  var E = window.Ellery, W = window.WL;
  if (!E || !W) return;
  var h = E.h;
  var cid = (W.param("c") || "").toLowerCase(), xid = (W.param("x") || "").toLowerCase();
  var KEY = "wia_ex_" + xid;
  var x = null, st = null, eachLimit = null;

  function load() {
    if (!/^[a-z0-9-]{2,60}$/.test(cid) || !/^[a-z0-9-]{3,80}$/.test(xid)) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Exercise not found", "Open it from your course page.", [W.btn("Go to dashboard", { href: "/learn/" })])));
      return;
    }
    if (!W.requireAuth()) return;
    W.loading("Loading exercise…");
    Promise.all([E.status(cid).catch(function () { return null; }),
      E.request("GET", "/api/ai/exercises?courseId=" + encodeURIComponent(cid), undefined, { auth: true })]).then(function (r) {
      st = r[0];
      x = ((r[1] && r[1].exercises) || []).filter(function (e) { return e.id === xid; })[0];
      eachLimit = r[1] && typeof r[1].eachLimit === "number" ? r[1].eachLimit : (st && st.modes && st.modes.exercise && st.modes.exercise.eachLimit) || null;
      if (!x) { W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Exercise not found", "This course has no exercise with that name.", [W.btn("Back to course", { href: W.courseUrl(cid) })]))); return; }
      render();
    }, function (err) {
      if (err.status === 401) return;
      W.mount(h("div", { class: "wl-narrow" }, crumbs(), E.stateBox(E.describe(err, "exercise"), load), h("p", null, h("a", { href: W.courseUrl(cid) }, "Back to the course"))));
    });
  }

  function crumbs() {
    return h("nav", { class: "wl-crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "/learn/" }, "My learning"), h("span", { "aria-hidden": "true" }, " / "),
      h("a", { href: W.courseUrl(cid) + "#practice" }, W.courseTitle(cid)), h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, "Graded exercise"));
  }

  function render() {
    W.setTitle(x.title + " · Graded exercise");
    var saved = E.lsGet(KEY, null) || {};
    var isCode = (x.submission && x.submission.format) === "code" || x.kind === "code";
    var max = (x.submission && x.submission.maxChars) || 8000;
    var sub = h("textarea", { id: "ex-sub", class: "ell-input" + (isCode ? " ell-code-input" : ""), rows: isCode ? "16" : "12", maxlength: String(max),
      spellcheck: isCode ? "false" : null, autocapitalize: isCode ? "off" : null, "aria-describedby": "ex-sub-h" });
    sub.value = saved.submission || x.starter || "";
    var note = h("input", { id: "ex-note", class: "ell-input", type: "text", maxlength: "300", value: saved.note || "" });
    var count = h("span", { class: "ell-count" });
    function upd() { count.textContent = sub.value.length + " / " + max + " characters"; }
    sub.addEventListener("input", upd); upd();
    var go = E.btn("Submit for feedback");
    var left = h("p", { class: "ell-hint", role: "status" });
    function showLeft(q) {
      var day = q && typeof q.remaining === "number" ? q.remaining : null;
      var each = q && q.each && typeof q.each.remaining === "number" ? q.each : null;
      var per = each ? each.limit : eachLimit;
      var bits = [];
      if (day !== null) bits.push(day + (day === 1 ? " submission" : " submissions") + " left today");
      if (each) bits.push(each.remaining + " for this exercise");
      left.textContent = bits.length ? bits.join(", ") + (per ? " (up to " + per + " per exercise)." : ".")
        : (per ? "Up to " + per + " submissions per exercise each day." : "");
    }
    showLeft(st && st.modes && st.modes.exercise);
    var clearBtn = E.btn("Clear saved work", { class: "ell-btn-sm ell-btn-ghost", onclick: function () {
      if (!window.confirm("Clear the submission and feedback saved in this browser?")) return;
      E.lsSet(KEY, null); saved = {}; sub.value = x.starter || ""; note.value = ""; upd(); E.clear(out); sub.focus();
    } });
    var out = h("div", { class: "ell-ex-out" });
    var form = h("form", { class: "ell-ex-form", novalidate: true, "aria-labelledby": "ex-form-t" },
      h("h2", { id: "ex-form-t", class: "ell-block-t" }, "Your submission"),
      h("div", { class: "ell-field" }, h("label", { for: "ex-sub" }, isCode ? "Your code" + (x.language ? " (" + x.language + ")" : "") : "Your answer"), sub,
        h("p", { class: "ell-hint", id: "ex-sub-h" }, (isCode ? "Code is read, not run. " : "") + "Use invented data: no real names, customers or secrets. ", count)),
      h("div", { class: "ell-field" }, h("label", { for: "ex-note" }, "Note to the grader (optional)"), note),
      h("div", { class: "ell-actions" }, go,
        x.starter ? E.btn("Reset to the starter", { class: "ell-btn-ghost", onclick: function () { if (window.confirm("Replace your text with the starter?")) { sub.value = x.starter; upd(); sub.focus(); } } }) : null),
      left,
      h("p", { class: "ell-hint" }, "Your last submission and feedback are saved in this browser only. ", clearBtn));

    var rubric = x.rubric && x.rubric.criteria ? h("section", { class: "ell-rubric", "aria-labelledby": "ex-rub-t" },
      h("h2", { id: "ex-rub-t", class: "ell-block-t" }, "How it's graded" + (x.rubric.totalPoints ? " (" + x.rubric.totalPoints + " points)" : "")),
      h("ul", { class: "ell-rubric-list" }, x.rubric.criteria.map(function (c) {
        return h("li", null, h("strong", null, c.name), h("span", { class: "ell-pts" }, " · " + c.points + (c.points === 1 ? " point" : " points")), c.description ? h("p", null, c.description) : null);
      }))) : null;

    W.mount(h("div", { class: "ell-page" }, crumbs(),
      h("header", { class: "ell-page-head" },
        h("p", { class: "wl-eyebrow" }, "Graded exercise · " + E.label(st)),
        h("h1", { class: "wl-display" }, x.title),
        h("p", { class: "ell-hint" }, (x.kind === "code" ? "Code" : "Writing") + (x.minutes ? " · about " + x.minutes + " minutes" : "")),
        E.practiceLabel(x.label || "Not part of certification. Feedback is AI-generated and can be wrong.")),
      h("div", { class: "ell-ex-grid" },
        h("div", null,
          h("section", { class: "ell-task", "aria-labelledby": "ex-task-t" }, h("h2", { id: "ex-task-t", class: "ell-block-t" }, "The task"), E.md(x.task || "")),
          rubric),
        h("div", null, form, out))));

    var blocked = E.blockedBy(st, "exercise", cid);
    if (blocked) { form.insertBefore(E.stateBox(blocked), form.children[1]); go.disabled = true; }
    if (saved.result) { showResult(out, saved.result, true); }

    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    go.addEventListener("click", function (e) { e.preventDefault(); submit(); });
    function submit() {
      var text = sub.value.trim();
      if (text.length < 2) { sub.focus(); return; }
      E.lsSet(KEY, { submission: sub.value, note: note.value, result: saved.result || null });
      go.disabled = true; go.setAttribute("aria-busy", "true"); go.textContent = "Grading…";
      var stages = { reading: "Reading your submission", scoring: "Scoring", writing: "Writing feedback" };
      E.clear(out).appendChild(h("div", { class: "ell-progress", role: "status", "aria-live": "polite" }, E.spinner("Reading your submission…")));
      var body = { courseId: cid, submission: sub.value };
      if (note.value.trim()) body.attemptNote = note.value.trim();
      E.request("POST", "/api/ai/exercises/" + encodeURIComponent(x.id) + "/submit", body, { auth: true, stream: true, onEvent: function (name, d) {
        if (name === "progress") E.clear(out.firstChild).appendChild(E.spinner((stages[d.stage] || "Working") + "…"));
        if (name === "meta" && d.notice === "redacted") out.appendChild(E.redactedNote());
        if (name === "meta" && d.quota) showLeft(d.quota);
      } }).then(function (r) {
        var d0 = r.done || {};
        if (d0.stopReason === "assessment_like") { E.clear(out).appendChild(h("p", { class: "ell-notice", role: "status" }, d0.text || "")); return; }
        var j = d0.json || {};
        saved = { submission: sub.value, note: note.value, result: j, at: new Date().toISOString() };
        E.lsSet(KEY, saved);
        showResult(out, j, false);
      }, function (err) {
        E.clear(out).appendChild(E.stateBox(err.reason === "assessment_overlap" ? { kind: "unavailable", title: "Feedback withheld", body: err.message } : E.describe(err, "exercise"), submit));
      }).then(function () { go.disabled = false; go.removeAttribute("aria-busy"); go.textContent = "Submit again"; });
    }
  }

  function showResult(out, j, old) {
    E.clear(out);
    var box = h("article", { class: "ell-feedback", "aria-labelledby": "fb-t" },
      h("h2", { id: "fb-t", class: "ell-block-t", tabindex: "-1" }, old ? "Feedback on your last submission" : "Feedback"),
      E.practiceLabel(j.label || "Not part of certification. Feedback is AI-generated and can be wrong."),
      j.safety && j.safety.flag ? h("p", { class: "ell-notice", role: "status" }, "This looked like real personal data or a secret. Use invented data in practice work.") : null,
      h("p", { class: "ell-score" }, h("strong", null, (j.points != null ? j.points : "?") + " of " + (j.totalPoints != null ? j.totalPoints : "?") + " points")),
      (j.criteria || []).map(function (c) {
        return h("section", { class: "ell-crit", "aria-labelledby": "fb-" + c.id },
          h("h3", { id: "fb-" + c.id, class: "ell-crit-t" }, c.name, h("span", { class: "ell-crit-score" }, " " + c.score + " of " + c.max)),
          h("div", { class: "ell-meter", "aria-hidden": "true" }, h("span", { style: "width:" + Math.round(100 * c.score / (c.max || 1)) + "%" })),
          c.evidence ? h("blockquote", { class: "ell-evidence" }, c.evidence) : null,
          c.feedback ? h("div", null, E.md(c.feedback)) : null,
          c.lesson ? h("p", { class: "ell-hint" }, "Revisit: ", typeof c.lessonIdx === "number"
            ? h("a", { href: W.lessonUrl(cid, c.lessonIdx) }, c.lessonTitle || c.lesson)
            : [c.lessonTitle || c.lesson, " (see the ", h("a", { href: W.courseUrl(cid) }, "course outline"), ")"], ".") : null);
      }),
      j.strengths && j.strengths.length ? [h("h3", { class: "ell-h" }, "Strengths"), h("ul", { class: "ell-list" }, j.strengths.map(function (s) { return h("li", null, s); }))] : null,
      j.improvements && j.improvements.length ? [h("h3", { class: "ell-h" }, "To improve"), h("ul", { class: "ell-list" }, j.improvements.map(function (s) { return h("li", null, s); }))] : null,
      j.snippet ? [h("h3", { class: "ell-h" }, "A short example"), h("pre", { class: "ell-pre", tabindex: "0" }, h("code", { text: j.snippet }))] : null,
      old ? null : E.feedback("exercise"));
    out.appendChild(box);
    if (!old) box.querySelector("#fb-t").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
