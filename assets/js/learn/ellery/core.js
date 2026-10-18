/* [ellery] Shared client for Ellery, the AI instructor (window.Ellery).
 *
 * Loaded after /assets/js/api.js on every page with an Ellery surface (lesson player, course page,
 * role-play and exercise pages, dashboard, home, /go/ and /faq/). Never loaded on /learn/exam/.
 *
 * - request(): fetch() to the learning Worker's /api/ai/* routes. With {stream:true} it sends
 *   Accept: text/event-stream and reads the response body as Server-Sent Events (EventSource
 *   cannot send the Authorization header). Gate failures come back as JSON errors and are thrown
 *   as Ellery.Err {status, reason, message, resetAt}.
 * - md(): the only renderer for model output. It builds DOM nodes with textContent: there is no
 *   innerHTML anywhere in Ellery. Paragraphs, **bold**, *italic*, `code`, lists, fenced code and
 *   (debriefs only) pipe tables. No images, no raw links: the only links are in-page anchors built
 *   from the server's verified citations.
 * - state(): one friendly view for every "can't answer now" case (paused, quota, exam open, not on
 *   this course, cool-down, offline, upstream error).
 * - mic(): push-to-talk with the browser's SpeechRecognition (never sends automatically).
 * - voices()/speak(): browser speech synthesis for role-play replies; Listen lives in listen.js.
 * Every storage access is wrapped in try/catch; the page works with storage blocked.
 */
