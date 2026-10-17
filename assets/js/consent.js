/* Wirewalk Institute of AI: cookie consent and the Reddit Pixel.

   Loaded by _layouts/default.html ONLY when _config.yml sets reddit_pixel_id (meta "wia-rdt").
   With no pixel ID configured this file is never loaded: no banner, no pixel, no Reddit requests.

   1. Banner. A small, non-blocking region at the foot of the page with two equal buttons,
      "Accept" and "Reject", shown until the visitor chooses. The choice is kept in localStorage
      "wia_consent" ({ads:"accepted"|"rejected", at}); every storage access is wrapped, and with
      storage blocked the banner simply shows again on the next page and nothing loads.
      Any element with [data-cookie-settings] (the footer "Cookie settings" link, the button on
      /privacy/) reopens it so the choice can be changed.
   2. Pixel. https://www.redditstatic.com/ads/pixel.js is added to the page only after Accept
      (Reddit's standard loader). It then talks to alb.reddit.com and pixel-config.reddit.com;
      the layout's Content-Security-Policy allows exactly those hosts, and only when the pixel is
      configured. Events: PageVisit on each page; SignUp, Lead and Purchase come from the learner
      app through window.WIAConsent.track(). Only an event name, a conversion id (our own account,
      course or purchase reference), and for Purchase the value, currency and item count are sent.
      No name, email or other personal data is passed to the pixel.
   3. Rejecting after accepting deletes Reddit's first-party cookies (_rdt_*) and reloads the page,
      so the pixel stops. A signed-in learner's choice is also stored on the account
      (POST /api/marketing/consent), so the Institute never forwards a conversion server-side for
      someone who rejected. */
