/* /learn/cart/ : multi-item cart, discount code, live quote from the Worker, Stripe checkout.
 * Prices are never computed here: every figure shown comes from POST /api/quote. */
(function () {
  "use strict";
  var API = window.WIAApi, W = window.WL, h = W.h;
  var CODE_KEY = "wia_code";
  var ID_RE = /^[a-z0-9-]{2,60}$/;

  var state = { quote: null, quoteError: null, loading: false, seq: 0, me: null, code: "", buy: false };
  var els = {};

  function storedCode() { try { return sessionStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
  function saveCode(c) { try { if (c) sessionStorage.setItem(CODE_KEY, c); else sessionStorage.removeItem(CODE_KEY); } catch (e) { /* ignore */ } }

  /** ?add=course:fnd-101 or ?add=program:cert-x, repeatable or comma/pipe separated. */
  function absorbParams() {
    var sp; try { sp = new URLSearchParams(window.location.search); } catch (e) { return; }
    var adds = sp.getAll("add"), added = 0;
    adds.forEach(function (raw) {
      String(raw).split(/[,|\s]+/).forEach(function (tok) {
        var m = /^(course|program|track|pass):([a-z0-9-]+)$/.exec(tok.trim().toLowerCase());   // [bundles] track, pass
        if (m && ID_RE.test(m[2])) { W.cart.add(m[1], m[2]); added++; }
      });
    });
    var code = sp.get("code");
    if (code) saveCode(code.trim().toLowerCase().slice(0, 40));
    var canceled = sp.get("canceled");
    /* "Buy now" on a course/program page: same cart, but take the learner straight on to
       checkout (sign-in first when needed, otherwise focus the Pay button once priced). */
    var buy = sp.get("buy") === "1";
    if (adds.length || code || sp.has("buy")) {
      sp.delete("add"); sp.delete("code"); sp.delete("buy");
      var q = sp.toString();
      history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
    }
    return { added: added, canceled: canceled === "1", buy: buy && added > 0 };
  }

  function itemTitle(i) {
    if (i.type === "track") return W.trackLabel(i.id) + " track";   // [bundles]
    if (i.type === "pass") return "All-Access Pass";
    return i.type === "program" ? W.programTitle(i.id) : W.courseTitle(i.id);
  }
  /* [bundles] */
  var KIND_LABEL = { program: "Program", track: "Track bundle", pass: "Pass" };
  function itemHref(i) {
    if (i.type === "track") return "/tracks/" + i.id + "/";
    if (i.type === "pass") return "/pricing/#all-access";
    return (i.type === "program" ? "/programs/" : "/courses/") + i.id + "/";
  }

  function build(flags) {
    W.setTitle("Your cart");
    state.code = storedCode();
    els.items = h("div", { class: "wl-cart-items" });
    els.summary = h("div", { class: "wl-summary-body", "aria-live": "polite" });
    els.codeMsg = h("p", { class: "wl-hint", id: "code-msg", role: "status" });
    els.codeInput = h("input", { id: "code", name: "code", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
      maxlength: "40", value: state.code, "aria-describedby": "code-msg" });
    var codeForm = h("form", { class: "wl-code-form", novalidate: true },
      h("label", { for: "code" }, "Discount code"),
      h("div", { class: "wl-inline" }, els.codeInput, h("button", { type: "submit", class: "wl-btn wl-btn-ghost" }, "Apply")),
      els.codeMsg);
    codeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      state.code = els.codeInput.value.trim().toLowerCase();
      saveCode(state.code);
      requote();
    });
    els.codeForm = codeForm;

    els.checkout = h("div", { class: "wl-checkout" });
    var top = [];
    if (flags && flags.canceled) top.push(W.notice("info", "Checkout canceled", "Nothing was charged. Your cart is just as you left it."));

    W.mount(h("div", { class: "wl-cart" },
      h("header", { class: "wl-pagehead" }, h("p", { class: "wl-eyebrow" }, "Checkout"), h("h1", { class: "wl-display" }, "Your cart")),
      top,
      h("div", { class: "wl-cart-grid" },
        h("section", { "aria-labelledby": "h-items" }, h("h2", { id: "h-items", class: "wl-sr" }, "Items"), els.items, codeForm),
        h("aside", { class: "wl-summary", "aria-labelledby": "h-sum" },
          h("h2", { id: "h-sum", class: "wl-h3" }, "Summary"), els.summary, els.checkout))));
    renderItems();
    renderCheckout();
    requote();
  }

  function renderItems() {
    var cart = W.cart.get();
    W.clear(els.items);
    els.codeForm.hidden = !cart.length;
    if (!cart.length) {
      els.items.appendChild(h("div", { class: "wl-empty" },
        h("p", { class: "wl-strong" }, "Your cart is empty."),
        h("p", null, "Choose a course or a program from the catalog. Programs bundle several courses at a lower price."),
        h("div", { class: "wl-actions" }, W.btn("Browse courses", { href: "/courses/" }), W.btn("See programs", { href: "/programs/", class: "wl-btn-ghost" }))));
      return;
    }
    var q = state.quote;
    var lines = (q && q.lines) || [];
    var list = h("ul", { class: "wl-cart-list", role: "list" });
    cart.forEach(function (i) {
      var line = lines.filter(function (l) { return l.type === i.type && l.id === i.id; })[0];
      var coveredBy = !line && q ? lines.filter(function (l) { return (l.type === "program" || l.type === "track") && (l.grants || []).indexOf(i.id) >= 0; })[0] : null;   // [bundles] track
      var title = (line && line.title) || itemTitle(i);
      var price = h("div", { class: "wl-line-price" });
      if (line) {
        if (line.discount > 0) price.appendChild(h("s", { class: "wl-muted", "aria-label": "was " + W.money(line.base) }, W.money(line.base)));
        /* Free = billing priced the line at 0 before any discount (intro course or a 0 override). */
        price.appendChild(h("span", { class: "wl-strong" + (line.base === 0 ? " wl-tone-ok" : "") }, line.base === 0 ? "Free" : W.money(line.price)));
      } else if (coveredBy) {
        price.appendChild(h("span", { class: "wl-muted" }, "Included"));
      } else if (state.loading) {
        price.appendChild(h("span", { class: "wl-skel", "aria-hidden": "true" }));
      } else {
        price.appendChild(h("span", { class: "wl-muted" }, "—"));
      }
      var rm = h("button", { type: "button", class: "wl-link-btn", "aria-label": "Remove " + title + " from cart" }, "Remove");
      rm.addEventListener("click", function () {
        W.cart.remove(i.type, i.id);
        W.toast("Removed " + title + ".");
        renderItems(); requote();
        var next = els.items.querySelector(".wl-link-btn") || els.items.querySelector("a");
        if (next) next.focus();
      });
      list.appendChild(h("li", { class: "wl-cart-line" },
        h("div", { class: "wl-grow" },
          h("div", { class: "wl-card-meta" }, h("span", { class: "wl-code" }, KIND_LABEL[i.type] || i.id),
            line && (line.type === "program" || line.type === "track") && line.grants ? h("span", null, W.plural(line.grants.length, "course")) : null,
            line && line.type === "pass" && line.durationDays ? h("span", null, line.durationDays + " days") : null),
          h("a", { class: "wl-strong-link", href: itemHref(i) }, title),
          line && line.type === "track" ? h("p", { class: "wl-hint" }, "The courses on sale in this track today that you do not already own. Courses added to the track later are not included.") : null,
          line && line.type === "pass" ? h("p", { class: "wl-hint" }, "Every course on sale for " + line.durationDays + " days, including new ones; if you already have a pass, it starts when that one ends.") : null,
          line && line.discountLabel ? h("p", { class: "wl-disc" }, h("span", { "aria-hidden": "true" }, "✓ "), line.discountLabel, " · −" + W.money(line.discount)) : null,
          coveredBy ? h("p", { class: "wl-hint" }, "Already included in " + coveredBy.title + ".") : null,
          h("div", null, rm)),
        price));
    });
    els.items.appendChild(list);
  }

  function requote() {
    var cart = W.cart.get();
    var my = ++state.seq;
    if (!cart.length) { state.quote = null; state.quoteError = null; renderSummary(); renderCheckout(); return; }
    state.loading = true;
    renderSummary();
    var body = { items: cart.map(function (i) { return { type: i.type, id: i.id }; }) };
    if (state.code) body.code = state.code;
    API.quote(body).then(function (q) {
      if (my !== state.seq) return;
      state.loading = false;
      if (q && q.error) { state.quote = null; state.quoteError = q.error; }
      else { state.quote = q; state.quoteError = null; }
      renderItems(); renderSummary(); renderCheckout();
    }, function (err) {
      if (my !== state.seq) return;
      state.loading = false; state.quote = null; state.quoteError = err.message;
      renderItems(); renderSummary(); renderCheckout();
    });
  }

  function codeMessage(q) {
    if (!state.code) return ["", ""];
    var c = q && q.code;
    if (!c) return ["", ""];
    switch (c.status) {
      case "applied": return ["Code “" + c.code + "” applied.", "ok"];
      case "better_offer_applied": return ["Code “" + c.code + "” is valid, but a better offer you already qualify for is applied instead. Discounts do not stack; you always get the best one.", "info"];
      case "not_applicable": return ["Code “" + c.code + "” does not apply to the items in your cart" + (API.signedIn() ? "" : ", or needs you to sign in") + ".", "warn"];
      default: return ["We do not recognize the code “" + c.code + "”.", "warn"];
    }
  }

  function renderSummary() {
    var s = els.summary; W.clear(s);
    var q = state.quote;
    var cm = codeMessage(q);
    els.codeMsg.textContent = cm[0];
    els.codeMsg.className = "wl-hint" + (cm[1] ? " wl-tone-" + cm[1] : "");
    if (!W.cart.get().length) { s.appendChild(h("p", { class: "wl-muted" }, "Nothing to pay for yet.")); return; }
    if (state.loading && !q) { s.appendChild(W.spinner("Getting your price…")); return; }
    if (state.quoteError) {
      s.appendChild(W.notice("error", "We could not price this cart", state.quoteError,
        [W.btn("Try again", { class: "wl-btn-sm wl-btn-ghost", onclick: requote })]));
      return;
    }
    if (!q) return;
    /* [bundles-fix] an active pass already opens every course on sale: warn before paying twice */
    var pass = state.me && state.me.pass;
    var paidCourses = W.cart.get().filter(function (i) { return i.type === "course" || i.type === "track" || i.type === "program"; });
    if (pass && pass.active && paidCourses.length)
      s.appendChild(W.notice("warn", "Your All-Access Pass already includes these courses",
        "Every course on sale is open to you until " + W.fmtDate(pass.endsAt) + ". Buy a course only if you want to keep it after the pass ends.",
        [W.btn("Go to my dashboard", { href: "/learn/", class: "wl-btn-sm wl-btn-ghost" })]));
    var f = q.formatted || {};
    var rows = h("dl", { class: "wl-totals" + (state.loading ? " is-updating" : "") },
      h("div", null, h("dt", null, "Subtotal"), h("dd", null, f.subtotal || W.money(q.subtotal))),
      q.discount > 0 ? h("div", { class: "wl-tone-ok" }, h("dt", null, "Discounts"), h("dd", null, "−" + (f.discount || W.money(q.discount)))) : null,
      h("div", { class: "wl-total" }, h("dt", null, "Total"), allFree(q) ? h("dd", { class: "wl-tone-ok" }, "Free") : h("dd", null, f.total || W.money(q.total), h("span", { class: "wl-cur" }, " " + String(q.currency || "usd").toUpperCase()))));
    s.appendChild(rows);
    if (state.loading) s.appendChild(h("p", { class: "wl-hint" }, "Updating…"));
    /* [bundles] next build-your-own tier, from billing's quote (never computed here) */
    var bn = q.bundle;
    if (bn && bn.next && bn.courses > 0 && bn.next.more > 0)
      s.appendChild(h("p", { class: "wl-hint wl-tone-info", "data-bundle-next": "" },
        "Add " + W.plural(bn.next.more, "more course") + " to save " + (bn.next.bps / 100) + "% on each course" + (bn.current ? " instead of " + (bn.current.bps / 100) + "%" : "") + "."));
    var personal = API.signedIn();
    s.appendChild(h("p", { class: "wl-hint" }, personal
      ? "Your personal price: it includes any discount available to your account."
      : "Sign in to see any discount available to you or your organization."));
  }

  /** Billing priced the whole cart at 0 with no discount involved: free courses only. Stripe
   *  cannot take $0, so these are enrolled directly (the Worker re-checks the price). */
  function allFree(q) { return !!q && !q.error && q.subtotal === 0 && q.total === 0 && Array.isArray(q.grants) && q.grants.length > 0; }

  function renderFreeEnroll(c, cart) {
    var q = state.quote, ids = q.grants.slice();
    var b = h("button", { type: "button", class: "wl-btn wl-btn-block" }, ids.length === 1 ? "Enroll free" : "Enroll free in " + W.plural(ids.length, "course"));
    var err = h("div", { role: "alert", class: "wl-form-error", hidden: true });
    b.addEventListener("click", function () {
      err.hidden = true;
      var run = ids.reduce(function (p, id) {
        return p.then(function () { return API.request("POST", "/api/courses/" + encodeURIComponent(id) + "/enroll-free", {}); });
      }, Promise.resolve());
      W.busy(b, run, "Enrolling…").then(function () {
        cart.forEach(function (i) { W.cart.remove(i.type, i.id); });
        if (window.WIAConsent) window.WIAConsent.track("Lead", {});   // [marketing] Reddit Pixel, only after Accept; no PII
        window.location.assign(ids.length === 1 ? W.courseUrl(ids[0]) : "/learn/");
      }, function (e) { err.textContent = e.message; err.hidden = false; requote(); });
    });
    c.appendChild(b);
    c.appendChild(err);
    c.appendChild(h("p", { class: "wl-small wl-center wl-muted" }, "No payment needed. Your enrollment starts straight away."));
  }

  function renderCheckout() {
    var c = els.checkout;
    var hadFocus = c.contains(document.activeElement) && document.activeElement.tagName === "BUTTON";
    W.clear(c);
    var cart = W.cart.get();
    if (!cart.length) return;
    var free = allFree(state.quote) && !state.quoteError && !state.loading;
    if (!API.signedIn()) {
      c.appendChild(W.btn(free ? "Sign in to enroll free" : "Sign in to check out", { href: W.signInUrl("/learn/cart/"), class: "wl-btn-block" }));
      c.appendChild(h("p", { class: "wl-small wl-center" }, "New here? ", h("a", { href: "/learn/?mode=signup&next=" + encodeURIComponent("/learn/cart/") }, "Create an account")));
      return;
    }
    var me = state.me;
    if (me && me.learner && !me.learner.emailVerified) {
      c.appendChild(h("p", { class: "wl-hint wl-tone-info" }, "Personal and organization discounts need a verified email. ",
        h("a", { href: "/learn/account/" }, "Verify your email"), " before checking out if you expect one."));
    }
    if (free) { renderFreeEnroll(c, cart); return; }
    var ok = state.quote && !state.quoteError && !state.loading;
    var b = h("button", { type: "button", class: "wl-btn wl-btn-block", disabled: !ok }, ok ? "Pay " + ((state.quote.formatted && state.quote.formatted.total) || W.money(state.quote.total)) + " securely" : "Check out");
    var err = h("div", { role: "alert", class: "wl-form-error", hidden: true });
    var changed = h("div", { class: "wl-checkout-changed", hidden: true });
    function go(r, u) {
      b.disabled = true; b.textContent = "Redirecting to Stripe…";
      try { sessionStorage.setItem("wia_last_purchase", JSON.stringify({ id: r.purchaseId, items: cart })); } catch (e) { /* ignore */ }
      window.location.assign(u.href);
    }
    b.addEventListener("click", function () {
      err.hidden = true; changed.hidden = true;
      var shown = state.quote ? state.quote.total : null;
      var body = { items: cart.map(function (i) { return { type: i.type, id: i.id }; }), cancelPath: "/learn/cart/" };
      if (state.code) body.code = state.code;
      W.busy(b, API.checkout(body), "Opening secure checkout…").then(function (r) {
        var u;
        try { u = new URL(r.url); } catch (e) { u = null; }
        if (!u || !(u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
          err.textContent = "Checkout could not be started. Please try again."; err.hidden = false; return;
        }
        /* The price can change between quote and checkout (an offer expired or reached its
           cap). Never send the learner to pay an amount the button did not show. */
        if (typeof r.total === "number" && shown !== null && r.total !== shown) {
          W.clear(changed);
          var cont = W.btn("Continue to pay " + (r.totalFormatted || W.money(r.total)), { class: "wl-btn-block" });
          cont.addEventListener("click", function () { go(r, u); });
          W.append(changed, W.notice("warn", "Your price has changed",
            "The total is now " + (r.totalFormatted || W.money(r.total)) + " instead of " + W.money(shown) +
            ", usually because an offer ended or reached its limit. Nothing has been charged.", [cont]));
          changed.hidden = false;
          b.hidden = true; /* its label shows the old total */
          cont.focus();
          return;
        }
        go(r, u);
      }, function (e) {
        err.textContent = e.message; err.hidden = false;
        if (e.status !== 401) requote();
      });
    });
    c.appendChild(b);
    c.appendChild(err);
    c.appendChild(changed);
    if (ok && state.buy) {
      /* "Buy now": the cart is priced, so take the learner to the Pay button. */
      state.buy = false;
      b.scrollIntoView({ block: "center", behavior: "smooth" });
      b.focus({ preventScroll: true });
    } else if (hadFocus && !b.disabled) b.focus({ preventScroll: true });
    c.appendChild(h("p", { class: "wl-small wl-center wl-muted" }, "Payment by card through Stripe. Your enrollment starts as soon as payment is confirmed."));
  }

  function boot() {
    var flags = absorbParams() || {};
    if (flags.buy) {
      if (!API.signedIn()) { window.location.replace(W.signInUrl("/learn/cart/")); return; }
      state.buy = true;
    }
    build(flags);
    if (API.signedIn()) {
      API.request("GET", "/api/me", undefined, { quiet401: true }).then(function (me) { state.me = me; renderSummary(); renderCheckout(); },   // [bundles-fix] renderSummary: pass warning
        function (e) { if (e.status === 401) { renderCheckout(); renderSummary(); requote(); } });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