(function () {
  "use strict";
  var API = window.WIAApi;
  if (!API || window.Ellery) return;

  /* ---------------- DOM ---------------- */
  var SVGNS = "http://www.w3.org/2000/svg";
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return el;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return el; }
    el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  /** Small inline icon from a list of SVG path strings (stroke icons, currentColor). */
  function icon(paths, size) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", String(size || 18)); s.setAttribute("height", String(size || 18));
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    paths.forEach(function (d) { var p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); s.appendChild(p); });
    return s;
  }
  var ICONS = {
    spark: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
    mic: ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M19 11a7 7 0 0 1-14 0", "M12 18v3"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    up: ["M7 11v9H4v-9z", "M7 11l4-8a2 2 0 0 1 3 2l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7"],
    down: ["M17 13V4h3v9z", "M17 13l-4 8a2 2 0 0 1-3-2l1-4H5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 6.3 4H17"],
    play: ["M7 4l13 8-13 8z"],
    pause: ["M7 4h3v16H7z", "M14 4h3v16h-3z"],
    prev: ["M18 5l-9 7 9 7z", "M6 5v14"],
    next: ["M6 5l9 7-9 7z", "M18 5v14"],
    speaker: ["M4 9h4l5-4v14l-5-4H4z", "M16.5 8.5a5 5 0 0 1 0 7", "M19 6a8.5 8.5 0 0 1 0 12"],
    stop: ["M6 6h12v12H6z"],
    expand: ["M4 14v6h6", "M20 10V4h-6", "M4 20l7-7", "M20 4l-7 7"]
  };

  /* ---------------- storage ---------------- */
  function lsGet(key, fallback) {
    try { var v = window.localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { if (val === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  /* ---------------- errors ---------------- */
  function Err(status, message, data) {
    this.name = "ElleryError";
    this.status = status;
    this.message = message || "Something went wrong. Try again.";
    this.reason = (data && data.reason) || (status === 0 ? "offline" : "");
    this.resetAt = (data && data.resetAt) || null;
    this.data = data || null;
  }
  Err.prototype = Object.create(Error.prototype);
  Err.prototype.constructor = Err;

  function capital(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------------- requests ---------------- */
  function token() { return API.token.get(); }

  /**
   * request(method, path, body, opts)
   * opts.auth: true (token required) | "optional" (default) | false
   * opts.stream: send Accept: text/event-stream and call opts.onEvent(name, data) per event.
   * opts.signal: AbortSignal (the Stop button).
   * Resolves with the JSON body, or for a stream {meta, done, error, retracted}.
   */
  function request(method, path, body, opts) {
    opts = opts || {};
    var auth = opts.auth === undefined ? "optional" : opts.auth;
    var t = token();
    if (auth === true && !t) return Promise.reject(new Err(401, "Sign in to continue.", { reason: "signin" }));
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.reject(new Err(0, "You're offline. Reconnect to ask " + name() + ".", { reason: "offline" }));
    var headers = { "Accept": opts.stream ? "text/event-stream" : "application/json" };
    if (auth && t) headers.Authorization = "Bearer " + t;
    var init = { method: method, headers: headers, mode: "cors", credentials: "omit", cache: "no-store" };
    if (opts.signal) init.signal = opts.signal;
    if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(API.base() + path, init).then(function (res) {
      var ct = res.headers.get("Content-Type") || "";
      if (res.ok && opts.stream && /text\/event-stream/i.test(ct) && res.body && res.body.getReader) return readSse(res, opts.onEvent || function () {});
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) {
          if (res.status === 401 && auth && t) {
            API.token.clear();
            try { window.dispatchEvent(new CustomEvent("wia:unauthorized")); } catch (e) { /* old browser */ }
          }
          throw new Err(res.status, capital((data && data.error) || defaultMessage(res.status)), data);
        }
        if (data === null) throw new Err(res.status, "The server sent an unexpected response. Please try again.", { reason: "bad_response" });
        if (opts.stream) {
          /* A JSON answer to a streaming request (a proxy that strips SSE): replay it as events. */
          var cb = opts.onEvent || function () {};
          cb("meta", data); cb("done", data);
          return { meta: data, done: data };
        }
        return data;
      });
    }, function (e) {
      if (e && e.name === "AbortError") throw new Err(0, "Stopped.", { reason: "aborted" });
      throw new Err(0, "We could not reach the Institute server. Check your connection and try again.", { reason: "network" });
    });
  }
  function defaultMessage(status) {
    if (status === 401) return "Sign in to continue.";
    if (status === 403) return "This isn't available on this course.";
    if (status === 404) return "Not found.";
    if (status === 413) return "That's too long. Please shorten it.";
    if (status === 429) return "That's a lot of requests. Please wait a little and try again.";
    if (status >= 500) return "Something went wrong. Try again.";
    return "Request failed (" + status + ").";
  }

  /** Read an SSE body: "event: x\ndata: {...}\n\n" blocks and ": ping" comments. */
  function readSse(res, onEvent) {
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
    var out = { meta: null, done: null, error: null, retracted: null };
    function dispatch(block) {
      var name = "message", data = [];
      block.split(/\r?\n/).forEach(function (line) {
        if (!line || line.charAt(0) === ":") return;
        var i = line.indexOf(":"), f = i < 0 ? line : line.slice(0, i), v = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (f === "event") name = v; else if (f === "data") data.push(v);
      });
      if (!data.length) return;
      var parsed; try { parsed = JSON.parse(data.join("\n")); } catch (e) { return; }
      if (name === "meta") out.meta = parsed;
      else if (name === "done") out.done = parsed;
      else if (name === "error") out.error = parsed;
      else if (name === "retract") out.retracted = parsed;
      try { onEvent(name, parsed); } catch (e) { if (window.console) console.error(e); }
    }
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { if (buf.trim()) dispatch(buf); return finish(); }
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop();
        parts.forEach(dispatch);
        return pump();
      });
    }
    function finish() {
      if (out.error) throw new Err(out.error.status || 502, capital(out.error.error || "Something went wrong. Try again."), out.error);
      if (!out.done) throw new Err(502, "The answer was cut off. Try again.", { reason: "incomplete" });
      return out;
    }
    return pump().catch(function (e) {
      if (e instanceof Err) throw e;
      if (e && e.name === "AbortError") throw new Err(0, "Stopped.", { reason: "aborted" });
      throw new Err(0, "The connection dropped. Try again.", { reason: "network" });
    });
  }

  /* ---------------- status ---------------- */
  var statusCache = {};
  /** GET /api/ai/status[?courseId=] once per page and course. */
  function status(courseId) {
    var key = courseId || "";
    if (!statusCache[key]) {
      statusCache[key] = request("GET", "/api/ai/status" + (courseId ? "?courseId=" + encodeURIComponent(courseId) : ""), undefined, { auth: "optional" })
        .then(function (st) { setPersona(st); return st; }, function (e) { delete statusCache[key]; throw e; });
    }
    return statusCache[key];
  }
  /* The persona name is admin-editable (OWNER-DECISIONS): every visible name goes through
     name()/label(). "Ellery" is only the fallback until a status call has answered. Pages that
     drew a name before status loaded listen for "ellery:persona" and relabel. */
  var persona = { name: "Ellery", label: "Ellery · AI instructor" };
  function setPersona(st) {
    if (!st || !st.instructorName || st.instructorName === persona.name) return;
    persona = { name: String(st.instructorName), label: st.label || String(st.instructorName) + " · AI instructor" };
    try { window.dispatchEvent(new CustomEvent("ellery:persona", { detail: persona })); } catch (e) { /* old browser */ }
  }
  function label(st) { return (st && st.label) || persona.label; }
  function name(st) { return (st && st.instructorName) || persona.name; }
  function aiWho() { return name() + " · AI"; }
  /** Text that names the persona and is drawn before status may have answered: relabeled on "ellery:persona". */
  function nameText() { return h("span", { "data-ell-name": "" }, name()); }
  function labelText() { return h("span", { "data-ell-label": "" }, label()); }
  window.addEventListener("ellery:persona", function () {
    Array.prototype.forEach.call(document.querySelectorAll("[data-ell-name]"), function (n) { n.textContent = name(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-ell-label]"), function (n) { n.textContent = label(); });
  });

  /* ---------------- time ---------------- */
  function localTime(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    try {
      var sameDay = new Date().toDateString() === d.toDateString();
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + (sameDay ? " today" : " " + d.toLocaleDateString("en-US", { weekday: "long" }));
    } catch (e) { return d.toString(); }
  }

  /* ---------------- states ---------------- */
  var MODE_NOUN = { tutor: "questions", practice: "practice sets", sandbox: "sandbox runs", roleplay: "practice conversations",
    exercise: "exercise submissions", finder: "course finder questions", helpdesk: "help desk questions" };

  /** Map an error (or a status flag) to {kind, title, body}. kind: paused | quota | exam | unavailable | cooldown | offline | signin | turnstile | error */
  function describe(e, mode) {
    var r = (e && e.reason) || "";
    var msg = (e && e.message) || "";
    switch (r) {
      case "paused": case "quota_global": case "quota_org": case "not_configured":
        return { kind: "paused", title: name() + " is resting", body: r === "not_configured" ? "The AI instructor isn't switched on yet. Lessons, exams and certificates all work as normal." : msg || "The AI instructor is resting for now. Lessons, exams and certificates all work as normal." };
      case "quota_mode": case "assessment_limit":
        return { kind: "quota", title: "Today's limit reached", body: "You've used today's " + (MODE_NOUN[mode] || "AI") + ". " +
          (e.resetAt ? "More are available from " + localTime(e.resetAt) + ". " : "More are available tomorrow. ") + "Everything in the lesson is still available." };
      case "exam_open":
        return { kind: "exam", title: "Exam in progress", body: msg || "You have an exam in progress, so " + name() + " is paused until you submit it. Good luck." };
      case "mode_off": case "paid_only": case "not_enrolled": case "no_sandbox":
        return { kind: "unavailable", title: "Not available on this course", body: msg };
      case "cooldown":
        return { kind: "cooldown", title: "Taking a break", body: msg };
      case "offline": case "network":
        return { kind: "offline", title: "You're offline", body: msg };
      case "signin":
        return { kind: "signin", title: "Sign in to use " + name(), body: name() + " helps enrolled learners inside their courses." };
      case "turnstile":
        return { kind: "turnstile", title: "Quick check", body: "Please complete the human check below, then send again." };
      case "quota_anon":
        return { kind: "quota", title: "Limit reached", body: msg || "You've asked a lot of questions from this network. Try again later." };
      default:
        return { kind: "error", title: "Something went wrong", body: msg || "Something went wrong. Try again." };
    }
  }
  /** A notice box for a state; `retry` adds a Try again button for transient errors. */
  function stateBox(st, retry) {
    var tone = st.kind === "error" || st.kind === "offline" ? "warn" : st.kind === "quota" || st.kind === "exam" || st.kind === "cooldown" ? "info" : "muted";
    return h("div", { class: "ell-state ell-state-" + st.kind + " ell-tone-" + tone, role: st.kind === "error" ? "alert" : "status", "data-state": st.kind },
      h("strong", { class: "ell-state-t" }, st.title),
      st.body ? h("p", null, st.body) : null,
      retry && (st.kind === "error" || st.kind === "offline") ? h("button", { type: "button", class: "ell-btn ell-btn-sm", onclick: retry }, "Try again") : null);
  }
  /** The status flags that block a learner surface before any request is sent. */
  function blockedBy(st, mode, courseId) {
    if (!st) return null;
    if (st.paused) return { kind: "paused", title: name(st) + " is resting", body: st.pausedMessage || "The AI instructor is resting for now. Lessons, exams and certificates all work as normal." };
    if (st.examOpen) return describe({ reason: "exam_open", message: "You have an exam in progress, so " + name(st) + " is paused until you submit it. Good luck." }, mode);
    var m = st.modes && st.modes[mode];
    if (m && !m.enabled) return describe({ reason: "mode_off", message: "This feature isn't switched on right now." }, mode);
    if (courseId) {
      if (!st.course) return describe({ reason: "not_enrolled", message: name(st) + " is available once you're enrolled in this course." }, mode);
      if (st.course.modes && st.course.modes[mode] === false) {
        var paid = st.course.free && (mode === "roleplay" || mode === "exercise" || mode === "sandbox");
        return describe({ reason: paid ? "paid_only" : "mode_off", message: paid
          ? "Practice conversations, graded exercises and the prompt sandbox come with the full courses. The free intro courses include the lesson tutor and practice questions."
          : "This feature isn't switched on for this course yet." }, mode);
      }
    }
    if (m && typeof m.remaining === "number" && m.remaining <= 0) return describe({ reason: "quota_mode", resetAt: m.resetAt }, mode);
    return null;
  }

  /* ---------------- Markdown subset (DOM only) ---------------- */
  /**
   * md(text, opts) -> DocumentFragment.
   * opts.citations: [{id, lesson, title, href}] from the server; "[S3]" markers become in-page anchor
   *   chips when the section is in this lesson (opts.lessonRef), plain text chips otherwise.
   * opts.tables: render pipe tables (server-filled debrief templates only).
   * opts.headingLevel: the level used for "#"/"##" headings (default 3).
   */
  function md(text, opts) {
    opts = opts || {};
    var frag = document.createDocumentFragment();
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var i = 0, para = [];
    function flush() { if (para.length) { frag.appendChild(inline(h("p"), para.join(" "), opts)); para = []; } }
    while (i < lines.length) {
      var line = lines[i];
      var fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
      if (fence) {
        flush();
        var code = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        i++;
        frag.appendChild(h("pre", { class: "ell-pre", tabindex: "0" }, h("code", { text: code.join("\n") })));
        continue;
      }
      if (/^\s*$/.test(line)) { flush(); i++; continue; }
      var hd = /^(#{1,6})\s+(.+)$/.exec(line);
      if (hd) {
        flush();
        var lvl = Math.min(6, (opts.headingLevel || 3) + Math.max(0, hd[1].length - 2));
        frag.appendChild(inline(h("h" + lvl, { class: "ell-h" }), hd[2].replace(/#+\s*$/, ""), opts));
        i++; continue;
      }
      if (opts.tables && /^\s*\|.*\|\s*$/.test(line)) {
        flush();
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        frag.appendChild(table(rows, opts));
        continue;
      }
      var li = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
      if (li) {
        flush();
        var ordered = /\d/.test(li[1]);
        var list = h(ordered ? "ol" : "ul", { class: "ell-list" });
        while (i < lines.length) {
          var m = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(lines[i]);
          if (!m || /\d/.test(m[1]) !== ordered) break;
          var item = [m[2]]; i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d{1,3}[.)])\s+/.test(lines[i])) item.push(lines[i++].trim());
          list.appendChild(inline(h("li"), item.join(" "), opts));
        }
        frag.appendChild(list);
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return frag;
  }
  function table(rows, opts) {
    var cells = rows.map(function (r) { return r.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }); })
      .filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ""; }); });
    var t = h("table", { class: "ell-table" });
    var hasHead = rows.length > 1 && /^\s*\|?\s*:?-{2,}/.test(rows[1]);
    var body = h("tbody");
    cells.forEach(function (r, n) {
      var tr = h("tr");
      r.forEach(function (c) { tr.appendChild(inline(h(hasHead && n === 0 ? "th" : "td", hasHead && n === 0 ? { scope: "col" } : null), c, opts)); });
      if (hasHead && n === 0) t.appendChild(h("thead", null, tr)); else body.appendChild(tr);
    });
    t.appendChild(body);
    return h("div", { class: "ell-table-wrap", role: "region", tabindex: "0", "aria-label": "Table (scrolls sideways)" }, t);
  }
  /** Inline spans: `code`, **bold**, *italic* / _italic_, and [S3] citation markers. Everything else is text. */
  function inline(el, s, opts) {
    var re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\b_[^_\n]+_\b)|(\[(?:L[a-z0-9-]+:)?S\d{1,3}\])/gi;
    var last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
      var tok = m[0];
      if (m[1]) el.appendChild(h("code", { text: tok.slice(1, -1) }));
      else if (m[2]) el.appendChild(inline(h("strong"), tok.slice(2, -2), opts));
      else if (m[3] || m[4]) el.appendChild(inline(h("em"), tok.slice(1, -1), opts));
      else el.appendChild(cite(tok.slice(1, -1), opts));
      last = m.index + tok.length;
    }
    if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
    return el;
  }
  function cite(id, opts) {
    var list = opts.citations || [];
    var c = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id).toUpperCase() === id.toUpperCase()) { c = list[i]; break; }
    if (!c) return document.createTextNode("");
    var anchor = sectionAnchor(c, opts.lessonRef);
    var text = "§ " + (c.title || c.id);
    if (anchor) {
      return h("a", { class: "ell-cite", href: "#" + anchor, title: "Go to the section “" + (c.title || c.id) + "” in this lesson",
        onclick: function (ev) {
          var t = document.getElementById(anchor);
          if (!t) return;
          ev.preventDefault();
          t.setAttribute("tabindex", "-1");
          t.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
          t.focus({ preventScroll: true });
          try { history.replaceState(null, "", location.pathname + location.search + "#" + anchor); } catch (e) { /* ignore */ }
          if (opts.onCite) opts.onCite(anchor);
        } }, text);
    }
    return h("span", { class: "ell-cite ell-cite-off", title: c.lesson ? "From lesson " + c.lesson : "" }, text + (c.lesson && c.lesson !== opts.lessonRef ? " (" + c.lesson + ")" : ""));
  }
  /** An anchor id inside this page's lesson for a citation, or null. Never a URL. */
  function sectionAnchor(c, lessonRef) {
    if (!c || (lessonRef && c.lesson && c.lesson !== lessonRef)) return null;
    var body = document.getElementById("lesson-body");
    if (!body) return null;
    var id = c.href && /^#[^\s#]{1,120}$/.test(c.href) ? c.href.slice(1) : null;
    if (id) { var el = document.getElementById(id); if (el && body.contains(el)) return id; }
    var want = String(c.title || "").trim().toLowerCase();
    if (!want) return null;
    var hs = body.querySelectorAll("h2[id], h3[id]");
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim().toLowerCase() === want) return hs[i].id;
    return null;
  }
  function reducedMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  /* ---------------- small widgets ---------------- */
  function btn(text, attrs) {
    attrs = attrs || {};
    attrs.type = attrs.type || "button";
    attrs.class = "ell-btn" + (attrs.class ? " " + attrs.class : "");
    return h("button", attrs, text);
  }
  function spinner(text) {
    return h("div", { class: "ell-loading", role: "status" }, h("span", { class: "ell-spin", "aria-hidden": "true" }), h("span", null, text || "Loading…"));
  }
  /** "Practice only. Not part of certification." */
  function practiceLabel(text) {
    return h("p", { class: "ell-practice-label" }, h("strong", null, "Practice only."), " " + String(text || "Not part of certification.").replace(/^Practice only\.\s*/, ""));
  }
  /** One-time notice per mode: AI, can be wrong, what is and isn't stored. `stored` replaces the
   *  default storage sentence (the exercise page keeps the last submission in this browser). */
  function firstUse(mode, extra, stored) {
    var key = "wia_ell_seen_" + mode;
    if (lsGet(key, false)) return null;
    var box = h("div", { class: "ell-first", role: "note" },
      h("p", null, h("strong", null, name() + " is an AI. "), "It can be wrong, so check answers against the lesson. ",
        (stored || "Your conversation stays in this browser tab; we don't store it.") + " ", extra || ""),
      btn("Got it", { class: "ell-btn-sm ell-btn-ghost", onclick: function () { lsSet(key, true); box.remove(); } }));
    return box;
  }
  /** Helpful / Not helpful under an answer: POST /api/ai/feedback (counts only, never text). */
  function feedback(mode) {
    var row = h("div", { class: "ell-fb" });
    var note = h("span", { class: "ell-fb-note", role: "status" });
    function send(rating, reason) {
      return request("POST", "/api/ai/feedback", { mode: mode, rating: rating, reason: reason || undefined }, { auth: "optional" })
        .then(function () { clear(row).appendChild(h("span", { class: "ell-fb-note" }, "Thanks for the feedback.")); },
          function () { note.textContent = "Couldn't send feedback just now."; });
    }
    var up = h("button", { type: "button", class: "ell-icon-btn", "aria-label": "Helpful", title: "Helpful", onclick: function () { send("up"); } }, icon(ICONS.up, 16));
    var down = h("button", { type: "button", class: "ell-icon-btn", "aria-label": "Not helpful", title: "Not helpful", "aria-expanded": "false",
      onclick: function () {
        if (row.querySelector(".ell-fb-reasons")) return;
        down.setAttribute("aria-expanded", "true");
        var reasons = h("div", { class: "ell-fb-reasons", role: "group", "aria-label": "What was wrong?" },
          [["wrong", "Wrong"], ["unhelpful", "Unhelpful"], ["unsafe", "Unsafe"], ["other", "Other"]].map(function (r) {
            return btn(r[1], { class: "ell-btn-sm ell-btn-ghost", onclick: function () { send("down", r[0]); } });
          }));
        row.appendChild(reasons);
        var first = reasons.querySelector("button"); if (first) first.focus();
      } }, icon(ICONS.down, 16));
    add(row, [h("span", { class: "ell-fb-q" }, "Was this helpful?"), up, down, note]);
    return row;
  }
  /** "We removed something that looked like personal data…" */
  function redactedNote() {
    return h("p", { class: "ell-notice", role: "status" }, "We removed something that looked like personal data or a secret before sending. Use invented data when you practice.");
  }

  /* ---------------- chat log ---------------- */
  /**
   * chatLog({label}) -> {el, user(text), assistant() -> handle, note(node)}
   * The log is role="log" with aria-live off; completed answers are announced once through a
   * separate polite status region, so screen readers never hear a reply token by token.
   */
  function chatLog(o) {
    o = o || {};
    var announcer = h("div", { class: "ell-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    var log = h("div", { class: "ell-log", role: "log", "aria-live": "off", "aria-label": o.ariaLabel || "Conversation", tabindex: "0" });
    var wrap = h("div", { class: "ell-log-wrap" }, log, announcer);
    /* Scroll whatever actually scrolls: the log itself (lesson panel), or the closest scrolling
       ancestor (pages where the log grows and its container scrolls). */
    function scroll() {
      log.scrollTop = log.scrollHeight;
      for (var p = log.parentElement; p && p !== document.body; p = p.parentElement) {
        var oy = "";
        try { oy = window.getComputedStyle(p).overflowY; } catch (e) { oy = ""; }
        if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) { p.scrollTop = p.scrollHeight; break; }
      }
    }
    /* Stay pinned to the newest message while the reader is at the bottom, including when a
       footer (feedback buttons, notes) is added after the reply finished. */
    var stick = true;
    log.addEventListener("scroll", function () { stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48; });
    if (window.MutationObserver) new MutationObserver(function () { if (stick) scroll(); }).observe(log, { childList: true, subtree: true });
    function announce(text) { announcer.textContent = ""; setTimeout(function () { announcer.textContent = text; }, 60); }
    return {
      el: wrap, log: log, announce: announce,
      user: function (text, who) {
        log.appendChild(h("div", { class: "ell-msg ell-msg-user" }, h("div", { class: "ell-who" }, who || "You"), h("div", { class: "ell-body ell-plain", text: text })));
        scroll();
      },
      note: function (node) { log.appendChild(node); scroll(); },
      clear: function () { clear(log); },
      assistant: function (who, opts) {
        opts = opts || {};
        var body = h("div", { class: "ell-body ell-streaming" });
        var typing = h("span", { class: "ell-typing", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
        var typingTimer = setTimeout(function () { if (!raw) body.appendChild(typing); }, 300);
        var foot = h("div", { class: "ell-foot" });
        var msg = h("div", { class: "ell-msg ell-msg-ai" + (opts.className ? " " + opts.className : ""), "aria-busy": "true" },
          h("div", { class: "ell-who" }, who || aiWho()), body, foot);
        log.appendChild(msg); scroll();
        if (opts.announceStart !== false) announce((who || name()) + " is replying.");
        var raw = "";
        return {
          el: msg, body: body, foot: foot,
          append: function (t) {
            if (!raw) { clearTimeout(typingTimer); if (typing.parentNode) typing.remove(); }
            raw += t;
            clear(body).appendChild(md(raw, { lessonRef: opts.lessonRef }));
            scroll();
          },
          replace: function (t) { raw = ""; clear(body); if (t) this.append(t); },
          finish: function (text, mdOpts) {
            clearTimeout(typingTimer);
            if (typing.parentNode) typing.remove();
            body.classList.remove("ell-streaming");
            clear(body).appendChild(md(text != null ? text : raw, mdOpts || { lessonRef: opts.lessonRef }));
            msg.removeAttribute("aria-busy");
            announce((who || name()) + ": " + body.textContent);
            scroll();
          },
          fail: function (node) {
            clearTimeout(typingTimer);
            if (typing.parentNode) typing.remove();
            body.classList.remove("ell-streaming");
            clear(body).appendChild(node);
            msg.removeAttribute("aria-busy");
            msg.classList.add("ell-msg-failed");
            announce(node.textContent);
            scroll();
          },
          text: function () { return raw; }
        };
      }
    };
  }

  /* ---------------- composer (textarea + mic + send/stop) ---------------- */
  /**
   * composer({id, label, placeholder, maxLength, rows, mic, lang, onSend(text), sendText})
   * -> {el, input, setBusy(bool, onStop), setDisabled(reason|null), focus(), clear()}
   * Enter sends, Shift+Enter adds a line. The send button turns into Stop while a reply streams.
   */
  function composer(o) {
    var id = o.id || "ell-in-" + Math.random().toString(36).slice(2, 8);
    var input = h("textarea", { id: id, class: "ell-input", rows: String(o.rows || 2), maxlength: o.maxLength ? String(o.maxLength) : null,
      placeholder: o.placeholder || "Type your message", autocomplete: "off", "aria-describedby": id + "-hint" });
    var count = h("span", { class: "ell-count", "aria-hidden": "true" });
    /* On touch keyboards Enter makes a new line (Shift+Enter isn't available); Send sends. */
    var coarse = false;
    try { coarse = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches; } catch (e) { coarse = false; }
    var defaultHint = o.hint || (coarse ? "Tap " + (o.sendText || "Send") + " when you're ready." : "Enter to send, Shift+Enter for a new line.");
    var hint = h("p", { class: "ell-hint", id: id + "-hint" }, defaultHint);
    var send = btn(o.sendText || "Send", { class: "ell-send" });
    var stopFn = null, busy = false, disabledReason = null;
    var micBtn = o.mic === false ? null : mic(input, { lang: o.lang });
    var row = h("div", { class: "ell-compose-row" }, input, h("div", { class: "ell-compose-btns" }, micBtn ? micBtn.el : null, send));
    var el = h("form", { class: "ell-compose", novalidate: true },
      h("label", { class: o.labelHidden ? "ell-sr" : "ell-label", for: id }, o.label || "Your message"),
      row, h("div", { class: "ell-compose-meta" }, hint, count), micBtn ? micBtn.status : null);
    function upd() { if (o.maxLength) { var n = input.value.length; count.textContent = n > o.maxLength * 0.8 ? n + " / " + o.maxLength : ""; } }
    input.addEventListener("input", upd);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !(o.multiline) && !coarse) { e.preventDefault(); submit(); }
    });
    el.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    send.addEventListener("click", function (e) { e.preventDefault(); if (busy && stopFn) { stopFn(); return; } submit(); });
    function submit() {
      if (busy || disabledReason) return;
      var text = input.value.trim();
      if (text.length < (o.minLength || 2)) { input.focus(); return; }
      if (micBtn) micBtn.stop();
      o.onSend(text);
    }
    function online() { setDisabled(navigator.onLine === false ? "You're offline. Reconnect to send." : null, true); }
    function setDisabled(reason, fromNet) {
      if (fromNet && disabledReason && disabledReason.indexOf("offline") < 0) return;
      disabledReason = reason;
      input.disabled = !!reason; send.disabled = !!reason && !busy;
      if (micBtn) micBtn.el.disabled = !!reason;
      hint.textContent = reason || defaultHint;
    }
    window.addEventListener("online", online); window.addEventListener("offline", online);
    if (navigator.onLine === false) online();
    return {
      el: el, input: input,
      setBusy: function (b, onStop) {
        busy = b; stopFn = onStop || null;
        input.readOnly = b;
        if (micBtn) { if (b) micBtn.stop(); micBtn.el.disabled = b || !!disabledReason; }
        send.textContent = b ? (onStop ? "Stop" : "Sending…") : (o.sendText || "Send");
        send.classList.toggle("ell-stop", !!(b && onStop));
        send.disabled = b && !onStop;
        if (b) send.setAttribute("aria-busy", "true"); else send.removeAttribute("aria-busy");
      },
      setDisabled: setDisabled,
      focus: function () { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } },
      clear: function () { input.value = ""; upd(); }
    };
  }

  /* ---------------- push-to-talk ---------------- */
  var MIC_NOTE = "Voice input uses your browser's speech service. In some browsers, such as Chrome, audio is sent to the browser maker's servers to be transcribed. The Institute does not receive or store audio.";
  /**
   * mic(textarea, {lang}) -> {el, status, stop()} or null when the browser has no SpeechRecognition.
   * Click, Enter or Space toggles listening (DESIGN §10.2: hold-to-talk is hard for some people).
   * Pointer press-and-hold (350 ms) also talks while held. Holding Space instead is an opt-in
   * setting ("holdToTalk" in wia_voice). Starting the mic stops any read-aloud first (the
   * "ellery:mic-start" event pauses Listen), so the recognizer never transcribes our own voice.
   * Interim text appears in the box as a live caption; the result stays there to edit and is
   * never sent automatically.
   */
  function mic(input, o) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    o = o || {};
    var rec = null, on = false, base = "", holdTimer = null, held = false;
    var helpId = "ell-mic-h-" + Math.random().toString(36).slice(2, 8);
    function holdMode() { return !!voicePrefs().holdToTalk; }
    function modeText() { return holdMode() ? "Hold Space, or press and hold, to talk; release to stop." : "Press Enter or Space to start, and again to stop. You can also press and hold."; }
    var b = h("button", { type: "button", class: "ell-icon-btn ell-mic", "aria-pressed": "false", "aria-label": "Speak your message", title: "Speak. " + modeText(), "aria-describedby": helpId }, icon(ICONS.mic, 18));
    var help = h("span", { id: helpId, class: "ell-sr" }, modeText());
    var st = h("p", { class: "ell-mic-status", role: "status", "aria-live": "polite" });
    var statusWrap = h("div", { class: "ell-mic-wrap" }, help, st);
    window.addEventListener("ellery:voice-prefs", function () { help.textContent = modeText(); b.title = "Speak. " + modeText(); });
    function disclose() {
      if (lsGet("wia_ell_mic_ok", false)) return true;
      var ok = window.confirm(MIC_NOTE + "\n\nUse voice input?");
      if (ok) lsSet("wia_ell_mic_ok", true);
      return ok;
    }
    function start() {
      if (on || b.disabled) return;
      if (!disclose()) return;
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent("ellery:mic-start")); } catch (e) { /* old browser */ }
      try {
        rec = new SR();
        rec.lang = o.lang || "en-US";
        rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      } catch (e) { st.textContent = "Voice input isn't available in this browser. Type your message instead."; return; }
      base = input.value ? input.value.replace(/\s+$/, "") + " " : "";
      rec.onresult = function (ev) {
        if (input.readOnly || input.disabled) return;
        var interim = "", fin = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var tr = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) fin += tr; else interim += tr;
        }
        if (fin) base += fin.trim() + " ";
        input.value = (base + interim).replace(/^\s+/, "");
        st.textContent = interim ? "Hearing: " + interim : "Listening…";
        input.dispatchEvent(new Event("input"));
      };
      rec.onerror = function (ev) {
        var m = { "not-allowed": "Microphone access was blocked. Allow it in your browser settings, or type instead.",
          "service-not-allowed": "Voice input is turned off in this browser. Type your message instead.",
          "no-speech": "No speech was heard. Try again, or type your message.",
          "network": "Voice input needs a network connection. Type your message instead.",
          "audio-capture": "No microphone was found. Type your message instead." }[ev.error];
        st.textContent = m || "Voice input stopped. Type your message instead.";
      };
      rec.onend = function () { on = false; b.setAttribute("aria-pressed", "false"); b.classList.remove("is-on"); if (/^Listening|^Hearing/.test(st.textContent)) st.textContent = input.value ? "Check the text, then send it." : ""; input.focus(); };
      try { rec.start(); } catch (e) { st.textContent = "Voice input couldn't start. Type your message instead."; return; }
      on = true; b.setAttribute("aria-pressed", "true"); b.classList.add("is-on"); st.textContent = "Listening…";
    }
    function stop() { if (rec && on) { try { rec.stop(); } catch (e) { /* ignore */ } } }
    b.addEventListener("click", function (e) { e.preventDefault(); if (held) { held = false; return; } on ? stop() : start(); });
    b.addEventListener("pointerdown", function () { holdTimer = setTimeout(function () { held = true; start(); }, 350); });
    function release() { clearTimeout(holdTimer); if (held) { stop(); setTimeout(function () { held = false; }, 50); } }
    b.addEventListener("pointerup", release); b.addEventListener("pointerleave", release);
    /* Hold-to-talk (opt-in): Space held talks. Otherwise Space and Enter reach the click handler, which toggles. */
    b.addEventListener("keydown", function (e) { if (holdMode() && e.key === " " && !e.repeat) { e.preventDefault(); held = true; start(); } });
    b.addEventListener("keyup", function (e) { if (holdMode() && e.key === " ") { e.preventDefault(); stop(); setTimeout(function () { held = false; }, 50); } });
    return { el: b, status: statusWrap, stop: stop };
  }

  /* ---------------- speech synthesis ---------------- */
  var VOICE_KEY = "wia_voice";
  var voicesP = null;
  /** English voices, best first: natural/neural/enhanced/premium/Siri, then local, then the rest. At most 8. */
  function voices() {
    if (!("speechSynthesis" in window)) return Promise.resolve([]);
    if (voicesP) return voicesP;
    voicesP = new Promise(function (resolve) {
      var done = false;
      function pick() {
        var all = window.speechSynthesis.getVoices() || [];
        if (!all.length) return false;
        var en = all.filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
        var us = en.filter(function (v) { return /^en[-_]US/i.test(v.lang); });
        var list = (us.length ? us.concat(en.filter(function (v) { return us.indexOf(v) < 0; })) : en);
        function score(v) { return (/natural|neural|enhanced|premium|siri/i.test(v.name) ? 0 : 2) + (v.localService ? 0 : 1); }
        list = list.map(function (v, i) { return { v: v, i: i }; }).sort(function (a, b) { return score(a.v) - score(b.v) || a.i - b.i; }).map(function (x) { return x.v; });
        done = true; resolve(list.slice(0, 8)); return true;
      }
      if (pick()) return;
      window.speechSynthesis.addEventListener("voiceschanged", function () { if (!done) pick(); });
      setTimeout(function () { if (!done) { done = true; resolve([]); } }, 3000);
    });
    return voicesP;
  }
  function voicePrefs() {
    var p = lsGet(VOICE_KEY, null) || {};
    var rate = Number(p.rate);
    return { voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : "", rate: rate >= 0.75 && rate <= 1.75 ? rate : 1, readCode: !!p.readCode, holdToTalk: !!p.holdToTalk };
  }
  function saveVoicePrefs(p) {
    lsSet(VOICE_KEY, { voiceURI: p.voiceURI || "", rate: p.rate || 1, readCode: !!p.readCode, holdToTalk: !!p.holdToTalk });
    try { window.dispatchEvent(new CustomEvent("ellery:voice-prefs")); } catch (e) { /* old browser */ }
  }
  /** "Hold Space to talk" checkbox (DESIGN §10.2), shown wherever voice input is offered. */
  function holdToTalkToggle(id) {
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return null;
    var cb = h("input", { type: "checkbox", id: id, checked: !!voicePrefs().holdToTalk });
    cb.addEventListener("change", function () { var p = voicePrefs(); p.holdToTalk = cb.checked; saveVoicePrefs(p); });
    return h("label", { class: "ell-check", for: id }, cb, " Voice input: hold Space to talk (instead of press to start and stop)");
  }
  /** Speak text with the saved voice (or `opts.voiceURI`); resolves when finished or canceled. */
  function speak(text, opts) {
    opts = opts || {};
    if (!("speechSynthesis" in window) || !text) return Promise.resolve();
    return voices().then(function (list) {
      var prefs = voicePrefs();
      var want = opts.voiceURI || prefs.voiceURI;
      var v = null;
      for (var i = 0; i < list.length; i++) if (list[i].voiceURI === want) v = list[i];
      if (opts.second && list.length > 1) v = list.filter(function (x) { return x !== v; })[0] || v;
      var parts = splitSentences(text);
      return parts.reduce(function (p, s) {
        return p.then(function () {
          return new Promise(function (res) {
            var u = new SpeechSynthesisUtterance(s);
            if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
            u.rate = opts.rate || prefs.rate;
            u.onend = u.onerror = function () { res(); };
            window.speechSynthesis.speak(u);
          });
        });
      }, Promise.resolve());
    });
  }
  function splitSentences(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return [];
    try {
      if (window.Intl && Intl.Segmenter) {
        var seg = new Intl.Segmenter("en", { granularity: "sentence" });
        var out = [];
        var it = seg.segment(s)[Symbol.iterator](), n;
        while (!(n = it.next()).done) { var t = n.value.segment.trim(); if (t) out.push(t); }
        return out;
      }
    } catch (e) { /* fall through */ }
    return s.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* ---------------- Turnstile (public surfaces, anonymous visitors) ---------------- */
  function isLocalHost() { var hn = location.hostname; return hn === "localhost" || hn === "127.0.0.1" || hn === "[::1]"; }
  var tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsLoading) return tsLoading;
    tsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.onload = function () { resolve(window.turnstile); }; s.onerror = function () { tsLoading = null; reject(new Error("turnstile")); };
      document.head.appendChild(s);
    });
    return tsLoading;
  }
  /** A Turnstile widget rendered only when needed (anonymous, after the Worker asks). */
  function humanCheck() {
    var cfg = document.getElementById("wl-turnstile-config");
    var key = cfg ? (cfg.getAttribute("data-sitekey") || "").trim() : "";
    var box = h("div", { class: "ell-turnstile", hidden: true });
    var widget = null;
    return {
      el: box,
      show: function () {
        box.hidden = false;
        if (!key || widget !== null) return;
        loadTurnstile().then(function (ts) { widget = ts.render(box, { sitekey: key, theme: "auto", size: "flexible" }); },
          function () { box.appendChild(h("p", { class: "ell-hint" }, "The security check could not load. Disable content blockers for this site and reload.")); });
      },
      token: function () {
        if (!key || widget === null) return isLocalHost() ? "" : undefined;
        try { return window.turnstile.getResponse(widget) || undefined; } catch (e) { return undefined; }
      },
      reset: function () { try { if (widget !== null) window.turnstile.reset(widget); } catch (e) { /* ignore */ } }
    };
  }

  window.Ellery = {
    h: h, add: add, clear: clear, icon: icon, ICONS: ICONS, btn: btn, spinner: spinner,
    lsGet: lsGet, lsSet: lsSet, Err: Err, request: request, status: status, label: label, name: name, aiWho: aiWho, nameText: nameText, labelText: labelText,
    describe: describe, stateBox: stateBox, blockedBy: blockedBy, localTime: localTime,
    md: md, sectionAnchor: sectionAnchor, reducedMotion: reducedMotion,
    practiceLabel: practiceLabel, firstUse: firstUse, feedback: feedback, redactedNote: redactedNote,
    chatLog: chatLog, composer: composer, mic: mic,
    voices: voices, voicePrefs: voicePrefs, saveVoicePrefs: saveVoicePrefs, holdToTalkToggle: holdToTalkToggle, speak: speak, splitSentences: splitSentences,
    humanCheck: humanCheck, isLocalHost: isLocalHost
  };
})();