(function () {
  "use strict";
  if (window.WIAConsent) return;

  function meta(n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.getAttribute("content") || "" : ""; }
  var PIXEL_ID = meta("wia-rdt");
  var KEY = "wia_consent", SENT = "wia_rdt_sent", QUEUE = "wia_rdt_queue";
  var EVENTS = { PageVisit: 1, SignUp: 1, Lead: 1, Purchase: 1 };
  var configured = /^[A-Za-z0-9_-]{2,64}$/.test(PIXEL_ID);

  function get(store, k) { try { return JSON.parse(window[store].getItem(k) || "null"); } catch (e) { return null; } }
  function put(store, k, v) { try { if (v == null) window[store].removeItem(k); else window[store].setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

  function state() {
    var c = get("localStorage", KEY);
    return c && (c.ads === "accepted" || c.ads === "rejected") ? c.ads : null;
  }

  /* ---------------- pixel ---------------- */
  var loaded = false;
  function loadPixel() {
    if (loaded || !configured) return;
    loaded = true;
    /* Reddit's standard loader: a queueing stub, then the async script. */
    var p = window.rdt = function () { p.sendEvent ? p.sendEvent.apply(p, arguments) : p.callQueue.push(arguments); };
    p.callQueue = [];
    var s = document.createElement("script");
    s.src = "https://www.redditstatic.com/ads/pixel.js";
    s.async = true;
    document.head.appendChild(s);
    window.rdt("init", PIXEL_ID, { useDecimalCurrencyValues: true });
    window.rdt("track", "PageVisit");
    flush();
  }

  /* Only these fields, typed and clipped. No personal data ever reaches the pixel. */
  function clean(data) {
    var out = {};
    if (!data) return out;
    if (typeof data.conversionId === "string" && /^[A-Za-z0-9_:.-]{1,64}$/.test(data.conversionId)) out.conversionId = data.conversionId;
    if (typeof data.value === "number" && isFinite(data.value) && data.value >= 0) out.value = Math.round(data.value * 100) / 100;
    if (typeof data.currency === "string" && /^[A-Za-z]{3}$/.test(data.currency)) out.currency = data.currency.toUpperCase();
    if (typeof data.itemCount === "number" && data.itemCount >= 1 && data.itemCount <= 1000) out.itemCount = Math.floor(data.itemCount);
    return out;
  }

  /* Events wait in sessionStorage until the pixel is loaded, so one recorded just before a
     navigation (sign-up, free enrollment) is still sent from the next page. A conversion id is
     sent at most once per browser (list of the last 50). */
  function flush() {
    if (!loaded) return;
    var q = get("sessionStorage", QUEUE) || [];
    if (!q.length) return;
    put("sessionStorage", QUEUE, null);
    var sent = get("localStorage", SENT) || [];
    q.forEach(function (e) {
      if (!e || !EVENTS[e.n]) return;
      var d = clean(e.d);
      if (d.conversionId && sent.indexOf(e.n + ":" + d.conversionId) >= 0) return;
      window.rdt("track", e.n, d);
      if (d.conversionId) sent.push(e.n + ":" + d.conversionId);
    });
    put("localStorage", SENT, sent.slice(-50));
  }

  function track(name, data) {
    if (!configured || !EVENTS[name] || name === "PageVisit") return;
    if (state() !== "accepted") return;            // nothing is recorded or queued without consent
    var q = get("sessionStorage", QUEUE) || [];
    q.push({ n: name, d: clean(data) });
    put("sessionStorage", QUEUE, q.slice(-20));
    flush();
  }

  /* ---------------- account sync ---------------- */
  function syncAccount(ads) {
    var api = window.WIA && window.WIA.api, token = null;
    try { token = localStorage.getItem("wia_token"); } catch (e) { /* storage blocked */ }
    if (!api || !token || !window.fetch) return;
    try {
      fetch(api + "/api/marketing/consent", {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ adsConsent: ads === "accepted" })
      }).catch(function () { /* best effort */ });
    } catch (e) { /* never break the page */ }
  }

  function dropRedditCookies() {
    var names = ["_rdt_uuid", "_rdt_cid", "_rdt_em", "_rdt_pn"];
    var host = location.hostname, parts = host.split("."), domains = [""];
    for (var i = 0; i < parts.length - 1; i++) domains.push("; domain=." + parts.slice(i).join("."));
    names.forEach(function (n) {
      domains.forEach(function (d) { document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + d; });
    });
    put("sessionStorage", QUEUE, null);
    dropClickId();
  }
  /* [review-fixes] Reddit's click id (rdt_cid) is an advertising identifier: it is kept in
     the attribution record (campaign.js, "wia_attrib") only while ads cookies are accepted. */
  function dropClickId() {
    var a = get("localStorage", "wia_attrib");
    if (a && a.last && a.last.rdt_cid) { delete a.last.rdt_cid; put("localStorage", "wia_attrib", a); }
  }

  /* ---------------- banner ---------------- */
  var banner = null, lastFocus = null;
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }

  function choose(ads) {
    var before = state();
    put("localStorage", KEY, { ads: ads, at: Date.now() });
    hide();
    if (before !== ads) syncAccount(ads);
    if (ads === "accepted") { loadPixel(); return; }
    dropClickId();
    if (loaded || before === "accepted") { dropRedditCookies(); location.reload(); }
  }

  function hide() {
    if (!banner) return;
    banner.hidden = true;
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  function show(focus) {
    if (!configured) return;
    if (!banner) {
      banner = el("section", { class: "ck", role: "region", "aria-labelledby": "ck-h", "aria-describedby": "ck-p" });
      var inner = el("div", { class: "ck-in" });
      var txt = el("div", { class: "ck-txt" });
      txt.appendChild(el("h2", { id: "ck-h", class: "ck-h" }, "Advertising cookies"));
      var p = el("p", { id: "ck-p" }, "We would like to use the Reddit Pixel to measure which of our Reddit ads lead to visits, sign-ups and purchases. It sets cookies and sends page visits to Reddit. It stays off unless you accept. ");
      var a = el("a", { href: "/privacy/#cookies" }, "Details in our privacy policy");
      p.appendChild(a); p.appendChild(document.createTextNode("."));
      txt.appendChild(p);
      var acts = el("div", { class: "ck-acts" });
      var yes = el("button", { type: "button", class: "btn sm ck-btn", "data-ck": "accepted" }, "Accept");
      var no = el("button", { type: "button", class: "btn sm ck-btn", "data-ck": "rejected" }, "Reject");
      acts.appendChild(yes); acts.appendChild(no);
      inner.appendChild(txt); inner.appendChild(acts);
      banner.appendChild(inner);
      banner.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-ck]") : null;
        if (b) choose(b.getAttribute("data-ck"));
      });
      banner.addEventListener("keydown", function (e) { if ((e.key === "Escape" || e.key === "Esc") && state()) hide(); });
      document.body.appendChild(banner);
    }
    var cur = state();
    Array.prototype.forEach.call(banner.querySelectorAll("[data-ck]"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-ck") === cur ? "true" : "false");
    });
    banner.hidden = false;
    if (focus) {
      lastFocus = document.activeElement;
      var first = banner.querySelector("[data-ck]");
      if (first) first.focus();
    }
  }

  window.WIAConsent = {
    configured: configured,
    state: state,
    track: track,
    open: function () { show(true); }
  };

  if (!configured) return;

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-cookie-settings]") : null;
    if (!t) return;
    e.preventDefault();
    show(true);
  });

  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-cookie-settings]"), function (n) { n.hidden = false; });
    var s = state();
    if (s === "accepted") loadPixel();
    else if (!s) show(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
