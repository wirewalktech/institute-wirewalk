/* /learn/account/ : name and organization, email verification, password, sign out. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;

  function F(form, n) { return form.querySelector('[name="' + n + '"]'); }

  function load() {
    if (!W.requireAuth()) return;
    W.loading("Loading your account…");
    API.me().then(render, function (err) { if (err.status !== 401) W.mount(W.errorView(err, load)); });
  }

  function render(me) {
    var L = me.learner || {};
    W.setTitle("Account");
    var form = h("form", { class: "wl-form", novalidate: true, "aria-labelledby": "h-profile" },
      W.field({ label: "Full name", name: "name", autocomplete: "name", required: true, maxlength: "120", value: L.name || "",
        hint: "Printed on certificates issued from now on. Certificates already issued keep the name they were issued with." }),
      W.field({ label: "Organization", name: "organization", autocomplete: "organization", optional: true, maxlength: "160", value: L.organization || "" }),
      h("div", { class: "wl-actions" }, h("button", { type: "submit", class: "wl-btn" }, "Save changes")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = F(form, "name").value.trim(), org = F(form, "organization").value.trim();
      if (!name) { W.formError(form, "Enter your name."); F(form, "name").focus(); return; }
      W.formError(form, "");
      W.busy(form.querySelector("[type=submit]"), API.updateMe({ name: name, organization: org }), "Saving…").then(function () {
        W.toast("Saved.", "ok");
      }, function (err) { W.formError(form, err.message); });
    });

    var emailBox = h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "h-email" },
      h("h2", { id: "h-email", class: "wl-h3" }, "Email"),
      h("p", null, h("strong", null, L.email), " ", L.emailVerified ? W.chip("Verified", "ok") : W.chip("Not verified", "warn")),
      L.emailVerified ? h("p", { class: "wl-hint" }, "To change the email on your account, write to sales@wirewalk.com from your current address.")
        : W.verifyPanel(L, function () { load(); }, true));

    var out = W.btn("Sign out", { class: "wl-btn-ghost" });
    out.addEventListener("click", function () {
      W.busy(out, API.logout().catch(function () { return null; }), "Signing out…").then(function () {
        API.token.clear();
        window.location.assign("/learn/");
      });
    });

    W.mount(h("div", { class: "wl-narrow" },
      h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, "Account"), h("h1", { class: "wl-display" }, "Your account"),
        L.createdAt ? h("p", { class: "wl-hint" }, "Member since " + W.fmtDate(L.createdAt)) : null),
      h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "h-profile" }, h("h2", { id: "h-profile", class: "wl-h3" }, "Profile"), form),
      emailBox,
      h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "h-security" },
        h("h2", { id: "h-security", class: "wl-h3" }, "Password and sessions"),
        h("p", null, "To change your password, request a reset code by email. Resetting signs you out on every other device."),
        h("div", { class: "wl-actions" }, W.btn("Change password", { href: "/learn/reset/?email=" + encodeURIComponent(L.email || ""), class: "wl-btn-ghost" }), out))));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
