/* Wirewalk Institute of AI — enterprise inquiry form (/teams/enterprise/, #enterprise-form).
   The form posts natively to the portal inquiry endpoint and works without this script.
   This script only:
   - fills fields from the link: ?seats=, ?payment=card|invoice|purchase_order, ?program=<id>,
     ?topic=<track id>, and the utm_* tags (as site.js does for /teams/);
   - shows the State field only when the country is the United States, and requires it then
     (a hidden field is disabled, so it is not sent);
   - asks for a work address instead of a personal one: an address at a personal email provider
     (the list in _data/free_mail.yml, embedded as #free-mail-domains) is refused with a message,
     because organizations are verified by their email domain. Without JavaScript such an inquiry
     still arrives, and the console flags it.
   Values from the link are only ever written into existing inputs (never markup), and only
   when they match an option that is already on the page. */
(function () {
  "use strict";
  var form = document.getElementById("enterprise-form");
  if (!form) return;
  var $ = function (s) { return form.querySelector(s); };
  var MSG = "Please use your work address; we verify organizations by their email domain.";

  /* ---------------- personal email providers ---------------- */
  var FREE = [];
  try {
    var node = document.getElementById("free-mail-domains");
    var list = node ? JSON.parse(node.textContent || "[]") : [];
    if (Array.isArray(list)) FREE = list.filter(function (d) { return typeof d === "string" && d; }).map(function (d) { return d.toLowerCase(); });
  } catch (e) { FREE = []; }
  /* "mx.gmail.com" counts as gmail.com: equal to an entry, or ending in "." + entry. */
  function isFreeMail(email) {
    var at = String(email || "").trim().toLowerCase().lastIndexOf("@");
    if (at < 0) return false;
    var dom = String(email).trim().toLowerCase().slice(at + 1);
    return !!dom && FREE.some(function (f) { return dom === f || dom.slice(-(f.length + 1)) === "." + f; });
  }

  var email = $('[name="email"]'), help = document.getElementById("e-email-help");
  var helpText = help ? help.textContent : "";
  function checkEmail(show) {
    if (!email) return true;
    var bad = isFreeMail(email.value);
    email.setCustomValidity(bad ? MSG : "");
    if (help && (show || !bad)) {
      help.textContent = bad ? MSG : helpText;
      help.classList.toggle("warn", bad);
    }
    if (bad) email.setAttribute("aria-invalid", "true"); else email.removeAttribute("aria-invalid");
    return !bad;
  }
  if (email) {
    email.addEventListener("input", function () { checkEmail(false); });
    email.addEventListener("change", function () { checkEmail(true); });
    email.addEventListener("blur", function () { checkEmail(true); });
  }

  /* ---------------- state, for the United States only ---------------- */
  var country = $('[name="country"]'), state = $('[name="state"]'), stateWrap = document.getElementById("e-state-wrap");
  var stateReq = stateWrap ? stateWrap.querySelector("[data-state-req]") : null;
  function syncState() {
    if (!country || !state || !stateWrap) return;
    var us = country.value === "United States";
    stateWrap.hidden = !us;
    state.disabled = !us;
    state.required = us;
    if (stateReq) stateReq.hidden = !us;
  }
  if (country) country.addEventListener("change", syncState);

  /* ---------------- fill from the link ---------------- */
  (function () {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    function pick(el, v) {
      if (!el || !v) return;
      var opts = Array.prototype.slice.call(el.options || []);
      if (opts.some(function (o) { return o.value === v; })) el.value = v;
    }
    var seats = q.get("seats");
    if (seats && /^\d{1,6}$/.test(seats) && Number(seats) >= 1 && Number(seats) <= 100000) { var s = $('[name="seats"]'); if (s) s.value = String(Number(seats)); }
    var pay = q.get("payment");
    if (pay === "po") pay = "purchase_order";
    if (pay && /^(card|invoice|purchase_order)$/.test(pay)) { var r = $('input[name="payment"][value="' + pay + '"]'); if (r) r.checked = true; }
    pick($('[name="programs_interest"]'), q.get("program"));
    var topic = q.get("topic");
    if (topic && /^[a-z0-9-]{1,60}$/.test(topic)) { var t = $('input[name="topic_' + topic + '"]'); if (t) t.checked = true; }
    ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function (k) {
      var v = q.get(k), el = $('[name="' + k + '"]'); if (v && el) el.value = v.slice(0, 200);
    });
  })();
  syncState();

  /* ---------------- submit ---------------- */
  /* The browser's own validation already stops a form with a refused address; this is the
     fallback for browsers that skip it. src-fields.js adds its fields only to a submit that stands. */
  form.addEventListener("submit", function (e) {
    syncState();
    if (!checkEmail(true)) {
      e.preventDefault();
      try { email.reportValidity(); } catch (x) { /* old browser: the message is shown below the field */ }
      email.focus();
    }
  });
})();
