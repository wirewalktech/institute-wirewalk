/*
 * Wirewalk Institute of AI: client for the learning Worker (PLATFORM-SPEC.md section 1).
 *
 * - Base URL comes from window.WIA.api (set by _layouts/default.html from site.api_base).
 *   A ?api= override (sessionStorage "wia_api") is honored for local testing, but ONLY when
 *   the page itself is served from localhost / 127.0.0.1 AND the override points at localhost /
 *   127.0.0.1. On the production site any override (including one the layout already applied to
 *   window.WIA.api) is ignored, so a crafted link cannot send a learner's bearer token to a
 *   server listening on their machine or anywhere else.
 * - The bearer token lives in localStorage "wia_token"; every access is wrapped in try/catch
 *   (private windows and blocked storage throw).
 * - Errors are thrown as WIAApi.ApiError with the Worker's {error} message.
 * - A 401 on an authenticated call clears the token and dispatches "wia:unauthorized",
 *   which the learner pages answer with the sign-in view.
 * - Every request has a time limit (15 s for GET, 30 s otherwise, 90 s under /api/ai/ where a
 *   model reply can take longer; opts.timeout overrides, 0 = none). A request that hangs is
 *   aborted and fails like an unreachable server, as ApiError status 0, so the pages' error
 *   views and "Try again" buttons appear instead of an endless spinner.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "wia_token";
  var API_KEY = "wia_api";
  var PROD = "https://wirewalk-institute.wirewalk-upload.workers.dev";
  var GET_TIMEOUT_MS = 15000, WRITE_TIMEOUT_MS = 30000, AI_TIMEOUT_MS = 90000;

  function safeGet(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function safeSet(store, key, val) { try { window[store].setItem(key, val); return true; } catch (e) { return false; } }
  function safeDel(store, key) { try { window[store].removeItem(key); } catch (e) { /* storage blocked */ } }

  /** Overrides are accepted only for local development or the Institute's own Worker hosts. */
  function overrideAllowed(u) {
    try {
      var url = new URL(u);
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
      var h = url.hostname;
      return h === "localhost" || h === "127.0.0.1";
    } catch (e) { return false; }
  }

  function trimSlash(s) { return String(s || "").replace(/\/+$/, ""); }

  function pageIsLocal() {
    var h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function base() {
    var cfg = trimSlash((window.WIA && window.WIA.api) || PROD);
    if (!pageIsLocal()) {
      /* Production: never follow an override. The layout may already have copied one into
         WIA.api, so a localhost value there is discarded too. */
      if (safeGet("sessionStorage", API_KEY)) safeDel("sessionStorage", API_KEY);
      return overrideAllowed(cfg) ? PROD : cfg;
    }
    try {
      var q = new URLSearchParams(window.location.search).get("api");
      if (q && overrideAllowed(q)) safeSet("sessionStorage", API_KEY, trimSlash(q));
    } catch (e) { /* no URLSearchParams */ }
    var stored = safeGet("sessionStorage", API_KEY);
    if (stored && overrideAllowed(stored)) return trimSlash(stored);
    return cfg;
  }

  var token = {
    get: function () { return safeGet("localStorage", TOKEN_KEY); },
    set: function (t) { if (t) safeSet("localStorage", TOKEN_KEY, t); },
    clear: function () { safeDel("localStorage", TOKEN_KEY); }
  };

  function ApiError(status, message, data) {
    this.name = "ApiError";
    this.status = status;
    this.message = message;
    this.data = data || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ApiError);
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /**
   * request("POST", "/api/quote", body, {auth: "optional"|true|false, quiet401: bool, timeout: ms, keepalive: bool})
   * auth true (default): token required; without one we fail fast with a 401.
   * keepalive: the request may outlive the page (used to save exam answers on pagehide).
   */
  function request(method, path, body, opts) {
    opts = opts || {};
    var auth = opts.auth === undefined ? true : opts.auth;
    var headers = { "Accept": "application/json" };
    var t = token.get();
    if (auth && t) headers["Authorization"] = "Bearer " + t;
    if (auth === true && !t) {
      var e0 = new ApiError(401, "Sign in to continue.");
      if (!opts.quiet401) announce401();
      return Promise.reject(e0);
    }
    var init = { method: method, headers: headers, mode: "cors", credentials: "omit", cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (opts.keepalive) init.keepalive = true;
    var limit = opts.timeout !== undefined ? opts.timeout
      : method === "GET" ? GET_TIMEOUT_MS : /^\/api\/ai\//.test(path) ? AI_TIMEOUT_MS : WRITE_TIMEOUT_MS;
    var ctl = limit > 0 && typeof AbortController === "function" ? new AbortController() : null;
    var timedOut = false, timer = null;
    if (ctl) {
      init.signal = ctl.signal;
      timer = setTimeout(function () { timedOut = true; ctl.abort(); }, limit);
    }
    function settle() { if (timer) clearTimeout(timer); timer = null; }
    function unreachable() {
      settle();
      throw new ApiError(0, timedOut
        ? "The Institute server is taking too long to answer. Check your connection and try again."
        : "We could not reach the Institute server. Check your connection and try again.", timedOut ? { timeout: true } : null);
    }
    return fetch(base() + path, init).then(function (res) {
      return res.text().then(function (text) {
        settle();
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (res.ok) {
          if (data === null && text) throw new ApiError(res.status, "The server sent an unexpected response. Please try again.");
          return data || {};
        }
        var msg = (data && typeof data.error === "string" && data.error) || defaultMessage(res.status);
        var err = new ApiError(res.status, capital(msg), data);
        if (res.status === 401 && auth && t) {
          token.clear();
          if (!opts.quiet401) announce401();
        }
        throw err;
      }, unreachable);
    }, unreachable);
  }

  function capital(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  function defaultMessage(status) {
    if (status === 401) return "Sign in to continue.";
    if (status === 403) return "You do not have access to this.";
    if (status === 404) return "Not found.";
    if (status === 409) return "That conflicts with existing data.";
    if (status === 429) return "Too many attempts. Please wait a few minutes and try again.";
    if (status >= 500) return "The server had a problem. Please try again in a moment.";
    return "Request failed (" + status + ").";
  }

  /**
   * [ob3] An authenticated download as a Blob (the holder's Open Badge file). A plain link
   * could not carry the bearer token. Errors are ApiErrors, as from request().
   */
  function download(path) {
    var t = token.get();
    if (!t) { announce401(); return Promise.reject(new ApiError(401, "Sign in to continue.")); }
    return fetch(base() + path, { method: "GET", headers: { "Authorization": "Bearer " + t }, mode: "cors", credentials: "omit", cache: "no-store" })
      .then(function (res) {
        if (res.ok) return res.blob();
        return res.text().then(function (text) {
          var data = null;
          if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
          if (res.status === 401) { token.clear(); announce401(); }
          throw new ApiError(res.status, capital((data && typeof data.error === "string" && data.error) || defaultMessage(res.status)), data);
        });
      }, function () {
        throw new ApiError(0, "We could not reach the Institute server. Check your connection and try again.");
      });
  }

  var announced = false;
  function announce401() {
    if (announced) return;
    announced = true;
    setTimeout(function () { announced = false; }, 1000);
    try { window.dispatchEvent(new CustomEvent("wia:unauthorized")); } catch (e) { /* old browser */ }
  }

  var enc = encodeURIComponent;

  window.WIAApi = {
    base: base,
    token: token,
    ApiError: ApiError,
    request: request,
    signedIn: function () { return !!token.get(); },

    health: function () { return request("GET", "/api/health", undefined, { auth: false }); },
    catalog: function () { return request("GET", "/api/catalog", undefined, { auth: false }); },

    signup: function (b) { return request("POST", "/api/auth/signup", b, { auth: false }); },
    login: function (b) { return request("POST", "/api/auth/login", b, { auth: false }); },
    logout: function () { return request("POST", "/api/auth/logout", {}, { quiet401: true }); },
    sendVerify: function () { return request("POST", "/api/auth/email/send", {}); },
    confirmVerify: function (code) { return request("POST", "/api/auth/email/confirm", { code: code }); },
    resetSend: function (b) { return request("POST", "/api/auth/reset/send", b, { auth: false }); },
    resetConfirm: function (b) { return request("POST", "/api/auth/reset/confirm", b, { auth: false }); },

    me: function () { return request("GET", "/api/me"); },
    updateMe: function (b) { return request("PATCH", "/api/me", b); },

    quote: function (b) { return request("POST", "/api/quote", b, { auth: "optional", quiet401: true }); },
    checkout: function (b) { return request("POST", "/api/checkout", b); },
    purchase: function (id) { return request("GET", "/api/purchases/" + enc(id)); },
    purchaseBySession: function (cs) { return request("GET", "/api/purchases/by-session/" + enc(cs)); },

    course: function (id) { return request("GET", "/api/courses/" + enc(id)); },
    lesson: function (id, idx) { return request("GET", "/api/courses/" + enc(id) + "/lessons/" + enc(idx)); },
    completeLesson: function (id, idx) { return request("POST", "/api/courses/" + enc(id) + "/lessons/" + enc(idx) + "/complete", {}); },
    startExam: function (id) { return request("POST", "/api/courses/" + enc(id) + "/exam/start", {}); },
    submitAttempt: function (attemptId, answers) { return request("POST", "/api/attempts/" + enc(attemptId) + "/submit", { answers: answers }); },
    /* [WIA-014] rev numbers the snapshot; the Worker stores it only when it is newer than the stored one. */
    saveAnswers: function (attemptId, answers, opts, rev) {
      var b = { answers: answers };
      if (rev > 0) b.rev = rev;
      return request("PUT", "/api/attempts/" + enc(attemptId) + "/answers", b, opts);
    },

    certificate: function (id) { return request("GET", "/api/certificates/" + enc(id), undefined, { auth: false }); },
    /* [ob3] format "json" (default) or "svg"; resolves to a Blob. Holder only. */
    ob3Credential: function (id, format) { return download("/api/ob3/credentials/" + enc(id) + (format === "svg" ? "?format=svg" : "")); }
  };
})();
