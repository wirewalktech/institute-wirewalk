/* /learn/account/ : name and organization, email verification, email preferences, password, sign out.
   #preferences: "Training reminders from my team" (GET/PATCH /api/me/preferences, linked from every
   campaign reminder email). Until the Worker serves that route (404/503) the section says so. */
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

    var prefs = preferencesSection();

    W.mount(h("div", { class: "wl-narrow" },
      h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, "Account"), h("h1", { class: "wl-display" }, "Your account"),
        L.createdAt ? h("p", { class: "wl-hint" }, "Member since " + W.fmtDate(L.createdAt)) : null),
      h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "h-profile" }, h("h2", { id: "h-profile", class: "wl-h3" }, "Profile"), form),
      emailBox,
      prefs,
      h("section", { class: "wl-section wl-card-plain", "aria-labelledby": "h-security" },
        h("h2", { id: "h-security", class: "wl-h3" }, "Password and sessions"),
        h("p", null, "To change your password, request a reset code by email. Resetting signs you out on every other device."),
        h("div", { class: "wl-actions" }, W.btn("Change password", { href: "/learn/reset/?email=" + encodeURIComponent(L.email || ""), class: "wl-btn-ghost" }), out))));
    /* The page is drawn by script, so the browser's own jump to #preferences found nothing. */
    if (location.hash === "#preferences") try { prefs.scrollIntoView({ block: "start" }); prefs.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  /* [org-agreements] Campaign reminders are service emails from a team the learner is in, not
     marketing, so they have their own switch. "assigned" emails are always sent; this turns off
     the reminders before the due date and the overdue one. */
  function preferencesSection() {
    var box = h("div", null, W.spinner("Loading your email preferences…"));
    var s = h("section", { class: "wl-section wl-card-plain", id: "preferences", tabindex: "-1", "aria-labelledby": "h-prefs" },
      h("h2", { id: "h-prefs", class: "wl-h3" }, "Email preferences"), box);
    API.request("GET", "/api/me/preferences").then(function (p) {
      W.clear(box);
      var cb = h("input", { type: "checkbox", id: "p-campaign", name: "campaignReminders", checked: !p || p.campaignReminders !== "off", "aria-describedby": "p-campaign-hint" });
      box.appendChild(h("div", { class: "wl-ack" }, cb, h("label", { for: "p-campaign" }, "Training reminders from my team")));
      box.appendChild(h("p", { class: "wl-hint", id: "p-campaign-hint" }, "When a team you belong to assigns you training with a due date, we email you a week before, a day before and once if it is overdue. " +
        "Turning this off stops those reminders; you still get one email when training is assigned to you. Your team can still see your progress in the courses it gave you."));
      cb.addEventListener("change", function () {
        var on = cb.checked;
        cb.disabled = true;
        API.request("PATCH", "/api/me/preferences", { campaignReminders: on ? "on" : "off" }).then(function () {
          cb.disabled = false;
          W.toast(on ? "Training reminders are on." : "Training reminders are off.", "ok");
        }, function (e) {
          cb.disabled = false; cb.checked = !on;
          W.toast(e.message, "bad");
        });
      });
    }, function (e) {
      if (e.status === 401) return;
      W.clear(box).appendChild(h("p", { class: "wl-hint" }, e.status === 404 || e.status === 503
        ? "Training reminders from your team are not switched on yet. When they are, you can turn them off here."
        : "Your email preferences could not be loaded. " + e.message));
    });
    return s;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
