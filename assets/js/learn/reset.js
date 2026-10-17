/* /learn/reset/ : request a reset code, then confirm it with a new password. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  function F(form, n) { return form.querySelector('[name="' + n + '"]'); }
  var emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function shell(step, content) {
    return h("div", { class: "wl-narrow wl-narrower" },
      h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, "Step " + step + " of 2"),
        h("h1", { class: "wl-display" }, step === 1 ? "Reset your password" : "Choose a new password")), content,
      h("p", { class: "wl-small" }, h("a", { href: "/learn/" }, "Back to sign in")));
  }

  function requestStep(prefill) {
    W.setTitle("Reset your password");
    var ts = W.turnstile();
    var form = h("form", { class: "wl-form wl-card-plain", novalidate: true, "aria-label": "Request a reset code" },
      h("p", null, "Enter the email address on your account. We will email you a 6-digit code."),
      W.field({ label: "Email", type: "email", name: "email", autocomplete: "email", required: true, value: prefill || "", autocapitalize: "off", spellcheck: "false" }),
      ts.el,
      ts.unavailable ? W.notice("warn", "Password reset is temporarily unavailable",
        "Reset codes cannot be sent right now. Please try again later, or contact sales@wirewalk.com for help.") : null,
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn", disabled: ts.unavailable }, "Email me a code")),
      h("p", { class: "wl-small" }, "Already have a code? ", h("a", { href: "#", "data-have": "1" }, "Enter it")));
    form.querySelector("[data-have]").addEventListener("click", function (e) { e.preventDefault(); confirmStep(F(form, "email").value.trim(), false); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = F(form, "email").value.trim();
      if (!emailRe.test(email)) { W.formError(form, "Enter a valid email address."); F(form, "email").focus(); return; }
      if (ts.unavailable) { W.formError(form, "Password reset is temporarily unavailable. Please try again later."); return; }
      var t = ts.token();
      if (ts.required && !t) { W.formError(form, "Please complete the security check."); return; }
      W.formError(form, "");
      W.busy(form.querySelector("[type=submit]"), API.resetSend({ email: email, turnstile: t }), "Sending…")
        .then(function () { confirmStep(email, true); }, function (err) { ts.reset(); W.formError(form, err.message); });
    });
    W.mount(shell(1, form));
  }

  function confirmStep(email, sent) {
    W.setTitle("Choose a new password");
    var form = h("form", { class: "wl-form wl-card-plain", novalidate: true, "aria-label": "Set a new password" },
      sent ? W.notice("info", "Check your email", "If an account exists for " + email + ", we have sent it a 6-digit code. It expires in 15 minutes.") : null,
      W.field({ label: "Email", type: "email", name: "email", autocomplete: "email", required: true, value: email || "", autocapitalize: "off", spellcheck: "false" }),
      W.field({ label: "6-digit code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", required: true, maxlength: "6", pattern: "[0-9]{6}" }),
      W.field({ label: "New password", type: "password", name: "password", autocomplete: "new-password", required: true, minlength: "10", maxlength: "200", passwordToggle: true,
        hint: "At least 10 characters. Resetting signs you out on your other devices." }),
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn" }, "Set new password and sign in")),
      h("p", { class: "wl-small" }, "No code? ", h("a", { href: "#", "data-again": "1" }, "Send a new one")));
    form.querySelector("[data-again]").addEventListener("click", function (e) { e.preventDefault(); requestStep(F(form, "email").value.trim()); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var em = F(form, "email").value.trim(), code = F(form, "code").value.replace(/\D/g, ""), pw = F(form, "password").value;
      if (!emailRe.test(em)) { W.formError(form, "Enter a valid email address."); F(form, "email").focus(); return; }
      if (code.length !== 6) { W.formError(form, "Enter the 6-digit code from the email."); F(form, "code").focus(); return; }
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
    var first = sent ? F(form, "code") : F(form, email ? "code" : "email"); if (first) first.focus();
  }

  function boot() { requestStep(W.param("email") || ""); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
