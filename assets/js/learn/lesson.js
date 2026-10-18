/* /learn/lesson/?c=<course>&l=<idx> : long-form lesson reader. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  var cid = (W.param("c") || "").toLowerCase();
  var idx = W.param("l") || "";
  var data = null, outline = null;

  function load() {
    if (!/^[a-z0-9-]{2,60}$/.test(cid) || !/^\d{1,4}$/.test(idx)) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Lesson not found", "Open a lesson from your course outline.", [W.btn("Go to dashboard", { href: "/learn/" })])));
      return;
    }
    if (!W.requireAuth()) return;
    W.loading("Loading lesson…");
    var o = API.course(cid).then(function (d) { outline = d; }, function () { outline = null; });
    API.lesson(cid, idx).then(function (d) {
      data = d;
      return o.then(render);
    }, function (err) {
      if (err.status === 401) return;
      if (err.status === 403) {
        W.mount(h("div", { class: "wl-narrow" }, W.notice("info", "You are not enrolled in this course", "Enroll to read its lessons.",
          [W.btn("About this course", { href: W.publicCourseUrl(cid) }), W.btn("Dashboard", { href: "/learn/", class: "wl-btn-ghost" })])));
        return;
      }
      W.mount(W.errorView(err, load, { notFound: { title: "Lesson not found",
        body: "This course has no lesson " + idx + ". Pick a lesson from the course outline.", href: W.courseUrl(cid), label: "Back to course outline" } }));
    });
  }

  function courseTitle() { return (outline && outline.course && outline.course.title) || W.courseTitle(cid); }

  function render() {
    var d = data;
    W.setTitle(d.title + " · " + courseTitle());
    var prog = d.progress || (outline && outline.progress) || { done: 0, total: 0 };

    var article = h("article", { class: "wl-prose", id: "lesson-body", "aria-labelledby": "lesson-title" });
    article.innerHTML = d.html || "";
    enhance(article);
    var words = (article.textContent.match(/\S+/g) || []).length;
    var mins = Math.max(1, Math.round(words / 230));

    var head = h("header", { class: "wl-lesson-head" },
      h("nav", { class: "wl-crumbs", "aria-label": "Breadcrumb" },
        h("a", { href: "/learn/" }, "My learning"), h("span", { "aria-hidden": "true" }, " / "),
        h("a", { href: W.courseUrl(cid) }, courseTitle())),
      h("p", { class: "wl-eyebrow" }, "Module " + d.module + " · Lesson " + d.lesson),
      h("h1", { id: "lesson-title", class: "wl-lesson-title", tabindex: "-1" }, d.title),
      h("p", { class: "wl-lesson-meta" }, mins + " min read", d.completed ? [" · ", h("span", { class: "wl-tone-ok" }, "Completed")] : null));

    var completeBox = h("div", { class: "wl-complete", id: "complete-box" });
    renderComplete(completeBox, d.completed, prog, false);

    var pager = h("nav", { class: "wl-pager", "aria-label": "Lesson navigation" },
      d.prev ? h("a", { class: "wl-pager-prev", href: W.lessonUrl(cid, d.prev.idx), rel: "prev" },
        h("span", { class: "wl-pager-k" }, "← Previous"), h("span", { class: "wl-pager-t" }, d.prev.title)) : h("span"),
      d.next ? h("a", { class: "wl-pager-next", href: W.lessonUrl(cid, d.next.idx), rel: "next" },
        h("span", { class: "wl-pager-k" }, "Next →"), h("span", { class: "wl-pager-t" }, d.next.title))
        : h("a", { class: "wl-pager-next", href: W.courseUrl(cid) }, h("span", { class: "wl-pager-k" }, "Finish →"), h("span", { class: "wl-pager-t" }, "Back to course and exam")));

    /* [lx] The module's lab sits before the completion box, so the primary button and the lab are read together. */
    var main = h("div", { class: "wl-reader-main" }, head, article, labCallout(d), completeBox, pager,
      h("p", { class: "wl-hint wl-center wl-kbd-hint" }, "Tip: press ", h("kbd", null, "←"), " and ", h("kbd", null, "→"), " to move between lessons."),
      /* [support] Errata: /assets/js/errata.js opens a small report form from this link; without it, /errata/. */
      h("p", { class: "wl-hint wl-center" }, "Spotted a mistake? ",
        h("a", { href: "/errata/?c=" + encodeURIComponent(cid) + "&l=" + encodeURIComponent(d.idx), "data-errata-course": cid,
          "data-errata-lesson": String(d.idx), "data-errata-title": d.title }, "Report an error"), " in this lesson."));

    var verify = W.verifyBanner(d.learner);   // [onboard] dismissible "confirm your email" reminder
    if (verify) main.insertBefore(verify, article);

    var toc = buildToc(d.idx);
    var topbar = h("div", { class: "wl-readbar", "aria-hidden": "true" }, h("span", { id: "wl-readbar" }));
    var courseBar = h("div", { class: "wl-reader-progress" }, W.progressBar(prog.done, prog.total, "Course progress"));

    var orient = orientation(prog);   // [lx] once, after a first free enrollment
    if (orient) main.insertBefore(orient, article);

    W.mount(h("div", { class: "wl-reader" }, topbar,
      h("div", { class: "wl-reader-grid" },
        h("aside", { class: "wl-toc", "aria-label": "Course contents" }, courseBar, toc), main)));
    if (window.location.hash) { var target = document.getElementById(window.location.hash.slice(1)); if (target) target.scrollIntoView(); }
    onScroll();
    /* [ellery] The lesson's identity for the AI instructor panel and Listen (assets/js/learn/ellery/). */
    window.WLLesson = { courseId: cid, courseTitle: courseTitle(), idx: d.idx, module: d.module, lesson: d.lesson,
      ref: "m" + d.module + "-l" + d.lesson, title: d.title, free: (outline && outline.course && outline.course.level) === "intro" };
    try { document.dispatchEvent(new CustomEvent("wl:lesson", { detail: window.WLLesson })); } catch (e) { /* old browser */ }
  }

  /** [lx] The first unfinished Decision Lab of this lesson's module, when this is the module's last lesson; else null. */
  function pendingLab(d) {
    if (!window.WLLabs || !outline || !outline.modules) return null;
    var m = outline.modules.filter(function (x) { return x.module === d.module; })[0];
    if (!m || !m.labs || !m.labs.length || !m.lessons.length || String(m.lessons[m.lessons.length - 1].idx) !== String(d.idx)) return null;
    return m.labs.filter(function (l) { return l.status !== "finished"; })[0] || null;
  }
  function hasLabs() { return !!(outline && outline.modules && outline.modules.some(function (m) { return m.labs && m.labs.length; })); }

  /** [labs] After the last lesson of a module: its Decision Lab(s), "put this module into practice". */
  function labCallout(d) {
    if (!window.WLLabs || !outline || !outline.modules) return null;
    var m = outline.modules.filter(function (x) { return x.module === d.module; })[0];
    if (!m || !m.labs || !m.labs.length) return null;
    var lastIdx = m.lessons.length ? m.lessons[m.lessons.length - 1].idx : null;
    if (String(lastIdx) !== String(d.idx)) return null;
    return h("section", { class: "wl-lab-callout", "aria-labelledby": "lab-callout-h" },
      h("h2", { id: "lab-callout-h", class: "wl-h4" }, "Put module " + d.module + " into practice"),
      h("p", null, "Step into a realistic business situation, make the calls and see the consequences play out. Finishing the lab is required for the exam."),
      h("ul", { class: "wl-labs", role: "list" }, m.labs.map(function (l) { return window.WLLabs.row(cid, l); })));
  }

  /** [lx] One-time orientation strip. site.js and cart.js set localStorage "wia_orient" to the
   *  course id after a first free enrollment and send the learner straight here; it is shown once. */
  function orientation(prog) {
    var pending = null;
    try { pending = localStorage.getItem("wia_orient"); if (pending === cid) localStorage.removeItem("wia_orient"); } catch (e) { return null; }
    if (pending !== cid) return null;
    var op = (outline && outline.progress) || prog, labs = op.labs && op.labs.total;
    var steps = [W.plural(op.total || prog.total || 0, "lesson")]
      .concat(labs ? [W.plural(labs, "Decision Lab")] : [], ["exam", "certificate"]);
    var strip = h("section", { class: "wl-orient", "aria-labelledby": "wl-orient-h" },
      h("h2", { id: "wl-orient-h", class: "wl-h4" }, "You are enrolled. Here is how " + courseTitle() + " works"),
      h("ol", { class: "wl-orient-steps", role: "list" }, steps.map(function (t) { return h("li", null, t); })),
      h("p", { class: "wl-hint" }, (labs ? "Complete every lesson and Decision Lab" : "Complete every lesson") + " to unlock the exam. Questions as you read? Ask Ellery, the AI instructor, any time."),
      W.btn("Got it", { class: "wl-btn-sm wl-btn-ghost", onclick: function () { strip.remove(); var t = document.getElementById("lesson-title"); if (t) t.focus(); } }));
    return strip;
  }

  function renderComplete(box, completed, prog, justNow, unlocked) {
    W.clear(box);
    var d = data;
    var lab = pendingLab(d);   // [lx] lesson -> lab -> next module: the lab comes first
    if (completed) {
      box.appendChild(h("div", { class: "wl-complete-done" },
        h("span", { class: "wl-okmark wl-okmark-sm", "aria-hidden": "true" }),
        h("div", { class: "wl-grow" },
          h("strong", null, justNow ? "Lesson marked complete." : "You have completed this lesson."),
          h("div", { class: "wl-hint" }, prog.done + " of " + prog.total + " lessons complete")),
        lab ? W.btn("Start the Decision Lab", { href: window.WLLabs.url(cid, lab.id), class: "wl-btn-sm" }) : null,   // [lx]
        d.next ? W.btn(lab ? "Skip to next lesson" : "Next lesson", { href: W.lessonUrl(cid, d.next.idx), class: "wl-btn-sm" + (lab ? " wl-btn-ghost" : "") }) : null));
      if (unlocked) box.appendChild(W.notice("ok", "The exam is unlocked", hasLabs() ? "You have completed every lesson and Decision Lab in this course." : "You have completed every lesson in this course.",
        [W.btn("Go to the exam", { href: W.examUrl(cid) })]));
      else if (!d.next && prog.total && prog.done >= prog.total && prog.labs && prog.labs.done < prog.labs.total)   // [labs]
        box.appendChild(W.notice("info", "Lessons complete", "Finish the course's Decision Labs to unlock the exam (" + window.WLLabs.progressText(prog) + ").", [W.btn("Course and labs", { href: W.courseUrl(cid) })]));
      else if (!d.next && prog.total && prog.done >= prog.total) box.appendChild(W.notice("ok", "Course complete", "You can take the exam from the course page.", [W.btn("Course and exam", { href: W.courseUrl(cid) })]));
      return;
    }
    var mark = W.btn("Mark as complete", { class: "wl-btn-ghost" });
    /* [lx] On a module's last lesson with an unfinished lab, the primary path is the lab; the next lesson is secondary. */
    var markLab = lab ? W.btn("Complete and start the Decision Lab →") : null;
    var markNext = d.next ? W.btn(lab ? "Skip to next lesson" : "Complete and continue →", lab ? { class: "wl-btn-ghost" } : undefined) : null;
    function run(goNext, b) {
      return W.busy(b, API.completeLesson(cid, d.idx), "Saving…").then(function (r) {
        data.completed = true;
        var p = r.progress || prog;
        updateToc(d.idx);
        if (goNext === "lab") { window.location.assign(window.WLLabs.url(cid, lab.id)); return; }
        if (goNext && d.next && !r.examUnlocked) { window.location.assign(W.lessonUrl(cid, d.next.idx)); return; }
        renderComplete(box, true, p, true, r.examUnlocked);
        Array.prototype.forEach.call(document.querySelectorAll(".wl-reader-progress"), function (n) { W.clear(n).appendChild(W.progressBar(p.done, p.total, "Course progress")); });
        W.toast(r.examUnlocked ? "Lesson complete. The exam is unlocked." : "Lesson complete.", "ok");
        var focus = box.querySelector("a, button"); if (focus) focus.focus();
      }, function (e) { W.toast(e.message, "bad"); });
    }
    mark.addEventListener("click", function () { run(false, mark); });
    if (markNext) markNext.addEventListener("click", function () { run(true, markNext); });
    if (markLab) markLab.addEventListener("click", function () { run("lab", markLab); });
    box.appendChild(h("div", { class: "wl-complete-ask" },
      h("p", null, "Finished reading? Mark this lesson complete to record your progress. " +
        (hasLabs() ? "Lessons and Decision Labs must be complete before the exam unlocks." : "Every lesson must be complete before the exam unlocks.")),
      h("div", { class: "wl-actions" }, markLab, markNext, lab && markNext ? null : mark)));
  }

  function buildToc(current) {
    if (!outline || !outline.modules) return h("p", { class: "wl-hint" }, h("a", { href: W.courseUrl(cid) }, "Course outline"));
    var list = h("ol", { class: "wl-toc-mods", role: "list" }, outline.modules.map(function (m) {
      return h("li", null, h("p", { class: "wl-toc-mod" }, m.module + ". " + m.title),
        h("ol", { role: "list" }, m.lessons.map(function (l) {
          var cur = String(l.idx) === String(current);
          return h("li", { class: (l.completed ? "is-done" : "") + (cur ? " is-current" : ""), "data-idx": String(l.idx) },
            h("a", { href: W.lessonUrl(cid, l.idx), "aria-current": cur ? "page" : null },
              h("span", { class: "wl-check", "aria-hidden": "true" }), h("span", null, l.title),
              h("span", { class: "wl-sr" }, l.completed ? " (completed)" : "")));
        })),
        /* [labs] Decision Labs after the module's lessons */
        window.WLLabs && m.labs && m.labs.length ? h("ul", { class: "wl-labs", role: "list", "aria-label": "Decision Labs in module " + m.module },
          m.labs.map(function (l) { return window.WLLabs.row(cid, l, { compact: true }); })) : null);
    }));
    var det = h("details", { class: "wl-toc-details" }, h("summary", null, "Course contents"), list);
    var mq = window.matchMedia ? window.matchMedia("(min-width: 1080px)") : null;
    if (mq && mq.matches) det.open = true;
    return det;
  }
  function updateToc(i) {
    var li = document.querySelector('.wl-toc li[data-idx="' + i + '"]');
    if (li) { li.classList.add("is-done"); var sr = li.querySelector(".wl-sr"); if (sr) sr.textContent = " (completed)"; }
  }

  /** Tables scroll inside a focusable region; code blocks get a copy button; links to other sites open safely. */
  function enhance(root) {
    Array.prototype.forEach.call(root.querySelectorAll("table"), function (t, n) {
      var cap = t.querySelector("caption");
      var wrap = h("div", { class: "wl-table-wrap", role: "region", tabindex: "0", "aria-label": cap ? cap.textContent : "Table " + (n + 1) + " (scrolls sideways)" });
      t.parentNode.insertBefore(wrap, t); wrap.appendChild(t);
    });
    Array.prototype.forEach.call(root.querySelectorAll("pre"), function (pre) {
      var code = pre.querySelector("code");
      var lang = code && /language-([\w+-]+)/.exec(code.className || "");
      var b = h("button", { type: "button", class: "wl-copy", "aria-label": "Copy code to clipboard" }, "Copy");
      b.addEventListener("click", function () {
        W.copyText((code || pre).textContent.replace(/\n$/, "")).then(function () {
          b.textContent = "Copied"; b.classList.add("is-ok");
          setTimeout(function () { b.textContent = "Copy"; b.classList.remove("is-ok"); }, 1800);
        }, function () { b.textContent = "Press Ctrl+C"; });
      });
      var fig = h("div", { class: "wl-code-block" }, h("div", { class: "wl-code-bar" }, h("span", { class: "wl-code-lang" }, lang ? lang[1] : "code"), b));
      pre.parentNode.insertBefore(fig, pre); fig.appendChild(pre);
      pre.setAttribute("tabindex", "0");
    });
    Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (a) {
      try {
        var u = new URL(a.getAttribute("href"), window.location.href);
        if (u.origin !== window.location.origin) { a.target = "_blank"; a.rel = "noopener noreferrer"; a.classList.add("wl-ext"); }
      } catch (e) { /* ignore */ }
    });
    var used = {};
    Array.prototype.forEach.call(root.querySelectorAll("h2, h3"), function (hd) {
      if (hd.id) return;
      var base = hd.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
      var s = base, n = 2; while (used[s] || document.getElementById(s)) s = base + "-" + n++;
      used[s] = 1; hd.id = s;
    });
    checks(root);
  }

  /** [lx] Retrieval checks (the build puts each answer in details.wl-check-item, tools/retrieval.mjs):
   *  an optional "Your answer" box before the reveal and a Got it / Partly / Missed self-rating
   *  inside it. Both stay in this browser (localStorage "wia_rc_<course>_<lesson>"). */
  function checks(root) {
    var items = root.querySelectorAll("details.wl-check-item");
    if (!items.length) return;
    var key = "wia_rc_" + cid + "_" + idx, saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { saved = {}; }
    function save() { try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) { /* storage blocked */ } }
    Array.prototype.forEach.call(items, function (det, n) {
      var s = saved[n] = saved[n] || {}, id = "wl-rc-" + n;
      var box = h("textarea", { id: id, class: "wl-check-input", rows: "2", maxlength: "2000", placeholder: "Your answer (optional)" });
      box.value = s.a || "";
      box.addEventListener("input", function () { s.a = box.value; save(); });
      det.parentNode.insertBefore(h("div", { class: "wl-check-yours" },
        h("label", { for: id, class: "wl-sr" }, "Your answer to question " + (n + 1) + " (optional, kept in this browser)"), box), det);
      var btns = ["Got it", "Partly", "Missed"].map(function (t) {
        var b = h("button", { type: "button", class: "wl-check-rate-b", "aria-pressed": s.r === t ? "true" : "false" }, t);
        b.addEventListener("click", function () {
          s.r = s.r === t ? null : t; save();
          btns.forEach(function (x) { x.setAttribute("aria-pressed", x.textContent === s.r ? "true" : "false"); });
        });
        return b;
      });
      det.appendChild(h("div", { class: "wl-check-rate", role: "group", "aria-label": "How did you do on question " + (n + 1) + "?" },
        h("span", { class: "wl-hint", "aria-hidden": "true" }, "How did you do?"), btns));
    });
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      var bar = document.getElementById("wl-readbar"), art = document.getElementById("lesson-body");
      if (!bar || !art) return;
      var r = art.getBoundingClientRect(), vh = window.innerHeight;
      var total = r.height - vh * 0.6, seen = -r.top + vh * 0.4;
      var p = total > 0 ? Math.max(0, Math.min(1, seen / total)) : 1;
      bar.style.transform = "scaleX(" + p.toFixed(3) + ")";
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  document.addEventListener("keydown", function (e) {
    if (!data || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t.closest && t.closest(".wl-table-wrap, pre")))) return;
    if (e.key === "ArrowRight" && data.next) { e.preventDefault(); window.location.assign(W.lessonUrl(cid, data.next.idx)); }
    else if (e.key === "ArrowLeft" && data.prev) { e.preventDefault(); window.location.assign(W.lessonUrl(cid, data.prev.idx)); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
