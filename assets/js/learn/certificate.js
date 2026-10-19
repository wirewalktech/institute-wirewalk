/* /learn/certificate/?id=WIA-XXXX-XXXX-XXXX : printable certificate (public, no sign-in needed). */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  var id = (W.param("id") || "").trim().toUpperCase();

  function load() {
    if (!/^WIA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(id)) {
      W.setTitle("Certificate");
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Certificate not found",
        "This link does not contain a valid certificate ID. IDs look like WIA-7K2D-9QXM-4HTR.",
        [W.btn("Verify a certificate", { href: "/verify/" })], { h1: true })));
      return;
    }
    W.loading("Loading certificate…");
    API.certificate(id).then(render, function (err) {
      W.setTitle("Certificate");
      if (err.status === 404) {
        W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "Certificate not found",
          "No certificate with the ID " + id + " was issued by the Wirewalk Institute of AI.", [W.btn("Verify another", { href: "/verify/" })], { h1: true })));
        return;
      }
      W.mount(W.errorView(err, load));
    });
  }

  function mark() {
    return h("span", { class: "wl-cmark", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i", { class: "wl-cmark-4" }));
  }

  var SITE = ((window.WIA && window.WIA.site) || "https://institute.wirewalk.com").replace(/\/+$/, "");
  /** API-supplied links become hrefs only when they are https and on the expected host. */
  function safeLink(v, hosts) {
    try { var u = new URL(String(v)); return (u.protocol === "https:" && hosts.indexOf(u.hostname) >= 0) ? u.href : null; }
    catch (e) { return null; }
  }
  function siteHost() { try { return new URL(SITE).hostname; } catch (e) { return "institute.wirewalk.com"; } }

  /* [ob3] Open Badges 3.0, for the signed-in holder only. /api/me lists the holder's own
     unrevoked certificates, each with an openBadge object when the feature is on; the public
     payload above never carries download links. Anyone else sees the page unchanged. */
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: name, hidden: true });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function badgeError(err) {
    if (err && err.status === 410) return "This certificate is no longer valid, so no badge can be issued for it.";
    if (err && err.status === 403 && err.data && err.data.reason === "verify_email") return "Verify your email address first: the badge identifies you by it.";
    if (err && err.status === 429) return "Too many badge downloads in the last hour. Please try again later.";
    if (err && err.status === 503) return "Badge downloads are not available right now. Please try again later.";
    return (err && err.message) || "The download failed. Please try again.";
  }
  function addBadgeControls(certId, actions, after) {
    if (!API.signedIn || !API.signedIn()) return;
    API.request("GET", "/api/me", undefined, { quiet401: true }).then(function (me) {
      var mine = ((me && me.certificates) || []).filter(function (x) { return x && x.id === certId && x.openBadge; })[0];
      if (!mine) return;
      /* The badge carries a hashed form of the account email as a claim that the holder controls
         it, so the Worker signs one only for a verified address (403 verify_email otherwise). */
      var verified = !(me.learner && me.learner.emailVerified === false);
      function dl(format, label) {
        return W.btn(label, { class: "wl-btn-ghost", onclick: function (e) {
          W.busy(e.currentTarget, API.ob3Credential(certId, format), "Preparing…").then(function (blob) {
            saveBlob(blob, certId + (format === "svg" ? ".svg" : ".json"));
            W.toast("Badge downloaded.", "ok");
          }, function (err) { W.toast(badgeError(err), "bad"); });
        } });
      }
      var panel = h("section", { id: "wl-badge-panel", class: "wl-badge-panel wl-noprint", hidden: true, "aria-label": "Open Badge downloads" },
        verified
          ? h("div", { class: "wl-badge-row" }, dl("json", "Download Open Badge (.json)"), dl("svg", "Download badge image (.svg)"))
          : h("div", null,
              h("p", { class: "wl-hint" }, "Verify your email address to download the badge. The badge identifies you by a hashed form of your account email, so we sign one only for an address you have confirmed."),
              W.verifyPanel(me.learner, function () { window.location.reload(); }, true)),
        h("h2", { class: "wl-badge-h" }, "How to add it to a wallet"),
        h("p", { class: "wl-hint" }, "Import the .json or the .svg file into any Open Badges 3.0 wallet or backpack. Both carry the same signed credential: your name, the course or program, the dates and your score. Your email address is included only as a salted hash: it does not show the address, but anyone who knows or guesses the address can check it against the badge. To check it, enter the address in lowercase."),
        h("p", { class: "wl-hint" }, "The file is a copy of your certificate as it is today and does not update itself. After a renewal, download your badge again (and if the name on your certificate is corrected, download it again too), then delete the old file: the new copy has the later \u201cvalid from\u201d date."),
        h("p", { class: "wl-hint" }, "The badge keeps the limits of the certificate: it is a certificate of completion and assessment, not an accreditation. ",
          h("a", { href: "/certification/#open-badges" }, "About Open Badges")));
      var toggle = W.btn("Add to wallet / Download badge", { class: "wl-btn-ghost", "aria-expanded": "false", "aria-controls": "wl-badge-panel",
        onclick: function (e) {
          var open = panel.hidden;
          panel.hidden = !open;
          e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
        } });
      actions.appendChild(toggle);
      after.parentNode.insertBefore(panel, after.nextSibling);
    }, function () { /* not signed in any more, or offline: the page stays as it is */ });
  }

  function render(c) {
    W.setTitle(c.title ? "Certificate · " + c.title : "Certificate");
    var certId = /^WIA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(String(c.id || "")) ? c.id : id;
    var verifyUrl = safeLink(c.verifyUrl, [siteHost()]) || (SITE + "/verify/?id=" + encodeURIComponent(certId));
    var linkedin = safeLink(c.linkedinUrl, ["www.linkedin.com", "linkedin.com"]);
    var issuedTxt = W.fmtDateUTC(c.issuedAt);
    if (!c.revoked && c.expired) {   // [freshness] expired: say when, and how to renew
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "This certificate has expired",
        "Certificate " + certId + (c.title ? " for “" + c.title + "”" : "") + " was valid until " + W.fmtDateUTC(c.validUntil) + ". " +
        (c.kind === "program" ? "It is renewed when every course certificate in the program is current again."
          : "The holder can renew it by passing the course exam again; the certificate keeps the same ID."),
        [W.btn("Verification page", { href: verifyUrl }),
         c.kind !== "program" && c.refId ? W.btn("Go to the course", { href: W.courseUrl(c.refId), class: "wl-btn-ghost" }) : null].filter(Boolean), { h1: true })));
      return;
    }
    if (c.revoked || c.valid === false) {
      W.mount(h("div", { class: "wl-narrow" }, W.notice("error", c.revoked ? "This certificate has been revoked" : "This certificate is not valid",
        "Certificate " + certId + (c.title ? " for “" + c.title + "”" : "") + " is not currently valid. If you believe this is a mistake, contact sales@wirewalk.com.",
        [W.btn("Verification page", { href: verifyUrl })], { h1: true })));
      return;
    }
    var program = c.kind === "program";
    var issued = W.toDate(c.issuedAt);
    var sheet = h("article", { class: "wl-cert-sheet", "aria-label": "Certificate " + certId },
      h("div", { class: "wl-cert-frame" },
        h("header", { class: "wl-cert-top" }, mark(), h("span", { class: "wl-cert-inst" }, "Wirewalk Institute of AI")),
        h("div", { class: "wl-cert-body" },
        h("p", { class: "wl-cert-kind" }, program ? "Program Certificate of Completion and Assessment" : "Certificate of Completion and Assessment"),
        h("p", { class: "wl-cert-small" }, "This certifies that"),
        h("p", { class: "wl-cert-name" }, c.name || ""),
        h("p", { class: "wl-cert-small" }, program
          ? "has completed every course in the program and passed each course assessment"
          : "has completed the course and passed its assessment" + (c.scorePct != null ? " with a score of " + c.scorePct + "%" : "")),
        h("h1", { class: "wl-cert-title" }, c.title || ""),
        h("dl", { class: "wl-cert-facts" },
          h("div", null, h("dt", null, "Issued"), h("dd", null, issuedTxt)),
          c.validUntil ? h("div", null, h("dt", null, "Valid until"), h("dd", null, W.fmtDateUTC(c.validUntil))) : null,   // [freshness]
          h("div", null, h("dt", null, "Certificate ID"), h("dd", { class: "wl-mono" }, c.id || id)),
          c.refId ? h("div", null, h("dt", null, program ? "Program" : "Course"), h("dd", { class: "wl-mono" }, String(c.refId).toUpperCase())) : null)),
        h("footer", { class: "wl-cert-foot" },
          h("div", { class: "wl-cert-sign" }, h("span", { class: "wl-cert-line" }), h("span", null, "Wirewalk Institute of AI")),
          h("p", { class: "wl-cert-verify" }, "Verify this certificate at", h("br"), h("span", { class: "wl-mono" }, verifyUrl)))));

    var actions = h("div", { class: "wl-cert-actions wl-noprint" },
      W.btn("Print or save as PDF", { onclick: function () { window.print(); } }),
      linkedin ? h("a", { class: "wl-btn wl-btn-ghost", href: linkedin, target: "_blank", rel: "noopener noreferrer" }, "Add to LinkedIn profile") : null,
      W.btn("Copy verification link", { class: "wl-btn-ghost", onclick: function (e) {
        var b = e.currentTarget;
        W.copyText(verifyUrl).then(function () { W.toast("Verification link copied.", "ok"); b.textContent = "Link copied"; }, function () { W.toast("Copy failed. The link is printed on the certificate.", "bad"); });
      } }));

    var tip = h("p", { class: "wl-hint wl-center wl-noprint" }, "Tip: print in landscape with margins set to none or minimum for the best result.");
    W.mount(h("div", { class: "wl-cert-page" },
      h("div", { class: "wl-cert-intro wl-noprint" },
        h("p", { class: "wl-eyebrow" }, "Verified certificate"),
        h("p", { class: "wl-hint" }, "Issued " + issuedTxt + " to " + (c.name || "the holder") + (c.validUntil ? ", valid until " + W.fmtDateUTC(c.validUntil) : "") + ". This page and the verification link always show the certificate’s current status.")),
      h("div", { class: "wl-cert-scroll" }, sheet),
      /* On a phone the sheet is a scaled preview; these facts stay readable (hidden in print and on wide screens). */
      h("section", { class: "wl-cert-mfacts wl-noprint", "aria-label": "Certificate details" },
        h("dl", { class: "wl-facts" },
          h("div", null, h("dt", null, "Holder"), h("dd", null, c.name || "")),
          h("div", null, h("dt", null, program ? "Program" : "Course"), h("dd", null, c.title || "", c.refId ? h("span", { class: "wl-mono wl-muted" }, " · " + String(c.refId).toUpperCase()) : null)),
          h("div", null, h("dt", null, "Issued"), h("dd", null, issuedTxt)),
          c.renewedAt ? h("div", null, h("dt", null, "Renewed"), h("dd", null, W.fmtDateUTC(c.renewedAt))) : null,      // [freshness]
          c.validUntil ? h("div", null, h("dt", null, "Valid until"), h("dd", null, W.fmtDateUTC(c.validUntil))) : null,  // [freshness]
          !program && c.scorePct != null ? h("div", null, h("dt", null, "Score"), h("dd", null, c.scorePct + "%")) : null,
          h("div", null, h("dt", null, "Certificate ID"), h("dd", { class: "wl-mono" }, certId)),
          h("div", null, h("dt", null, "Verify at"), h("dd", { class: "wl-mono wl-break" }, h("a", { href: verifyUrl }, verifyUrl))))),
      actions,
      tip));
    if (issued) document.documentElement.setAttribute("data-cert-year", String(issued.getUTCFullYear()));
    addBadgeControls(certId, actions, actions);   // [ob3] valid certificates only (the expired and revoked branches returned above)
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
