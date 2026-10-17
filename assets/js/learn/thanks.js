/* /learn/thanks/?session=cs_... : polls the Worker until the purchase is confirmed paid.
 * It never says the payment succeeded until GET /api/purchases/by-session reports status "paid". */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;

  var session = W.param("session") || "";
  var started = Date.now();
  var timer = null, polls = 0;
  var FAST_MS = 2000, SLOW_MS = 6000, FAST_FOR = 40000, GIVE_UP = 180000;

  function pending(detail) {
    W.setTitle("Confirming your payment");
    W.mount(h("div", { class: "wl-narrow wl-center-block" },
      h("div", { class: "wl-pulse", "aria-hidden": "true" }),
      h("h1", { class: "wl-display" }, "Confirming your payment…"),
      h("p", { class: "wl-lead" }, "We are waiting for Stripe to confirm the payment. This usually takes a few seconds."),
      h("p", { class: "wl-hint", role: "status" }, detail || "Please keep this page open."),
      h("p", { class: "wl-small wl-muted" }, "Reference ", h("span", { class: "wl-mono" }, shortRef(session)))));
  }

  function shortRef(s) { return s.length > 24 ? s.slice(0, 12) + "…" + s.slice(-8) : s; }

  function paid(p) {
    W.setTitle("You are enrolled");
    var ids = p.courses || [];
    // Remove purchased items from the cart.
    var cart = W.cart.get().filter(function (i) {
      return !(i.type === "course" && ids.indexOf(i.id) >= 0);
    });
    var last = W.ss("wia_last_purchase");
    if (last && last.id === p.id && Array.isArray(last.items)) {
      cart = cart.filter(function (i) { return !last.items.some(function (x) { return x.type === i.type && x.id === i.id; }); });
      W.ss("wia_last_purchase", null);
    }
    W.cart.set(cart);
    /* [marketing] Reddit Pixel Purchase, only after Accept: our purchase id (also the dedup key), the paid total
       (integer cents from the Worker, converted to the pixel's decimal value here), USD as everywhere in the
       learner app (W.money), and the course count. Sent at most once per purchase per browser. No PII. */
    if (window.WIAConsent && typeof p.total === "number") window.WIAConsent.track("Purchase", { conversionId: p.id, value: p.total / 100, currency: "USD", itemCount: Math.max(1, ids.length) });
    try { sessionStorage.removeItem("wia_code"); } catch (e) { /* ignore */ }

    W.mount(h("div", { class: "wl-narrow" },
      h("div", { class: "wl-center-block" },
        h("div", { class: "wl-okmark", "aria-hidden": "true" }),
        h("p", { class: "wl-eyebrow" }, "Payment confirmed"),
        h("h1", { class: "wl-display", tabindex: "-1", id: "thanks-h" }, "You are enrolled."),
        h("p", { class: "wl-lead" }, "Thank you. A receipt is on its way from Stripe" +
          (p.totalFormatted || typeof p.total === "number" ? " for " + (p.totalFormatted || W.money(p.total)) : "") + ".")),
      ids.length ? h("section", { class: "wl-section", "aria-labelledby": "h-new" },
        h("h2", { id: "h-new", class: "wl-h3" }, ids.length === 1 ? "Your new course" : "Your new courses"),
        h("ul", { class: "wl-list", role: "list" }, ids.map(function (id) {
          return h("li", { class: "wl-list-row" },
            h("div", { class: "wl-grow" }, h("span", { class: "wl-code" }, id), " ", h("span", { class: "wl-strong" }, W.courseTitle(id))),
            W.btn("Start", { href: W.courseUrl(id), class: "wl-btn-sm" }));
        }))) : null,
      h("div", { class: "wl-actions wl-center" }, W.btn("Go to my dashboard", { href: "/learn/", class: "wl-btn-ghost" }))));
    var hd = document.getElementById("thanks-h"); if (hd) hd.focus();
  }

  function failed(p) {
    W.setTitle("Payment not completed");
    var expired = p.status === "expired";
    W.mount(h("div", { class: "wl-narrow" }, W.notice("error",
      expired ? "The checkout session expired" : "The payment did not go through",
      (expired ? "The checkout was not completed in time." : "Stripe reported that the payment failed.") +
        " You have not been charged and you are not enrolled. Your cart is still saved.",
      [W.btn("Return to cart", { href: "/learn/cart/" }), W.btn("Dashboard", { href: "/learn/", class: "wl-btn-ghost" })])));
  }

  function slow() {
    W.setTitle("Still confirming");
    var again = W.btn("Check again");
    again.addEventListener("click", function () { started = Date.now(); polls = 0; pending(); poll(); });
    W.mount(h("div", { class: "wl-narrow" }, W.notice("info", "Still waiting for confirmation",
      "Stripe has not confirmed this payment yet. That can take a few minutes. If you completed payment, you will receive an email receipt and your courses will appear on your dashboard as soon as the payment is confirmed. Nothing has been charged twice; please do not pay again.",
      [again, W.btn("Go to my dashboard", { href: "/learn/", class: "wl-btn-ghost" })])));
  }

  function poll() {
    clearTimeout(timer);
    timer = null;
    polls++;
    API.purchaseBySession(session).then(function (p) {
      if (p.status === "paid") return paid(p);
      if (p.status === "failed" || p.status === "expired") return failed(p);
      schedule(polls > 3 ? "Still confirming… (" + Math.round((Date.now() - started) / 1000) + " s)" : null);
    }, function (err) {
      if (err.status === 404) {
        W.mount(h("div", { class: "wl-narrow" }, W.notice("error", "We could not find this purchase",
          "There is no purchase with this reference on your account. If you paid while signed in with another email, sign in with that account.",
          [W.btn("Go to my dashboard", { href: "/learn/" })])));
        return;
      }
      if (err.status === 401) return; // redirected to sign in by common.js
      schedule("Connection problem — retrying… (" + err.message + ")");
    });
  }

  function schedule(detail) {
    var elapsed = Date.now() - started;
    if (elapsed > GIVE_UP) return slow();
    if (detail || polls === 1) pending(detail);
    timer = setTimeout(poll, elapsed < FAST_FOR ? FAST_MS : SLOW_MS);
  }

  function boot() {
    if (!/^cs_[A-Za-z0-9_]{6,250}$/.test(session)) {
      W.setTitle("Purchase");
      W.mount(h("div", { class: "wl-narrow" }, W.notice("info", "No purchase to confirm",
        "This page confirms a payment after checkout. Your enrolled courses are on your dashboard.",
        [W.btn("Go to my dashboard", { href: "/learn/" }), W.btn("View cart", { href: "/learn/cart/", class: "wl-btn-ghost" })])));
      return;
    }
    if (!W.requireAuth()) return;
    pending();
    poll();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && timer) { clearTimeout(timer); poll(); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
