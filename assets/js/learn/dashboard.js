/* /learn/ : sign in / create account, then the learner dashboard. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;

  function F(form, n) { return form.querySelector("[name=\"" + n + "\"]"); }

  /* Campaign attribution saved by /assets/js/campaign.js (localStorage "wia_attrib", 30 days).
     Sent with sign-up as an optional, whitelisted object; null when there is none. An expired or
     unreadable record is deleted here, and the record is deleted once an account is created, so a
     second person signing up in the same browser does not inherit the first person's campaign. */
  var ATTR_KEY = "wia_attrib", ATTR_KEYS = ["source", "medium", "campaign", "content", "term", "rdt_cid", "landing"];
  function dropAttribution() { try { localStorage.removeItem(ATTR_KEY); } catch (e) { /* storage blocked */ } }
  function storedAttribution() {
    var raw;
    try { raw = localStorage.getItem(ATTR_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var r = JSON.parse(raw), t = r && r.last;
      if (!t || typeof t.at !== "number" || Date.now() - t.at > 30 * 24 * 3600 * 1000) { dropAttribution(); return null; }
      var out = {}, any = false;
      ATTR_KEYS.forEach(function (k) { if (typeof t[k] === "string" && t[k]) { out[k] = t[k].slice(0, 100); any = true; } });
      return any ? out : null;
    } catch (e) { dropAttribution(); return null; }
  }
  function nextTarget() { return W.safeNext(W.param("next")); }

  function afterAuth(res) {
    API.token.set(res.token);
    var n = nextTarget();
    if (n && n !== "/learn/" && n.indexOf("/learn/?") !== 0) { window.location.assign(n); return; }
    if (n || W.param("next") !== null) history.replaceState(null, "", "/learn/");
    W.toast(res.learner && res.learner.name ? "Welcome, " + res.learner.name.split(" ")[0] + "." : "Signed in.", "ok");
    document.querySelectorAll("[data-when-signed-in]").forEach(function (x) { x.hidden = false; });
    loadDashboard();
  }

  /* ------------------------------------------------------------ sign in / sign up */
  function authView(mode, message) {
    W.setTitle(mode === "signup" ? "Create your account" : "Sign in");
    var signinTab = h("button", { type: "button", role: "tab", id: "tab-signin", "aria-controls": "panel-auth", class: "wl-tab" }, "Sign in");
    var signupTab = h("button", { type: "button", role: "tab", id: "tab-signup", "aria-controls": "panel-auth", class: "wl-tab" }, "Create account");
    var panel = h("div", { id: "panel-auth", role: "tabpanel" });
    var tabs = h("div", { class: "wl-tabs", role: "tablist", "aria-label": "Sign in or create an account" }, signinTab, signupTab);

    function select(m) {
      mode = m;
      [signinTab, signupTab].forEach(function (t) {
        var on = (t === signinTab) === (m === "signin");
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute("aria-labelledby", m === "signin" ? "tab-signin" : "tab-signup");
      W.clear(panel).appendChild(m === "signin" ? signinForm() : signupForm());
      W.setTitle(m === "signup" ? "Create your account" : "Sign in");
    }
    signinTab.addEventListener("click", function () { select("signin"); });
    signupTab.addEventListener("click", function () { select("signup"); });
    tabs.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        var to = mode === "signin" ? signupTab : signinTab;
        select(mode === "signin" ? "signup" : "signin");
        to.focus();
      }
    });

    var hasCart = W.cart.get().length > 0;
    var aside = h("aside", { class: "wl-auth-aside", "aria-label": "About your account" },
      h("p", { class: "wl-eyebrow" }, "Wirewalk Institute of AI"),
      h("h1", { class: "wl-display" }, "Your learning, in one place."),
      h("ul", { class: "wl-ticks" },
        h("li", null, "Read every lesson at your own pace; progress is saved to your account."),
        h("li", null, "Take the online exam when you have completed the lessons."),
        h("li", null, "Pass to receive a verifiable certificate of completion and assessment.")),
      hasCart ? W.notice("info", "Your cart is waiting", "Sign in or create an account to see your personal price and check out.",
        [W.btn("View cart", { href: "/learn/cart/", class: "wl-btn-ghost wl-btn-sm" })]) : null);

    var card = h("div", { class: "wl-auth-card" },
      message ? W.notice("info", null, message) : null,
      tabs, panel);
    W.mount(h("div", { class: "wl-auth" }, aside, card));
    select(mode || "signin");
  }
  window.WLShowSignIn = function (msg) { authView("signin", msg); };

  function signinForm() {
    var form = h("form", { class: "wl-form", novalidate: true, "aria-label": "Sign in" },
      W.field({ label: "Email", type: "email", name: "email", autocomplete: "email", required: true, autocapitalize: "off", spellcheck: "false" }),
      W.field({ label: "Password", type: "password", name: "password", autocomplete: "current-password", required: true, passwordToggle: true }),
      h("div", { class: "wl-form-row" },
        h("button", { class: "wl-btn wl-btn-block", type: "submit" }, "Sign in")),
      h("p", { class: "wl-small" }, h("a", { href: "/learn/reset/" }, "Forgot your password?")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = F(form, "email").value.trim(), password = F(form, "password").value;
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { W.formError(form, "Enter the email address you registered with."); F(form, "email").focus(); return; }
      if (!password) { W.formError(form, "Enter your password."); F(form, "password").focus(); return; }
      W.formError(form, "");
      W.busy(form.querySelector("[type=submit]"), API.login({ email: email, password: password }), "Signing in…")
        .then(afterAuth, function (err) {
          W.formError(form, err.status === 401 ? "That email and password do not match an account." : err.message);
        });
    });
    return form;
  }

  function signupForm() {
    var ts = W.turnstile();
    var pwHint = "At least 10 characters. A short phrase of unrelated words works well.";
    var form = h("form", { class: "wl-form", novalidate: true, "aria-label": "Create account" },
      W.field({ label: "Full name", name: "name", autocomplete: "name", required: true, maxlength: "120",
        hint: "Printed on your certificates exactly as typed." }),
      W.field({ label: "Email", type: "email", name: "email", autocomplete: "email", required: true, autocapitalize: "off", spellcheck: "false" }),
      W.field({ label: "Organization", name: "organization", autocomplete: "organization", optional: true, maxlength: "160" }),
      W.field({ label: "Password", type: "password", name: "password", autocomplete: "new-password", required: true, minlength: "10", maxlength: "200", passwordToggle: true, hint: pwHint }),
      h("div", { class: "wl-pwmeter", "aria-hidden": "true" }, h("span")),
      /* Marketing consent: unticked by default, optional, and never required to sign up. */
      h("div", { class: "wl-ack" },
        h("input", { type: "checkbox", id: "f-marketing", name: "marketingOptIn" }),
        h("label", { for: "f-marketing" }, "Email me about new courses and offers. Optional; you can unsubscribe at any time.")),
      ts.el,
      ts.unavailable ? W.notice("warn", "Sign-up is temporarily unavailable",
        "New accounts cannot be created right now. Please try again later, or contact sales@wirewalk.com and we will set up your account.") : null,
      h("div", { class: "wl-form-row" }, h("button", { class: "wl-btn wl-btn-block", type: "submit", disabled: ts.unavailable }, "Create account")),
      h("p", { class: "wl-small wl-muted" }, "By creating an account you agree to the ",
        h("a", { href: "/terms/" }, "terms"), " and ", h("a", { href: "/privacy/" }, "privacy policy"), "."));
    var meter = form.querySelector(".wl-pwmeter span");
    var hintEl = form.querySelector("#" + F(form, "password").id + "-hint");
    F(form, "password").addEventListener("input", function () {
      var n = F(form, "password").value.length;
      meter.style.width = Math.min(100, n * 6.25) + "%";
      meter.className = n === 0 ? "" : n < 10 ? "wl-weak" : n < 16 ? "wl-ok" : "wl-strong";
      hintEl.textContent = n === 0 ? pwHint : n < 10 ? (10 - n) + " more character" + (10 - n === 1 ? "" : "s") + " needed." : "Length looks good.";
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = F(form, "name").value.trim(), email = F(form, "email").value.trim(), org = F(form, "organization").value.trim(), pw = F(form, "password").value;
      if (!name) { W.formError(form, "Enter your name as it should appear on certificates."); F(form, "name").focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { W.formError(form, "Enter a valid email address."); F(form, "email").focus(); return; }
      if (pw.length < 10) { W.formError(form, "Use a password of at least 10 characters."); F(form, "password").focus(); return; }
      if (pw.length > 200) { W.formError(form, "That password is too long (200 characters at most)."); F(form, "password").focus(); return; }
      if (ts.unavailable) { W.formError(form, "Sign-up is temporarily unavailable. Please try again later."); return; }
      var token = ts.token();
      if (ts.required && !token) { W.formError(form, "Please complete the security check."); return; }
      W.formError(form, "");
      var body = { email: email, password: pw, name: name, turnstile: token };
      if (org) body.organization = org;
      if (F(form, "marketingOptIn").checked) body.marketingOptIn = true;
      if (window.WIAConsent && window.WIAConsent.state() === "accepted") body.adsConsent = true;   // [marketing] cookie-banner choice, stored on the account
      var attribution = storedAttribution();
      if (attribution) body.attribution = attribution;
      W.busy(form.querySelector("[type=submit]"), API.signup(body), "Creating account…")
        .then(function (res) {
          dropAttribution();
          if (window.WIAConsent && res.learner) window.WIAConsent.track("SignUp", { conversionId: res.learner.id });   // [marketing] Reddit Pixel, only after Accept; id only, no PII
          afterAuth(res);
        }, function (err) {
          ts.reset();
          W.formError(form, err.status === 409 ? "An account with this email already exists. Sign in instead, or reset your password." : err.message);
        });
    });
    return form;
  }

  /* ------------------------------------------------------------ dashboard */
  function loadDashboard() {
    W.loading("Loading your courses…");
    API.me().then(render, function (err) {
      if (err.status === 401) return authView("signin", "Your session has ended. Please sign in again.");
      W.mount(W.errorView(err, loadDashboard));
    });
  }

  function render(me) {
    var L = me.learner || {};
    W.setTitle("My learning");
    var first = (L.name || "").split(" ")[0];
    var enr = (me.enrollments || []).slice();
    var certs = me.certificates || [];
    var purchases = me.purchases || [];

    var head = h("header", { class: "wl-pagehead" },
      h("p", { class: "wl-eyebrow" }, "My learning"),
      h("h1", { class: "wl-display" }, first ? "Welcome back, " + first + "." : "Welcome back."),
      h("p", { class: "wl-lead" }, enr.length
        ? W.plural(enr.length, "course") + " · " + W.plural(certs.length, "certificate")
        : "You are not enrolled in a course yet."));

    var blocks = [head];
    if (!L.emailVerified) blocks.push(W.verifyPanel(L, function () { loadDashboard(); }));

    var cart = W.cart.get();
    if (cart.length) blocks.push(W.notice("info", "You have " + W.plural(cart.length, "item") + " in your cart", null,
      [W.btn("Review and check out", { href: "/learn/cart/", class: "wl-btn-sm" })]));

    // Courses: in progress first, then not started, then passed.
    function rank(e) { if (e.exam && e.exam.passed) return 2; return (e.progress && e.progress.done) ? 0 : 1; }
    enr.sort(function (a, b) { return rank(a) - rank(b) || String(b.grantedAt || "").localeCompare(String(a.grantedAt || "")); });

    var courses = h("section", { class: "wl-section", "aria-labelledby": "h-courses" },
      h("div", { class: "wl-section-head" }, h("h2", { id: "h-courses" }, "Your courses"),
        h("a", { class: "wl-link", href: "/courses/" }, "Browse the catalog")));
    if (!enr.length) {
      courses.appendChild(h("div", { class: "wl-empty" },
        h("p", null, "When you buy a course or program, or your organization enrolls you, it appears here."),
        W.btn("Browse courses", { href: "/courses/" })));
    } else {
      courses.appendChild(h("ul", { class: "wl-cards", role: "list" }, enr.map(courseCard)));
    }
    blocks.push(courses);

    blocks.push(h("div", { class: "wl-two" }, certSection(certs), purchaseSection(purchases)));
    W.mount(h("div", { class: "wl-dash" }, blocks));
  }

  function courseCard(e) {
    var p = e.progress || { done: 0, total: 0 };
    var ex = W.examSummary(e.exam, p);
    var started = p.done > 0;
    var action;
    if (e.certificate && !e.certificate.expired) action = W.btn("View certificate", { href: W.certUrl(e.certificate.id), class: "wl-btn-ghost wl-btn-sm" });   // [freshness] expired: offer renewal
    else if (e.exam && (e.exam.eligible || e.exam.openAttempt)) action = W.btn(e.exam.openAttempt ? "Resume exam" : e.exam.recertification ? "Renew certificate" : "Take the exam", { href: W.examUrl(e.courseId), class: "wl-btn-sm" });
    else action = W.btn(started ? "Continue" : "Start course", { href: W.courseUrl(e.courseId), class: "wl-btn-sm" });
    var title = e.title || W.courseTitle(e.courseId);
    return h("li", { class: "wl-card wl-course-card" + (e.exam && e.exam.passed ? " is-passed" : "") },
      h("div", { class: "wl-card-meta" },
        h("span", { class: "wl-code" }, e.courseId),
        e.level ? h("span", null, W.levelLabel(e.level)) : null),
      h("h3", { class: "wl-card-title" }, h("a", { href: W.courseUrl(e.courseId) }, title)),
      W.progressBar(p.done, p.total, "Progress in " + title),
      h("div", { class: "wl-card-foot" }, W.chip(ex.text, ex.kind), action),
      e.source === "comp" ? h("p", { class: "wl-hint" }, "Enrolled by the Institute") : e.source === "free" ? h("p", { class: "wl-hint" }, "Free course") : null);
  }

  function certSection(certs) {
    var s = h("section", { class: "wl-section", "aria-labelledby": "h-certs" }, h("h2", { id: "h-certs" }, "Certificates"));
    if (!certs.length) {
      s.appendChild(h("p", { class: "wl-muted" }, "Pass a course exam to earn a certificate of completion and assessment. Each certificate has a public verification page."));
      return s;
    }
    s.appendChild(h("ul", { class: "wl-list", role: "list" }, certs.map(function (c) {
      return h("li", { class: "wl-list-row" },
        h("span", { class: "wl-cert-ico", "aria-hidden": "true" }),
        h("div", { class: "wl-grow" },
          h("a", { href: W.certUrl(c.id), class: "wl-strong-link" }, c.title),
          h("div", { class: "wl-hint" }, (c.kind === "program" ? "Program certificate" : "Course certificate") + " · " + W.fmtDateUTC(c.issuedAt) +
            (c.scorePct != null ? " · " + c.scorePct + "%" : "") +
            (c.validUntil ? " · " + (c.expired ? "Expired " : "Valid until ") + W.fmtDateUTC(c.validUntil) : "") + " · ",   // [freshness]
            h("span", { class: "wl-mono" }, c.id))));
    })));
    return s;
  }

  function purchaseSection(list) {
    var s = h("section", { class: "wl-section", "aria-labelledby": "h-purchases" }, h("h2", { id: "h-purchases" }, "Purchases"));
    if (!list.length) { s.appendChild(h("p", { class: "wl-muted" }, "No purchases yet.")); return s; }
    var labels = { paid: ["Paid", "ok"], created: ["Awaiting payment", "warn"], failed: ["Failed", "bad"], expired: ["Not completed", ""], refunded: ["Refunded", ""] };
    var DAY = 24 * 3600 * 1000;
    /* A checkout that was opened but never paid stays "created"; after a day it is
       an abandoned checkout, not a payment the learner still owes. */
    function stale(p) { var d = W.toDate(p.createdAt); return p.status === "created" && (!d || Date.now() - d.getTime() > DAY); }
    s.appendChild(h("ul", { class: "wl-list", role: "list" }, list.map(function (p) {
      var st = stale(p) ? ["Not completed", ""] : (labels[p.status] || [p.status, ""]);
      var items = (p.items || []).map(function (i) {
        if (typeof i === "string") { var parts = i.split(":"); return parts[0] === "program" ? W.programTitle(parts[1]) : W.courseTitle(parts[1] || parts[0]); }
        return i.title || (i.type === "program" ? W.programTitle(i.id) : W.courseTitle(i.id));
      });
      return h("li", { class: "wl-list-row" },
        h("div", { class: "wl-grow" },
          h("div", { class: "wl-strong" }, items.join(", ") || p.id),
          h("div", { class: "wl-hint" }, W.fmtDate(p.createdAt), " · ", h("span", { class: "wl-mono" }, p.id))),
        h("div", { class: "wl-right" },
          h("div", { class: "wl-strong" }, p.totalFormatted || W.money(p.total)),
          W.chip(st[0], st[1])));
    })));
    return s;
  }

  /* ------------------------------------------------------------ boot */
  function boot() {
    var mode = W.param("mode"), next = W.param("next") || "";
    var toFreeCourse = /[?&]enroll=free/.test(next);
    if (API.signedIn()) {
      /* Already signed in and on the way to a free course (a /go/ "Start free" link): go and enrol. */
      var n = nextTarget();
      if (toFreeCourse && n && n.indexOf("/courses/") === 0) { window.location.replace(n); return; }
      loadDashboard();
    } else {
      /* A visitor on the way to a free course, from a /go/ page (mode=signup) or any campaign link,
         is almost always new: open on "Create account" (the Sign in tab is one click away). */
      var fromCampaign = toFreeCourse && (mode === "signup" || (!mode && storedAttribution()));
      if (fromCampaign) authView("signup", "Create a free account to start the course. Already have one? Use Sign in.");
      else authView(mode === "signup" ? "signup" : "signin", next ? "Sign in to continue." : null);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
