/* Wirewalk Institute of AI — boot script. Loaded synchronously in <head> (not deferred)
   so it runs before paint and before every page script:
   - applies the saved light/dark theme choice (no flash of the wrong theme)
   - marks the document as JS-capable
   - exposes window.WIA = { api, site } for site.js and the learner app (PLATFORM-SPEC §6)
   It is an external file rather than an inline script so the Content-Security-Policy in
   _layouts/default.html can forbid inline script entirely.

   ?api=<url> overrides the Worker URL for local testing ONLY: it is honoured only when this
   page itself is served from localhost / 127.0.0.1 and the override is a localhost origin, so
   a crafted link to the live site can never point a visitor's requests (or token) elsewhere. */
(function () {
  var d = document.documentElement;
  d.className += " js";
  try { var t = localStorage.getItem("wia_theme"); if (t === "light" || t === "dark") d.setAttribute("data-theme", t); } catch (e) {}
  function meta(n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.getAttribute("content") || "" : ""; }
  var api = meta("wia-api"), site = meta("wia-site");
  var LOCAL = /^(localhost|127\.0\.0\.1)$/;
  try {
    if (LOCAL.test(location.hostname)) {
      var q = new URLSearchParams(location.search).get("api");
      if (q !== null) {
        if (q === "" || q === "default") sessionStorage.removeItem("wia_api");
        else { var u = new URL(q); if (LOCAL.test(u.hostname) && /^https?:$/.test(u.protocol)) sessionStorage.setItem("wia_api", u.origin); }
      }
      var s = sessionStorage.getItem("wia_api"); if (s) api = s;
    } else {
      sessionStorage.removeItem("wia_api");
    }
  } catch (e) {}
  window.WIA = { api: api.replace(/\/+$/, ""), site: site };
})();
