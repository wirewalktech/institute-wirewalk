/* Wirewalk Institute of AI — public site script.
   - theme toggle and mobile menu
   - live prices from GET {WIA.api}/api/catalog into [data-price-for] placeholders
     (prices are never computed here: the Worker/billing resolves them, estate D-003)
   - sale strike-through and countdown to the sale's end
   - course catalog filtering with URL-synced state
   - certificate verification (/verify/)
   No framework; every storage access is wrapped because it can throw. */
(function () {
  "use strict";
  var W = window.WIA || { api: "", site: "" };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }

  /* ---------------- theme ---------------- */
  function effectiveTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  $$("[data-theme-toggle]").forEach(function (b) {
    function label() { b.setAttribute("aria-label", effectiveTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme"); }
    label();
    b.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("wia_theme", next); } catch (e) {}
      label();
    });
  });

  /* ---------------- menu ---------------- */
  var menuBtn = $(".menu-btn"), nav = $("#site-nav");
  if (menuBtn && nav) {
    var setMenu = function (open) { nav.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", open ? "true" : "false"); };
    menuBtn.addEventListener("click", function () { setMenu(!nav.classList.contains("open")); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { setMenu(false); menuBtn.focus(); } });
    document.addEventListener("click", function (e) { if (nav.classList.contains("open") && !nav.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false); });
  }

  /* ---------------- module accordion: expand / collapse all ---------------- */
  $$("[data-expand-all]").forEach(function (b) {
    var box = document.getElementById(b.getAttribute("data-expand-all"));
    if (!box) return;
    b.hidden = false;
    b.addEventListener("click", function () {
      var ds = $$("details", box), open = !ds.every(function (d) { return d.open; });
      ds.forEach(function (d) { d.open = open; });
      b.textContent = open ? "Collapse all" : "Expand all";
    });
  });

  /* ---------------- live catalog ---------------- */
  var CACHE_KEY = "wia_catalog_v1", CACHE_MS = 60 * 1000;
  function loadCatalog() {
    var ss = store("sessionStorage");
    try {
      var hit = ss && JSON.parse(ss.getItem(CACHE_KEY) || "null");
      if (hit && hit.api === W.api && Date.now() - hit.at < CACHE_MS && hit.data) return Promise.resolve(hit.data);
    } catch (e) {}
    if (!W.api || !window.fetch) return Promise.reject(new Error("no api"));
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    return fetch(W.api + "/api/catalog", { headers: { Accept: "application/json" }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error("catalog " + r.status); return r.json(); })
      .then(function (data) {
        if (!data || !Array.isArray(data.courses)) throw new Error("bad catalog");
        try { ss && ss.setItem(CACHE_KEY, JSON.stringify({ api: W.api, at: Date.now(), data: data })); } catch (e) {}
        return data;
      });
  }
  function money(minor, currency) {
    if (typeof minor !== "number" || !isFinite(minor)) return "";
    var cur = String(currency || "usd").toUpperCase();
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100); }
    catch (e) { return (minor / 100).toFixed(2) + " " + cur; }
  }
  function saleEnds(sale) {
    if (!sale || !sale.ends) return null;
    var t = Date.parse(sale.ends);
    return isFinite(t) ? t : null;
  }

  /* Free means billing's live price is 0 (the intro level, or an operator's override to 0).
     Never inferred from the level here: the static "Free intro" label is only the no-JS fallback. */
  function isFree(c) { return !!c && c.price === 0; }

  function renderCourse(el, c) {
    var mode = el.getAttribute("data-mode") || "card";
    if (!c) return; // unknown to billing: keep the no-JS fallback text
    if (c.status !== "on_sale") {
      el.innerHTML = mode === "big"
        ? '<span class="fallback">' + (isFree(c) ? "Free when it opens" : "Not yet open for enrolment") + '</span>'
        : '<span class="fallback">' + (isFree(c) ? "Free · join the waitlist" : "Join the waitlist") + '</span>';
      return;
    }
    if (isFree(c)) {
      el.innerHTML = '<span class="now free">Free</span>';
      el.removeAttribute("aria-label");
      return;
    }
    var ended = saleEnds(c.sale) !== null && saleEnds(c.sale) <= Date.now();
    if (c.sale && !ended) {
      el.innerHTML = '<span class="now on-sale">' + esc(c.sale.priceFormatted) + '</span>' +
        '<s><span class="sr">Was </span>' + esc(c.priceFormatted) + '</s>' +
        (mode === "card" ? "" : "");
      el.setAttribute("aria-label", "Sale price " + c.sale.priceFormatted + ", was " + c.priceFormatted);
    } else {
      el.innerHTML = '<span class="now">' + esc(c.priceFormatted) + '</span>';
      el.removeAttribute("aria-label");
    }
  }

  function renderProgram(el, p, currency) {
    if (!p) return;
    var mode = el.getAttribute("data-mode") || "card";
    if (p.status === "on_sale" && p.price === 0) {
      el.innerHTML = '<span class="now free">Free</span>';
    } else if (p.status === "on_sale" && typeof p.price === "number") {
      var save = typeof p.separately === "number" && p.separately > p.price ? p.separately - p.price : 0;
      el.innerHTML = '<span class="now">' + esc(p.priceFormatted) + '</span>' +
        (save ? '<s><span class="sr">Separately </span>' + esc(p.separatelyFormatted) + '</s>' : "") +
        (save && mode !== "card" && !document.querySelector('[data-save-for="' + p.id + '"]') ? ' <span class="save">Save ' + esc(money(save, currency)) + '</span>' : "");
    } else {
      el.innerHTML = mode === "card"
        ? '<span class="fallback">Opens with its courses</span>'
        : '<span class="fallback">Opens when every course in it is available</span>' +
          (p.separatelyFormatted ? '<span class="sep">Courses bought separately: ' + esc(p.separatelyFormatted) + '</span>' : "");
    }
  }

  function applyStatus(id, status) {
    $$('[data-status-pill="' + id + '"]').forEach(function (p) {
      p.classList.toggle("ok", status === "on_sale"); p.classList.toggle("wait", status !== "on_sale");
      p.textContent = status === "on_sale" ? "Available" : "Waitlist";
    });
    $$('[data-show-when][data-for="' + id + '"]').forEach(function (n) { n.hidden = n.getAttribute("data-show-when") !== status; });
    $$('.card[data-course="' + id + '"]').forEach(function (n) { n.setAttribute("data-status", status); });
  }

  /* After applyStatus: for an on-sale course whose live price is 0, swap Buy/Add to cart for
     "Enroll free"; for any other price, make sure the free block is gone. */
  function applyFree(c) {
    var free = isFree(c);
    $$('.card[data-course="' + c.id + '"]').forEach(function (n) { n.setAttribute("data-free", free ? "1" : "0"); });
    var open = c.status === "on_sale";
    $$('[data-free-for="' + c.id + '"]').forEach(function (n) { n.hidden = !(open && free); });
    if (open && free) $$('[data-show-when="on_sale"][data-for="' + c.id + '"]').forEach(function (n) { n.hidden = true; });
  }

  /* countdowns: one timer for the page */
  var countdowns = [];
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    if (d > 0) return d + "d " + p2(h) + "h " + p2(m) + "m";
    return p2(h) + ":" + p2(m) + ":" + p2(sec);
  }
  function tick() {
    var now = Date.now();
    countdowns.forEach(function (c) {
      var left = c.end - now;
      c.el.textContent = left > 0 ? "Ends in " + fmtLeft(left) : "This sale has ended — refresh for the current price";
      c.el.setAttribute("datetime", new Date(c.end).toISOString());
    });
  }

  function renderSaleBanner(box, c) {
    if (!c || c.status !== "on_sale" || !c.sale) { box.hidden = true; return; }
    var end = saleEnds(c.sale);
    if (end !== null && end <= Date.now()) { box.hidden = true; return; }
    box.innerHTML = '<span class="pill sale">' + esc(c.sale.label || "Sale") + '</span>' +
      (end !== null ? '<time class="countdown" aria-live="off"></time>' : "");
    box.hidden = false;
    var t = $(".countdown", box);
    if (t) {
      t.title = "Sale ends " + new Date(end).toLocaleString();
      countdowns.push({ el: t, end: end });
    }
  }

  function levelPrices(data) {
    var src = $("#course-levels");
    if (!src) return;
    var levels; try { levels = JSON.parse(src.textContent); } catch (e) { return; }
    var byLevel = {};
    data.courses.forEach(function (c) {
      var lv = levels[c.id]; if (!lv) return;
      var label = isFree(c) ? "Free" : c.priceFormatted;
      (byLevel[lv] = byLevel[lv] || {})[label] = ((byLevel[lv] || {})[label] || 0) + 1;
    });
    $$("[data-level-price]").forEach(function (el) {
      var counts = byLevel[el.getAttribute("data-level-price")]; if (!counts) return;
      var best = null, n = 0;
      Object.keys(counts).forEach(function (k) { if (counts[k] > n) { n = counts[k]; best = k; } });
      if (best) el.innerHTML = '<span class="now">' + esc(best) + '</span>';
    });
  }

  var priceEls = $$("[data-price-for]"), saleBoxes = $$("[data-sale-for]"), statusEls = $$("[data-show-when],[data-status-pill],[data-free-for]");
  if (priceEls.length || saleBoxes.length || statusEls.length || $("#course-levels")) {
    loadCatalog().then(function (data) {
      var cur = data.currency, cm = {}, pm = {};
      data.courses.forEach(function (c) { cm[c.id] = c; });
      (data.programs || []).forEach(function (p) { pm[p.id] = p; });
      priceEls.forEach(function (el) {
        var id = el.getAttribute("data-price-for");
        if (el.getAttribute("data-kind") === "program") renderProgram(el, pm[id], cur);
        else renderCourse(el, cm[id]);
      });
      Object.keys(cm).forEach(function (id) { applyStatus(id, cm[id].status); applyFree(cm[id]); });
      Object.keys(pm).forEach(function (id) {
        $$('[data-show-when][data-for="' + id + '"]').forEach(function (n) { n.hidden = n.getAttribute("data-show-when") !== pm[id].status; });
        $$('[data-program-pill="' + id + '"]').forEach(function (n) {
          var on = pm[id].status === "on_sale";
          n.classList.toggle("ok", on); n.classList.toggle("wait", !on);
          n.textContent = on ? "Available" : "Opening as its courses open";
        });
      });
      saleBoxes.forEach(function (b) { renderSaleBanner(b, cm[b.getAttribute("data-sale-for")]); });
      $$("[data-save-for]").forEach(function (el) {
        var p = pm[el.getAttribute("data-save-for")];
        if (p && p.status === "on_sale" && typeof p.price === "number" && p.separately > p.price) {
          el.textContent = "Save " + money(p.separately - p.price, cur) + " against buying separately"; el.hidden = false;
        }
      });
      levelPrices(data);
      if (countdowns.length) { tick(); setInterval(tick, 1000); }
      document.documentElement.setAttribute("data-prices", "live");
      document.dispatchEvent(new CustomEvent("wia:catalog", { detail: data }));
    }).catch(function () {
      document.documentElement.setAttribute("data-prices", "unavailable");
    });
  }

  /* ---------------- course catalog filters ---------------- */
  var cat = $("[data-catalog]");
  if (cat) (function () {
    var cards = $$(".card[data-course]", cat);
    var grid = $("#course-grid"), countEl = $("#result-count"), emptyEl = $("#empty"), clearBtn = $("#clear-filters");
    var miniEl = $("#result-mini");
    if (miniEl) miniEl.addEventListener("click", function () { var t = $(".results-bar"); if (t) { t.scrollIntoView({ block: "start" }); countEl.setAttribute("tabindex", "-1"); countEl.focus({ preventScroll: true }); } });
    var qEl = $("#f-q"), trackEl = $("#f-track"), vendorEl = $("#f-vendor"), sortEl = $("#f-sort");
    var levelChips = $$("[data-level-chip]"), statusChips = $$("[data-status-chip]"), freeChip = $("[data-free-chip]");
    var order = cards.slice();
    var LEVEL_ORDER = { intro: 0, basic: 1, intermediate: 2, expert: 3, executive: 4 };

    var BRANDS = [["Amazon Web Services", /^(amazon|aws)\b/i], ["Alibaba (Qwen)", /^(alibaba|qwen)\b/i], ["Mistral AI", /^mistral\b/i],
      ["NVIDIA", /^nvidia\b/i], ["Hugging Face", /^hugging face\b/i], ["Google", /^(google|gemini|gemma)\b/i], ["Microsoft", /^(microsoft|azure|windows ml)\b/i],
      ["OpenAI", /^openai\b/i], ["Anthropic", /^anthropic\b/i], ["Meta", /^meta\b/i], ["PyTorch", /^pytorch\b/i], ["Apple", /^apple\b/i],
      ["AMD", /^amd\b/i], ["Intel", /^intel\b/i], ["Red Hat", /^red hat\b/i], ["Oracle", /^oracle\b/i], ["GitHub", /^github\b/i], ["Cursor", /^cursor\b/i],
      ["Databricks", /^databricks\b/i], ["Snowflake", /^snowflake\b/i], ["Salesforce", /^salesforce\b/i], ["SAP", /^sap\b/i], ["IBM", /^ibm\b/i],
      ["Allen Institute for AI", /^(allen ?ai|allen institute)\b/i], ["Kubernetes", /^kubernetes\b/i], ["llama.cpp", /llama\.cpp/i], ["Cisco", /^cisco\b/i],
      ["Dell", /^dell\b/i], ["Qualcomm", /^qualcomm\b/i], ["Elastic", /^elastic(search)?\b/i], ["ONNX Runtime", /^onnx\b/i]];
    function normVendor(v) {
      v = String(v).trim(); if (!v) return "";
      for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i][1].test(v)) return BRANDS[i][0];
      return v.split(" (")[0].trim();
    }
    var vcount = {};
    cards.forEach(function (c) {
      var set = {};
      (c.getAttribute("data-vendors") || "").split("|").forEach(function (v) { var n = normVendor(v); if (n) set[n] = 1; });
      c._vendors = set;
      Object.keys(set).forEach(function (n) { vcount[n] = (vcount[n] || 0) + 1; });
    });
    if (vendorEl) {
      Object.keys(vcount).filter(function (n) { return vcount[n] >= 3; })
        .sort(function (a, b) { return vcount[b] - vcount[a] || a.localeCompare(b); })
        .forEach(function (n) { var o = document.createElement("option"); o.value = n; o.textContent = n + " (" + vcount[n] + ")"; vendorEl.appendChild(o); });
    }

    function state() {
      var lv = levelChips.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; }).map(function (b) { return b.getAttribute("data-level-chip"); });
      var st = statusChips.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; }).map(function (b) { return b.getAttribute("data-status-chip"); })[0] || "";
      return { q: (qEl.value || "").trim(), track: trackEl.value, level: lv, vendor: vendorEl ? vendorEl.value : "", status: st, sort: sortEl ? sortEl.value : "",
        free: !!freeChip && freeChip.getAttribute("aria-pressed") === "true" };
    }
    function setState(s) {
      qEl.value = s.q || "";
      trackEl.value = $$("option", trackEl).some(function (o) { return o.value === s.track; }) ? s.track : "";
      if (vendorEl) vendorEl.value = $$("option", vendorEl).some(function (o) { return o.value === s.vendor; }) ? s.vendor : "";
      if (sortEl) sortEl.value = $$("option", sortEl).some(function (o) { return o.value === s.sort; }) ? s.sort : "";
      levelChips.forEach(function (b) { b.setAttribute("aria-pressed", s.level.indexOf(b.getAttribute("data-level-chip")) >= 0 ? "true" : "false"); });
      statusChips.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-status-chip") === (s.status || "") ? "true" : "false"); });
      if (freeChip) freeChip.setAttribute("aria-pressed", s.free ? "true" : "false");
    }
    function fromURL() {
      var u = new URLSearchParams(location.search);
      return { q: u.get("q") || "", track: u.get("track") || "", vendor: u.get("vendor") || "", status: u.get("status") || "", sort: u.get("sort") || "",
        free: u.get("free") === "1",
        level: (u.get("level") || "").split(",").filter(function (x) { return LEVEL_ORDER.hasOwnProperty(x); }) };
    }
    function toURL(s) {
      var u = new URLSearchParams();
      if (s.q) u.set("q", s.q); if (s.track) u.set("track", s.track); if (s.level.length) u.set("level", s.level.join(","));
      if (s.vendor) u.set("vendor", s.vendor); if (s.status) u.set("status", s.status); if (s.free) u.set("free", "1"); if (s.sort) u.set("sort", s.sort);
      var qs = u.toString().replace(/%2C/g, ",");
      var url = location.pathname + (qs ? "?" + qs : "") + location.hash;
      if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
    }
    function apply(push) {
      var s = state(), terms = s.q.toLowerCase().split(/\s+/).filter(Boolean), n = 0;
      cards.forEach(function (c) {
        var ok = (!s.track || c.getAttribute("data-track") === s.track) &&
          (!s.level.length || s.level.indexOf(c.getAttribute("data-level")) >= 0) &&
          (!s.status || c.getAttribute("data-status") === s.status) &&
          (!s.free || c.getAttribute("data-free") === "1") &&
          (!s.vendor || c._vendors[s.vendor]);
        if (ok && terms.length) {
          var t = c.getAttribute("data-text") || "";
          ok = terms.every(function (w) { return t.indexOf(w) >= 0; });
        }
        c.hidden = !ok; if (ok) n++;
      });
      var sorted = order.slice();
      if (s.sort === "track") sorted.sort(function (a, b) { return (+a.getAttribute("data-track-order") || 0) - (+b.getAttribute("data-track-order") || 0) || LEVEL_ORDER[a.getAttribute("data-level")] - LEVEL_ORDER[b.getAttribute("data-level")] || order.indexOf(a) - order.indexOf(b); });
      else if (s.sort === "level") sorted.sort(function (a, b) { return LEVEL_ORDER[a.getAttribute("data-level")] - LEVEL_ORDER[b.getAttribute("data-level")] || order.indexOf(a) - order.indexOf(b); });
      else if (s.sort === "title") sorted.sort(function (a, b) { return $("h3", a).textContent.localeCompare($("h3", b).textContent); });
      else if (s.sort === "") sorted.sort(function (a, b) { return (a.getAttribute("data-status") === "on_sale" ? 0 : 1) - (b.getAttribute("data-status") === "on_sale" ? 0 : 1) || order.indexOf(a) - order.indexOf(b); });
      sorted.forEach(function (c) { grid.appendChild(c); });
      countEl.innerHTML = "<b>" + n + "</b> of " + cards.length + " courses";
      if (miniEl) miniEl.innerHTML = n === 0 ? "No matches" : "Show <b>" + n + "</b> course" + (n === 1 ? "" : "s");
      emptyEl.hidden = n !== 0;
      var active = s.q || s.track || s.level.length || s.vendor || s.status || s.free;
      clearBtn.hidden = !active;
      if (push !== false) toURL(s);
    }
    var debounce;
    qEl.addEventListener("input", function () { clearTimeout(debounce); debounce = setTimeout(apply, 120); });
    [trackEl, vendorEl, sortEl].forEach(function (e) { if (e) e.addEventListener("change", function () { apply(); }); });
    levelChips.forEach(function (b) { b.addEventListener("click", function () { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); apply(); }); });
    statusChips.forEach(function (b) { b.addEventListener("click", function () { statusChips.forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); apply(); }); });
    if (freeChip) freeChip.addEventListener("click", function () { freeChip.setAttribute("aria-pressed", freeChip.getAttribute("aria-pressed") === "true" ? "false" : "true"); apply(); });
    function reset() { setState({ q: "", track: "", level: [], vendor: "", status: "", free: false, sort: sortEl ? sortEl.value : "" }); apply(); qEl.focus(); }
    clearBtn.addEventListener("click", reset);
    var clear2 = $("#clear-filters-2"); if (clear2) clear2.addEventListener("click", reset);
    $("#filter-form").addEventListener("submit", function (e) { e.preventDefault(); apply(); });
    var ft = $(".filters-toggle"), more = $(".filters .more");
    if (ft && more) ft.addEventListener("click", function () { var o = !more.classList.contains("open"); more.classList.toggle("open", o); ft.setAttribute("aria-expanded", o ? "true" : "false"); ft.textContent = o ? "Hide filters" : "More filters"; });
    window.addEventListener("popstate", function () { setState(fromURL()); apply(false); });
    document.addEventListener("wia:catalog", function () { apply(false); });
    setState(fromURL());
    var init = fromURL();
    if (more && ft && (init.track || init.vendor || init.level.length || init.status || init.sort)) { more.classList.add("open"); ft.setAttribute("aria-expanded", "true"); ft.textContent = "Hide filters"; }
    apply(false);
  })();

  /* ---------------- certificate verification ---------------- */
  var vf = $("#verify-form");
  if (vf) (function () {
    var input = $("#cert-id"), out = $("#verify-result");
    var RE = /^WIA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;
    function norm(v) {
      var s = String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
      if (s.indexOf("WIA") === 0) s = s.slice(3);
      return s.length === 12 ? "WIA-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8) : String(v || "").trim().toUpperCase();
    }
    var wantFocus = false;
    function show(cls, html, final) {
      out.className = "result " + cls; out.innerHTML = html; out.hidden = false;
      if (final && wantFocus) { wantFocus = false; out.focus(); }
    }
    function fmtDate(iso) { var d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
    function check(id, focus) {
      wantFocus = !!focus;
      if (!RE.test(id)) { show("bad", "<h2>That is not a certificate ID</h2><p class=\"muted\">IDs look like <code>WIA-7K2M-Q9PX-4HTD</code>: the letters WIA and three groups of four letters or digits. You will find it at the top right of the certificate.</p>", true); return; }
      show("", '<p class="muted" role="status">Checking ' + esc(id) + "…</p>");
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
      fetch(W.api + "/api/certificates/" + encodeURIComponent(id), { headers: { Accept: "application/json" }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          clearTimeout(timer);
          if (r.status === 404) return { notFound: true };
          if (!r.ok) throw new Error("status " + r.status);
          return r.json();
        })
        .then(function (c) {
          if (c.notFound) {
            show("bad", "<h2>No certificate found</h2><p class=\"muted\">There is no certificate with the ID <code>" + esc(id) + "</code>. Check the characters against the certificate — the ID never contains the letters I, L, O or U. If it still does not match, email <a href=\"mailto:sales@wirewalk.com?subject=Certificate%20verification%20" + encodeURIComponent(id) + "\">sales@wirewalk.com</a>.</p>", true);
            return;
          }
          var kind = c.kind === "program" ? "Program certificate" : "Course certificate";
          var ref = c.refId ? (c.kind === "program" ? "/programs/" : "/courses/") + encodeURIComponent(c.refId) + "/" : null;
          var rows = "<dt>Awarded to</dt><dd>" + esc(c.name) + "</dd>" +
            "<dt>" + (c.kind === "program" ? "Program" : "Course") + "</dt><dd>" + (ref ? '<a href="' + ref + '">' + esc(c.title) + "</a>" : esc(c.title)) + "</dd>" +
            "<dt>Type</dt><dd>" + kind + " of completion and assessment</dd>" +
            "<dt>Issued</dt><dd>" + fmtDate(c.issuedAt) + "</dd>" +
            (c.scorePct != null ? "<dt>Exam score</dt><dd>" + esc(c.scorePct) + "%</dd>" : "") +
            "<dt>Certificate ID</dt><dd><code>" + esc(c.id) + "</code></dd>";
          if (c.valid && !c.revoked) {
            show("good", '<h2><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--ok)"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>Valid certificate</h2><p class="muted">Issued by the Wirewalk Institute of AI. It attests that the holder completed the course and passed its automated exam; see <a href="/certification/#limits">what a certificate attests</a>.</p><dl>' + rows + "</dl>", true);
          } else if (c.revoked) {
            show("bad", "<h2>This certificate has been revoked</h2><p class=\"muted\">It was issued by the Wirewalk Institute of AI but has been revoked and is no longer valid. Do not rely on it.</p><dl>" + rows + "</dl>", true);
          } else {
            show("bad", "<h2>This certificate is not currently valid</h2><p class=\"muted\">It was issued by the Wirewalk Institute of AI, but the verification service does not confirm it as valid at the moment. Do not rely on it; email <a href=\"mailto:sales@wirewalk.com?subject=Certificate%20verification%20" + encodeURIComponent(id) + "\">sales@wirewalk.com</a> with the ID if you need to know more.</p><dl>" + rows + "</dl>", true);
          }
        })
        .catch(function () {
          show("bad", "<h2>Verification is unavailable right now</h2><p class=\"muted\">We could not reach the verification service, so this result says nothing about the certificate either way. Try again in a minute, or email <a href=\"mailto:sales@wirewalk.com?subject=Certificate%20verification%20" + encodeURIComponent(id) + "\">sales@wirewalk.com</a> with the ID.</p>", true);
        });
    }
    vf.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = norm(input.value); input.value = id;
      try { history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(id)); } catch (er) {}
      check(id, true);
    });
    var initial = new URLSearchParams(location.search).get("id");
    if (initial) { input.value = norm(initial); check(norm(initial), false); }
  })();

  /* ---------------- free enrollment ----------------
     Signed out: sign in / sign up, then come back here with ?enroll=free, which finishes the job.
     Signed in: POST {api}/api/courses/<id>/enroll-free (billing decides it is free), then open
     the course. The Worker refuses a priced course with 402, so a stale page cannot enrol free. */
  function token() { try { return localStorage.getItem("wia_token"); } catch (e) { return null; } }
  function signInFor(id) { return "/learn/?next=" + encodeURIComponent("/courses/" + id + "/?enroll=free"); }
  function enrollFree(id, btn) {
    var msg = $('[data-enroll-msg="' + id + '"]');
    function say(text) { if (msg) { msg.textContent = text; msg.hidden = false; } }
    var t = token();
    if (!t) { location.assign(signInFor(id)); return; }
    if (!W.api || !window.fetch) { say("Enrollment is unavailable right now. Please try again shortly."); return; }
    var label = btn ? btn.innerHTML : "";
    if (btn) { btn.setAttribute("aria-disabled", "true"); btn.classList.add("busy"); btn.textContent = "Enrolling…"; }
    function restore() { if (btn) { btn.removeAttribute("aria-disabled"); btn.classList.remove("busy"); btn.innerHTML = label; } }
    fetch(W.api + "/api/courses/" + encodeURIComponent(id) + "/enroll-free", {
      method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json", Accept: "application/json" }, body: "{}"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, ok: r.ok, d: d || {} }; });
    }).then(function (x) {
      if (x.ok && x.d.enrolled) { location.assign("/learn/course/?c=" + encodeURIComponent(id)); return; }
      if (x.status === 401) { try { localStorage.removeItem("wia_token"); } catch (e) {} location.assign(signInFor(id)); return; }
      restore();
      if (x.status === 402) {
        /* Not free for this learner after all (the price changed): offer the normal purchase. */
        say("This course is no longer free. You can buy it below.");
        $$('[data-free-for="' + id + '"] .acts').forEach(function (n) { n.hidden = true; });
        $$('[data-show-when="on_sale"][data-for="' + id + '"]').forEach(function (n) { n.hidden = false; });
        return;
      }
      say(x.d.error ? String(x.d.error).charAt(0).toUpperCase() + String(x.d.error).slice(1) + "." : "Enrollment did not go through. Please try again.");
    }, function () { restore(); say("We could not reach the Institute. Check your connection and try again."); });
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("[data-enroll-free]") : null;
    if (!a) return;
    e.preventDefault();
    if (a.getAttribute("aria-disabled") === "true") return;
    enrollFree(a.getAttribute("data-enroll-free"), a);
  });
  (function () {
    var u; try { u = new URLSearchParams(location.search); } catch (e) { return; }
    if (u.get("enroll") !== "free") return;
    var btn = $("[data-enroll-free]");
    u.delete("enroll");
    var qs = u.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
    if (!btn) return;
    /* Signed out: go straight to sign-up / sign-in instead of making the visitor press the
       button a second time; /learn/ brings them back here with ?enroll=free to finish. */
    if (token()) enrollFree(btn.getAttribute("data-enroll-free"), btn);
    else location.replace(signInFor(btn.getAttribute("data-enroll-free")));
  })();

  /* ---------------- header: reflect a signed-in learner (token from the learner app) ---------------- */
  (function () {
    var signed = false;
    try { signed = !!localStorage.getItem("wia_token"); } catch (e) { /* storage blocked */ }
    if (!signed) return;
    $$(".hd-act .signin").forEach(function (a) { a.textContent = "My learning"; });
    $$(".nav-cta").forEach(function (a) { if (a.getAttribute("href") === "/learn/") a.textContent = "My learning"; });
  })();

  /* ---------------- teams enquiry: pre-select from query, keep UTM ---------------- */
  var tf = $("#teams-form");
  if (tf) (function () {
    var q = new URLSearchParams(location.search);
    ["request", "interest"].forEach(function (k) {
      var el = tf.querySelector('[name="' + k + '"]'), v = q.get(k);
      if (el && v && $$("option", el).some(function (o) { return o.value === v; })) el.value = v;
    });
    var seats = q.get("seats"); if (seats && /^\d{1,5}$/.test(seats)) { var s = tf.querySelector('[name="seats"]'); if (s) s.value = seats; }
    ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function (k) {
      var v = q.get(k), el = tf.querySelector('[name="' + k + '"]'); if (v && el) el.value = v.slice(0, 200);
    });
  })();
})();
