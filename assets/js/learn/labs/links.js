/* [labs] Decision Lab links and status for the course outline, lesson navigation and dashboard.
   Loaded after learn/common.js. Exposes window.WLLabs. Lab data comes from the course outline
   (GET /api/courses/:id -> modules[].labs) and /api/me (enrollments[].progress.labs). */
(function () {
  "use strict";
  var W = window.WL, h = W.h;
  var RATING = { best: "Best outcome", good: "Good outcome", mixed: "Mixed outcome", poor: "Poor outcome" };
  var RATING_KIND = { best: "ok", good: "ac", mixed: "warn", poor: "bad" };
  var KIND = { module: "Decision Lab", capstone: "Capstone simulation", intro: "Decision Lab" };

  function url(courseId, labId) { return "/learn/lab/?course=" + encodeURIComponent(courseId) + "&lab=" + encodeURIComponent(labId); }

  /** {text, kind} for a lab's status. */
  function status(l) {
    if (l.status === "finished") return { text: "Finished" + (l.bestRating ? " · " + RATING[l.bestRating] : ""), kind: RATING_KIND[l.bestRating] || "ok" };
    if (l.status === "in_progress") return { text: "In progress", kind: "warn" };
    return { text: "Not started", kind: "" };
  }
  function chip(l) { var s = status(l); return W.chip(s.text, s.kind); }

  /** One row in a module's list (course outline and lesson contents). */
  function row(courseId, l, opts) {
    opts = opts || {};
    var s = status(l);
    return h("li", { class: "wl-lab-row" + (l.status === "finished" ? " is-done" : "") + (opts.compact ? " is-compact" : "") },
      h("a", { href: url(courseId, l.id) },
        h("span", { class: "wl-lab-ico", "aria-hidden": "true" }),
        h("span", { class: "wl-grow" },
          h("span", { class: "wl-lab-k" }, KIND[l.kind] || "Decision Lab", l.minutes ? " · " + l.minutes + " min" : ""),
          h("span", { class: "wl-lab-t" }, l.title)),
        opts.compact ? h("span", { class: "wl-sr" }, " (" + s.text + ")") : chip(l)));
  }

  /** Short progress phrase from progress.labs: "1 of 3 Decision Labs finished". */
  function progressText(p) {
    if (!p || !p.labs || !p.labs.total) return "";
    return p.labs.done + " of " + W.plural(p.labs.total, "Decision Lab") + " finished";
  }

  window.WLLabs = { url: url, status: status, chip: chip, row: row, progressText: progressText, RATING: RATING, RATING_KIND: RATING_KIND, KIND: KIND };
})();
