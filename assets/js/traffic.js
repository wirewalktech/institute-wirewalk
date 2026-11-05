/* Anonymous aggregate page-load counter. Names come from server-rendered public
   metadata, never visitor input. No identity, attribution, storage or cookies. */
(function () {
  "use strict";
  if (window.__wiaTrafficSent) return;
  if (navigator.globalPrivacyControl === true) return;
  var dnt = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
  if (dnt.some(function (v) { return v === "1" || String(v).toLowerCase() === "yes"; })) return;
  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute("content") || "" : "";
  }
  var name = meta("wia-page-event"), endpoint = meta("wia-events");
  if (!/^inst\.[a-z0-9_-]{1,24}$/.test(name) || !endpoint || !window.fetch) return;
  try {
    var url = new URL(endpoint);
    if (!/^https?:$/.test(url.protocol) || url.search || url.hash || url.username || url.password) return;
    window.__wiaTrafficSent = true;
    fetch(endpoint, { method: "POST", body: JSON.stringify({ name: name }),
      headers: { "Content-Type": "text/plain;charset=UTF-8" }, mode: "cors",
      credentials: "omit", referrerPolicy: "no-referrer", keepalive: true }).catch(function () {});
  } catch (e) { /* A blocked or failed counter must not affect the page. */ }
})();
