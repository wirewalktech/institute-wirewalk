/*
 * Shared helpers for the learner app (/learn/**). Loaded after /assets/js/api.js.
 * Exposes window.WL. No innerHTML with data from the API except lesson HTML,
 * which the content build escapes (tools/build.mjs) and which is rendered only in the reader.
 */
(function () {
  "use strict";
  var API = window.WIAApi;

  /* ---------- DOM ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "style" && typeof v === "object") { for (var s in v) el.style.setProperty(s, v[s]); }
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function mount(el) {
    var app = document.getElementById("learn-app");
    clear(app);
    append(app, el);
    app.setAttribute("aria-busy", "false");
    return app;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }

  /* ---------- URL ---------- */
  function param(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }
  /** Only same-origin paths are valid redirect targets. The value is resolved with the URL
   * parser (which strips tabs/newlines, so "/\t/evil.example" would otherwise escape) and its
   * origin compared; control characters and backslashes are rejected outright. */
  function safeNext(n) {
    if (!n || typeof n !== "string" || n.length > 512) return null;
    if (n.charAt(0) !== "/" || /[\u0000-\u001f\u007f\\]/.test(n)) return null;
    try {
      var u = new URL(n, window.location.origin);
      if (u.origin !== window.location.origin) return null;
      return u.pathname + u.search + u.hash;
    } catch (e) { return null; }
  }
  function here() { return window.location.pathname + window.location.search; }
  /** [onboard] opts.intent "buy" | "free" | "team" and opts.course (an id): the sign-in page then
   * opens on "Create account" for a browser that has never signed in, with a line saying why. */
  function signInUrl(next, opts) {
    opts = opts || {};
    var u = "/learn/?next=" + encodeURIComponent(next || here());
    if (opts.intent && /^(buy|free|team)$/.test(opts.intent)) u += "&intent=" + opts.intent;
    if (opts.course && /^[a-z0-9-]{2,60}$/.test(opts.course)) u += "&c=" + encodeURIComponent(opts.course);
    return u;
  }
  /* [onboard] "This browser has signed in before" (localStorage "wia_has_account"), so a returning
     learner is not shown "Create account" first. A per-browser convenience only. */
  var HAS_ACCOUNT = "wia_has_account";
  function hasAccount() { try { return localStorage.getItem(HAS_ACCOUNT) === "1"; } catch (e) { return false; } }
  function markHasAccount() { try { localStorage.setItem(HAS_ACCOUNT, "1"); } catch (e) { /* storage blocked */ } }
  function courseUrl(id) { return "/learn/course/?c=" + encodeURIComponent(id); }
  function lessonUrl(id, idx) { return "/learn/lesson/?c=" + encodeURIComponent(id) + "&l=" + encodeURIComponent(idx); }
  function examUrl(id) { return "/learn/exam/?c=" + encodeURIComponent(id); }
  function certUrl(id) { return "/learn/certificate/?id=" + encodeURIComponent(id); }
  function publicCourseUrl(id) { return "/courses/" + encodeURIComponent(id) + "/"; }

  /* ---------- catalog map (embedded by the page from _data/catalog.json) ---------- */
  var catalogCache = null;
  function catalog() {
    if (catalogCache) return catalogCache;
    catalogCache = { courses: {}, programs: {}, tracks: {}, levels: {} };
    var node = document.getElementById("wia-catalog");
    if (node) {
      try {
        var d = JSON.parse(node.textContent);
        catalogCache.courses = d.courses || {};
        catalogCache.programs = d.programs || {};
        catalogCache.tracks = d.tracks || {};
        catalogCache.levels = d.levels || {};
      } catch (e) { /* malformed embed: titles fall back to ids */ }
    }
    return catalogCache;
  }
  function courseTitle(id) { var c = catalog().courses[id]; return (c && c.t) || id; }
  /** "on_sale" | "waitlist" | "" (unknown) from the embedded catalog. */
  function courseStatus(id) { var c = catalog().courses[id]; return (c && c.s) || ""; }
  function programTitle(id) { var p = catalog().programs[id]; return (p && p.t) || id; }
  function levelLabel(level) {
    var l = catalog().levels[level];
    if (l) return l;
    return level ? String(level).charAt(0).toUpperCase() + String(level).slice(1) : "";
  }
  function trackLabel(track) { return catalog().tracks[track] || track || ""; }

  /* ---------- formatting (display only; amounts always come from the server) ---------- */
  var money = (function () {
    try { var f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }); return function (m) { return f.format((Number(m) || 0) / 100); }; }
    catch (e) { return function (m) { return "$" + ((Number(m) || 0) / 100).toFixed(2); }; }
  })();
  function toDate(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  function fmtDate(v) {
    var d = toDate(v); if (!d) return "";
    try { return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); } catch (e) { return d.toDateString(); }
  }
  /** Certificate dates: always the UTC calendar day, so the holder, the printed copy and a
   * verifier in any time zone all see the same issue date. */
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDateUTC(v) {
    var d = toDate(v); if (!d) return "";
    try { return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }); }
    catch (e) { return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
  }
  function fmtDateTime(v) {
    var d = toDate(v); if (!d) return "";
    try { return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return d.toString(); }
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function pct(done, total) { return total > 0 ? Math.round((100 * done) / total) : 0; }

  /* ---------- UI pieces ---------- */
  function progressBar(done, total, label) {
    var p = pct(done, total);
    return h("div", { class: "wl-progress" },
      h("div", { class: "wl-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total || 0),
        "aria-valuenow": String(done || 0), "aria-label": label || "Lessons completed",
        "aria-valuetext": (done || 0) + " of " + (total || 0) + " lessons complete" },
        h("span", { style: { width: p + "%" } })),
      h("span", { class: "wl-progress-txt" }, (done || 0) + "/" + (total || 0) + " lessons · " + p + "%"));
  }

  function chip(text, kind) { return h("span", { class: "wl-chip" + (kind ? " wl-chip-" + kind : "") }, text); }

  /** One-line, human description of an ExamState. */
  function examSummary(exam, progress) {
    exam = exam || {};
    if (exam.passed) return { kind: "ok", text: "Exam passed" + (exam.bestScore != null ? " · " + exam.bestScore + "%" : "") };
    if (exam.openAttempt) return { kind: "warn", text: "Exam in progress" };
    if (exam.eligible) return { kind: "ac", text: exam.recertification ? "Certificate expired · renew it" : "Exam unlocked" };   // [freshness]
    switch (exam.reason) {
      case "complete_lessons":
        var left = progress ? Math.max(0, (progress.total || 0) - (progress.done || 0)) : null;
        return { kind: "", text: left ? "Exam unlocks after " + plural(left, "more lesson") : "Complete all lessons to unlock the exam" };
      case "complete_labs":   // [labs]
        var labsLeft = progress && progress.labs ? Math.max(0, progress.labs.total - progress.labs.done) : 0;
        return { kind: "", text: labsLeft ? "Exam unlocks after " + plural(labsLeft, "more Decision Lab") : "Finish every Decision Lab to unlock the exam" };
      case "cooldown":
        return { kind: "warn", text: "Next attempt " + (exam.nextAttemptAt ? fmtDateTime(exam.nextAttemptAt) : "after a 24-hour wait") };
      case "no_attempts_left":
        return { kind: "bad", text: "No exam attempts left" };
      case "already_passed":
        return { kind: "ok", text: "Exam passed" };
      default:
        return { kind: "", text: "Exam not available yet" };
    }
  }

  function reasonDetail(exam, progress) {
    exam = exam || {};
    switch (exam.reason) {
      case "complete_lessons":
        var left = progress ? Math.max(0, (progress.total || 0) - (progress.done || 0)) : 0;
        return "The exam unlocks once every lesson is marked complete" + (left ? " — " + plural(left, "lesson") + " to go." : ".");
      case "complete_labs":   // [labs]
        var labsLeft = progress && progress.labs ? Math.max(0, progress.labs.total - progress.labs.done) : 0;
        return "The exam unlocks once you have played every Decision Lab in this course to an ending (any ending counts)" + (labsLeft ? " — " + plural(labsLeft, "lab") + " to go." : ".");
      case "cooldown":
        return "After an attempt that does not pass there is a 24-hour wait before the next one." +
          (exam.nextAttemptAt ? " Your next attempt opens " + fmtDateTime(exam.nextAttemptAt) + "." : "");
      case "no_attempts_left":
        return "You have used all " + (exam.attemptsAllowed || "") + " attempts for this exam. If you believe this is a mistake, contact sales@wirewalk.com and an administrator can review your attempts.";
      case "already_passed":
        return "You have already passed this exam.";
      default:
        return "";
    }
  }

  function spinner(text) {
    return h("div", { class: "wl-loading", role: "status" }, h("span", { class: "wl-spin", "aria-hidden": "true" }), h("span", null, text || "Loading…"));
  }
  function loading(text) {
    var app = document.getElementById("learn-app");
    if (!app) return;
    clear(app);
    app.setAttribute("aria-busy", "true");
    app.appendChild(spinner(text));
  }

  /** opts.h1: render the title as the page's h1 (for views where the notice is the whole page). */
  function notice(kind, title, body, actions, opts) {
    var asH1 = opts && opts.h1;
    return h("div", { class: "wl-notice wl-notice-" + (kind || "info"), role: kind === "error" ? "alert" : "status" },
      title ? h(asH1 ? "h1" : "strong", { class: "wl-notice-title" }, title) : null,
      body ? h("div", { class: "wl-notice-body" }, body) : null,
      actions && actions.length ? h("div", { class: "wl-actions" }, actions) : null);
  }

  /** opts.notFound: {title, body, href, label} used when the API answers 404 (no pointless retry). */
  function errorView(err, retry, opts) {
    opts = opts || {};
    if (err && err.status === 404 && opts.notFound) {
      var nf = opts.notFound;
      return h("div", { class: "wl-narrow" }, notice("error", nf.title || "Not found", nf.body || null,
        [h("a", { class: "wl-btn", href: nf.href || "/learn/" }, nf.label || "Go to dashboard")], { h1: true }));
    }
    var msg = (err && err.message) || "Something went wrong.";
    var actions = [];
    if (retry) actions.push(h("button", { class: "wl-btn", type: "button", onclick: retry }, "Try again"));
    actions.push(h("a", { class: "wl-btn wl-btn-ghost", href: "/learn/" }, "Go to dashboard"));
    return h("div", { class: "wl-narrow" }, notice("error", "We could not load this page", msg, actions, { h1: true }));
  }

  function btn(text, attrs) {
    attrs = attrs || {};
    attrs.class = "wl-btn" + (attrs.class ? " " + attrs.class : "");
    if (!attrs.type && !attrs.href) attrs.type = "button";
    return h(attrs.href ? "a" : "button", attrs, text);
  }
  /** Put a button into a busy state while a promise runs. */
  function busy(button, promise, busyText) {
    var old = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (busyText) button.textContent = busyText;
    function done() { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = old; }
    return promise.then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  }

  function field(opts) {
    var id = opts.id || ("f-" + Math.random().toString(36).slice(2, 8));
    var input = h(opts.textarea ? "textarea" : "input", {
      id: id, name: opts.name || id, type: opts.textarea ? null : (opts.type || "text"),
      autocomplete: opts.autocomplete, required: opts.required, value: opts.value,
      inputmode: opts.inputmode, maxlength: opts.maxlength, minlength: opts.minlength,
      placeholder: opts.placeholder, pattern: opts.pattern, spellcheck: opts.spellcheck,
      autocapitalize: opts.autocapitalize, "aria-describedby": opts.hint ? id + "-hint" : null
    });
    return h("div", { class: "wl-field" },
      h("label", { for: id }, opts.label, opts.optional ? h("span", { class: "wl-opt" }, " (optional)") : null),
      opts.passwordToggle ? h("div", { class: "wl-pw" }, input, pwToggle(input)) : input,
      opts.hint ? h("p", { class: "wl-hint", id: id + "-hint" }, opts.hint) : null);
  }
  function pwToggle(input) {
    var b = h("button", { type: "button", class: "wl-pw-toggle", "aria-label": "Show password", "aria-pressed": "false" }, "Show");
    b.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-pressed", String(show));
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
    return b;
  }
  function formError(form, msg) {
    var box = form.querySelector(".wl-form-error");
    if (!box) { box = h("div", { class: "wl-form-error", role: "alert", tabindex: "-1" }); form.insertBefore(box, form.firstChild); }
    box.textContent = msg || "";
    box.hidden = !msg;
    if (msg) box.focus();
  }

  /* ---------- toasts ---------- */
  function toast(msg, kind) {
    var region = document.getElementById("wl-toasts");
    if (!region) {
      region = h("div", { id: "wl-toasts", class: "wl-toasts", role: "status", "aria-live": "polite" });
      document.body.appendChild(region);
    }
    var t = h("div", { class: "wl-toast" + (kind ? " wl-toast-" + kind : "") }, msg);
    region.appendChild(t);
    setTimeout(function () { t.classList.add("wl-out"); setTimeout(function () { t.remove(); }, 400); }, 3600);
  }

  /* ---------- cart (localStorage "wia_cart") ---------- */
  /* [bundles] item types: course, program, track (whole-track bundle), pass (All-Access) */
  var CART = "wia_cart";
  function cartGet() {
    try {
      var v = JSON.parse(localStorage.getItem(CART) || "[]");
      return Array.isArray(v) ? v.filter(function (i) { return i && (i.type === "course" || i.type === "program" || i.type === "track" || i.type === "pass") && typeof i.id === "string" && /^[a-z0-9-]{2,60}$/.test(i.id); }).slice(0, 12) : [];
    } catch (e) { return []; }
  }
  function cartSet(items) { try { localStorage.setItem(CART, JSON.stringify(items)); } catch (e) { /* blocked */ } updateCartBadge(); }
  function cartAdd(type, id) {
    var items = cartGet();
    if (!items.some(function (i) { return i.type === type && i.id === id; })) items.push({ type: type, id: id });
    cartSet(items);
  }
  function cartRemove(type, id) { cartSet(cartGet().filter(function (i) { return !(i.type === type && i.id === id); })); }
  function updateCartBadge() {
    var n = cartGet().length;
    Array.prototype.forEach.call(document.querySelectorAll("[data-cart-count]"), function (b) {
      b.textContent = n ? String(n) : "";
      b.hidden = !n;
    });
  }

  /* ---------- auth ---------- */
  function requireAuth() {
    if (API.signedIn()) return true;
    window.location.replace(signInUrl());
    return false;
  }
  window.addEventListener("wia:unauthorized", function () {
    if (document.querySelector("[data-public=\"1\"]")) return;
    if (window.location.pathname === "/learn/" || window.location.pathname === "/learn/index.html") {
      if (window.WLShowSignIn) window.WLShowSignIn("Your session has ended. Please sign in again.");
      return;
    }
    window.location.replace(signInUrl());
  });

  /* ---------- learner sub-nav ---------- */
  function markNav() {
    var path = window.location.pathname;
    Array.prototype.forEach.call(document.querySelectorAll(".wl-subnav a"), function (a) {
      var target = a.getAttribute("href");
      if (target === path || (target === "/learn/" && /^\/learn\/(course|lesson|exam|lab)\//.test(path))) a.setAttribute("aria-current", "page");
    });
    var signed = API.signedIn();
    Array.prototype.forEach.call(document.querySelectorAll("[data-when-signed-in]"), function (x) { x.hidden = !signed; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-when-signed-out]"), function (x) { x.hidden = signed; });
    updateCartBadge();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markNav); else markNav();

  function setTitle(t) { document.title = t + " · Wirewalk Institute of AI"; }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("copy failed")); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  /* ---------- Turnstile ----------
   * The page carries <div id="wl-turnstile-config" data-sitekey="{{ site.turnstile_sitekey }}">.
   * With a key, Cloudflare's widget is rendered. With no key on localhost an empty token is sent
   * (the Worker accepts that only when DEV=1). With no key anywhere else the form cannot succeed
   * (the Worker rejects an empty token), so the widget reports "unavailable" and callers block the
   * form with a clear message instead of failing with "the human check failed". */
  function isLocalHost() { var hn = window.location.hostname; return hn === "localhost" || hn === "127.0.0.1" || hn === "[::1]"; }
  var tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsLoading) return tsLoading;
    tsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.defer = true;
      s.onload = function () { resolve(window.turnstile); };
      s.onerror = function () { reject(new Error("turnstile")); };
      document.head.appendChild(s);
    });
    return tsLoading;
  }
  function turnstile() {
    var cfg = document.getElementById("wl-turnstile-config");
    var key = cfg ? (cfg.getAttribute("data-sitekey") || "").trim() : "";
    var unavailable = !key && !isLocalHost();
    var box = h("div", { class: "cf-turnstile wl-turnstile", "data-sitekey": key || null, "data-state": key ? "loading" : "unconfigured" });
    var widget = null;
    if (key) {
      loadTurnstile().then(function (ts) {
        widget = ts.render(box, { sitekey: key, theme: "auto", size: "flexible" });
        box.setAttribute("data-state", "ready");
      }, function () {
        box.setAttribute("data-state", "error");
        box.appendChild(h("p", { class: "wl-hint" }, "The security check could not load. Disable content blockers for this site and reload."));
      });
    }
    return {
      el: box,
      token: function () {
        if (!key) return "";
        try { return (window.turnstile && widget !== null && window.turnstile.getResponse(widget)) || ""; } catch (e) { return ""; }
      },
      required: !!key,
      unavailable: unavailable,
      reset: function () { try { if (window.turnstile && widget !== null) window.turnstile.reset(widget); } catch (e) { /* ignore */ } }
    };
  }

  /* ---------- email verification panel (dashboard + account) ---------- */
  function verifyPanel(learner, onVerified, compact) {
    var status = h("p", { class: "wl-hint", role: "status", "aria-live": "polite" });
    var codeId = "verify-code-" + Math.random().toString(36).slice(2, 6);
    var code = h("input", { id: codeId, name: "code", inputmode: "numeric", autocomplete: "one-time-code",
      pattern: "[0-9]{6}", maxlength: "6", required: true, class: "wl-code-input", "aria-describedby": codeId + "-h" });
    var confirmForm = h("form", { class: "wl-inline-form", hidden: true, novalidate: true },
      h("div", { class: "wl-field" },
        h("label", { for: codeId }, "6-digit code"),
        h("div", { class: "wl-inline" }, code, h("button", { class: "wl-btn", type: "submit" }, "Confirm")),
        h("p", { class: "wl-hint", id: codeId + "-h" }, "The code expires 15 minutes after it was sent.")));
    var sendBtn = btn("Send verification code", { class: "wl-btn-sm" });
    sendBtn.addEventListener("click", function () {
      busy(sendBtn, API.sendVerify(), "Sending…").then(function (r) {
        confirmForm.hidden = false;
        sendBtn.textContent = "Send a new code";
        status.textContent = (r && r.sent === false)
          ? ("We could not send the email" + (r.detail ? ": " + r.detail : "") + ". Try again in a few minutes.")
          : "We sent a code to " + learner.email + ". Check your inbox (and spam folder).";
        if (!(r && r.sent === false)) code.focus();
      }, function (e) { status.textContent = e.message; });
    });
    confirmForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = code.value.replace(/\D/g, "");
      if (v.length !== 6) { status.textContent = "Enter the 6-digit code from the email."; code.focus(); return; }
      var b = confirmForm.querySelector("button[type=submit]");
      busy(b, API.confirmVerify(v), "Checking…").then(function (r) {
        toast("Email verified. Thank you.", "ok");
        if (onVerified) onVerified(r.learner);
      }, function (e) { status.textContent = e.message; code.select(); });
    });
    return h("section", { class: "wl-verify" + (compact ? " wl-verify-compact" : ""), "aria-labelledby": codeId + "-t" },
      h("div", { class: "wl-verify-head" },
        h("h2", { id: codeId + "-t", class: "wl-h3" }, "Verify your email"),
        h("p", null, "Confirm ", h("strong", null, learner.email),
          " so we can send your certificates, and so any discount set up for you or your organization can apply at checkout.")),
      h("div", { class: "wl-actions" }, sendBtn), confirmForm, status);
  }

  /* [onboard] Dismissible "verify your email" banner for the course and lesson pages.
     learner = {email, emailVerified} from the page's API payload. A dismissal lasts 3 days in this browser. */
  var VERIFY_DISMISS = "wia_verify_dismissed";
  function verifyBanner(learner, onVerified) {
    if (!learner || learner.emailVerified || !learner.email) return null;
    try { var t = Number(localStorage.getItem(VERIFY_DISMISS)); if (t && Date.now() - t < 3 * 24 * 3600 * 1000) return null; } catch (e) { /* storage blocked */ }
    var box = h("div", { class: "wl-verify-banner" });
    var open = btn("Verify now", { class: "wl-btn-sm" });
    var dismiss = btn("Dismiss", { class: "wl-btn-sm wl-btn-ghost", "aria-label": "Dismiss the email verification reminder" });
    var row = notice("info", "Confirm your email address",
      "We sent a link and a code to " + learner.email + " when you signed up. Confirm it so we can send your certificate.", [open, dismiss]);
    box.appendChild(row);
    open.addEventListener("click", function () {
      var panel = verifyPanel(learner, function (L) { box.remove(); if (onVerified) onVerified(L); }, true);
      box.replaceChild(panel, row);
      var b = panel.querySelector("button"); if (b) b.focus();
    });
    dismiss.addEventListener("click", function () {
      try { localStorage.setItem(VERIFY_DISMISS, String(Date.now())); } catch (e) { /* storage blocked */ }
      box.remove();
    });
    return box;
  }

  /* [onboard] "Next in your path" after a pass: GET /api/courses/<id>/next (at most 3 open courses,
     or a waitlist for a track with nothing open yet). Prices come from GET /api/catalog through
     [data-price-for] (site.js), never from this route. One dismiss per course, kept in this browser.
     opts.onlyIfPassed: render nothing unless the signed-in learner holds this course's certificate. */
  var NEXT_DISMISS = "wia_next_dismissed";
  function nextDismissed(id) { try { return !!(JSON.parse(localStorage.getItem(NEXT_DISMISS) || "{}") || {})[id]; } catch (e) { return false; } }
  function dismissNext(id) {
    try { var m = JSON.parse(localStorage.getItem(NEXT_DISMISS) || "{}") || {}; m[id] = 1; localStorage.setItem(NEXT_DISMISS, JSON.stringify(m)); } catch (e) { /* storage blocked */ }
  }
  function nextPanel(courseId, opts) {
    opts = opts || {};
    var box = h("section", { class: "wl-section wl-next", "aria-labelledby": "h-next-" + courseId, hidden: true });
    if (!API.signedIn() || nextDismissed(courseId)) return box;
    API.request("GET", "/api/courses/" + encodeURIComponent(courseId) + "/next", undefined, { quiet401: true }).then(function (d) {
      if (opts.onlyIfPassed && !d.passed) return;
      var list = d.courses || [];
      if (!list.length && !d.waitlist) return;
      var dismiss = btn("Dismiss", { class: "wl-btn-sm wl-btn-ghost", "aria-label": "Dismiss next course suggestions" });
      dismiss.addEventListener("click", function () { dismissNext(courseId); box.remove(); });
      box.appendChild(h("div", { class: "wl-section-head" }, h("h2", { id: "h-next-" + courseId, class: "wl-h3" }, "Next in your path"), dismiss));
      if (list.length) box.appendChild(h("ul", { class: "wl-cards wl-next-cards", role: "list" }, list.map(function (c) {
        return h("li", { class: "wl-card wl-course-card" },
          h("div", { class: "wl-card-meta" }, h("span", { class: "wl-code" }, c.id), c.level ? h("span", null, levelLabel(c.level)) : null),
          h("h3", { class: "wl-card-title" }, h("a", { href: publicCourseUrl(c.id) }, c.title || courseTitle(c.id))),
          h("p", { class: "wl-hint" }, c.reason === "prerequisite" ? "Builds on this course" : c.reason === "track" ? "Same track: " + trackLabel(c.track) : "A good next step"),
          h("div", { class: "wl-card-foot" },
            h("span", { class: "price", "data-price-for": c.id, "data-kind": "course" }, h("span", { class: "fallback" }, "See the course page")),
            btn("Add to cart", { href: "/learn/cart/?add=course:" + encodeURIComponent(c.id), class: "wl-btn-sm" })));
      })));
      if (d.waitlist) box.appendChild(waitlistRow(d.waitlist));
      box.hidden = false;
      if (window.WIAPrices) window.WIAPrices.fill(box);
    }, function () { /* optional panel: stay hidden */ });
    return box;
  }
  function waitlistRow(w) {
    var status = h("p", { class: "wl-hint", role: "status" });
    var b = btn("Notify me when " + (trackLabel(w.track) || "this track") + " opens", { class: "wl-btn-sm wl-btn-ghost" });
    b.addEventListener("click", function () {
      busy(b, API.request("POST", "/api/waitlist", { courseId: w.courseId }), "Adding you…").then(function (r) {
        b.disabled = true;
        status.textContent = r && r.status === "check_email"
          ? "Check your inbox: press the link we sent to confirm, and we will email you once, when " + w.title + " opens."
          : "Done. We will email you once, when " + w.title + " opens.";
      }, function (e) { status.textContent = e.message; });
    });
    return h("div", { class: "wl-next-wait" }, h("p", null, "More " + (trackLabel(w.track) || "") + " courses are on the way, starting with ", h("strong", null, w.title), "."), b, status);
  }

  function ss(key, val) {
    try {
      if (val === undefined) return JSON.parse(sessionStorage.getItem(key) || "null");
      if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  window.WL = {
    h: h, append: append, clear: clear, mount: mount, $: $,
    param: param, safeNext: safeNext, here: here, signInUrl: signInUrl, hasAccount: hasAccount, markHasAccount: markHasAccount,
    courseUrl: courseUrl, lessonUrl: lessonUrl, examUrl: examUrl, certUrl: certUrl, publicCourseUrl: publicCourseUrl,
    catalog: catalog, courseTitle: courseTitle, programTitle: programTitle, levelLabel: levelLabel, trackLabel: trackLabel,
    money: money, fmtDate: fmtDate, fmtDateUTC: fmtDateUTC, courseStatus: courseStatus, isLocalHost: isLocalHost, fmtDateTime: fmtDateTime, toDate: toDate, plural: plural, pct: pct,
    progressBar: progressBar, chip: chip, examSummary: examSummary, reasonDetail: reasonDetail,
    spinner: spinner, loading: loading, notice: notice, errorView: errorView, btn: btn, busy: busy,
    field: field, formError: formError, toast: toast,
    cart: { get: cartGet, set: cartSet, add: cartAdd, remove: cartRemove, badge: updateCartBadge },
    requireAuth: requireAuth, setTitle: setTitle, copyText: copyText, ss: ss, turnstile: turnstile, verifyPanel: verifyPanel,
    verifyBanner: verifyBanner, nextPanel: nextPanel   // [onboard]
  };
})();
