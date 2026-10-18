/* [ellery] Practice questions (POST /api/ai/practice): Ellery.practice(container, opts).
 * Used by the lesson panel's Practice tab and by the course page's module practice.
 * Items come back with their answers (they are AI-written practice, never exam content); each
 * answer is revealed only after the learner commits. Nothing is stored.
 * opts: {courseId, lesson ("m1-l2") | module (number), lessonRef (this page's lesson, for anchors), title} */
(function () {
  "use strict";
  var E = window.Ellery;
  if (!E) return;
  var h = E.h;
  var seq = 0;

  function practice(root, o) {
    var uid = "ellp" + (++seq);
    /* The question list is not a live region (a screen reader would read every stem and option and
       then the focused control); one short message goes through its own status node instead. */
    var out = h("div", { class: "ell-practice-out" });
    var said = h("div", { class: "ell-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    var diff = h("select", { id: uid + "-d", class: "ell-select" },
      h("option", { value: "intro" }, "Gentle"), h("option", { value: "standard", selected: true }, "Standard"), h("option", { value: "stretch" }, "Stretch"));
    var num = h("select", { id: uid + "-n", class: "ell-select" }, [3, 5, 8].map(function (n) { return h("option", { value: String(n), selected: n === 5 }, n + " questions"); }));
    var go = E.btn("Write practice questions");
    var form = h("form", { class: "ell-practice-form", novalidate: true },
      h("div", { class: "ell-row" },
        h("div", { class: "ell-field" }, h("label", { for: uid + "-d" }, "Difficulty"), diff),
        h("div", { class: "ell-field" }, h("label", { for: uid + "-n" }, "How many"), num)),
      h("div", { class: "ell-actions" }, go));
    E.clear(root);
    E.add(root, [
      E.practiceLabel("Not part of certification. Questions are AI-generated and can be wrong."),
      h("p", { class: "ell-hint" }, o.title ? E.name() + " writes fresh questions from " + o.title + ". " : "", "They are never exam questions, and answers are shown only after you choose."),
      E.firstUse("practice"), form, said, out]);

    form.addEventListener("submit", function (e) { e.preventDefault(); run(); });
    go.addEventListener("click", function (e) { e.preventDefault(); run(); });

    function run() {
      go.disabled = true; go.setAttribute("aria-busy", "true"); go.textContent = "Writing questions…";
      E.clear(out).appendChild(E.spinner(E.name() + " is writing questions. This takes a few seconds…"));
      var body = { courseId: o.courseId, n: Number(num.value), difficulty: diff.value };
      if (o.lesson) body.lesson = o.lesson; else body.module = o.module;
      E.request("POST", "/api/ai/practice", body, { auth: true }).then(render, function (err) {
        E.clear(out).appendChild(E.stateBox(E.describe(err, "practice"), run));
      }).then(function () {
        go.disabled = false; go.removeAttribute("aria-busy"); go.textContent = "Write a new set";
        if (!document.activeElement || document.activeElement === document.body) go.focus();
      });
    }

    function render(d) {
      E.clear(out);
      var items = (d && d.items) || [];
      if (d && d.quota && typeof d.quota.remaining === "number")
        out.appendChild(h("p", { class: "ell-hint" }, d.quota.remaining + " practice " + (d.quota.remaining === 1 ? "set" : "sets") + " left today."));
      var aside = ((d && d.dropped) || 0) + ((d && d.invalid) || 0);
      if (aside) out.appendChild(h("p", { class: "ell-hint" }, E.name() + " set aside " + aside + (aside === 1 ? " draft question that didn't" : " draft questions that didn't") + " meet the quality checks."));
      var head = h("h3", { class: "ell-h", tabindex: "-1" }, items.length + " practice " + (items.length === 1 ? "question" : "questions"));
      var list = h("ol", { class: "ell-q-list" });
      items.forEach(function (it, n) { list.appendChild(item(it, n)); });
      out.appendChild(head);
      out.appendChild(list);
      out.appendChild(E.feedback("practice"));
      said.textContent = "";
      setTimeout(function () { said.textContent = items.length + " practice " + (items.length === 1 ? "question" : "questions") + " ready. Answer each, then choose Check answer."; }, 60);
      head.focus();
    }

    function section(it) {
      if (!it.section) return null;
      var a = E.sectionAnchor({ href: null, title: it.section.title, lesson: it.section.lesson }, o.lessonRef);
      var text = "From: " + (it.section.title || it.section.id);
      if (a) return h("p", { class: "ell-from" }, h("a", { class: "ell-cite", href: "#" + a }, "§ " + (it.section.title || it.section.id)));
      return h("p", { class: "ell-from" }, text + (it.section.lesson && it.section.lesson !== o.lessonRef ? " (lesson " + it.section.lesson + ")" : ""));
    }

    function item(it, n) {
      var qid = uid + "-q" + n;
      var res = h("div", { class: "ell-q-result", role: "status" });
      var li = h("li", { class: "ell-q" });
      var check = E.btn(it.type === "short" ? "Show model answer" : "Check answer", { class: "ell-btn-sm" });
      function reveal(correct, extra) {
        check.disabled = true;
        E.add(res, [
          correct === null ? null : h("p", { class: correct ? "ell-ok" : "ell-bad" }, h("strong", null, correct ? "Correct. " : "Not quite. "), extra || ""),
          it.explanation ? h("div", { class: "ell-expl" }, E.md(it.explanation)) : null, section(it)]);
      }
      if (it.type === "single" || it.type === "truefalse") {
        var opts = it.type === "single" ? it.options : ["True", "False"];
        var fs = h("fieldset", { class: "ell-q-opts" }, h("legend", { class: "ell-q-stem" }, h("span", { class: "ell-q-n" }, (n + 1) + ". "), it.stem),
          opts.map(function (txt, i) {
            return h("label", { class: "ell-opt" }, h("input", { type: "radio", name: qid, value: String(i) }), h("span", null, txt));
          }));
        check.addEventListener("click", function () {
          var sel = fs.querySelector("input:checked");
          if (!sel) { res.textContent = "Choose an answer first."; return; }
          res.textContent = "";
          var i = Number(sel.value);
          var right = it.type === "single" ? it.answer[0] : (it.answer ? 0 : 1);
          Array.prototype.forEach.call(fs.querySelectorAll("input"), function (x) { x.disabled = true; });
          var labels = fs.querySelectorAll(".ell-opt");
          if (labels[right]) { labels[right].classList.add("is-right"); labels[right].appendChild(h("span", { class: "ell-tag" }, " (correct answer)")); }
          if (i !== right && labels[i]) labels[i].classList.add("is-wrong");
          reveal(i === right, i === right ? "" : "The answer is “" + opts[right] + "”.");
        });
        E.add(li, [fs, h("div", { class: "ell-actions" }, check), res]);
      } else {
        var ta = h("textarea", { id: qid, class: "ell-input", rows: "3", maxlength: "1200" });
        check.addEventListener("click", function () {
          reveal(null);
          res.insertBefore(h("div", { class: "ell-model" }, h("strong", null, "Model answer: "), it.modelAnswer), res.firstChild);
          ta.readOnly = true;
        });
        E.add(li, [h("p", { class: "ell-q-stem", id: qid + "-s" }, h("span", { class: "ell-q-n" }, (n + 1) + ". "), it.stem),
          h("label", { class: "ell-label", for: qid }, "Your answer (only you see it)"), ta, h("div", { class: "ell-actions" }, check), res]);
      }
      return li;
    }
  }

  E.practice = practice;
})();
