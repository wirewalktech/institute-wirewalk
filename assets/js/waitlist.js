/* Waitlist: "Notify me when it opens" (learning Worker /api/waitlist; see
   wirewalk-institute-worker src/features/waitlist.js). Three uses, picked by what is on the page:

   1. Course page, [data-wl-notify="<course id>"] (_layouts/course.html):
      signed in  -> one button, POST /api/waitlist {courseId} with the learner's token;
      anonymous  -> email + Turnstile, POST /api/waitlist {courseId, email, turnstile}; we then
                    email a confirmation link (double opt-in).
      The block replaces the older enquiry form only once it is ready; if the API is not
      configured or unreachable, the enquiry form stays, exactly as before.
   2. /waitlist/confirm/?t=  [data-wl-confirm]: confirm on an explicit click (POST /api/waitlist/confirm).
   3. /waitlist/leave/?t=    [data-wl-leave]:   leave on an explicit click (POST /api/waitlist/leave).
   Opening a link never changes anything by itself, so mail scanners cannot confirm or remove.
   All text is set with textContent (no innerHTML). */
(function () {
  "use strict";
  var api = ((window.WIA && window.WIA.api) || "").replace(/\/+$/, "");
  if (!api) return;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function token() { try { return localStorage.getItem("wia_token") || ""; } catch (e) { return ""; } }
  function isLocal() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }
  function call(method, path, body, auth) {
    var headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = "Bearer " + auth;
    return fetch(api + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || ("status " + r.status)); e.status = r.status; e.reason = d.reason; throw e; }
          return d;
        });
      });
  }

  /* ------------------------------------------------------ course page */
  var box = document.querySelector("[data-wl-notify]");
  if (box) {
    /* Only once the course's waitlist block is showing (site.js may switch it from the live status). */
    var holder = box.closest("[data-show-when]");
    if (!holder || !holder.hidden) coursePage(box);
    else if (window.MutationObserver) {
      var mo = new MutationObserver(function () { if (!holder.hidden) { mo.disconnect(); coursePage(box); } });
      mo.observe(holder, { attributes: true, attributeFilter: ["hidden"] });
    }
  }

  function coursePage(box) {
    var courseId = box.getAttribute("data-wl-notify");
    var title = box.getAttribute("data-title") || courseId;
    var legacy = box.parentNode ? box.parentNode.querySelector("form.wl-form") : null;
    var status = el("p", { class: "wl-note", role: "status", "aria-live": "polite" });
    function ready() { if (legacy) legacy.hidden = true; box.hidden = false; }
    function fallBack(msg) {
      /* Our API is not available: put the enquiry form back and say why. */
      if (legacy) legacy.hidden = false;
      if (msg) { status.textContent = msg; if (!status.parentNode) box.appendChild(status); box.hidden = false; }
      else box.hidden = true;
    }
    function done(text) {
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el("p", { class: "wl-note", role: "status" }, text));
    }

    var t = token();
    if (t) {
      call("GET", "/api/waitlist/mine", undefined, t).then(function (d) {
        if (!d.available) return fallBack(null);
        var on = (d.entries || []).some(function (x) { return x.courseId === courseId; });
        if (on) { done("You are on the list. We will email your account address once, when " + title + " opens."); ready(); return; }
        signedIn(t);
      }, function (e) {
        if (e.status === 401) anonymous(); else fallBack(null);
      });
    } else anonymous();

    function signedIn(t) {
      var btn = el("button", { class: "btn", type: "button" }, "Notify me when it opens");
      box.appendChild(btn);
      box.appendChild(el("p", { class: "wl-note" }, "One click: we email your account address once, when it opens. No payment is taken."));
      box.appendChild(status);
      ready();
      btn.addEventListener("click", function () {
        btn.disabled = true; status.textContent = "Adding you…";
        call("POST", "/api/waitlist", { courseId: courseId }, t).then(function (d) {
          /* [review-fixes] An account whose email is not verified yet confirms by email first. */
          if (d && d.status === "check_email") { done("Check your inbox: we sent a link to your account address. Press it to confirm, and we will email you once, when " + title + " opens."); return; }
          done("Done. We will email your account address once, when " + title + " opens.");
        }, function (e) {
          btn.disabled = false;
          if (e.status === 401) { status.textContent = "Your session has ended. Sign in again, or use the form below."; fallBack(null); return; }
          if (e.status === 409) { status.textContent = "This course is open now. Reload the page to enroll."; return; }
          if (e.status === 503) { fallBack("Verify your email address first (see your dashboard), then try again, or use the enquiry form."); return; }
          status.textContent = e.message || "That did not work. Please try again.";
        });
      });
    }

    function anonymous() {
      var key = (box.getAttribute("data-sitekey") || "").trim();
      if (!key && !isLocal()) return fallBack(null);          // Turnstile not configured: keep the enquiry form
      var id = "wl-n-email-" + courseId;
      var form = el("form", { novalidate: "", "aria-label": "Get an email when " + title + " opens" });
      form.appendChild(el("label", { for: id }, "Your email"));
      var input = el("input", { type: "email", id: id, name: "email", required: "", autocomplete: "email", maxlength: "254", placeholder: "you@example.com" });
      var btn = el("button", { class: "btn", type: "submit" }, "Notify me when it opens");
      var row = el("div", { class: "wl-row" }); row.appendChild(input);
      form.appendChild(row);
      var ts = el("div", { class: "cf-turnstile" });
      form.appendChild(ts);
      row.appendChild(btn);
      form.appendChild(el("p", { class: "wl-note" }, "We send one email to confirm, then one when it opens. No payment is taken. Already have an account? Sign in for one-click sign-up."));
      form.appendChild(status);
      box.appendChild(form);
      ready();

      var widget = null;
      if (key) loadTurnstile().then(function (T) {
        widget = T.render(ts, { sitekey: key, theme: "auto", size: "flexible" });
      }, function () { fallBack("The security check could not load, so please use the form above instead."); });

      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var email = input.value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status.textContent = "Enter a valid email address."; input.focus(); return; }
        var tok = "";
        if (key) {
          try { tok = (window.turnstile && widget !== null && window.turnstile.getResponse(widget)) || ""; } catch (e) { tok = ""; }
          if (!tok) { status.textContent = "Please complete the security check first."; return; }
        }
        btn.disabled = true; status.textContent = "Sending…";
        call("POST", "/api/waitlist", { courseId: courseId, email: email, turnstile: tok }).then(function () {
          done("Check your inbox: we sent a confirmation link to " + email + ". You are on the list once you click it.");
        }, function (e) {
          btn.disabled = false;
          try { if (window.turnstile && widget !== null) window.turnstile.reset(widget); } catch (x) { /* ignore */ }
          if (e.status === 503 || !e.status) { fallBack("Email sign-up is not available right now, so please use the form above instead."); return; }
          if (e.status === 409) { status.textContent = "This course is open now. Reload the page to enroll."; return; }
          status.textContent = e.message || "That did not work. Please try again.";
        });
      });
    }
  }

  var tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsLoading) return tsLoading;
    tsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = function () { window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")); };
      s.onerror = function () { reject(new Error("turnstile")); };
      document.head.appendChild(s);
    });
    return tsLoading;
  }

  /* ------------------------------------------ confirm / leave pages */
  var page = document.querySelector("[data-wl-confirm], [data-wl-leave]");
  if (page) linkPage(page, page.hasAttribute("data-wl-confirm") ? "confirm" : "leave");

  function takeParam(name) {
    /* [review-fixes] Tokens arrive in the URL fragment (never sent to a server, a Referer or a
       pixel); older links used the query. Either way it is removed from the address bar at once. */
    var v = "";
    try { v = new URLSearchParams((location.hash || "").replace(/^#/, "")).get(name) || ""; } catch (e) { v = ""; }
    if (!v) { try { v = new URLSearchParams(location.search).get(name) || ""; } catch (e) { v = ""; } }
    if (v) { try { history.replaceState(history.state, "", location.pathname); } catch (e) { /* ignore */ } }
    return v;
  }

  function linkPage(root, action) {
    var out = root.querySelector("[data-wl-result]"), btn = root.querySelector("[data-wl-go]");
    if (!out || !btn) return;
    var t = "";
    t = takeParam("t");
    function show(kind, head, text, focus) {
      while (out.firstChild) out.removeChild(out.firstChild);
      out.className = "result" + (kind ? " " + kind : "");
      out.appendChild(el("h2", null, head));
      if (text) out.appendChild(el("p", { class: "muted" }, text));
      out.hidden = false;
      if (focus) out.focus();
    }
    var HELP = "If this keeps happening, email sales@wirewalk.com and we will sort it out by hand.";
    if (!t) { show("bad", "This link is incomplete", "Open the link from our email in full. " + HELP); return; }
    btn.hidden = false;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      call("POST", "/api/waitlist/" + action, { t: t }).then(function (d) {
        btn.hidden = true;
        if (action === "confirm") show("good", "You are on the list", "We will email you once, when " + (d.title || "the course") + " opens. That email also deletes the address we keep for it.", true);
        else show("good", "You have left the waitlist", "We have deleted this sign-up and will not email you about it.", true);
      }, function (e) {
        btn.disabled = false;
        if (e.status === 410) show("bad", e.reason === "expired" ? "This link has expired" : "This sign-up is no longer on the list", "Sign up again from the course page. " + HELP, true);
        else if (e.status === 400) show("bad", "This link is not valid", "Use the whole link from our email. " + HELP, true);
        else show("bad", "We could not reach the server", "Please try again in a minute. " + HELP, true);
      });
    });
  }
})();
