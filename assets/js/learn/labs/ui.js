/* [labs] Decision Lab player components: metric formatting, the metrics dashboard with animated
   deltas, materials as expandable documents, choice cards, delta chips and the decision timeline.
   Loaded after learn/common.js and learn/labs/links.js; used by learn/labs/player.js.
   Server HTML (scene text, materials, outcomes, debriefs) is sanitized by the Worker
   (src/sanitize.js) exactly like lesson HTML, and is the only HTML written with innerHTML. */
(function () {
  "use strict";
  var W = window.WL, h = W.h;

  var reduced = (function () { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
  function prefersReduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return reduced; } }

  /* ---------- numbers ---------- */
  /* [lx] usd_k / usd_m are values in thousands / millions of dollars; "rate" is a count per `per`
     (year, month, week), which may qualify any unit: "$1.3M/yr", "6/mo", "4 hrs/wk". */
  var UNIT = { usd: "", percent: "%", points: " pts", weeks: " wk", days: " days", hours: " hrs", months: " mo", count: "", people: "", score: "", rate: "" };
  var UNIT_LONG = { usd: "dollars", percent: "percent", points: "points", weeks: "weeks", days: "days", hours: "hours", months: "months" };
  var PER = { year: "/yr", month: "/mo", week: "/wk" };
  /* [lx] A nonzero amount never prints as "0": it falls back to two significant digits ("0.04"). */
  function group(n, frac) {
    var a = Math.abs(n), s;
    try { s = a.toLocaleString("en-US", { maximumFractionDigits: frac == null ? 1 : frac }); } catch (e) { s = String(a); }
    if (a && !/[1-9]/.test(s)) { try { s = a.toLocaleString("en-US", { maximumSignificantDigits: 2 }); } catch (e) { s = String(a); } }
    return s;
  }
  function compactUsd(n) {
    var a = Math.abs(n), s;
    if (a >= 1e9) s = (a / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
    else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    else if (a >= 1e4) s = Math.round(a / 1e3) + "K";
    else s = group(a);
    return s;
  }
  /** [lx] A value already in K or M: two decimals under 10, one under 100 ("$1.27M", "$12.5M", "$180K"); 1,000+ moves up a scale; zero is "$0". */
  function scaled(a, scale) {
    var next = { K: "M", M: "B" };
    if (!a) return "0";
    if (a >= 1000 && next[scale]) return scaled(a / 1000, next[scale]);
    return group(a, a < 10 ? 2 : a < 100 ? 1 : 0) + scale;
  }
  /** Display value: "$200K", "85 pts", "12%", "$1.3M/yr". */
  function fmt(m, v, opts) {
    v = Number(v) || 0;
    var neg = v < 0 ? "−" : "", per = PER[m.per] || "";
    if (m.unit === "usd") return neg + "$" + (opts && opts.full ? group(v) : compactUsd(v)) + per;
    if (m.unit === "usd_k") return neg + "$" + scaled(Math.abs(v), "K") + per;
    if (m.unit === "usd_m") return neg + "$" + scaled(Math.abs(v), "M") + per;
    var u = UNIT.hasOwnProperty(m.unit) ? UNIT[m.unit] : " " + m.unit;
    return neg + group(v) + u + per;
  }
  /** Signed delta: "+$40K", "−5 pts". */
  function fmtDelta(m, d) { return (d > 0 ? "+" : d < 0 ? "−" : "±") + fmt(m, Math.abs(d)).replace(/^−/, ""); }
  /** Spoken amount: "$1.27 million per year", "10 points". */
  function spokenAmount(m, v) {
    var per = m.per ? " per " + m.per : "";
    if (m.unit === "usd") return "$" + group(v) + per;
    if (m.unit === "usd_k" || m.unit === "usd_m") return fmt(m, Math.abs(v)).replace(/\/(yr|mo|wk)$/, "").replace(/K$/, " thousand").replace(/M$/, " million").replace(/B$/, " billion") + per;
    var unit = UNIT_LONG[m.unit] || (m.unit === "rate" || UNIT[m.unit] === "" ? "" : m.unit || "");
    return group(v) + (unit ? " " + unit : "") + per;
  }
  /** For screen readers: "Billing team trust up 10 points to 60 points, better". */
  function spokenDelta(m, d, now) {
    var better = isBetter(m, d);
    return m.label + (d > 0 ? " up " : " down ") + spokenAmount(m, Math.abs(d)) + " to " + (now < 0 ? "minus " : "") + spokenAmount(m, Math.abs(now)) + (better ? ", better" : ", worse");
  }
  /** [lx] The timeline's metric name: `short`, else the label's first word (acronyms keep their case: "CFO", not "cfo"). */
  function shortLabel(m) {
    if (m.short) return m.short;
    var w = String(m.label || "").split(" ")[0];
    return /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w;
  }
  function isBetter(m, d) { return m.good === "low" ? d < 0 : d > 0; }
  function tone(m, d) { return !d ? "" : isBetter(m, d) ? "up-good" : "up-bad"; }

  /** Bar fill 0..100 for a metric value. Bounded metrics use min/max; others scale to the largest value seen. */
  function fill(m, v, peak) {
    if (m.min != null && m.max != null && m.max > m.min) return Math.max(0, Math.min(100, (100 * (v - m.min)) / (m.max - m.min)));
    var top = Math.max(Math.abs(peak || 0), Math.abs(m.start || 0), Math.abs(v), 1) * 1.15;
    return Math.max(2, Math.min(100, (100 * Math.abs(v)) / top));
  }

  /* ---------- count-up ---------- */
  function countTo(el, m, from, to) {
    if (prefersReduced() || from === to) { el.textContent = fmt(m, to); return; }
    var t0 = null, dur = 700;
    function frame(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var v = from + (to - from) * e;
      var whole = Math.round(from) === from && Math.round(to) === to;
      el.textContent = fmt(m, whole || Math.abs(to - from) >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
      if (p < 1) window.requestAnimationFrame(frame); else el.textContent = fmt(m, to);
    }
    window.requestAnimationFrame(frame);
  }

  /* ---------- dashboard ---------- */
  /** Build the metrics dashboard. Returns {el, update(metrics, deltas)}. */
  function dashboard(metrics, values) {
    var peak = {}, tiles = {}, cur = {};
    var grid = h("div", { class: "lab-dash-grid", role: "list" });
    metrics.forEach(function (m) {
      var v = values[m.id];
      cur[m.id] = v; peak[m.id] = Math.max(Math.abs(v), Math.abs(m.start || 0));
      var value = h("span", { class: "lab-tile-v" }, fmt(m, v));
      var delta = h("span", { class: "lab-tile-d", "aria-hidden": "true" });
      var bar = h("span", { class: "lab-tile-fill" });
      bar.style.width = fill(m, v, peak[m.id]) + "%";
      var sr = h("span", { class: "wl-sr" });
      var tile = h("div", { class: "lab-tile", role: "listitem", "data-metric": m.id, "data-good": m.good },
        h("div", { class: "lab-tile-top" },
          h("span", { class: "lab-tile-l" }, m.label),
          h("span", { class: "lab-tile-dir", title: m.good === "high" ? "Higher is better" : "Lower is better" },
            h("span", { "aria-hidden": "true" }, m.good === "high" ? "↑" : "↓"),
            h("span", { class: "wl-sr" }, m.good === "high" ? " (higher is better)" : " (lower is better)"))),
        h("div", { class: "lab-tile-mid" }, value, delta),
        h("div", { class: "lab-tile-bar", "aria-hidden": "true" }, bar), sr);
      sr.textContent = ": " + fmt(m, v, { full: true });
      tiles[m.id] = { tile: tile, value: value, delta: delta, bar: bar, sr: sr };
      grid.appendChild(tile);
    });
    var el = h("section", { class: "lab-dash", "aria-labelledby": "lab-dash-h" },
      h("h2", { id: "lab-dash-h", class: "lab-side-h" }, "Dashboard"), grid);
    function update(next, deltas) {
      metrics.forEach(function (m) {
        var t = tiles[m.id], from = cur[m.id], to = next[m.id];
        if (to === undefined) return;
        peak[m.id] = Math.max(peak[m.id], Math.abs(to));
        var d = deltas && deltas[m.id] ? deltas[m.id] : 0;
        countTo(t.value, m, from, to);
        t.bar.style.width = fill(m, to, peak[m.id]) + "%";
        t.sr.textContent = ": " + fmt(m, to, { full: true });
        t.tile.classList.remove("is-up-good", "is-up-bad", "is-pulse");
        if (d) {
          t.delta.textContent = fmtDelta(m, d);
          t.delta.className = "lab-tile-d is-" + tone(m, d);
          void t.tile.offsetWidth;   // restart the pulse animation
          t.tile.classList.add("is-" + tone(m, d), "is-pulse");
        } else { t.delta.textContent = ""; t.delta.className = "lab-tile-d"; }
        cur[m.id] = to;
      });
    }
    return { el: el, update: update };
  }

  /** Delta chips for a consequence or event: [+10 pts Trust] ... with a spoken summary. */
  function deltaChips(metrics, deltas, values) {
    var items = metrics.filter(function (m) { return deltas && deltas[m.id]; });
    if (!items.length) return { el: h("p", { class: "lab-nochange" }, "No change on the dashboard."), spoken: "No change on the dashboard." };
    var spoken = items.map(function (m) { return spokenDelta(m, deltas[m.id], values ? values[m.id] : 0); }).join(". ") + ".";
    var el = h("ul", { class: "lab-chips", role: "list", "aria-label": "Dashboard changes" }, items.map(function (m, i) {
      var d = deltas[m.id];
      var li = h("li", { class: "lab-chip is-" + tone(m, d) },
        h("span", { class: "lab-chip-arrow", "aria-hidden": "true" }, d > 0 ? "▲" : "▼"),
        h("span", { class: "lab-chip-v", "aria-hidden": "true" }, fmtDelta(m, d)),
        h("span", { class: "lab-chip-l", "aria-hidden": "true" }, m.label),
        h("span", { class: "wl-sr" }, spokenDelta(m, d, values ? values[m.id] : 0)));
      li.style.setProperty("--i", String(i));
      return li;
    }));
    return { el: el, spoken: spoken };
  }

  /* ---------- materials ---------- */
  var MAT_LABEL = { email: "Email", memo: "Memo", table: "Data", log: "Log", quote: "Quote", chat: "Chat", policy: "Policy", report: "Report",
    document: "Document", contract: "Contract", dashboard: "Dashboard" };
  function html(cls, markup) { var d = h("div", { class: cls }); d.innerHTML = markup || ""; tables(d); return d; }
  /** Wide tables scroll inside a focusable region (as in lessons). */
  function tables(root) {
    Array.prototype.forEach.call(root.querySelectorAll("table"), function (t, n) {
      var wrap = h("div", { class: "wl-table-wrap", role: "region", tabindex: "0", "aria-label": "Table " + (n + 1) + " (scrolls sideways)" });
      t.parentNode.insertBefore(wrap, t); wrap.appendChild(t);
      /* Say when a table is wider than its box (phones), so nobody decides on half the columns. */
      var hint = h("p", { class: "lab-scroll-hint", "aria-hidden": "true" }, "Scroll sideways for more →");
      wrap.parentNode.insertBefore(hint, wrap.nextSibling);
      var check = function () {
        var more = wrap.scrollWidth > wrap.clientWidth + 2;
        var rest = more && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 2;
        wrap.classList.toggle("is-more", rest);
        hint.classList.toggle("is-on", rest);
      };
      wrap.addEventListener("scroll", check, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(check).observe(wrap); else window.addEventListener("resize", check);
      setTimeout(check, 0);
    });
    Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (a) {
      try { var u = new URL(a.getAttribute("href"), window.location.href); if (u.origin !== window.location.origin) { a.target = "_blank"; a.rel = "noopener noreferrer"; } } catch (e) { /* ignore */ }
    });
  }
  function material(mt, i) {
    var kind = MAT_LABEL[mt.kind] ? mt.kind : "document";
    var meta = [];
    if (mt.from) meta.push(h("div", null, h("dt", null, "From"), h("dd", null, mt.from)));
    if (mt.to) meta.push(h("div", null, h("dt", null, "To"), h("dd", null, mt.to)));
    if (mt.date) meta.push(h("div", null, h("dt", null, "Sent"), h("dd", null, mt.date)));
    if (mt.subject) meta.push(h("div", null, h("dt", null, "Subject"), h("dd", null, mt.subject)));
    var det = h("details", { class: "lab-doc lab-doc-" + kind },
      h("summary", null,
        h("span", { class: "lab-doc-ico", "aria-hidden": "true" }),
        h("span", { class: "lab-doc-k" }, MAT_LABEL[kind]),
        h("span", { class: "lab-doc-t" }, mt.title),
        h("span", { class: "lab-doc-open", "aria-hidden": "true" })),
      h("div", { class: "lab-doc-paper" },
        meta.length ? h("dl", { class: "lab-doc-meta" }, meta) : null,
        html("lab-doc-body wl-prose", mt.body)));
    if (i === 0 && window.matchMedia && window.matchMedia("(min-width: 900px)").matches) det.open = true;
    return det;
  }
  function materials(list) {
    if (!list || !list.length) return null;
    return h("section", { class: "lab-docs", "aria-label": "Materials" },
      h("p", { class: "lab-docs-h" }, list.length === 1 ? "1 document on your desk" : list.length + " documents on your desk"),
      list.map(material));
  }

  /* ---------- timeline ---------- */
  var EVENT_LABEL = { alert: "Alert", news: "Breaking news", message: "Message", call: "Call", time: "Time passes", board: "Board" };
  function timeline(metrics, items) {
    var list = h("ol", { class: "lab-tl", role: "list" });
    var n = 0;
    (items || []).forEach(function (t) {
      var ds = metrics.filter(function (m) { return t.deltas && t.deltas[m.id]; }).map(function (m) {
        return h("span", { class: "lab-tl-d is-" + tone(m, t.deltas[m.id]) }, fmtDelta(m, t.deltas[m.id]) + " " + shortLabel(m));
      });
      /* [lx] The ending's own effects get a row ("Six months later"), so the timeline adds up to the final table. */
      if (t.t === "ending") {
        if (ds.length) list.appendChild(h("li", { class: "lab-tl-i is-event is-reckoning" },
          h("span", { class: "lab-tl-dot", "aria-hidden": "true" }, "…"),
          h("div", { class: "lab-tl-b" }, h("p", { class: "lab-tl-t" }, "Six months later"), h("p", { class: "lab-tl-ds" }, ds))));
        return;
      }
      var isEvent = t.t === "event";
      if (!isEvent) n++;
      list.appendChild(h("li", { class: "lab-tl-i" + (isEvent ? " is-event" : "") },
        h("span", { class: "lab-tl-dot", "aria-hidden": "true" }, isEvent ? "!" : String(n)),
        h("div", { class: "lab-tl-b" },
          h("p", { class: "lab-tl-t" }, isEvent ? "Event: " + t.title : t.title),
          !isEvent ? h("p", { class: "lab-tl-c" }, t.label) : null,
          ds.length ? h("p", { class: "lab-tl-ds" }, ds) : null)));
    });
    if (!list.children.length) list.appendChild(h("li", { class: "lab-tl-empty" }, "Your decisions will appear here."));
    return list;
  }

  /* ---------- rating ---------- */
  function ratingBadge(rating, big) {
    var L = window.WLLabs;
    return h("div", { class: "lab-medal lab-medal-" + (rating || "none") + (big ? " is-big" : "") },
      h("span", { class: "lab-medal-ring", "aria-hidden": "true" }, h("span", { class: "lab-medal-core" }, rating === "best" ? "★" : rating === "good" ? "✓" : rating === "mixed" ? "≈" : "!")),
      h("span", { class: "lab-medal-t" }, (L && L.RATING[rating]) || "Outcome"));
  }
  var QUALITY = { strong: "Strong choice", reasonable: "Reasonable choice", weak: "Weak choice" };
  function qualityChip(q) { return h("span", { class: "lab-q lab-q-" + (q || "none") }, QUALITY[q] || "Choice"); }

  window.WLLabUI = { fmt: fmt, fmtDelta: fmtDelta, spokenDelta: spokenDelta, shortLabel: shortLabel, isBetter: isBetter, tone: tone, fill: fill, dashboard: dashboard,
    deltaChips: deltaChips, materials: materials, html: html, timeline: timeline, ratingBadge: ratingBadge, qualityChip: qualityChip,
    EVENT_LABEL: EVENT_LABEL, prefersReduced: prefersReduced };
})();
