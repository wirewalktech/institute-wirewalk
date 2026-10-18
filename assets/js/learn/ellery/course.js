/* [ellery] /learn/course/ : "Practice with Ellery" under the course outline.
 *   - practice questions per module (POST /api/ai/practice, every course including free intros),
 *   - "Practice conversations" (role-play launcher, GET /api/ai/scenarios, paid courses),
 *   - "Graded exercises" (GET /api/ai/exercises, paid courses).
 * Everything is labeled practice only, never part of certification. Waits for course.js to
 * render the outline, then appends one section; hidden when the learner isn't enrolled. */
(function () {
  "use strict";
  var E = window.Ellery;
  if (!E) return;
  var h = E.h;
  var cid = "";
  try { cid = (new URLSearchParams(location.search).get("c") || "").toLowerCase(); } catch (e) { return; }
  if (!/^[a-z0-9-]{2,60}$/.test(cid)) return;
  var done = false;

  function modules() {
    return Array.prototype.map.call(document.querySelectorAll(".wl-module"), function (m) {
      var n = /(\d+)/.exec((m.querySelector(".wl-module-n") || {}).textContent || "");
      var t = m.querySelector("h3");
      return n ? { n: Number(n[1]), title: t ? t.textContent : "Module " + n[1] } : null;
    }).filter(Boolean);
  }

  function mount() {
    var host = document.querySelector(".wl-course");
    if (done || !host) return !!done;
    done = true;
    var sec = h("section", { class: "ell-course", id: "practice", "aria-labelledby": "ell-course-t" },
      h("div", { class: "ell-course-head" },
        h("h2", { id: "ell-course-t", class: "wl-h3" }, E.icon(E.ICONS.spark, 18), " Practice with ", E.nameText()),
        h("p", { class: "ell-hint" }, E.labelText(), ". Practice only, not part of certification. AI can be wrong.")),
      E.spinner("Checking what's available…"));
    host.appendChild(sec);
    E.status(cid).then(function (st) { render(sec, st); }, function (err) {
      sec.removeChild(sec.lastChild);
      sec.appendChild(E.stateBox(E.describe(err, "practice")));
    });
    return true;
  }

  function render(sec, st) {
    sec.removeChild(sec.lastChild);
    if (!st.course) { sec.remove(); return; }
    var stop = E.blockedBy(st, "practice", null);
    if (stop && (stop.kind === "paused" || stop.kind === "exam")) { sec.appendChild(E.stateBox(stop)); return; }
    var m = st.course.modes || {};
    var grid = h("div", { class: "ell-course-grid" });
    sec.appendChild(grid);

    /* module practice */
    var mods = modules();
    if (m.practice && mods.length) {
      var sel = h("select", { id: "ell-mod", class: "ell-select" }, mods.map(function (x) { return h("option", { value: String(x.n) }, "Module " + x.n + ": " + x.title); }));
      var area = h("div", { class: "ell-mod-practice" });
      var go = E.btn("Practice this module", { class: "ell-btn-ghost" });
      go.addEventListener("click", function () {
        var mod = mods.filter(function (x) { return String(x.n) === sel.value; })[0];
        E.practice(area, { courseId: cid, module: mod.n, title: "Module " + mod.n + " (" + mod.title + ")" });
        var first = area.querySelector("select, button"); if (first) first.focus();
      });
      grid.appendChild(h("div", { class: "ell-block" },
        h("h3", { class: "ell-block-t" }, "Practice questions"),
        h("p", { class: "ell-hint" }, "Fresh questions from one module's lessons, with answers shown after you choose. " +
          (st.modes.practice && typeof st.modes.practice.remaining === "number" ? st.modes.practice.remaining + " sets left today." : "")),
        h("div", { class: "ell-row" }, h("div", { class: "ell-field ell-grow" }, h("label", { for: "ell-mod" }, "Module"), sel), go), area));
    } else if (!m.practice) {
      grid.appendChild(h("div", { class: "ell-block" }, h("h3", { class: "ell-block-t" }, "Practice questions"), E.stateBox(E.blockedBy(st, "practice", cid) || E.describe({ reason: "mode_off", message: "Practice questions aren't switched on for this course yet." }))));
    }

    if (st.course.free) {
      grid.appendChild(h("div", { class: "ell-block" }, h("h3", { class: "ell-block-t" }, "Practice conversations and graded exercises"),
        h("p", null, "Role-plays with feedback, graded exercises and the prompt sandbox come with the full courses. This free intro course includes the lesson tutor and practice questions."),
        h("p", null, h("a", { href: "/courses/?level=basic" }, "Browse the full courses"))));
      return;
    }
    if (m.roleplay) list(grid, "/api/ai/scenarios?courseId=", "scenarios", "Practice conversations",
      "Role-play a realistic conversation, then get a debrief scored against a rubric. Each one takes about 15 minutes.",
      function (s) {
        return h("li", { class: "ell-launch" },
          h("a", { href: "/learn/roleplay/?c=" + encodeURIComponent(cid) + "&s=" + encodeURIComponent(s.id) }, h("strong", null, s.title)),
          h("p", null, s.summary || ""),
          h("p", { class: "ell-hint" }, (s.counterpart ? "With " + s.counterpart.name + ", " + s.counterpart.role + " · " : "") + (s.minutes ? "about " + s.minutes + " minutes" : "")));
      }, "roleplay");
    if (m.exercise) list(grid, "/api/ai/exercises?courseId=", "exercises", "Graded exercises",
      "Submit your work and get feedback on each rubric criterion.",
      function (x) {
        return h("li", { class: "ell-launch" },
          h("a", { href: "/learn/exercise/?c=" + encodeURIComponent(cid) + "&x=" + encodeURIComponent(x.id) }, h("strong", null, x.title)),
          h("p", { class: "ell-hint" }, (x.kind === "code" ? "Code" + (x.language ? " (" + x.language + ")" : "") : "Writing") +
            (x.minutes ? " · about " + x.minutes + " minutes" : "") + (x.rubric && x.rubric.totalPoints ? " · " + x.rubric.totalPoints + " points" : "")));
      }, "exercise");
  }

  function list(grid, path, key, title, intro, row, mode) {
    var block = h("div", { class: "ell-block" }, h("h3", { class: "ell-block-t" }, title), h("p", { class: "ell-hint" }, intro), E.spinner());
    grid.appendChild(block);
    E.request("GET", path + encodeURIComponent(cid), undefined, { auth: true }).then(function (d) {
      block.removeChild(block.lastChild);
      var items = d[key] || [];
      if (!items.length) { block.remove(); return; }
      block.appendChild(h("ul", { class: "ell-launch-list" }, items.map(row)));
    }, function (err) { block.removeChild(block.lastChild); block.appendChild(E.stateBox(E.describe(err, mode))); });
  }

  function watch() {
    if (mount()) return;
    var app = document.getElementById("learn-app");
    if (!app || !window.MutationObserver) return;
    var mo = new MutationObserver(function () { if (mount()) mo.disconnect(); });
    mo.observe(app, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();
