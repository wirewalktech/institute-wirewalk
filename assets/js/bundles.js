/* [bundles] Live bundle prices on public pages, from GET {WIA.api}/api/catalog.
 * Nothing here computes a price: every figure is billing's answer.
 *   [data-track-bundle="<trackId>"]  track page: "Buy the whole track" box
 *   [data-pass-box]                   pricing page: All-Access Pass price and length
 *   [data-bundle-tiers]               pricing page: build-your-own tiers
 *   [data-all-access-for="<id>"]      course page: "Included in All-Access"; for a signed-in pass
 *                                     holder (or owner) "Start with your All-Access Pass" instead of Buy
 *   [data-bundle-hint]                course page: build-your-own hint
 * Without JS or the API every box stays hidden (no stale or invented prices). */
(function () {
  "use strict";
  var W = window.WIA || {};
  var CACHE_KEY = "wia_catalog_v1", CACHE_MS = 60 * 1000;
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store() { try { return window.sessionStorage; } catch (e) { return null; } }

  function load() {
    var ss = store();
    try {
      var hit = ss && JSON.parse(ss.getItem(CACHE_KEY) || "null");
      if (hit && hit.api === W.api && Date.now() - hit.at < CACHE_MS && hit.data && Array.isArray(hit.data.tracks)) return Promise.resolve(hit.data);
    } catch (e) { /* ignore */ }
    if (!W.api || !window.fetch) return Promise.reject(new Error("no api"));
    return fetch(W.api + "/api/catalog", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("catalog " + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.courses)) throw new Error("bad catalog");
        try { ss && ss.setItem(CACHE_KEY, JSON.stringify({ api: W.api, at: Date.now(), data: d })); } catch (e) { /* ignore */ }
        return d;
      });
  }
  function money(minor) {
    if (typeof minor !== "number" || !isFinite(minor)) return "";
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100); }
    catch (e) { return "$" + (minor / 100).toFixed(2); }
  }
  function set(root, sel, text) { $$(sel, root).forEach(function (n) { n.textContent = text; }); }
  function pct(bps) { return (bps / 100) + "%"; }
  function tierText(tiers) {
    return tiers.map(function (t) { return t.minCourses + "+ courses: " + pct(t.bps) + " off each"; }).join(" · ");
  }

  function trackBoxes(d) {
    var byId = {};
    (d.tracks || []).forEach(function (t) { byId[t.id] = t; });
    $$("[data-track-bundle]").forEach(function (box) {
      var t = byId[box.getAttribute("data-track-bundle")];
      if (!t || t.status !== "on_sale" || !t.enabled || typeof t.price !== "number") return;
      set(box, "[data-tb-price]", money(t.price));
      set(box, "[data-tb-list]", money(t.list));
      set(box, "[data-tb-save]", money(t.list - t.price));
      set(box, "[data-tb-count]", t.courses.length + " course" + (t.courses.length === 1 ? "" : "s"));
      set(box, "[data-tb-label]", t.label || "");
      $$("[data-tb-buy]", box).forEach(function (a) { a.setAttribute("href", "/learn/cart/?add=track:" + encodeURIComponent(t.id) + "&buy=1"); });
      box.hidden = false;
    });
  }

  function passBoxes(d) {
    var p = (d.passes || [])[0];
    $$("[data-pass-box]").forEach(function (box) {
      if (!p) return;
      set(box, "[data-pass-price]", money(p.price));
      set(box, "[data-pass-days]", String(p.durationDays));
      $$("[data-pass-list]", box).forEach(function (n) { n.textContent = p.price < p.list ? money(p.list) : ""; n.hidden = !(p.price < p.list); });
      set(box, "[data-pass-label]", p.label || "");
      $$("[data-pass-buy]", box).forEach(function (a) { a.setAttribute("href", "/learn/cart/?add=pass:" + encodeURIComponent(p.id) + "&buy=1"); });
      box.hidden = false;
    });
    $$("[data-pass-fallback]").forEach(function (n) { n.hidden = !!p; });
    if (p) set(document, "[data-pass-length]", p.durationDays + " more days");   // [bundles-fix] the length set in the console
  }

  function tiers(d) {
    var t = (d.bundles && d.bundles.tiers) || [];
    $$("[data-bundle-tiers]").forEach(function (n) { if (t.length) { n.textContent = tierText(t); n.hidden = false; } });
  }

  function coursePages(d) {
    var byId = {};
    d.courses.forEach(function (c) { byId[c.id] = c; });
    var pass = (d.passes || [])[0];
    var t = ((d.bundles && d.bundles.tiers) || [])[0];
    $$("[data-all-access-for]").forEach(function (n) {
      var c = byId[n.getAttribute("data-all-access-for")];
      n.hidden = !(pass && c && c.status === "on_sale" && c.price > 0);   // a free course needs no pass
    });
    $$("[data-bundle-hint]").forEach(function (n) {
      var c = byId[n.getAttribute("data-bundle-hint")];
      if (!t || !c || c.status !== "on_sale" || !(c.price > 0)) return;
      n.textContent = "Buy " + t.minCourses + " or more courses together and save " + pct(t.bps) + " on each.";
      n.hidden = false;
    });
  }

  /* [bundles-fix] A signed-in learner with an active pass (or who owns the course) is sent into
     the course instead of being offered Buy now / Add to cart, so nobody pays twice for a course
     their pass already opens. GET /api/pass is small; any failure leaves the page as it was. */
  function holderPages() {
    var nodes = $$("[data-all-access-for]");
    var A = window.WIAApi;
    if (!nodes.length || !A || !A.signedIn || !A.signedIn()) return;
    A.request("GET", "/api/pass", undefined, { quiet401: true }).then(function (r) {
      var active = !!(r && r.pass && r.pass.active);
      var owned = (r && r.owned) || [];
      nodes.forEach(function (n) {
        var id = n.getAttribute("data-all-access-for");
        var mine = owned.indexOf(id) >= 0;
        if (!mine && !(active && !n.hidden)) return;   // the pill shows only for a paid on-sale course
        $$('[data-show-when="on_sale"][data-for="' + id + '"] .acts, [data-bundle-hint="' + id + '"]').forEach(function (x) { x.hidden = true; });
        while (n.firstChild) n.removeChild(n.firstChild);
        var a = document.createElement("a");
        a.className = "btn block";
        a.href = "/learn/course/?c=" + encodeURIComponent(id);
        a.textContent = mine ? "Go to your course" : "Start with your All-Access Pass";
        var note = document.createElement("span");
        note.className = "small muted";
        note.textContent = mine ? "You already own this course." : "Your pass includes this course" +
          (r.pass.endsAt ? " until " + new Date(r.pass.endsAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "") + ".";
        n.appendChild(a); n.appendChild(note);
        n.hidden = false;
      });
    }, function () { /* signed out or offline: the page stays as it was */ });
  }

  /* api.js (default layout) may run after this deferred script; wait for it when needed. */
  function holderLater() { if (window.WIAApi) holderPages(); else window.addEventListener("load", holderPages); }

  function run() {
    if (!document.querySelector("[data-track-bundle],[data-pass-box],[data-bundle-tiers],[data-all-access-for],[data-bundle-hint]")) return;
    load().then(function (d) { trackBoxes(d); passBoxes(d); tiers(d); coursePages(d); holderLater(); }, holderLater);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
