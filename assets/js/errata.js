/* "Report an error": a small form that posts to {api}/api/errata.
 *
 * - Any element with data-errata-course="<course id>" (and optionally data-errata-lesson="<idx>",
 *   data-errata-title="<what is being reported>") opens the form in a dialog when clicked. Its
 *   href should point at /errata/?c=<id>&l=<idx>, which is the no-dialog fallback. Clicks are
 *   delegated, so links rendered later by the learner app work too.
 * - On /errata/ the form is rendered inline into #errata-mount, prefilled from ?c= and ?l=.
 * - Signed in (localStorage "wia_token"): the report is sent with the learner's token and needs no
 *   human check. Signed out: Cloudflare Turnstile (site key from #errata-turnstile-config or
 *   #wl-turnstile-config) and an optional reply address.
 * All text is set with textContent; no innerHTML anywhere. */
(function () {
  "use strict";
  var MAX = 2000;
  var api = ((window.WIA && window.WIA.api) || "").replace(/\/+$/, "");

  function token() { try { return localStorage.getItem("wia_token"); } catch (e) { return null; } }
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  function ensureCss() {
    if (document.querySelector('link[href="/assets/css/errata.css"]')) return;
    document.head.appendChild(el("link", { rel: "stylesheet", href: "/assets/css/errata.css" }));
  }
  function isLocal() { var h = location.hostname; return h === "localhost" || h === "127.0.0.1" || h === "[::1]"; }
  function sitekey() {
    var c = document.getElementById("errata-turnstile-config") || document.getElementById("wl-turnstile-config");
    return c ? (c.getAttribute("data-sitekey") || "").trim() : "";
  }

  /* ---------- Turnstile (explicit render, loaded only when a signed-out visitor opens the form) */
  var tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsLoading) return tsLoading;
    tsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = function () { resolve(window.turnstile); };
      s.onerror = function () { tsLoading = null; reject(new Error("turnstile")); };
      document.head.appendChild(s);
    });
    return tsLoading;
  }
  function humanCheck() {
    var key = sitekey(), widget = null;
    var box = el("div", { class: "er-ts" });
    if (key) {
      loadTurnstile().then(function (ts) { widget = ts.render(box, { sitekey: key, theme: "auto", size: "flexible" }); }, function () {
        box.appendChild(el("p", { class: "er-hint", text: "The security check could not load. Disable content blockers for this site and reload, or email sales@wirewalk.com." }));
      });
    }
    return {
      el: box,
      unavailable: !key && !isLocal(),
      token: function () { try { return (key && window.turnstile && widget !== null && window.turnstile.getResponse(widget)) || ""; } catch (e) { return ""; } },
      reset: function () { try { if (window.turnstile && widget !== null) window.turnstile.reset(widget); } catch (e) { /* ignore */ } }
    };
  }

  /* ---------- the form */
  var seq = 0;
  function form(ctx, onDone) {
    var n = ++seq, signedIn = !!token();
    var id = function (s) { return "er-" + s + "-" + n; };
    var courseInput = ctx.courseId ? null : el("input", { id: id("c"), name: "courseId", required: true, maxlength: "40", autocomplete: "off",
      spellcheck: "false", placeholder: "e.g. ven-120", pattern: "[a-z0-9-]{1,40}" });
    var msg = el("textarea", { id: id("m"), name: "message", required: true, maxlength: String(MAX), rows: "6",
      "aria-describedby": id("mh") });
    var count = el("span", { text: "0 / " + MAX });
    msg.addEventListener("input", function () { count.textContent = msg.value.length + " / " + MAX; });
    var qref = el("input", { id: id("q"), name: "questionRef", maxlength: "120", autocomplete: "off",
      placeholder: "e.g. Module 2, the question about retrieval" });
    var email = signedIn ? null : el("input", { id: id("e"), name: "email", type: "email", maxlength: "200", autocomplete: "email", placeholder: "you@example.com" });
    var check = signedIn ? null : humanCheck();
    var status = el("p", { class: "er-status", role: "status", "aria-live": "polite" });
    var submit = el("button", { class: "btn sm", type: "submit", text: "Send report" });
    var where = ctx.courseId
      ? el("p", { class: "er-where" }, "Course ", el("code", { text: ctx.courseId }),
          ctx.lessonIdx !== "" && ctx.lessonIdx != null ? ", lesson " + (Number(ctx.lessonIdx) + 1) : "",
          ctx.title ? el("span", { class: "er-hint", text: " — " + ctx.title }) : null)
      : el("div", { class: "er-field" }, el("label", { for: id("c"), text: "Course id" }), courseInput,
          el("p", { class: "er-hint", text: "The code shown on the course page, such as ven-120." }));

    var f = el("form", { class: "er-form", novalidate: true },
      where,
      el("div", { class: "er-field" }, el("label", { for: id("m"), text: "What is wrong?" }), msg,
        el("p", { class: "er-hint", id: id("mh") }, "Quote the sentence or describe the question, and say what you think is correct. ", count)),
      el("div", { class: "er-field" }, el("label", { for: id("q") }, "Exam or quiz question ", el("span", { class: "er-opt", text: "(optional)" })), qref,
        el("p", { class: "er-hint", text: "Describe it in your own words. Please do not post answers." })),
      email ? el("div", { class: "er-field" }, el("label", { for: id("e") }, "Your email ", el("span", { class: "er-opt", text: "(optional, only if you are happy for us to ask you about it)" })), email) : null,
      check ? check.el : null,
      check && check.unavailable ? el("p", { class: "er-hint", text: "Sending reports while signed out is not available right now. Sign in, or email sales@wirewalk.com." }) : null,
      el("div", { class: "er-actions" }, submit),
      status,
      el("p", { class: "er-hint" }, "How reports are handled: ", el("a", { href: "/errata/", text: "errata process" }), ". ",
        el("a", { href: "/privacy/", text: "Privacy" }), "."));

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      status.className = "er-status";
      var courseId = ctx.courseId || (courseInput.value || "").trim().toLowerCase();
      var text = msg.value.trim();
      if (!/^[a-z0-9-]{1,40}$/.test(courseId)) { status.className = "er-status bad"; status.textContent = "Enter the course id shown on the course page."; (courseInput || msg).focus(); return; }
      if (!text) { status.className = "er-status bad"; status.textContent = "Describe the error first."; msg.focus(); return; }
      if (text.length > MAX) { status.className = "er-status bad"; status.textContent = "Keep it to " + MAX + " characters."; msg.focus(); return; }
      if (check && check.unavailable) { status.className = "er-status bad"; status.textContent = "Please sign in or email sales@wirewalk.com."; return; }
      var body = { courseId: courseId, message: text };
      if (ctx.lessonIdx !== "" && ctx.lessonIdx != null && /^\d{1,4}$/.test(String(ctx.lessonIdx))) body.lessonIdx = Number(ctx.lessonIdx);
      if (qref.value.trim()) body.questionRef = qref.value.trim();
      if (email && email.value.trim()) body.email = email.value.trim();
      if (check) {
        body.turnstile = check.token();
        if (sitekey() && !body.turnstile) { status.className = "er-status bad"; status.textContent = "Complete the human check above, then send."; return; }
      }
      var headers = { "Content-Type": "application/json", Accept: "application/json" };
      var t = token();
      if (t) headers.Authorization = "Bearer " + t;
      submit.disabled = true; submit.textContent = "Sending…";
      fetch(api + "/api/errata", { method: "POST", mode: "cors", credentials: "omit", headers: headers, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok) { var er = new Error(d.error || ("status " + r.status)); er.status = r.status; throw er; }
            return d;
          });
        })
        .then(function () {
          var done = el("div", { class: "er-done", role: "status", tabindex: "-1" },
            el("strong", { text: "Thank you. Your report has been sent." }),
            el("p", { class: "er-hint", text: "We review every report. If the course needs correcting, we fix the lesson or question." }));
          f.parentNode.replaceChild(done, f);
          done.focus();
          if (onDone) onDone();
        }, function (er) {
          submit.disabled = false; submit.textContent = "Send report";
          if (check) check.reset();
          status.className = "er-status bad";
          var m;
          if (!er || !er.status) m = "We could not reach the server. Check your connection and try again, or email sales@wirewalk.com.";
          else {
            m = String(er.message || "The report could not be sent");
            m = m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
            if (er.status >= 500) m += " You can also email sales@wirewalk.com.";
          }
          status.textContent = m;
        });
    });
    return f;
  }

  /* ---------- dialog */
  var dlg = null;
  function openDialog(ctx) {
    ensureCss();
    if (!dlg) {
      dlg = el("dialog", { class: "er-dlg", "aria-labelledby": "er-dlg-title" });
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    }
    while (dlg.firstChild) dlg.removeChild(dlg.firstChild);
    var close = el("button", { class: "er-x", type: "button", "aria-label": "Close", text: "×", onclick: function () { dlg.close(); } });
    dlg.appendChild(el("div", { class: "er-head" }, el("h2", { id: "er-dlg-title", text: "Report an error" }), close));
    dlg.appendChild(form(ctx));
    dlg.showModal();
    var first = dlg.querySelector("textarea, input");
    if (first) first.focus();
  }

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("[data-errata-course]") : null;
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof HTMLDialogElement === "undefined" || !document.createElement("dialog").showModal) return;   // follow the href
    var c = (a.getAttribute("data-errata-course") || "").toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(c)) return;
    e.preventDefault();
    openDialog({ courseId: c, lessonIdx: a.getAttribute("data-errata-lesson") || "", title: a.getAttribute("data-errata-title") || "" });
  });

  /* ---------- inline on /errata/ */
  function mountInline() {
    var mount = document.getElementById("errata-mount");
    if (!mount) return;
    ensureCss();
    var q; try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
    var c = q ? (q.get("c") || "").toLowerCase() : "", l = q ? q.get("l") || "" : "";
    if (!/^[a-z0-9-]{1,40}$/.test(c)) c = "";
    if (!/^\d{1,4}$/.test(l)) l = "";
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(form({ courseId: c, lessonIdx: c ? l : "", title: "" }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountInline); else mountInline();
})();
