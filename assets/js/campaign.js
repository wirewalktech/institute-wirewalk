/* Wirewalk Institute of AI: campaign attribution and an aggregate counter.
   Loaded by the default layout on /go/ campaign pages (page.campaign) and, on any other page,
   by boot.js only when the URL carries utm_* or rdt_cid. Never loaded on an untagged learner-app page.

   1. Attribution (stays in this browser): utm_source/medium/campaign/content/term and Reddit's click
      id (rdt_cid) from the URL are kept in localStorage "wia_attrib" as {last}, replaced on each tagged
      visit and expiring 30 days after it (an expired or unreadable record is deleted when read).
      The learner app sends it with sign-up (POST /api/auth/signup "attribution") and deletes it once
      the account exists, so the operator can count sign-ups per campaign. Nothing else reads it.
   2. Counter: a landing view (once per page per browser session) and each click on a [data-cta]
      element POST {name:"inst.<page-or-cta>"} to the estate counter, which stores only
      (day, name, count). No identifiers, no cookies; fire-and-forget via sendBeacon. When the visit's
      utm_content ends in v<n> (e.g. "dev-v2"), "-v<n>" is appended so ad variants can be told apart.
   3. "Start free" links ([data-start="<course>"]) go to account creation by default; for a visitor who
      is already signed in they are pointed at the course, which enrols in one step.
   Every storage access is wrapped: private windows and blocked storage must not break the page. */
(function () {
  "use strict";
  if (window.__wiaCampaign) return;
  window.__wiaCampaign = true;

  var KEY = "wia_attrib", TTL = 30 * 24 * 3600 * 1000;
  var NAME_RE = /^[a-z][a-z0-9]{1,14}\.[a-z0-9_-]{1,24}$/;
  var PARAMS = { utm_source: "source", utm_medium: "medium", utm_campaign: "campaign", utm_content: "content", utm_term: "term", rdt_cid: "rdt_cid" };

  function meta(n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.getAttribute("content") || "" : ""; }
  function clip(v) { return String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100); }
  var q; try { q = new URLSearchParams(location.search); } catch (e) { q = null; }

  /* ---------------- attribution ---------------- */
  (function capture() {
    if (!q) return;
    var touch = {}, any = false;
    Object.keys(PARAMS).forEach(function (p) { var v = q.get(p); if (v && clip(v)) { touch[PARAMS[p]] = clip(v); any = true; } });
    if (!any) {
      /* Untagged visit: just drop a record that has expired or cannot be read. */
      try {
        var r = JSON.parse(localStorage.getItem(KEY) || "null");
        if (r && (!r.last || typeof r.last.at !== "number" || Date.now() - r.last.at > TTL)) localStorage.removeItem(KEY);
      } catch (e) { try { localStorage.removeItem(KEY); } catch (e2) { /* storage blocked */ } }
      return;
    }
    touch.landing = clip(location.pathname);
    touch.at = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify({ last: touch })); } catch (e) { /* storage blocked */ }
  })();

  /* ---------------- counter ---------------- */
  var endpoint = meta("wia-events");
  var vm = q && /(?:^|[^a-z0-9])(v\d{1,2})$/i.exec(q.get("utm_content") || "");
  var variant = vm ? "-" + vm[1].toLowerCase() : "";
  function send(name) {
    if (variant && NAME_RE.test(name + variant)) name += variant;
    if (!endpoint || !NAME_RE.test(name)) return;
    var body = JSON.stringify({ name: name });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    } catch (e) { /* fall through */ }
    try {
      if (window.fetch) fetch(endpoint, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(function () {});
    } catch (e) { /* never let the counter affect the page */ }
  }
  window.WIATrack = function (suffix) { send("inst." + String(suffix || "")); };

  /* Landing view: the /go/ page's own name, or a generic one for a tagged visit anywhere else. */
  var page = meta("wia-campaign");
  var view = "inst." + (page || "utm-landing");
  var seen = false;
  try {
    var s = JSON.parse(sessionStorage.getItem("wia_ev_seen") || "[]");
    seen = s.indexOf(view + variant) >= 0;
    if (!seen) { s.push(view + variant); sessionStorage.setItem("wia_ev_seen", JSON.stringify(s.slice(-20))); }
  } catch (e) { /* no session storage: count it */ }
  if (!seen) send(view);

  /* CTA clicks: <a data-cta="cta-free-dev">. Delegated, so it also covers markup added later. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("[data-cta]") : null;
    if (a) send("inst." + a.getAttribute("data-cta"));
  }, true);

  /* ---------------- signed-in visitors skip account creation ---------------- */
  var signedIn = false;
  try { signedIn = !!localStorage.getItem("wia_token"); } catch (e) { /* storage blocked */ }
  if (signedIn) {
    Array.prototype.forEach.call(document.querySelectorAll("a[data-start]"), function (a) {
      var id = a.getAttribute("data-start");
      if (/^[a-z]{2,4}-\d{3}$/.test(id)) a.setAttribute("href", "/courses/" + id + "/?enroll=free");
    });
  }
})();
