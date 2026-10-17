/* /email/unsubscribe/#t=<token> (older links: ?t=) : check the signed link with GET {api}/api/email/unsubscribe,
   then unsubscribe on an explicit click with POST. Opening the page never unsubscribes by
   itself, so a mail scanner that follows links cannot unsubscribe anyone.
   All text is set with textContent (no innerHTML). */
(function () {
  "use strict";
  var out = document.getElementById("unsub-result"), btn = document.getElementById("unsub-confirm");
  if (!out || !btn) return;
  var api = (window.WIA && window.WIA.api) || "";
  var token = "";
  function takeParam(name) {
    /* [review-fixes] Tokens arrive in the URL fragment (never sent to a server, a Referer or a
       pixel); older links used the query. Either way it is removed from the address bar at once. */
    var v = "";
    try { v = new URLSearchParams((location.hash || "").replace(/^#/, "")).get(name) || ""; } catch (e) { v = ""; }
    if (!v) { try { v = new URLSearchParams(location.search).get(name) || ""; } catch (e) { v = ""; } }
    if (v) { try { history.replaceState(history.state, "", location.pathname); } catch (e) { /* ignore */ } }
    return v;
  }
  token = takeParam("t");

  function show(kind, title, text, focus) {
    while (out.firstChild) out.removeChild(out.firstChild);
    out.className = "result" + (kind ? " " + kind : "");
    var h = document.createElement("h2"); h.textContent = title; out.appendChild(h);
    if (text) { var p = document.createElement("p"); p.className = "muted"; p.textContent = text; out.appendChild(p); }
    out.hidden = false;
    if (focus) out.focus();
  }
  function call(method) {
    var opts = { method: method, headers: { Accept: "application/json" } };
    var url = api + "/api/email/unsubscribe";
    if (method === "GET") url += "?t=" + encodeURIComponent(token);
    else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify({ t: token }); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ("status " + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  var MANUAL = "Email sales@wirewalk.com with the subject \"Unsubscribe\" from the address you want removed, and we will do it by hand.";
  function failed(e) {
    if (e && e.status === 400) show("bad", "This link is not valid", "Use the whole link from the bottom of our email. " + MANUAL, true);
    else show("bad", "We could not reach the server", "Please try again in a minute. " + MANUAL, true);
  }

  if (!token) { show("bad", "This link is incomplete", "Open the unsubscribe link from the bottom of one of our emails. " + MANUAL); return; }
  show("", "Checking your link…", null);
  call("GET").then(function (d) {
    if (d.unsubscribed) { show("good", "You are unsubscribed", (d.email || "This address") + " will not receive marketing email from us."); return; }
    show("", "Unsubscribe " + (d.email || "this address") + "?", "Press the button to stop marketing email. Account and certificate emails still arrive.");
    btn.hidden = false;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      call("POST").then(function () {
        btn.hidden = true;
        show("good", "You are unsubscribed", (d.email || "This address") + " will not receive marketing email from us any more.", true);
      }, function (e) { btn.disabled = false; failed(e); });
    });
  }, failed);
})();
