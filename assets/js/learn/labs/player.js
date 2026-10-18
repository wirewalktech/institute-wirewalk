/* [labs] /learn/lab/?course=<id>&lab=<id> : the Decision Lab player.
   Briefing (role card, stakes, starting dashboard) -> decisions (narrative, documents, choice cards)
   -> consequence reveal (outcome, animated metric changes) -> event interstitials (cliffhangers)
   -> "Six months later" (the ending's own effects, when it has any) -> ending (rating, final metrics vs start, path vs expert path, principles, real-world sidebars,
   endings discovered, then one action bar: Try a different path / Start fresh / Discuss with Ellery).
   The Worker is the source of truth: the page only sends {nodeId, choiceId} and renders what comes
   back; choice quality, rationale and the debrief arrive only after an ending. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h, U = window.WLLabUI, L = window.WLLabs;
  var cid = (W.param("course") || W.param("c") || "").toLowerCase();
  var lid = (W.param("lab") || "").toLowerCase();
  var enc = encodeURIComponent;
  var base = "/api/courses/" + enc(cid) + "/labs/" + enc(lid);
  var S = { data: null, meta: null, play: null, dash: null, live: null, lastChoices: {}, decisionN: 0, chat: null, outline: null, finish: null };

  function req(method, path, body) { return API.request(method, base + path, body); }

  /* ---------------------------------------------------------------- load */
  function load() {
    if (!/^[a-z0-9-]{2,60}$/.test(cid) || !/^[a-z0-9-]{2,60}$/.test(lid)) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Lab not found", "Open a Decision Lab from your course page.", [W.btn("Go to dashboard", { href: "/learn/" })], { h1: true })));
      return;
    }
    if (!W.requireAuth()) return;
    W.loading("Loading the lab…");
    /* [lx] The course outline (modules, lessons, labs with status) for "Continue to Module N" after the ending; optional. */
    API.course(cid).then(function (o) { S.outline = o; }, function () { S.outline = null; });
    req("GET", "").then(function (d) { S.data = d; S.meta = d.lab; briefing(); }, function (err) {
      if (err.status === 401) return;
      if (err.status === 403) {
        W.mount(h("div", { class: "wl-narrow" }, W.notice("info", "Enroll to play this Decision Lab", "Decision Labs come with the course. Enroll to practice its decisions.",
          [W.btn("About this course", { href: W.publicCourseUrl(cid) }), W.btn("Dashboard", { href: "/learn/", class: "wl-btn-ghost" })], { h1: true })));
        return;
      }
      W.mount(W.errorView(err, load, { notFound: { title: "Lab not found", body: "This course has no Decision Lab called “" + lid + "”.", href: W.courseUrl(cid), label: "Back to the course" } }));
    });
  }

  function crumbs(extra) {
    var c = S.data && S.data.course;
    return h("nav", { class: "wl-crumbs", "aria-label": "Breadcrumb" },
      h("a", { href: "/learn/" }, "My learning"), h("span", { "aria-hidden": "true" }, " / "),
      h("a", { href: W.courseUrl(cid) }, (c && c.title) || W.courseTitle(cid)),
      extra ? [h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, extra)] : null);
  }
  function liveRegion() { S.live = h("div", { class: "wl-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" }); return S.live; }
  function announce(text) { if (!S.live) return; S.live.textContent = ""; setTimeout(function () { S.live.textContent = text; }, 60); }
  /* Focus the heading; scroll its panel (not the heading) into view, clear of the sticky site header (scroll-margin-top in labs.css).
     [lx] `instant` jumps without animation (the first scene, right after the briefing is replaced). */
  function focusEl(el, instant) { if (!el) return; if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true });
    var panel = (el.closest && el.closest(".lab-scene, .lab-cons, .lab-event, .lab-end, .lab-chat")) || el;
    try { panel.scrollIntoView({ block: "start", behavior: instant || U.prefersReduced() ? "auto" : "smooth" }); } catch (e) { panel.scrollIntoView(); } }

  /* An inline "are you sure?" that replaces the trigger until answered (no native confirm()). */
  function confirmInline(trigger, question, yesLabel, onYes) {
    trigger.addEventListener("click", function () {
      var yes = W.btn(yesLabel, { class: "wl-btn-sm lab-confirm-yes" });
      var no = h("button", { type: "button", class: "wl-link-btn" }, "Cancel");
      var box = h("span", { class: "lab-confirm", role: "group", "aria-label": question }, h("span", { class: "lab-confirm-q" }, question), yes, no);
      trigger.hidden = true;
      trigger.parentNode.insertBefore(box, trigger.nextSibling);
      no.addEventListener("click", function () { box.remove(); trigger.hidden = false; trigger.focus(); });
      yes.addEventListener("click", function () { onYes(yes); });
      no.focus();
    });
  }

  /* ------------------------------------------------------------ briefing */
  function briefing() {
    var d = S.data, m = S.meta;
    W.setTitle(m.title + " · Decision Lab");
    var kindLabel = L.KIND[m.kind] || "Decision Lab";
    var active = d.activePlay;
    var startBtn = W.btn(active ? "Resume where you left off" : "Begin the lab", { class: "lab-cta" });
    startBtn.addEventListener("click", function () { begin(false, startBtn); });
    var actions = [startBtn];
    if (active) {
      var fresh = W.btn("Start over", { class: "wl-btn-ghost" });
      confirmInline(fresh, "Set aside your current run?", "Start over", function (b) { begin(true, b); });
      actions.push(fresh);
    }

    var role = h("section", { class: "lab-role", "aria-labelledby": "lab-role-h" },
      h("div", { class: "lab-role-badge", "aria-hidden": "true" }, h("span", null, "YOU")),
      h("div", { class: "lab-role-b" },
        h("h2", { id: "lab-role-h", class: "lab-role-h" }, "Your role"),
        U.html("lab-role-text wl-prose", m.role),
        m.stakes ? h("div", { class: "lab-stakes" }, h("strong", { class: "lab-stakes-k" }, "What's at stake"), U.html("wl-prose", m.stakes)) : null));

    var startDash = h("section", { class: "lab-brief-dash", "aria-labelledby": "lab-start-h" },
      h("h2", { id: "lab-start-h", class: "wl-h4" }, "Your starting dashboard"),
      h("ul", { class: "lab-brief-metrics", role: "list" }, m.metrics.map(function (x) {
        return h("li", null, h("span", { class: "lab-bm-l" }, x.label), h("span", { class: "lab-bm-v" }, U.fmt(x, x.start)),
          h("span", { class: "lab-bm-g" }, x.good === "high" ? "Higher is better" : "Lower is better"));
      })));

    var how = h("section", { class: "lab-how", "aria-labelledby": "lab-how-h" },
      h("h2", { id: "lab-how-h", class: "wl-h4" }, "How it works"),
      h("ol", { class: "lab-how-l" },
        h("li", null, h("strong", null, (m.decisionsMax || m.decisions) > 4 ? "Several decisions" : "A handful of decisions"), " with real trade-offs. Every option is defensible; read the documents before you choose."),
        h("li", null, h("strong", null, "Consequences, not verdicts."), " The dashboard moves after each choice, and the situation can change without warning."),
        h("li", null, h("strong", null, m.endings + " possible endings."), " After yours, an expert debrief compares your path with the expert's. Replay as often as you like; finishing once completes the lab.")));

    var lessons = (m.lessons || []).length ? h("section", { class: "lab-lessons", "aria-labelledby": "lab-ls-h" },
      h("h2", { id: "lab-ls-h", class: "wl-h4" }, "Practices what you learned in"),
      h("ul", { role: "list" }, m.lessons.map(function (l) { return h("li", null, h("a", { href: W.lessonUrl(cid, l.idx) }, l.title)); }))) : null;

    var hist = d.history && d.history.length ? h("section", { class: "lab-history", "aria-labelledby": "lab-hist-h" },
      h("h2", { id: "lab-hist-h", class: "wl-h4" }, "Your earlier runs"),
      h("ul", { role: "list" }, d.history.slice().reverse().slice(0, 6).map(function (p) {
        return h("li", null, W.chip(L.RATING[p.rating] || "Finished", L.RATING_KIND[p.rating]), h("span", { class: "wl-hint" }, " " + W.fmtDateTime(p.finishedAt)),
          h("button", { type: "button", class: "wl-link-btn lab-review", onclick: function () { review(p.playId); } }, "Review debrief"));
      }))) : null;

    W.mount(h("div", { class: "lab lab-briefing" }, liveRegion(),
      h("header", { class: "lab-brief-head" }, crumbs(),
        h("p", { class: "wl-eyebrow" }, kindLabel + " · Module " + m.module + " · about " + m.minutes + " minutes"),
        h("h1", { class: "wl-display", tabindex: "-1", id: "lab-h1" }, m.title),
        h("p", { class: "wl-lead" }, m.summary)),
      h("div", { class: "lab-brief-grid" },
        h("div", { class: "lab-brief-main" }, role, how, h("div", { class: "wl-actions" }, actions)),
        h("aside", { class: "lab-brief-side" }, startDash, lessons, hist))));
  }

  function review(playId) {
    S.finish = null;
    W.loading("Loading your debrief…");
    req("GET", "/plays/" + enc(playId)).then(function (p) {
      S.play = p; stage();
      if (p.labUpdated || !p.result) staleRun(p); else ending(p.result, p.playId);
    }, function (e) { W.toast(e.message, "bad"); briefing(); });
  }
  /* A run from an earlier version of the lab: only what was stored when it ended. */
  function staleRun(p) {
    var sm = p.summary || {};
    setCounter("Earlier version");
    if (S.root) S.root.classList.add("is-ended");
    var head = h("h2", { class: "lab-end-t", tabindex: "-1" }, "This lab has changed since this run");
    var again = W.btn("Play the current version", { class: "lab-cta" });
    again.addEventListener("click", function () { begin(true, again); });
    var page = h("article", { class: "lab-end" },
      h("div", { class: "lab-end-hero lab-end-" + (sm.rating || "good") }, sm.rating ? U.ratingBadge(sm.rating, true) : null,
        h("div", { class: "lab-end-hb" }, h("p", { class: "lab-scene-k" }, "Run finished " + W.fmtDateTime(p.finishedAt)), head,
          h("p", { class: "lab-end-story" }, "The scenario was revised after you played it, so its debrief, expert path and Ellery discussion now describe a different version. Your result is kept: it still counts toward completing the course."))),
      h("div", { class: "wl-actions lab-end-actions" }, again, W.btn("Back to the course", { href: W.courseUrl(cid), class: "wl-btn-ghost" })));
    W.clear(S.main).appendChild(page);
    focusEl(head);
  }

  /* --------------------------------------------------------------- play */
  function begin(restart, button) {
    var p = req("POST", "/play", { restart: !!restart });
    (button ? W.busy(button, p, "Starting…") : p).then(function (r) {
      S.finish = null;
      S.play = r; S.decisionN = (r.timeline || []).filter(function (t) { return t.t === "choice"; }).length;
      stage();
      if (r.finished) ending(r.result, r.playId); else scene(r.node, true);
    }, function (e) { W.toast(e.message, "bad"); });
  }

  function stage() {
    var m = S.meta;
    S.dash = U.dashboard(m.metrics, S.play.metrics);
    S.tl = h("div", { class: "lab-tl-wrap" });
    S.main = h("div", { class: "lab-main", id: "lab-main" });
    S.counter = h("span", { class: "lab-hud-step" });
    var restart = h("button", { type: "button", class: "wl-link-btn lab-restart" }, "Restart");
    confirmInline(restart, "Set aside this run?", "Restart", function (b) { begin(true, b); });
    /* Progress is saved on the server after every decision, so leaving is safe: "Resume" picks it up. */
    var exit = h("a", { class: "wl-link-btn lab-exit", href: W.courseUrl(cid), title: "Your progress is saved" }, "Exit");
    S.root = h("div", { class: "lab lab-play" }, liveRegion(),
      h("header", { class: "lab-hud" },
        h("div", { class: "lab-hud-l" }, h("span", { class: "lab-hud-k" }, L.KIND[m.kind] || "Decision Lab"), h("span", { class: "lab-hud-t" }, m.title)),
        h("div", { class: "lab-hud-r" }, S.counter, restart, exit)),
      h("div", { class: "lab-grid" },
        S.main,
        h("aside", { class: "lab-side", "aria-label": "Dashboard and decisions so far" }, S.dash.el,
          h("section", { class: "lab-tl-sec", "aria-labelledby": "lab-tl-h" },
            h("details", { class: "lab-tl-det", open: wide() ? true : null },
              h("summary", null, h("h2", { id: "lab-tl-h", class: "lab-side-h" }, "Decisions so far")), S.tl)))));
    W.mount(S.root);
    drawTimeline();
  }
  function wide() { try { return window.matchMedia("(min-width: 961px)").matches; } catch (e) { return true; } }
  function drawTimeline() { W.clear(S.tl).appendChild(U.timeline(S.meta.metrics, S.play.timeline)); }
  function setCounter(text) { if (S.counter) S.counter.textContent = text; }
  /** [lx] "Decision 2 of 5" from the decisions on the shortest and longest path. While paths of
      different lengths are still possible the range stays: "of 7–10", then "of 8–10" past the shortest
      path (this path has at least n), never a bare maximum the path may not reach. */
  function counterText(n) {
    var lo = S.meta.decisionsMin, hi = S.meta.decisionsMax;
    if (!hi) return "Decision " + n;
    if (lo === hi || n >= hi) return "Decision " + n + " of " + Math.max(hi, n);
    return "Decision " + n + " of " + Math.max(lo || n, n) + "–" + hi;
  }

  /** A decision node: narrative, documents, choice cards. */
  function scene(node, first) {
    S.decisionN++;
    setCounter(counterText(S.decisionN));
    var title = h("h2", { class: "lab-scene-t", id: "lab-scene-t", tabindex: "-1" }, node.title);
    var cards = h("div", { class: "lab-choices", role: "group", "aria-labelledby": "lab-choose-h" });
    node.choices.forEach(function (c, i) {
      var last = S.lastChoices[node.id] === c.id;
      var b = h("button", { type: "button", class: "lab-card", "data-choice": c.id, "aria-describedby": last ? "lab-last-" + c.id : null },
        h("span", { class: "lab-card-n", "aria-hidden": "true" }, String.fromCharCode(65 + i)),
        h("span", { class: "lab-card-t" }, c.label),
        last ? h("span", { class: "lab-card-last", id: "lab-last-" + c.id }, "Your choice last time") : null,
        h("span", { class: "lab-card-go", "aria-hidden": "true" }));
      b.addEventListener("click", function () { choose(node, c, b, cards); });
      cards.appendChild(b);
    });
    var sc = h("article", { class: "lab-scene" + (first ? "" : " is-enter") },
      h("p", { class: "lab-scene-k" }, "Decision " + S.decisionN),
      title, U.html("lab-scene-body wl-prose", node.body),
      U.materials(node.materials),
      h("h3", { class: "lab-choose-h", id: "lab-choose-h" }, "What do you do?"),
      cards,
      h("p", { class: "wl-hint lab-keys" }, "Tip: with an option focused, use ", h("kbd", null, "↑"), " ", h("kbd", null, "↓"), " to move between options, or press its letter."));
    W.clear(S.main).appendChild(sc);
    S.keys = { node: node, cards: cards };
    /* [lx] The first scene (after Begin or Resume) also scrolls into view: the page was scrolled down to the briefing's button. */
    if (!first) focusEl(title); else { var h1 = title; setTimeout(function () { focusEl(h1, true); }, 0); }
  }

  function choose(node, c, btn, cards) {
    if (cards.getAttribute("aria-busy") === "true") return;
    cards.setAttribute("aria-busy", "true");
    S.keys = null;
    Array.prototype.forEach.call(cards.querySelectorAll(".lab-card"), function (b) { b.disabled = true; if (b !== btn) b.classList.add("is-dim"); });
    btn.classList.add("is-picked");
    var prev = S.play.metrics;
    req("POST", "/play/" + enc(S.play.playId) + "/step", { nodeId: node.id, choiceId: c.id }).then(function (r) {
      S.play.timeline = r.timeline; S.play.metrics = r.metrics;
      if (r.finished) S.finish = { progress: r.progress || null, examUnlocked: !!r.examUnlocked, examPassed: !!r.examPassed, firstFinish: !!r.firstFinish };   // [lx]
      consequence(r, prev);
    }, function (e) {
      cards.removeAttribute("aria-busy");
      Array.prototype.forEach.call(cards.querySelectorAll(".lab-card"), function (b) { b.disabled = false; b.classList.remove("is-dim", "is-picked"); });
      S.keys = { node: node, cards: cards };
      if (e.status === 409) {
        W.toast(e.message, "bad");
        return begin(e.data && (e.data.reason === "lab_updated" || e.data.reason === "abandoned"));
      }
      W.toast(e.message, "bad");
    });
  }

  /** After a choice: what happened, and the dashboard moving. */
  function consequence(r, prev) {
    var m = S.meta;
    // values after the choice alone; events are revealed (and applied) one by one after this
    var afterChoice = {};
    m.metrics.forEach(function (x) { afterChoice[x.id] = (prev && prev[x.id] != null ? prev[x.id] : 0) + ((r.deltas || {})[x.id] || 0); });
    S.dash.update(afterChoice, r.deltas);
    drawTimelineThroughChoice(r);
    var chips = U.deltaChips(m.metrics, r.deltas, afterChoice);
    var head = h("h2", { class: "lab-cons-t", tabindex: "-1" }, "What happened");
    /* A queued event gets a lead-in, so the cliffhanger lands with some build-up. */
    var lead = r.events && r.events.length ? (r.events[0].kind === "time" ? "Time passes…" : "Meanwhile…") : null;
    var later = r.finished && hasReckoning(r);   // [lx] the ending's effects come next, on their own screen
    var next = W.btn(lead || (later ? "Time passes…" : r.finished ? "See how it ended" : "Next decision"), { class: "lab-next" });
    var panel = h("section", { class: "lab-cons", "aria-labelledby": "lab-cons-h" },
      h("p", { class: "lab-cons-k", id: "lab-cons-h" }, "You chose"),
      h("p", { class: "lab-cons-choice" }, r.choice.label),
      head,
      U.html("lab-cons-body wl-prose", r.outcome),
      h("div", { class: "lab-cons-impact" }, h("p", { class: "lab-impact-k" }, "Impact"), chips.el),
      h("div", { class: "wl-actions" }, next));
    W.clear(S.main).appendChild(panel);
    focusEl(head);
    announce("What happened. " + panel.querySelector(".lab-cons-body").textContent.trim() + " " + chips.spoken);
    var events = (r.events || []).slice();
    var running = afterChoice;
    next.addEventListener("click", function step() {
      if (events.length) {
        var ev = events.shift();
        var vals = {}; m.metrics.forEach(function (x) { vals[x.id] = running[x.id] + ((ev.deltas || {})[x.id] || 0); });
        running = vals;
        return eventScreen(ev, vals, function () { if (events.length) step(); else afterEvents(r); });
      }
      afterEvents(r);
    });
  }
  function hasReckoning(r) { var rk = r.reckoning || (r.result && r.result.reckoning); return !!(rk && rk.deltas && Object.keys(rk.deltas).length); }
  function afterEvents(r) {
    if (r.finished && hasReckoning(r)) return reckoning(r, (r.reckoning || r.result.reckoning).deltas);   // [lx]
    S.dash.update(r.metrics, {});
    drawTimeline();
    if (r.finished) ending(r.result, r.playId);
    else scene(r.node, false);
  }

  /** [lx] "Six months later…": the ending's own effects, shown as chips before the debrief, so every change
      the learner saw adds up to the final table (the hidden cost of the fast path lands here). */
  function reckoning(r, deltas) {
    var m = S.meta;
    setCounter("Six months later");
    S.dash.update(r.metrics, deltas);
    drawTimeline();
    var chips = U.deltaChips(m.metrics, deltas, r.metrics);
    var head = h("h2", { class: "lab-ev-t", tabindex: "-1" }, "The longer-term results come in");
    var go = W.btn("See how it ended", { class: "lab-ev-go" });
    go.addEventListener("click", function () { ending(r.result, r.playId); });
    var box = h("section", { class: "lab-event lab-event-time lab-reckoning", "aria-labelledby": "lab-rk-k" },
      h("div", { class: "lab-ev-banner" }, h("span", { class: "lab-ev-pulse", "aria-hidden": "true" }), h("span", { class: "lab-ev-k", id: "lab-rk-k" }, "Six months later…")),
      h("div", { class: "lab-ev-in" },
        head, h("p", { class: "lab-ev-body" }, "Some consequences take months to show. This is how the months after your last decision moved the dashboard."),
        h("div", { class: "lab-ev-impact" }, h("p", { class: "lab-impact-k" }, "Impact"), chips.el),
        h("div", { class: "wl-actions" }, go)));
    W.clear(S.main).appendChild(box);
    focusEl(head);
    announce("Six months later. " + chips.spoken);
  }
  function drawTimelineThroughChoice(r) {
    // show the timeline through the choice just made; events appear as they are revealed
    var tl = (r.timeline || []).slice();
    while (tl.length && tl[tl.length - 1].t !== "choice") tl.pop();
    W.clear(S.tl).appendChild(U.timeline(S.meta.metrics, tl));
  }

  /** A cliffhanger: the situation changes without the learner's choice. */
  function eventScreen(ev, values, done) {
    var m = S.meta;
    setCounter(U.EVENT_LABEL[ev.kind] || "Update");
    S.dash.update(values, ev.deltas || {});
    var tl = (S.play.timeline || []).slice(), idx = -1;
    tl.forEach(function (t, i) { if (t.t === "event" && t.node === ev.id) idx = i; });
    if (idx >= 0) W.clear(S.tl).appendChild(U.timeline(m.metrics, tl.slice(0, idx + 1)));
    var chips = U.deltaChips(m.metrics, ev.deltas || {}, values);
    var label = U.EVENT_LABEL[ev.kind] || "Alert";
    var head = h("h2", { class: "lab-ev-t", tabindex: "-1" }, ev.title);
    var go = W.btn("Continue", { class: "lab-ev-go" });
    go.addEventListener("click", done);
    var box = h("section", { class: "lab-event lab-event-" + (ev.kind || "alert"), "aria-labelledby": "lab-ev-k" },
      h("div", { class: "lab-ev-banner" }, h("span", { class: "lab-ev-pulse", "aria-hidden": "true" }), h("span", { class: "lab-ev-k", id: "lab-ev-k" }, label)),
      h("div", { class: "lab-ev-in" },
        head, U.html("lab-ev-body wl-prose", ev.body),
        h("div", { class: "lab-ev-impact" }, h("p", { class: "lab-impact-k" }, "Impact"), chips.el),
        h("div", { class: "wl-actions" }, go)));
    W.clear(S.main).appendChild(box);
    focusEl(head);
    announce(label + ": " + ev.title + ". " + box.querySelector(".lab-ev-body").textContent.trim() + " " + chips.spoken);
  }

  /* -------------------------------------------------------------- ending */
  function ending(res, playId) {
    var m = S.meta;
    setCounter("Debrief");
    if (S.root) S.root.classList.add("is-ended");
    /* Count this run among the learner's finished runs (for "Endings discovered"). */
    S.data.history = S.data.history || [];
    if (!S.data.history.some(function (x) { return x.playId === (playId || S.play.playId); }))
      S.data.history.push({ playId: playId || S.play.playId, endingId: res.ending.id, rating: res.ending.rating, finishedAt: S.play.finishedAt || new Date().toISOString() });
    if (S.dash) S.dash.update(S.play.metrics || {}, {});
    if (S.tl) drawTimeline();
    S.lastChoices = {};
    (res.path || []).forEach(function (p) { S.lastChoices[p.node] = p.choice; });
    W.setTitle(res.ending.title + " · " + m.title);
    var head = h("h2", { class: "lab-end-t", tabindex: "-1" }, res.ending.title);

    var metricsRows = h("div", { class: "lab-final", role: "table", "aria-label": "Final dashboard compared with the start and the expert path" },
      h("div", { class: "lab-final-r lab-final-hd", role: "row" },
        h("span", { role: "columnheader" }, "Metric"), h("span", { role: "columnheader" }, "Start"),
        h("span", { role: "columnheader" }, "You"), h("span", { role: "columnheader" }, "Expert path")),
      res.metrics.map(function (x) {
        var d = (x.final || 0) - (x.start || 0);
        var peak = Math.max(Math.abs(x.start || 0), Math.abs(x.final || 0), Math.abs(x.expert || 0));
        var mm = { unit: x.unit, min: null, max: null, start: x.start };
        var defn = m.metrics.filter(function (y) { return y.id === x.id; })[0] || {};
        mm.min = defn.min; mm.max = defn.max;
        var barYou = h("span", { class: "lab-fb-you is-" + U.tone(x, d) }); barYou.style.width = U.fill(mm, x.final, peak) + "%";
        var barStart = h("span", { class: "lab-fb-start" }); barStart.style.left = U.fill(mm, x.start, peak) + "%";
        var barExp = x.expert != null ? h("span", { class: "lab-fb-exp" }) : null; if (barExp) barExp.style.left = U.fill(mm, x.expert, peak) + "%";
        return h("div", { class: "lab-final-r", role: "row" },
          h("span", { role: "rowheader", class: "lab-final-l" }, x.label, h("span", { class: "wl-sr" }, x.good === "high" ? " (higher is better)" : " (lower is better)")),
          h("span", { role: "cell" }, U.fmt(x, x.start)),
          h("span", { role: "cell", class: "lab-final-you" }, U.fmt(x, x.final), d ? h("span", { class: "lab-final-d is-" + U.tone(x, d) }, " " + U.fmtDelta(x, d)) : null),
          h("span", { role: "cell" }, x.expert != null ? U.fmt(x, x.expert) : "—"),
          h("span", { class: "lab-final-bar", "aria-hidden": "true" }, barYou, barStart, barExp));
      }));

    var cmp = res.comparison || {};
    var cmpText = cmp.sameEnding ? "You reached the same ending as the expert path." :
      "You matched the expert on " + cmp.matched + " of " + cmp.expertSteps + " decisions" + (cmp.firstDivergence ? "; your paths split at “" + cmp.firstDivergence.nodeTitle + "”." : ".");

    var yours = h("ol", { class: "lab-path", role: "list" }, res.path.map(function (p, i) {
      return h("li", { class: "lab-path-i" + (p.matchesExpert ? " is-match" : "") },
        h("p", { class: "lab-path-n" }, "Decision " + (i + 1) + ": " + p.nodeTitle),
        h("p", { class: "lab-path-c" }, p.label),
        h("div", { class: "lab-path-meta" }, U.qualityChip(p.quality), p.matchesExpert ? W.chip("Same as expert", "ok") : null),
        U.html("lab-path-r wl-prose", p.rationale));
    }));
    var expert = h("ol", { class: "lab-path is-expert", role: "list" }, res.expertPath.map(function (p, i) {
      return h("li", { class: "lab-path-i" + (p.learnerChoice === p.choice ? " is-match" : "") },
        h("p", { class: "lab-path-n" }, "Decision " + (i + 1) + ": " + p.nodeTitle),
        h("p", { class: "lab-path-c" }, p.label),
        h("div", { class: "lab-path-meta" }, U.qualityChip(p.quality),
          p.learnerChoice === p.choice ? W.chip("You chose this too", "ok") : p.learnerChoice ? W.chip("You chose differently", "warn") : W.chip("You did not reach this decision", "")),
        U.html("lab-path-r wl-prose", p.rationale));
    }));

    /* One action bar, at the end of the debrief. "Try a different path" keeps the
       "Your choice last time" markers; "Start fresh" clears them. */
    var next = nextAction();   // [lx] lesson -> lab -> next module routing
    var diff = W.btn("Try a different path", { class: next ? "wl-btn-ghost" : "lab-cta" });
    diff.addEventListener("click", function () { W.toast("Your earlier choices are marked “Your choice last time”.", "ok"); begin(true, diff); });
    var freshBtn = W.btn("Start fresh", { class: "wl-btn-ghost" });
    freshBtn.addEventListener("click", function () { S.lastChoices = {}; begin(true, freshBtn); });
    var discuss = W.btn("Discuss my choices with Ellery", { class: "wl-btn-ghost lab-ellery-btn" });
    var chatBox = h("section", { class: "lab-chat", id: "lab-chat", "aria-labelledby": "lab-chat-h", hidden: true });
    discuss.addEventListener("click", function () { openChat(chatBox, playId || S.play.playId, discuss); });

    var page = h("article", { class: "lab-end" },
      progressStrip(next),
      h("div", { class: "lab-end-hero lab-end-" + res.ending.rating },
        U.ratingBadge(res.ending.rating, true),
        h("div", { class: "lab-end-hb" }, h("p", { class: "lab-scene-k" }, "Your ending"), head, U.html("lab-end-story wl-prose", res.ending.body),
          endingsFound(res.ending.id))),
      h("section", { class: "lab-end-sec lab-why", "aria-labelledby": "lab-why-h" }, h("h3", { id: "lab-why-h" }, "Why it played out this way"), U.html("wl-prose", res.ending.debrief)),
      h("section", { class: "lab-end-sec", "aria-labelledby": "lab-fin-h" }, h("h3", { id: "lab-fin-h" }, "Your dashboard: start, finish and the expert path"),
        h("p", { class: "lab-legend", "aria-hidden": "true" }, h("span", { class: "lab-lg-you" }), "Your result", h("span", { class: "lab-lg-start" }), "Start", h("span", { class: "lab-lg-exp" }), "Expert path"),
        metricsRows),
      h("section", { class: "lab-end-sec", "aria-labelledby": "lab-cmp-h" },
        h("h3", { id: "lab-cmp-h" }, "Your path and the expert's"),
        h("p", { class: "lab-cmp-sum" }, cmpText, res.expertEnding ? " The expert path ends at “" + res.expertEnding.title + "” (" + (L.RATING[res.expertEnding.rating] || "") + ")." : ""),
        h("div", { class: "lab-paths" },
          h("div", { class: "lab-paths-col" }, h("h4", { class: "wl-h4" }, "Your path"), yours),
          h("div", { class: "lab-paths-col" }, h("h4", { class: "wl-h4" }, "Expert path"), expert))),
      res.principles && res.principles.length ? h("section", { class: "lab-end-sec", "aria-labelledby": "lab-pr-h" },
        h("h3", { id: "lab-pr-h" }, "Principles this lab tested"),
        h("ul", { class: "lab-principles", role: "list" }, res.principles.map(function (p) { var li = h("li"); li.innerHTML = p; return li; }))) : null,
      res.realWorld && res.realWorld.length ? h("section", { class: "lab-end-sec", "aria-labelledby": "lab-rw-h" },
        h("h3", { id: "lab-rw-h" }, "In the real world"),
        h("div", { class: "lab-rw" }, res.realWorld.map(function (r) {
          var t = h("p", { class: "lab-rw-t" }); t.innerHTML = r.text;
          return h("aside", { class: "lab-rw-card" }, t,
            h("p", { class: "lab-rw-s" }, "Source: ", r.url ? h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.source) : r.source,
              r.accessed ? " (accessed " + W.fmtDate(r.accessed + "T12:00:00Z") + ")" : ""));
        }))) : null,
      h("section", { class: "lab-end-next", "aria-labelledby": "lab-next-h" },
        h("h3", { id: "lab-next-h", class: "lab-next-h" }, nextPrompt()),
        h("div", { class: "wl-actions lab-end-actions" }, next ? W.btn(next.label, { href: next.href, class: "lab-cta" }) : null, diff, discuss, freshBtn,
          next && next.course ? null : W.btn("Back to the course", { href: W.courseUrl(cid), class: "wl-btn-ghost" }))),
      chatBox);
    W.clear(S.main).appendChild(page);
    focusEl(head);
    /* The unlock is said once: the toast (itself a polite live region) carries it, not announce(). */
    announce("Lab finished. " + (L.RATING[res.ending.rating] || "") + ": " + res.ending.title + ".");
    if (next && next.exam && S.finish && S.finish.firstFinish) W.toast("Lab complete. The exam is unlocked.", "ok");
    S.finish = S.finish ? { progress: S.finish.progress, examUnlocked: S.finish.examUnlocked, examPassed: S.finish.examPassed, firstFinish: false } : null;   // announce once
  }

  /** [lx] Where to go after this lab: the exam once it unlocks, another unfinished lab in this module, the next
      module's first open lesson, or the course page. null when the run was reopened from history. */
  function nextAction() {
    var f = S.finish;
    if (!f) return null;
    if (f.examUnlocked && !f.examPassed) return { label: "Take the exam", href: W.examUrl(cid), exam: true };   // passed: route onward
    var mods = (S.outline && S.outline.modules) || [], mod = S.meta.module;
    var here = mods.filter(function (x) { return x.module === mod; })[0];
    var lab = here && (here.labs || []).filter(function (l) { return l.id !== lid && l.status !== "finished"; })[0];
    if (lab) return { label: "Next: " + lab.title, href: L.url(cid, lab.id) };
    var after = mods.filter(function (x) { return x.module > mod && x.lessons && x.lessons.length; })[0];
    if (after) {
      var open = after.lessons.filter(function (l) { return !l.completed; })[0] || after.lessons[0];
      return { label: "Continue to Module " + after.module + ": " + after.title, href: W.lessonUrl(cid, open.idx) };
    }
    return { label: "Back to the course", href: W.courseUrl(cid), course: true };
  }
  /** [lx] "Lab complete · 4 of 7 Decision Labs", with what still stands between the learner and the exam. */
  function progressStrip(next) {
    var f = S.finish, p = f && f.progress;
    if (!p) return null;
    var bits = ["Lab complete"];
    if (p.labs && p.labs.total) bits.push(p.labs.done + " of " + W.plural(p.labs.total, "Decision Lab"));
    if (p.total && p.done < p.total) bits.push(p.done + " of " + W.plural(p.total, "lesson"));
    return h("div", { class: "lab-end-progress" },
      h("span", { class: "wl-okmark wl-okmark-sm", "aria-hidden": "true" }),
      h("p", { class: "lab-end-progress-t" }, bits.join(" · ")),
      f.examPassed ? W.chip("Exam passed", "ok") : f.examUnlocked ? W.chip("Exam unlocked", "ok") : h("span", { class: "wl-hint" }, "The exam unlocks when every lesson and Decision Lab is complete."));
  }

  /** "Endings discovered: 2 of 4": a chip per ending reached, an unlabeled slot per ending not yet found. */
  function discovered() {
    var seen = {}, order = [];
    (S.data.history || []).forEach(function (x) { if (x.endingId && !seen[x.endingId]) { seen[x.endingId] = x.rating; order.push(x.endingId); } });
    return { seen: seen, order: order };
  }
  function endingsFound(currentId) {
    var total = S.meta.endings || 0, d = discovered();
    if (!total) return null;
    var found = Math.min(d.order.length, total);
    var slots = d.order.slice(0, total).map(function (id) {
      return h("li", { class: "lab-found-i is-found lab-found-" + (d.seen[id] || "none") + (id === currentId ? " is-now" : "") },
        h("span", { class: "lab-found-dot", "aria-hidden": "true" }), (L.RATING[d.seen[id]] || "Ending") + (id === currentId ? " (this run)" : ""));
    });
    for (var i = found; i < total; i++) slots.push(h("li", { class: "lab-found-i is-open" }, h("span", { class: "lab-found-dot", "aria-hidden": "true" }), h("span", { class: "wl-sr" }, "Not yet found"), h("span", { "aria-hidden": "true" }, "?")));
    return h("div", { class: "lab-found" },
      h("p", { class: "lab-found-k" }, "Endings discovered: ", h("strong", null, found + " of " + total)),
      h("ul", { class: "lab-found-l", role: "list" }, slots));
  }
  function nextPrompt() {
    var total = S.meta.endings || 0, left = total - discovered().order.length;
    return left > 0 ? (left === 1 ? "One ending still undiscovered. What would you do differently?" : left + " endings still undiscovered. What would you do differently?")
      : "You have found every ending. Replay to sharpen your path, or talk it through.";
  }

  /* ---------------------------------------------------- Ellery discussion */
  var OPENING = "Walk me through my choices: what worked, which decision mattered most for my ending, and what should I take back to my job?";
  function openChat(box, playId, btn) {
    box.hidden = false;
    if (S.chat && S.chat.playId === playId) { focusEl(box.querySelector("textarea") || box); return; }
    S.chat = { playId: playId, turns: [] };
    var log = h("div", { class: "lab-chat-log", role: "log", "aria-live": "polite", "aria-label": "Conversation with Ellery" });
    var ta = h("textarea", { id: "lab-chat-in", rows: "2", maxlength: "2000", placeholder: "Ask a follow-up, for example: what if I had paused only the affected code?" });
    var send = W.btn("Ask Ellery", { class: "wl-btn-sm", type: "submit" });
    var form = h("form", { class: "lab-chat-form", novalidate: true }, h("label", { for: "lab-chat-in", class: "wl-sr" }, "Your question for Ellery"), ta, send);
    W.clear(box).appendChild(h("div", { class: "lab-chat-head" },
      h("span", { class: "lab-chat-av", "aria-hidden": "true" }, "E"),
      h("div", null, h("h3", { id: "lab-chat-h" }, "Discuss my choices with Ellery"),
        h("p", { class: "wl-hint" }, "Ellery · AI instructor. Practice only, not part of certification; AI feedback can be wrong."))));
    box.appendChild(log); box.appendChild(form);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = ta.value.trim(); if (!q) { ta.focus(); return; }
      ask(q, log, send, ta);
    });
    /* The opening question is offered, not sent: each question uses one of the learner's Ellery turns. */
    var sugg = h("button", { type: "button", class: "lab-suggest" }, OPENING);
    sugg.addEventListener("click", function () { sugg.remove(); ask(OPENING, log, send, ta); });
    log.appendChild(h("p", { class: "wl-hint lab-suggest-k" }, "Start with a suggested question, or write your own:"));
    log.appendChild(sugg);
    focusEl(sugg);
    try { box.scrollIntoView({ block: "start", behavior: U.prefersReduced() ? "auto" : "smooth" }); } catch (e) { /* ignore */ }
  }
  function bubble(log, who, text) {
    var b = h("div", { class: "lab-msg lab-msg-" + who }, h("span", { class: "wl-sr" }, who === "me" ? "You: " : "Ellery: "));
    String(text).split(/\n{2,}/).forEach(function (para) { b.appendChild(h("p", null, para)); });
    log.appendChild(b); return b;
  }
  function ask(q, log, btn, ta) {
    bubble(log, "me", q);
    Array.prototype.forEach.call(log.querySelectorAll(".lab-suggest, .lab-suggest-k"), function (x) { x.remove(); });
    var wait = h("div", { class: "lab-msg lab-msg-ai is-wait" }, h("span", { class: "wl-spin", "aria-hidden": "true" }), " Ellery is thinking…");
    log.appendChild(wait);
    var history = S.chat.turns.slice(-8);
    var p = API.request("POST", "/api/ai/labdebrief", { courseId: cid, labId: lid, playId: S.chat.playId, message: q, history: history });
    W.busy(btn, p).then(function (r) {
      wait.remove();
      bubble(log, "ai", r.text || "");
      S.chat.turns.push({ role: "user", text: q });
      if (r.turn) S.chat.turns.push(r.turn);
      if (ta) { ta.value = ""; ta.focus(); }
    }, function (e) {
      wait.remove();
      var msg = h("div", { class: "lab-msg lab-msg-err", role: "alert" }, e.message || "Ellery is not available right now.");
      log.appendChild(msg);
    });
  }

  /* ------------------------------------------------------------ keyboard */
  /* Shortcuts work only while focus is on an option (WCAG 2.1.4): arrows move, a letter picks. */
  document.addEventListener("keydown", function (e) {
    if (!S.keys || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (!t || !t.closest || !t.closest(".lab-choices")) return;
    var cards = Array.prototype.slice.call(S.keys.cards.querySelectorAll(".lab-card"));
    var at = cards.indexOf(t.closest(".lab-card"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var n = cards[(at + (e.key === "ArrowDown" ? 1 : cards.length - 1)) % cards.length];
      if (n) n.focus();
      return;
    }
    var k = (e.key || "").toUpperCase();
    if (!/^[A-D]$/.test(k)) return;
    var b = cards[k.charCodeAt(0) - 65];
    if (b && !b.disabled) { e.preventDefault(); b.focus(); b.click(); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
