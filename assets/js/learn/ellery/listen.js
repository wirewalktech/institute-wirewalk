/* [ellery] /learn/lesson/ : "Listen" read-aloud with the browser's speechSynthesis.
 *
 * - Reads the lesson as rendered: title, headings, paragraphs, list items one by one, table rows as
 *   "Column: value", and code blocks as "Code example skipped" (unless "Read code aloud" is on).
 * - One utterance per sentence (Intl.Segmenter, else a regex): short utterances avoid the
 *   long-utterance cut-off in some Chrome versions and make pause/resume reliable. Pause is
 *   cancel() plus the sentence index; resume starts that sentence again.
 * - Highlighting: the sentence being read is highlighted with the CSS Custom Highlight API (no
 *   change to the lesson's DOM); browsers without it get a class on the block instead. The
 *   current sentence also shows as a caption in the player bar.
 * - Controls: play/pause, previous/next sentence, speed 0.75x to 1.75x, voice picker (English voices,
 *   natural/neural/enhanced first), "Read code aloud". Saved in localStorage "wia_voice".
 * - The player sits in the DOM right after the lesson toolbar (it is fixed on screen), and focus
 *   moves to its play/pause button on first play, so keyboard users reach it at once. The toolbar
 *   button keeps the label "Listen" and reports playing with aria-pressed. Esc stops from the bar
 *   or the toolbar button. Starting voice input pauses reading ("ellery:mic-start").
 * - No speechSynthesis, or no voices within 3 seconds: no Listen button at all.
 */
