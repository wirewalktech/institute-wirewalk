/* /learn/course/?c=<id> : course outline, completion, resume, exam status and eligibility. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  var id = (W.param("c") || "").toLowerCase();

  function notEnrolled() {
    var title = W.courseTitle(id);
    W.setTitle(title);
    W.mount(h("div", { class: "wl-narrow" },
      h("p", { class: "wl-eyebrow" }, id),
      h("h1", { class: "wl-display" }, title),
      W.courseStatus(id) === "waitlist"
        ? W.notice("info", "This course is not on sale yet",
          "Enrollment has not opened. Join the waitlist from the course page to hear when it does.",
          [W.btn("Join the waitlist", { href: W.publicCourseUrl(id) }),
           W.btn("Browse open courses", { href: "/courses/", class: "wl-btn-ghost" })])
        : W.notice("info", "You are not enrolled in this course",
          "Enroll to read the lessons, take the exam and earn the certificate.",
          [W.btn("Add to cart", { href: "/learn/cart/?add=course:" + encodeURIComponent(id) }),
           W.btn("About this course", { href: W.publicCourseUrl(id), class: "wl-btn-ghost" })])));
  }

  function load() {
    if (!/^[a-z0-9-]{2,60}$/.test(id)) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "No course selected", "Open a course from your dashboard.", [W.btn("Go to dashboard", { href: "/learn/" })])));
      return;
    }
    if (!W.requireAuth()) return;
    W.loading("Loading course…");
    API.course(id).then(render, function (err) {
      if (err.status === 403) return notEnrolled();
      if (err.status === 401) return;
      W.mount(W.errorView(err, load, { notFound: { title: "Course not found",
        body: "There is no course with the ID “" + id + "”. Open your courses from the dashboard.", href: "/learn/", label: "Go to dashboard" } }));
    });
  }

  function firstIncomplete(modules) {
    for (var i = 0; i < modules.length; i++)
      for (var j = 0; j < modules[i].lessons.length; j++)
        if (!modules[i].lessons[j].completed) return modules[i].lessons[j];
    return null;
  }

  function render(d) {
    var c = d.course || {}, mods = d.modules || [], prog = d.progress || { done: 0, total: 0 };
    var exam = d.exam || {}, cfg = c.exam || {};
    W.setTitle(c.title || id);
    var next = firstIncomplete(mods);
    var firstLesson = mods[0] && mods[0].lessons[0];
    var resume = next || firstLesson;
    var allDone = prog.total > 0 && prog.done >= prog.total;

    var cta = [];
    if (resume) cta.push(W.btn(prog.done === 0 ? "Start the first lesson" : allDone ? "Review lessons" : "Resume: " + resume.title,
      { href: W.lessonUrl(id, resume.idx), class: allDone ? "wl-btn-ghost" : "" }));

    var head = h("header", { class: "wl-course-head" },
      h("nav", { class: "wl-crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "/learn/" }, "My learning"), h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, c.title || id)),
      h("div", { class: "wl-card-meta" }, h("span", { class: "wl-code" }, c.id || id),
        c.level ? h("span", null, W.levelLabel(c.level)) : null,
        c.track ? h("span", null, W.trackLabel(c.track)) : null,
        c.hours ? h("span", null, c.hours + " hours") : null),
      h("h1", { class: "wl-display" }, c.title || W.courseTitle(id)),
      W.progressBar(prog.done, prog.total, "Course progress"),
      h("div", { class: "wl-actions" }, cta));

    var outline = h("section", { class: "wl-outline", "aria-labelledby": "h-outline" },
      h("h2", { id: "h-outline", class: "wl-h3" }, "Course outline"),
      h("ol", { class: "wl-modules", role: "list" }, mods.map(function (m) {
        var done = m.lessons.filter(function (l) { return l.completed; }).length;
        return h("li", { class: "wl-module" },
          h("div", { class: "wl-module-head" },
            h("span", { class: "wl-module-n" }, "Module " + m.module),
            h("h3", null, m.title),
            h("span", { class: "wl-hint" }, done + "/" + m.lessons.length)),
          h("ol", { class: "wl-lessons", role: "list" }, m.lessons.map(function (l) {
            var isNext = next && l.idx === next.idx;
            return h("li", { class: "wl-lesson-row" + (l.completed ? " is-done" : "") + (isNext ? " is-next" : "") },
              h("a", { href: W.lessonUrl(id, l.idx), "aria-describedby": isNext ? "next-tag" : null },
                h("span", { class: "wl-check", "aria-hidden": "true" }),
                h("span", { class: "wl-grow" }, l.title),
                h("span", { class: "wl-sr" }, l.completed ? " (completed)" : " (not completed)"),
                isNext ? h("span", { class: "wl-chip wl-chip-ac", id: "next-tag" }, "Up next") : null));
          })));
      })));

    W.mount(h("div", { class: "wl-course" }, head,
      h("div", { class: "wl-course-grid" }, outline, examPanel(c, cfg, exam, prog, d.certificate))));
  }

  function examPanel(c, cfg, exam, prog, cert) {
    var facts = h("dl", { class: "wl-facts" },
      cfg.questions ? h("div", null, h("dt", null, "Questions"), h("dd", null, String(cfg.questions))) : null,
      cfg.minutes ? h("div", null, h("dt", null, "Time"), h("dd", null, cfg.minutes + " min")) : null,
      cfg.passPct ? h("div", null, h("dt", null, "Pass mark"), h("dd", null, cfg.passPct + "%")) : null,
      h("div", null, h("dt", null, "Attempts"), h("dd", null, (exam.attemptsUsed || 0) + " of " + (exam.attemptsAllowed || cfg.attempts || "—") + " used")),
      exam.bestScore != null ? h("div", null, h("dt", null, "Best score"), h("dd", null, exam.bestScore + "%")) : null);

    var sum = W.examSummary(exam, prog);
    var body = [], actions = [];
    if (exam.recertification) body.push(h("p", null, "Your certificate expired on " + W.fmtDateUTC(exam.recertification.expiredAt) +   // [freshness]
      ". Pass the exam again to renew it: you have one attempt for this, and the certificate keeps its ID."));
    if ((cert && !cert.expired) || exam.passed) {   // [freshness] an expired certificate does not close the exam
      body.push(h("p", null, "You passed this exam. Your certificate of completion and assessment is ready."));
      if (cert) actions.push(W.btn("View certificate", { href: W.certUrl(cert.id) }));
    } else if (exam.openAttempt) {
      body.push(h("p", null, "You have an exam in progress. The timer keeps running; it ends " + W.fmtDateTime(exam.openAttempt.deadline) + "."));
      actions.push(W.btn("Resume exam", { href: W.examUrl(c.id || id) }));
    } else if (exam.eligible) {
      body.push(h("p", null, "You have completed every lesson. When you are ready, start the exam. Set aside " + (cfg.minutes ? cfg.minutes + " uninterrupted minutes" : "uninterrupted time") + "."));
      actions.push(W.btn("Go to the exam", { href: W.examUrl(c.id || id) }));
    } else {
      body.push(h("p", null, W.reasonDetail(exam, prog)));
      if (exam.reason === "complete_lessons" && prog.total) body.push(W.progressBar(prog.done, prog.total, "Lessons needed for the exam"));
    }

    return h("aside", { class: "wl-exam-panel", "aria-labelledby": "h-exam" },
      h("div", { class: "wl-exam-panel-head" }, h("h2", { id: "h-exam", class: "wl-h3" }, "Exam"), W.chip(sum.text, sum.kind)),
      body, facts,
      actions.length ? h("div", { class: "wl-actions" }, actions) : null,
      h("p", { class: "wl-hint" }, "Feedback is given by module. Correct answers are never shown, so the exam stays fair for everyone. ",
        h("a", { href: "/certification/" }, "How exams work")));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
