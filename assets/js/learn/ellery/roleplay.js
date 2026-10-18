/* [ellery] /learn/roleplay/?c=<course>&s=<scenario> : practice conversation with debrief.
 *
 * GET /api/ai/scenarios (public fields only), POST /api/ai/roleplay/start, /turn (streamed) and
 * /debrief (progress events, then the scored JSON). The session lives only in the signed
 * transcript, kept in this tab's sessionStorage so a reload doesn't lose it; nothing is stored
 * on the server. The debrief score is computed by the server from per-criterion levels.
 * Voice: push-to-talk in the reply box, and "Read replies aloud" (a second browser voice). Every
 * spoken line is also in the transcript on screen. Practice only, not part of certification. */
(function () {
  "use strict";
  var E = window.Ellery, W = window.WL;
  if (!E || !W) return;
  var h = E.h;
  var cid = (W.param("c") || "").toLowerCase(), sid = (W.param("s") || "").toLowerCase();
  var SKEY = "wia_rp_" + sid;
  var sc = null, st = null, sess = null, transcript = [], learnerTurns = 0, ctl = null;

  function ss(v) {
    try { if (v === undefined) return JSON.parse(sessionStorage.getItem(SKEY) || "null"); if (v === null) sessionStorage.removeItem(SKEY); else sessionStorage.setItem(SKEY, JSON.stringify(v)); }
    catch (e) { return null; }
  }

  function load() {
    if (!/^[a-z0-9-]{2,60}$/.test(cid) || !/^[a-z0-9-]{3,80}$/.test(sid)) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Practice conversation not found", "Open it from your course page.", [W.btn("Go to dashboard", { href: "/learn/" })])));
      return;
    }
    if (!W.requireAuth()) return;
    W.loading("Loading practice conversation…");
    Promise.all([E.status(cid).catch(function () { return null; }),
      E.request("GET", "/api/ai/scenarios?courseId=" + encodeURIComponent(cid), undefined, { auth: true })]).then(function (r) {
      st = r[0];
      sc = ((r[1] && r[1].scenarios) || []).filter(function (s) { return s.id === sid; })[0];
      if (!sc) { W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Practice conversation not found", "This course has no practice conversation with that name.", [W.btn("Back to course", { href: W.courseUrl(cid) })]))); return; }
      render();
    }, function (err) {
      if (err.status === 401) return;
      var s = E.describe(err, "roleplay");
      W.mount(h("div", { class: "wl-narrow" }, crumbs(), E.stateBox(s, load), h("p", null, h("a", { href: W.courseUrl(cid) }, "Back to the course"))));
    });
  }

  function crumbs() {
    return h("nav", { class: "wl-crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "/learn/" }, "My learning"), h("span", { "aria-hidden": "true" }, " / "),
      h("a", { href: W.courseUrl(cid) + "#practice" }, W.courseTitle(cid)), h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, "Practice conversation"));
  }

  function render() {
    W.setTitle(sc.title + " · Practice conversation");
    var cp = sc.counterpart || {}, me = sc.learner || {};
    var brief = h("aside", { class: "ell-rp-brief", "aria-labelledby": "rp-brief-t" },
      h("h2", { id: "rp-brief-t", class: "ell-block-t" }, "Your brief"),
      sc.setting ? h("p", null, sc.setting) : null,
      h("dl", { class: "ell-dl" },
        me.role ? [h("dt", null, "You are"), h("dd", null, me.role)] : null,
        cp.name ? [h("dt", null, "Talking with"), h("dd", null, cp.name + (cp.role ? ", " + cp.role : ""))] : null,
        h("dt", null, "Length"), h("dd", null, "Up to " + sc.turnLimit + " replies from you" + (sc.minutes ? ", about " + sc.minutes + " minutes" : ""))),
      me.brief ? h("p", null, me.brief) : null,
      me.goals && me.goals.length ? [h("h3", { class: "ell-h" }, "Your goals"), h("ul", { class: "ell-list" }, me.goals.map(function (g) { return h("li", null, g); }))] : null,
      sc.rubric && sc.rubric.criteria && sc.rubric.criteria.length ? [h("h3", { class: "ell-h" }, "What the debrief looks for"),
        h("ul", { class: "ell-list" }, sc.rubric.criteria.map(function (c) { return h("li", null, c.name + (c.weight > 1 ? " (counts " + c.weight + "×)" : "")); }))] : null,
      h("p", { class: "ell-hint" }, "The other person is played by an AI. It's a hypothetical scenario: use invented details, not real names or data."));
    var stage = h("section", { class: "ell-rp-stage", "aria-labelledby": "rp-stage-t" });
    W.mount(h("div", { class: "ell-page" }, crumbs(),
      h("header", { class: "ell-page-head" },
        h("p", { class: "wl-eyebrow" }, "Practice conversation · " + E.label(st)),
        h("h1", { class: "wl-display", tabindex: "-1", id: "rp-title" }, sc.title),
        sc.summary ? h("p", { class: "ell-lead" }, sc.summary) : null,
        E.practiceLabel("Not part of certification. Feedback is AI-generated and can be wrong.")),
      h("div", { class: "ell-rp-grid" }, brief, stage)));
    var blocked = E.blockedBy(st, "roleplay", cid);
    var saved = ss();
    if (saved && saved.session && Date.parse(saved.session.expiresAt) > Date.now() && !saved.debriefed) {
      sess = saved.session; transcript = saved.transcript || []; learnerTurns = transcript.filter(function (t) { return t.role === "user"; }).length;
      chat(stage, blocked && blocked.kind !== "quota" ? blocked : null);
      return;
    }
    intro(stage, blocked);
  }

  function intro(stage, blocked) {
    E.clear(stage);
    stage.appendChild(h("h2", { id: "rp-stage-t", class: "ell-block-t" }, "Conversation"));
    if (blocked) { stage.appendChild(E.stateBox(blocked)); return; }
    var go = E.btn("Start the conversation");
    stage.appendChild(h("div", { class: "ell-rp-start" },
      E.firstUse("roleplay", "Starting uses one of today's practice conversations."),
      h("p", null, (sc.counterpart && sc.counterpart.name ? sc.counterpart.name : "The other person") + " speaks first. Reply as you would at work; when you're done, ask for your debrief."),
      st && st.modes && st.modes.roleplay && typeof st.modes.roleplay.remaining === "number" ? h("p", { class: "ell-hint" }, st.modes.roleplay.remaining + " practice conversations left today.") : null,
      h("div", { class: "ell-actions" }, go)));
    go.addEventListener("click", function () {
      W.busy(go, E.request("POST", "/api/ai/roleplay/start", { scenarioId: sc.id }, { auth: true }), "Starting…").then(function (d) {
        sess = { sessionId: d.sessionId, nonce: d.nonce, expiresAt: d.expiresAt, session: d.session, turnLimit: d.turnLimit, counterpart: d.counterpart };
        transcript = [d.opening]; learnerTurns = 0;
        ss({ session: sess, transcript: transcript });
        chat(stage, null, true);
      }, function (err) { stage.appendChild(E.stateBox(E.describe(err, "roleplay"))); });
    });
  }

  function cpName() { return ((sess && sess.counterpart && sess.counterpart.name) || (sc.counterpart && sc.counterpart.name) || "Counterpart") + " · AI role-play"; }

  function chat(stage, blocked, fresh) {
    E.clear(stage);
    var counter = h("p", { class: "ell-rp-count", role: "status" });
    var log = E.chatLog({ ariaLabel: "Practice conversation transcript" });
    var notices = h("div", { class: "ell-notices" });
    var readAloud = h("input", { type: "checkbox", id: "rp-read", checked: !!E.lsGet("wia_rp_read", false) });
    readAloud.addEventListener("change", function () { E.lsSet("wia_rp_read", readAloud.checked); if (!readAloud.checked && window.speechSynthesis) window.speechSynthesis.cancel(); });
    var comp = E.composer({ id: "rp-in", label: "Your reply", maxLength: 1200, placeholder: "Type your reply", sendText: "Reply", onSend: send });
    var debriefBtn = E.btn("End and get my debrief", { class: "ell-btn-ghost" });
    var restart = E.btn("Start over", { class: "ell-btn-sm ell-btn-ghost", onclick: function () {
      if (!window.confirm("Start over? This conversation will be discarded, and a new one uses another of today's practice conversations.")) return;
      ss(null); sess = null; transcript = []; intro(stage, null);
    } });
    E.add(stage, [h("div", { class: "ell-rp-top" }, h("h2", { id: "rp-stage-t", class: "ell-block-t" }, "Conversation"), counter),
      log.el, notices, comp.el,
      "speechSynthesis" in window ? h("label", { class: "ell-check", for: "rp-read" }, readAloud, " Read replies aloud (they also appear above)") : null,
      E.holdToTalkToggle("rp-hold"),
      h("div", { class: "ell-actions ell-rp-actions" }, debriefBtn, restart)]);
    transcript.forEach(function (t) {
      if (t.role === "user") log.user(t.text);
      else { var m = log.assistant(cpName(), { announceStart: false }); m.finish(t.text); }
    });
    if (fresh && readAloud.checked && transcript[0]) E.speak(transcript[0].text, { second: true });
    function count() {
      counter.textContent = "Your replies: " + learnerTurns + " of " + sess.turnLimit;
      if (learnerTurns >= sess.turnLimit) { comp.setDisabled("You've reached the reply limit. Ask for your debrief."); }
      debriefBtn.disabled = learnerTurns < 1;
    }
    count();
    if (blocked) { notices.appendChild(E.stateBox(blocked)); comp.setDisabled(blocked.title + "."); debriefBtn.disabled = true; }
    else comp.focus();

    function send(text) {
      if (ctl) return;
      log.user(text); comp.clear(); E.clear(notices);
      var msg = log.assistant(cpName());
      ctl = window.AbortController ? new AbortController() : null;
      comp.setBusy(true, ctl ? function () { ctl.abort(); } : null);
      E.request("POST", "/api/ai/roleplay/turn", { scenarioId: sc.id, sessionId: sess.sessionId, nonce: sess.nonce, expiresAt: sess.expiresAt, session: sess.session,
        message: text, transcript: transcript }, { auth: true, stream: true, signal: ctl ? ctl.signal : undefined, onEvent: function (name, d) {
        if (name === "meta" && d.notice === "redacted") notices.appendChild(E.redactedNote());
        if (name === "delta") msg.append(d.text || "");
        if (name === "retract") msg.replace("");
      } }).then(function (r) {
        var d = r.done || {};
        if (d.system || d.stopReason === "refused" || d.stopReason === "retracted" || d.stopReason === "assessment_like") {
          /* not a line from the character: show it as a note from the practice system */
          msg.el.remove();
          log.note(h("p", { class: "ell-notice ell-rp-system", role: "status" }, h("strong", null, "Practice note: "), d.text || ""));
          comp.input.value = text;
          count();
          return;
        }
        msg.finish(d.text || "");
        if (d.turn && d.turn.sig) {
          transcript.push({ role: "user", text: text }, d.turn);
          learnerTurns = d.learnerTurn || learnerTurns + 1;
          ss({ session: sess, transcript: transcript });
          if (readAloud.checked) E.speak(d.turn.text, { second: true });
        }
        if (d.ended) notices.appendChild(h("p", { class: "ell-notice", role: "status" }, "That's the last reply for this conversation. Ask for your debrief when you're ready."));
        count();
      }, function (err) {
        if (err.reason === "aborted") { msg.fail(h("p", { class: "ell-hint" }, "Stopped. Your reply wasn't added; send it again when you're ready.")); comp.input.value = text; return; }
        var s = E.describe(err, "roleplay");
        if (err.reason === "session" || err.reason === "session_expired" || err.reason === "transcript") s = { kind: "unavailable", title: "This session has ended", body: err.message };
        msg.fail(E.stateBox(s, s.kind === "error" || s.kind === "offline" ? function () { comp.input.value = text; } : null));
        if (s.kind !== "error" && s.kind !== "offline") comp.setDisabled(s.title + ".");
        else comp.input.value = text;
      }).then(function () { ctl = null; comp.setBusy(false); if (!comp.input.disabled) comp.focus(); });
    }

    debriefBtn.addEventListener("click", function () {
      if (ctl || learnerTurns < 1) return;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      debriefBtn.disabled = true; comp.setDisabled("Writing your debrief…");
      var stages = { reading: "Reading the conversation", scoring: "Scoring against the rubric", writing: "Writing your feedback", thinking: "Thinking" };
      var prog = h("div", { class: "ell-progress", role: "status", "aria-live": "polite" }, E.spinner("Reading the conversation…"));
      notices.appendChild(prog);
      E.request("POST", "/api/ai/roleplay/debrief", { scenarioId: sc.id, sessionId: sess.sessionId, nonce: sess.nonce, expiresAt: sess.expiresAt,
        session: sess.session, transcript: transcript }, { auth: true, stream: true, onEvent: function (name, d) {
        if (name === "progress") E.clear(prog).appendChild(E.spinner((stages[d.stage] || "Working") + "…"));
      } }).then(function (r) {
        var j = (r.done && r.done.json) || r.done || {};
        ss({ session: sess, transcript: transcript, debriefed: true });
        debrief(stage, j);
      }, function (err) {
        prog.remove();
        notices.appendChild(E.stateBox(E.describe(err, "roleplay")));
        if (err.reason !== "debriefed") { debriefBtn.disabled = false; comp.setDisabled(null); }
      });
    });
  }

  function debrief(stage, j) {
    E.clear(stage);
    var band = { strong: "Strong", developing: "Developing", "not yet": "Not yet" }[j.band] || j.band || "";
    var crit = j.criteria || [];
    var box = h("article", { class: "ell-debrief", "aria-labelledby": "db-t" },
      h("h2", { id: "db-t", class: "ell-block-t", tabindex: "-1" }, "Your debrief"),
      E.practiceLabel(j.label || "Not part of certification. Feedback is AI-generated and can be wrong."),
      h("p", { class: "ell-score" }, h("strong", null, "Overall: " + band), " · score " + (j.scorePct != null ? j.scorePct + "%" : "not available"),
        h("span", { class: "ell-hint" }, " (worked out from the level reached on each criterion, weighted)")),
      h("p", { class: "ell-hint" }, "Hidden facts you uncovered: " + (j.factsFound || []).length + " of " + ((j.factsFound || []).length + (j.factsMissed || []).length) + "."),
      h("h3", { class: "ell-h" }, "By criterion"),
      crit.map(function (c) {
        return h("section", { class: "ell-crit", "aria-labelledby": "db-" + c.id },
          h("h4", { id: "db-" + c.id, class: "ell-crit-t" }, c.name, h("span", { class: "ell-crit-score" }, " " + c.score + " of " + c.max + (c.weight > 1 ? " · counts " + c.weight + "×" : ""))),
          h("div", { class: "ell-meter", "aria-hidden": "true" }, h("span", { style: "width:" + Math.round(100 * c.score / (c.max || 1)) + "%" })),
          c.evidence ? h("blockquote", { class: "ell-evidence" }, c.evidence) : null,
          c.feedback ? h("div", null, E.md(c.feedback)) : null);
      }),
      j.strengths && j.strengths.length ? [h("h3", { class: "ell-h" }, "What went well"), h("ul", { class: "ell-list" }, j.strengths.map(function (s) { return h("li", null, s); }))] : null,
      j.improvements && j.improvements.length ? [h("h3", { class: "ell-h" }, "Try next time"), h("ul", { class: "ell-list" }, j.improvements.map(function (s) {
        return h("li", null, s.text, s.betterLine ? [h("br"), h("em", null, "You could say: “" + s.betterLine + "”")] : null,
          s.lessonTitle ? [h("br"), h("span", { class: "ell-hint" }, "See ", lessonLink(s.lessonTitle, s.lessonIdx))] : null);
      }))] : null,
      j.lessons && j.lessons.length ? h("p", null, h("strong", null, "Revisit: "), j.lessons.map(function (l, i) {
        return [i ? "; " : "", lessonLink(l.title, l.idx)];
      })) : null,
      j.tryNext ? h("p", null, h("strong", null, "Next: "), j.tryNext) : null,
      j.markdown ? h("details", { class: "ell-details" }, h("summary", null, "Full debrief, including the hidden facts"), h("div", { class: "ell-md" }, E.md(j.markdown, { tables: true, headingLevel: 4 }))) : null,
      E.feedback("roleplay"),
      h("div", { class: "ell-actions" }, W.btn("Back to the course", { href: W.courseUrl(cid) + "#practice" }),
        E.btn("Practice again", { class: "ell-btn-ghost", onclick: function () { ss(null); sess = null; transcript = []; intro(stage, null); } })));
    stage.appendChild(box);
    box.querySelector("#db-t").focus();
  }

  /** A lesson title, linked to the lesson when the server gave its index. */
  function lessonLink(title, idx) {
    return typeof idx === "number" && W.lessonUrl ? h("a", { href: W.lessonUrl(cid, idx) }, title) : title;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