(function () {
  "use strict";
  var E = window.Ellery;
  if (!E || !("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) return;
  var h = E.h, synth = window.speechSynthesis;
  var BLOCKS = "h1,h2,h3,h4,h5,p,li,blockquote,tr,pre,dt,dd,figcaption";
  var items = [], idx = 0, playing = false, gen = 0, voices = [], prefs = E.voicePrefs(), bar = null, btn = null, built = false, hl = null;
  var useHighlight = !!(window.CSS && CSS.highlights && window.Highlight);

  function start() {
    E.voices().then(function (list) {
      voices = list;
      if (!list.length) return;          // unsupported: show nothing
      button();
    });
  }

  function button() {
    var bar0 = document.querySelector(".ell-toolbar");
    if (!bar0) {
      var head = document.querySelector(".wl-lesson-head");
      if (!head) return;
      bar0 = h("div", { class: "ell-toolbar", role: "group", "aria-label": "Lesson tools" });
      head.appendChild(bar0);
    }
    btn = h("button", { type: "button", class: "ell-tool ell-tool-listen", "aria-pressed": "false", "aria-label": "Listen to this lesson", onclick: toggle },
      E.icon(E.ICONS.speaker, 17), h("span", null, "Listen"));
    btn.addEventListener("keydown", function (e) { if (e.key === "Escape" && (playing || (bar && !bar.hidden))) { e.preventDefault(); stop(); } });
    bar0.appendChild(btn);
    window.addEventListener("pagehide", function () { synth.cancel(); });
    window.addEventListener("ellery:mic-start", function () { if (playing) pause(); });
  }

  /* ---------------- text model ---------------- */
  function collect() {
    items = [];
    var title = document.getElementById("lesson-title");
    if (title) push(title, title.textContent);
    var art = document.getElementById("lesson-body");
    if (!art) return;
    var all = Array.prototype.slice.call(art.querySelectorAll(BLOCKS));
    all.forEach(function (el) {
      if (el.closest(".ell-card, .wl-code-bar")) return;
      if (el.tagName !== "PRE" && el.closest("pre")) return;
      /* leaf blocks only (a list item that holds paragraphs is read through its paragraphs) */
      if (el.tagName !== "TR" && el.tagName !== "PRE" && el.querySelector(BLOCKS)) {
        var own = directText(el);
        if (own) pushText(el, own, null);
        return;
      }
      if (el.tagName === "PRE") {
        if (prefs.readCode) push(el, el.textContent);
        else pushText(el, "Code example skipped.", null);
        return;
      }
      if (el.tagName === "TR") { row(el); return; }
      if (el.closest("table")) return;
      push(el, null);
    });
  }
  function directText(el) {
    var t = "";
    Array.prototype.forEach.call(el.childNodes, function (n) { if (n.nodeType === 3) t += n.nodeValue; else if (n.nodeType === 1 && !n.matches(BLOCKS) && !n.querySelector(BLOCKS)) t += n.textContent; });
    return t.replace(/\s+/g, " ").trim();
  }
  function row(tr) {
    var table = tr.closest("table");
    var heads = table ? Array.prototype.map.call(table.querySelectorAll("thead th, tr:first-child th"), function (x) { return x.textContent.trim(); }) : [];
    var cells = Array.prototype.slice.call(tr.children);
    if (cells.every(function (c) { return c.tagName === "TH"; })) return;          // the header row itself
    var text = cells.map(function (c, i) { var k = heads[i]; var v = c.textContent.replace(/\s+/g, " ").trim(); return k && k !== v ? k + ": " + v : v; })
      .filter(Boolean).join(". ");
    pushText(tr, text + ".", whole(tr));
  }
  function whole(el) { var r = document.createRange(); r.selectNodeContents(el); return r; }
  function pushText(block, text, range) { if (text && /\w/.test(text)) items.push({ text: text, block: block, range: range }); }
  /** Split one block into sentences and map each to a Range over its text nodes. */
  function push(block, text) {
    var nodes = [], walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null), n, full = "";
    while ((n = walker.nextNode())) {
      if (n.parentNode && n.parentNode.closest && n.parentNode.closest("button, .wl-sr, .ell-sr")) continue;
      nodes.push({ node: n, start: full.length }); full += n.nodeValue;
    }
    if (text == null) text = full;
    if (!/\w/.test(full)) return;
    sentences(full).forEach(function (s) {
      var r = null;
      try {
        var a = locate(nodes, s.start), b = locate(nodes, s.end);
        if (a && b) { r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); }
      } catch (e) { r = null; }
      pushText(block, s.text, r);
    });
  }
  function locate(nodes, pos) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (pos >= nodes[i].start) return { node: nodes[i].node, offset: Math.min(pos - nodes[i].start, nodes[i].node.nodeValue.length) };
    }
    return null;
  }
  /** [{text, start, end}] with offsets into `s`. */
  function sentences(s) {
    var out = [];
    try {
      if (window.Intl && Intl.Segmenter) {
        var it = new Intl.Segmenter("en", { granularity: "sentence" }).segment(s)[Symbol.iterator](), x;
        while (!(x = it.next()).done) add(x.value.segment, x.value.index);
        return out;
      }
    } catch (e) { out = []; }
    var re = /[^.!?]+(?:[.!?]+["')\]]*|$)/g, m;
    while ((m = re.exec(s))) { add(m[0], m.index); if (!m[0]) re.lastIndex++; }
    return out;
    function add(seg, at) {
      var lead = seg.length - seg.replace(/^\s+/, "").length, t = seg.trim();
      if (t) out.push({ text: t.replace(/\s+/g, " "), start: at + lead, end: at + lead + t.length });
    }
  }

  /* ---------------- player ---------------- */
  function toggle() { playing ? pause() : play(); }
  function play() {
    var first = !built;
    if (!built) { collect(); buildBar(); built = true; }
    else { bar.hidden = false; document.documentElement.classList.add("ell-listening"); }
    if (first && bar._pp) setTimeout(function () { try { bar._pp.focus(); } catch (e) { /* ignore */ } }, 0);
    if (!items.length) return;
    if (idx >= items.length) idx = 0;
    playing = true; setButtons();
    speakAt(idx);
  }
  function pause() { playing = false; gen++; synth.cancel(); setButtons(); }
  function stop() { pause(); idx = 0; mark(null); if (bar) bar.hidden = true; document.documentElement.classList.remove("ell-listening"); if (btn) btn.focus(); }
  function step(d) { idx = Math.max(0, Math.min(items.length - 1, idx + d)); if (playing) speakAt(idx); else { mark(items[idx]); caption(items[idx]); } }
  function voiceObj() { for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === prefs.voiceURI) return voices[i]; return voices[0] || null; }
  function speakAt(i) {
    var my = ++gen;
    synth.cancel();
    var it = items[i];
    if (!it) { playing = false; idx = 0; mark(null); setButtons(); caption(null, "Finished reading the lesson."); return; }
    var u = new SpeechSynthesisUtterance(it.text);
    var v = voiceObj();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
    u.rate = prefs.rate;
    u.onstart = function () { if (my !== gen) return; idx = i; mark(it); caption(it); };
    u.onend = function () { if (my !== gen || !playing) return; idx = i + 1; speakAt(idx); };
    u.onerror = function (e) { if (my !== gen) return; if (e && (e.error === "interrupted" || e.error === "canceled")) return; idx = i + 1; if (playing) speakAt(idx); };
    /* Safari sometimes drops the first utterance after cancel(); a microtask gap avoids it. */
    setTimeout(function () { if (my === gen) synth.speak(u); }, 0);
  }

  function mark(it) {
    Array.prototype.forEach.call(document.querySelectorAll(".wia-speaking"), function (x) { x.classList.remove("wia-speaking"); });
    if (useHighlight) {
      if (!hl) { hl = new Highlight(); CSS.highlights.set("wia-speaking", hl); }
      hl.clear();
    }
    if (!it) return;
    if (useHighlight && it.range) hl.add(it.range);
    else it.block.classList.add("wia-speaking");
    var r = (it.range || whole(it.block)).getBoundingClientRect();
    var bottom = window.innerHeight - (bar && !bar.hidden ? bar.offsetHeight : 0);
    if (r.top < 70 || r.bottom > bottom - 10) it.block.scrollIntoView({ block: "center", behavior: E.reducedMotion() ? "auto" : "smooth" });
  }
  function caption(it, text) {
    if (!bar) return;
    bar._cap.textContent = text || (it ? it.text : "");
    bar._pos.textContent = items.length ? "Sentence " + Math.min(items.length, idx + 1) + " of " + items.length : "";
  }
  function setButtons() {
    if (btn) btn.setAttribute("aria-pressed", playing ? "true" : "false");          // fixed label "Listen"; state is aria-pressed
    if (bar) {
      var pp = bar._pp;
      E.clear(pp).appendChild(E.icon(playing ? E.ICONS.pause : E.ICONS.play, 20));
      pp.setAttribute("aria-label", playing ? "Pause reading" : "Resume reading");
    }
  }

  function buildBar() {
    var pp = h("button", { type: "button", class: "ell-icon-btn ell-pp", "aria-label": "Pause reading", onclick: toggle });
    var prev = h("button", { type: "button", class: "ell-icon-btn", "aria-label": "Previous sentence", onclick: function () { step(-1); } }, E.icon(E.ICONS.prev, 18));
    var next = h("button", { type: "button", class: "ell-icon-btn", "aria-label": "Next sentence", onclick: function () { step(1); } }, E.icon(E.ICONS.next, 18));
    var close = h("button", { type: "button", class: "ell-icon-btn", "aria-label": "Stop and close the player", onclick: stop }, E.icon(E.ICONS.close, 18));
    var speed = h("select", { id: "ell-rate", class: "ell-select" }, [0.75, 1, 1.25, 1.5, 1.75].map(function (r) {
      return h("option", { value: String(r), selected: Math.abs(r - prefs.rate) < 0.01 }, r + "×");
    }));
    var voice = h("select", { id: "ell-voice", class: "ell-select" }, voices.map(function (v) {
      return h("option", { value: v.voiceURI, selected: v.voiceURI === prefs.voiceURI }, v.name.replace(/\s*\(.*\)\s*$/, "") + " (" + v.lang + ")");
    }));
    var code = h("input", { type: "checkbox", id: "ell-code", checked: prefs.readCode });
    function save() { E.saveVoicePrefs(prefs); }
    speed.addEventListener("change", function () { prefs.rate = Number(speed.value); save(); if (playing) speakAt(idx); });
    voice.addEventListener("change", function () { prefs.voiceURI = voice.value; save(); if (playing) speakAt(idx); });
    code.addEventListener("change", function () {
      prefs.readCode = code.checked; save();
      var was = playing; pause(); collect(); idx = Math.min(idx, items.length - 1); if (was) play();
    });
    var cap = h("p", { class: "ell-caption", "aria-live": "off" });
    var pos = h("span", { class: "ell-pos" });
    bar = h("div", { class: "ell-player", role: "region", "aria-label": "Lesson read-aloud player" },
      h("div", { class: "ell-player-main" },
        h("div", { class: "ell-player-ctl" }, prev, pp, next),
        h("div", { class: "ell-player-cap" }, h("span", { class: "ell-player-k" }, "Now reading", pos), cap),
        close),
      h("details", { class: "ell-player-set" }, h("summary", null, "Voice and speed"),
        h("div", { class: "ell-row" },
          h("div", { class: "ell-field" }, h("label", { for: "ell-rate" }, "Speed"), speed),
          h("div", { class: "ell-field" }, h("label", { for: "ell-voice" }, "Voice"), voice)),
        h("label", { class: "ell-check", for: "ell-code" }, code, " Read code aloud")));
    bar._pp = pp; bar._cap = cap; bar._pos = pos;
    bar.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); stop(); } });
    var tb = document.querySelector(".ell-toolbar");
    if (tb && tb.parentNode) tb.parentNode.insertBefore(bar, tb.nextSibling); else document.body.appendChild(bar);
    document.documentElement.classList.add("ell-listening");
  }

  if (window.WLLesson) start();
  else document.addEventListener("wl:lesson", start);
})();
