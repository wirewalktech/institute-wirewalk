/* [tutor] /learn/lesson/ : "Ask about this lesson" AI panel.
 * Loaded after learn/lesson.js. Waits for the lesson to render, then adds a
 * collapsed panel below the "mark complete" box. Answers come from
 * POST /api/courses/:id/lessons/:idx/tutor and are shown as plain text
 * (textContent), never as HTML. Nothing is stored in the browser. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL;
  if (!API || !W) return;
  var h = W.h;
  var cid = (W.param("c") || "").toLowerCase();
  var idx = W.param("l") || "";
  if (!/^[a-z0-9-]{2,60}$/.test(cid) || !/^\d{1,4}$/.test(idx)) return;
  var path = "/api/courses/" + encodeURIComponent(cid) + "/lessons/" + encodeURIComponent(idx) + "/tutor";
  var history = [];   // [{role, content, sig?}] for this page view only; the server signs each answer (sig) and ignores unsigned turns
  var mounted = false;

  function badge() {
    return h("span", { style: "display:inline-block;font:700 11.5px/1 var(--wl-sans);letter-spacing:.04em;padding:4px 7px;border-radius:6px;background:var(--wl-acbg);color:var(--wl-ac);margin-left:8px;vertical-align:middle" }, "AI");
  }

  function build(anchor) {
    var status = h("p", { class: "wl-hint", "aria-live": "polite" });
    var log = h("div", { "aria-live": "polite", style: "display:grid;gap:12px;margin:12px 0" });
    var area = h("div");
    var loaded = false;
    var det = h("details", { class: "wl-card-plain", id: "lesson-tutor", style: "margin:24px 0" },
      h("summary", { style: "cursor:pointer;font-weight:650" }, "Ask about this lesson", badge()),
      h("div", { style: "margin-top:12px" },
        h("p", { class: "wl-hint" }, "An AI assistant answers questions about this lesson only, using the lesson's text. ",
          h("strong", null, "Answers can be wrong"), ": check them against the lesson. It will not help with exam questions."),
        log, area, status));
    det.addEventListener("toggle", function () { if (det.open && !loaded) { loaded = true; init(); } });
    anchor.parentNode.insertBefore(det, anchor.nextSibling);

    function setStatus(d) {
      status.textContent = d && typeof d.remaining === "number" ? d.remaining + " question" + (d.remaining === 1 ? "" : "s") + " left today." : "";
    }

    function init() {
      W.clear(area).appendChild(h("p", { class: "wl-hint" }, "Loading…"));
      API.request("GET", path).then(function (d) {
        W.clear(area);
        if (!d.configured) { area.appendChild(W.notice("info", "Not configured", "The AI tutor is not configured yet.")); return; }
        if (d.examOpen) area.appendChild(W.notice("info", "Paused during your exam", "The tutor does not answer while your exam for this course is in progress. It is back once you submit."));
        form(); setStatus(d);
      }, function (e) { W.clear(area).appendChild(W.notice("error", "The tutor is unavailable", e.message)); });
    }

    function bubble(who, text, tone) {
      return h("div", { style: "padding:10px 14px;border-radius:10px;border:1px solid var(--wl-line);" + (who === "You" ? "background:var(--wl-alt)" : "background:var(--wl-surface)") + (tone === "warn" ? ";border-left:4px solid var(--wl-warn)" : "") },
        h("div", { class: "wl-hint", style: "font-weight:650;margin-bottom:4px" }, who === "You" ? "You" : ["Tutor", badge()]),
        h("div", { style: "white-space:pre-wrap;overflow-wrap:anywhere" }, text));
    }

    function form() {
      var id = "tutor-q";
      var q = h("textarea", { id: id, rows: "3", maxlength: "1000", placeholder: "e.g. Can you explain the second idea in simpler words?" });
      var send = W.btn("Ask", { class: "wl-btn-sm" });
      var f = h("form", { class: "wl-field", novalidate: true },
        h("label", { "for": id }, "Your question about this lesson"), q, h("div", { class: "wl-actions" }, send));
      f.addEventListener("submit", function (ev) { ev.preventDefault(); ask(); });
      send.addEventListener("click", function (ev) { ev.preventDefault(); ask(); });
      area.appendChild(f);

      function ask() {
        var text = q.value.trim();
        if (text.length < 2) { q.focus(); return; }
        log.appendChild(bubble("You", text));
        send.disabled = true; send.setAttribute("aria-busy", "true"); send.textContent = "Thinking…";
        API.request("POST", path, { question: text, history: history.slice(-8) }).then(function (d) {
          log.appendChild(bubble("Tutor", d.answer + (d.truncated ? " …" : ""), d.refused ? "warn" : null));
          if (!d.refused && d.sig) { history.push({ role: "user", content: text }, { role: "assistant", content: d.answer, sig: d.sig }); }
          q.value = ""; setStatus(d);
        }, function (e) {
          var msg = e.data && e.data.reason === "not_configured" ? "The AI tutor is not configured yet."
            : e.data && e.data.reason === "exam_open" ? "The tutor is paused while your exam for this course is in progress. It is back once you submit."
            : e.message;
          log.appendChild(bubble("Tutor", msg, "warn"));
        }).then(function () {
          send.disabled = false; send.removeAttribute("aria-busy"); send.textContent = "Ask"; q.focus();
        });
      }
    }
  }

  function tryMount() {
    if (mounted) return true;
    var box = document.getElementById("complete-box");
    if (!box || !box.parentNode) return false;
    mounted = true; build(box); return true;
  }

  function start() {
    if (tryMount()) return;
    var app = document.getElementById("learn-app");
    if (!app || !window.MutationObserver) return;
    var mo = new MutationObserver(function () { if (tryMount()) mo.disconnect(); });
    mo.observe(app, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
