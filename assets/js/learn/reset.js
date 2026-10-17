/* /learn/reset/ : request a reset code, then confirm it with a new password.
 *
 * Two ways in (WIA-011):
 *  - by email: "Email me a code" sends a 6-digit code that expires in 15 minutes;
 *  - by a support reset link: /learn/reset/?email=<email>#code=<6 digits>, made by an
 *    operator in the admin console when email cannot be delivered. That code lasts
 *    24 hours. The page reads it from the fragment (never sent to any server), removes
 *    the fragment from the address bar and history at once, and opens the
 *    new-password step pre-filled. It never calls reset/send for a link, and it never
 *    submits on its own: the learner still chooses the password and presses the button.
 */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  function F(form, n) { return form.querySelector('[name="' + n + '"]'); }
  var emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var EMAIL_CODE_MINUTES = 15, LINK_CODE_HOURS = 24;   // server: auth.js CODE_MINUTES, admin.js RESET_LINK_HOURS

  /* Capture the support-link code as soon as this script runs, then clear it from the
   * URL so it is not left in history, bookmarks or a copied address. A fragment that
   * mentions a code but is not exactly six digits is cleared too and reported as bad. */
  var linkCode = (function () {
    var hash = "";
    try { hash = window.location.hash || ""; } catch (e) { return null; }
    if (!/(^#|&)code=/.test(hash)) return null;
    try { history.replaceState(history.state, "", window.location.pathname + window.location.search); }
    catch (e) { try { window.location.hash = ""; } catch (e2) {} }
    var m = /^#code=(\d{6})$/.exec(hash);
    return m ? m[1] : "bad";
  })();

  function shell(step, content) {
    return h("div", { class: "wl-narrow wl-narrower" },
      h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, "Step " + step + " of 2"),
        h("h1", { class: "wl-display" }, step === 1 ? "Reset your password" : "Choose a new password")), content,
      h("p", { class: "wl-small" }, h("a", { href: "/learn/" }, "Back to sign in")));
  }

  function requestStep(prefill, badLink) {
    W.setTitle("Reset your password");
    var ts = W.turnstile();
    var form = h("form", { class: "wl-form wl-card-plain", novalidate: true, "aria-label": "Request a reset code" },
      badLink ? W.notice("error", "This reset link is not complete",
        "The link is missing its 6-digit code or was changed. Ask Wirewalk support for a new link, or request a code by email below.") : null,
      h("p", null, "Enter the email address on your account. We will email you a 6-digit code that expires in " + EMAIL_CODE_MINUTES + " minutes."),
      W.field({ label: "Email", type: "email", name: "email", autocomplete: "email", required: true, value: prefill || "", autocapitalize: "off", spellcheck: "false" }),
      ts.el,
      ts.unavailable ? W.notice("warn", "Password reset is temporarily unavailable",
        "Reset codes cannot be sent right now. Please try again later, or contact sales@wirewalk.com for help.") : null,
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn", disabled: ts.unavailable }, "Email me a code")),
      h("p", { class: "wl-small" }, "Already have a code? ", h("a", { href: "#", "data-have": "1" }, "Enter it")));
    form.querySelector("[data-have]").addEventListener("click", function (e) { e.preventDefault(); confirmStep(F(form, "email").value.trim(), "manual"); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = F(form, "email").value.trim();
      if (!emailRe.test(email)) { W.formError(form, "Enter a valid email address."); F(form, "email").focus(); return; }
      if (ts.unavailable) { W.formError(form, "Password reset is temporarily unavailable. Please try again later."); return; }
      var t = ts.token();
      if (ts.required && !t) { W.formError(form, "Please complete the security check."); return; }
      W.formError(form, "");
      W.busy(form.querySelector("[type=submit]"), API.resetSend({ email: email, turnstile: t }), "Sending…")
        .then(function () { confirmStep(email, "sent"); }, function (err) { ts.reset(); W.formError(form, err.message); });
    });
    W.mount(shell(1, form));
  }

  /* how: "sent" (we just emailed a code), "link" (support reset link, code pre-filled)
   *  or "manual" (the learner already has a code from either source). */
  function confirmStep(email, how, code) {
    W.setTitle("Choose a new password");
    var link = how === "link";
    var form = h("form", { class: "wl-form wl-card-plain", novalidate: true, "aria-label": "Set a new password" },
      how === "sent" ? W.notice("info", "Check your email", "If an account exists for " + email + ", we have sent it a 6-digit code. It expires in " + EMAIL_CODE_MINUTES + " minutes.") : null,
      link ? W.notice("info", "Reset link from Wirewalk support",
        "Your reset code is filled in below. A support reset link works once, for " + LINK_CODE_HOURS + " hours after support created it. Choose a new password to finish.") : null,
      W.field({ label: "Email", type: "email", name: "email", autocomplete: "email", required: true, value: email || "", autocapitalize: "off", spellcheck: "false" }),
      W.field({ label: "6-digit code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", required: true, maxlength: "6", pattern: "[0-9]{6}", value: code || "",
        hint: link ? "From your support reset link." : how === "sent" ? null
          : "From your reset email (valid " + EMAIL_CODE_MINUTES + " minutes) or a support reset link (valid " + LINK_CODE_HOURS + " hours)." }),
      W.field({ label: "New password", type: "password", name: "password", autocomplete: "new-password", required: true, minlength: "10", maxlength: "200", passwordToggle: true,
        hint: "At least 10 characters. Resetting signs you out on your other devices." }),
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn" }, "Set new password and sign in")),
      link ? h("p", { class: "wl-small" }, "Link not working? ", h("a", { href: "#", "data-again": "1" }, "Get a code by email instead"),
               " (this replaces the code in your link).")
        : h("p", { class: "wl-small" }, "No code? ", h("a", { href: "#", "data-again": "1" }, "Send a new one")));
    form.querySelector("[data-again]").addEventListener("click", function (e) { e.preventDefault(); requestStep(F(form, "email").value.trim()); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var em = F(form, "email").value.trim(), code = F(form, "code").value.replace(/\D/g, ""), pw = F(form, "password").value;
      if (!emailRe.test(em)) { W.formError(form, "Enter a valid email address."); F(form, "email").focus(); return; }
      if (code.length !== 6) { W.formError(form, link ? "Enter the 6-digit code from your reset link." : "Enter the 6-digit code from the email."); F(form, "code").focus(); return; }
      if (pw.length < 10) { W.formError(form, "Use a password of at least 10 characters."); F(form, "password").focus(); return; }
      if (pw.length > 200) { W.formError(form, "That password is too long (200 characters at most)."); F(form, "password").focus(); return; }
      W.formError(form, "");
      W.busy(form.querySelector("[type=submit]"), API.resetConfirm({ email: em, code: code, password: pw }), "Saving…").then(function (r) {
        API.token.set(r.token);
        W.toast("Password changed. You are signed in.", "ok");
        setTimeout(function () { window.location.assign("/learn/"); }, 700);
      }, function (err) { W.formError(form, err.message); });
    });
    W.mount(shell(2, form));
    var first = link ? F(form, emailRe.test(email || "") ? "password" : "email")
      : how === "sent" ? F(form, "code") : F(form, email ? "code" : "email");
    if (first) first.focus();
  }

  function boot() {
    var email = (W.param("email") || "").trim();
    if (linkCode && linkCode !== "bad") confirmStep(email, "link", linkCode);
    else requestStep(email, linkCode === "bad");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
