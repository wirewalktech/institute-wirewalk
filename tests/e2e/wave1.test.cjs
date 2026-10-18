// Wave 1 learner-experience acceptance tests (worker repo ai/plans/learning-experience-2026-10.md),
// in a real browser against a static build of this site and a stubbed Worker API.
// Run: see tests/e2e/README.md.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { start, stubApi } = require("./harness.cjs");

const LAB = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/lab.json"), "utf8"));
const LAB_ID = LAB.get.lab.id;
let H;
before(async () => { H = await start(); });
after(async () => { if (H) await H.stop(); });

/* ------------------------------------------------------------------ fixtures */
const NO_EXAM = { eligible: false, reason: "complete_lessons", attemptsUsed: 0, attemptsAllowed: 3, passed: false, bestScore: null, nextAttemptAt: null, openAttempt: null };
const EXAM_OPEN = { ...NO_EXAM, eligible: true, reason: null };
/** ven-120 as a 3-lesson course: module 1 (lessons 0, 1, then the lab), module 2 (lesson 2). */
function outline({ done = [], labFinished = false, exam = NO_EXAM } = {}) {
  const L = (idx, title) => ({ idx, title, completed: done.includes(idx) });
  return {
    course: { id: "ven-120", title: "Claude for Professionals", level: "basic", track: "vendors", hours: 4, exam: { questions: 4, passPct: 70, minutes: 40, attempts: 3 } },
    enrolled: true,
    modules: [
      { module: 1, title: "Getting Started", lessons: [L(0, "Plans and data rules"), L(1, "Briefs that hold")],
        labs: [{ id: LAB_ID, title: LAB.get.lab.title, kind: "module", minutes: 12, module: 1, status: labFinished ? "finished" : "not_started", bestRating: null }] },
      { module: 2, title: "Organizing for Adoption", lessons: [L(2, "Workspaces")] },
    ],
    progress: { done: done.length, total: 3, labs: { done: labFinished ? 1 : 0, total: 1 } },
    exam, certificate: null, learner: { email: "pat@example.com", emailVerified: true },
  };
}
function lesson(idx, { completed = false } = {}) {
  const mods = { 0: [1, 1], 1: [1, 2], 2: [2, 1] }, titles = ["Plans and data rules", "Briefs that hold", "Workspaces"];
  return { idx, module: mods[idx][0], lesson: mods[idx][1], title: titles[idx], completed,
    html: "<p>" + "Lesson text for the walk. ".repeat(40) + "</p><h2>Key takeaways</h2><ul><li>One.</li></ul>",
    prev: idx > 0 ? { idx: idx - 1, title: titles[idx - 1] } : null, next: idx < 2 ? { idx: idx + 1, title: titles[idx + 1] } : null,
    progress: { done: idx, total: 3 }, learner: { email: "pat@example.com", emailVerified: true } };
}
/** Stub for the lab routes, replaying the engine-generated fixture; `finish` is merged into the ending step. */
function labRoutes(finish) {
  const base = `/api/courses/ven-120/labs/${LAB_ID}`;
  let n = 0;
  return (m, p, b) => {
    if (p === base && m === "GET") return LAB.get;
    if (p === base + "/play" && m === "POST") { n = 0; return LAB.play; }
    if (p === base + "/play/lp_1/step" && m === "POST") {
      const s = LAB.steps[n++];
      assert.deepEqual([b.nodeId, b.choiceId], [s.nodeId, s.choiceId], "the walk follows the fixture path");
      return s.response.finished ? { ...s.response, ...finish } : s.response;
    }
  };
}
const until = async (fn, ms = 5000, step = 50) => {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, step)); }
};
const text = (page, sel) => page.$eval(sel, e => e.textContent.replace(/\s+/g, " ").trim());
const liveTexts = page => page.$$eval("[role=status],[aria-live],[role=alert]", els => els.map(e => e.textContent.trim()).filter(Boolean));
const bigLive = page => page.$$eval("[role=status],[aria-live],[role=alert],[role=log]", els => els.filter(e => (e.textContent || "").trim().length > 300).map(e => e.id || e.className));

/** Click through a lab from its briefing to the ending, choosing the fixture's path. */
async function playLab(page) {
  await page.click("button.lab-cta");
  let node = LAB.play.node;
  for (const s of LAB.steps) {
    await page.waitForSelector(".lab-choices .lab-card:not([disabled])");
    const i = node.choices.findIndex(c => c.id === s.choiceId);
    assert.ok(i >= 0, `choice ${s.choiceId} is shown`);
    await page.locator(".lab-choices .lab-card").nth(i).click();
    await page.waitForSelector(".lab-next");
    for (let guard = 0; guard < 8; guard++) {
      if (await page.$(".lab-end")) break;
      if (!s.response.finished && await page.$(".lab-choices .lab-card:not([disabled])")) break;
      const go = await page.$(".lab-next, .lab-ev-go");
      if (!go) { await page.waitForTimeout(100); continue; }
      await go.click();
      await page.waitForTimeout(120);
    }
    node = s.response.node || node;
  }
  await page.waitForSelector(".lab-end", { timeout: 5000 });
  await page.waitForTimeout(150);
}

/* ------------------------------------------------------------------ W1-4 */
test("W1-4: primary buttons only, lesson -> Decision Lab -> unlocked exam; the unlock is announced once", async () => {
  const { ctx, page } = await H.newPage(1280);
  let completed = [0];
  const labs = labRoutes({ progress: { done: 3, total: 3, labs: { done: 1, total: 1 } }, examUnlocked: true, examPassed: false, firstFinish: true });
  await stubApi(page, (m, p, b) => {
    if (p === "/api/courses/ven-120") return outline({ done: completed });
    if (/\/lessons\/\d+$/.test(p)) return lesson(Number(p.split("/").pop()));
    if (/\/lessons\/1\/complete$/.test(p)) { completed = [0, 1]; return { progress: { done: 2, total: 3, labs: { done: 0, total: 1 } }, examUnlocked: false, examPassed: false }; }
    if (/\/exam$|\/exam\//.test(p)) return undefined;
    return labs(m, p, b);
  });
  await page.goto(H.origin + "/learn/lesson/?c=ven-120&l=1");
  await page.waitForSelector(".wl-complete-ask .wl-actions");
  const acts = await page.$$eval(".wl-complete-ask .wl-actions > *", els => els.map(e => e.textContent.trim()));
  assert.deepEqual(acts, ["Complete and start the Decision Lab →", "Complete and skip the lab", "Mark as complete"]);
  const labBeforeBox = await page.evaluate(() => { const a = document.querySelector(".wl-lab-callout"), b = document.querySelector(".wl-complete"); return !!(a && b && a.compareDocumentPosition(b) & 4); });
  assert.ok(labBeforeBox, "the lab callout sits above the completion box");
  await Promise.all([page.waitForURL(/\/learn\/lab\/\?course=ven-120&lab=/), page.click(".wl-complete-ask .wl-actions > :first-child")]);

  await page.waitForSelector("button.lab-cta");
  await playLab(page);
  const strip = await text(page, ".lab-end-progress");
  assert.match(strip, /Lab complete · 1 of 1 Decision Lab/);
  const primary = await text(page, ".lab-end-actions > :first-child");
  assert.equal(primary, "Take the exam");
  const toasts = await until(() => page.evaluate(() => (document.getElementById("wl-toasts") || {}).textContent || ""));
  assert.match(toasts, /The exam is unlocked/);
  const live = await liveTexts(page);
  assert.equal(live.filter(t => /exam is unlocked/i.test(t)).length, 1, "spoken once: " + JSON.stringify(live));
  await Promise.all([page.waitForURL(/\/learn\/exam\/\?c=ven-120/), page.click(".lab-end-actions > :first-child")]);
  await ctx.close();
});

test("W1-4: replaying a finished lab does not re-announce the unlock, and a passed exam is not offered again", async () => {
  for (const [finish, wantPrimary] of [
    [{ progress: { done: 3, total: 3, labs: { done: 1, total: 1 } }, examUnlocked: true, examPassed: false, firstFinish: false }, "Take the exam"],
    [{ progress: { done: 3, total: 3, labs: { done: 1, total: 1 } }, examUnlocked: true, examPassed: true, firstFinish: true }, "Continue to Module 2: Organizing for Adoption"],
  ]) {
    const { ctx, page } = await H.newPage(1280);
    const labs = labRoutes(finish);
    await stubApi(page, (m, p, b) => p === "/api/courses/ven-120" ? outline({ done: [0, 1, 2], labFinished: true }) : labs(m, p, b));
    await page.goto(H.origin + `/learn/lab/?course=ven-120&lab=${LAB_ID}`);
    await page.waitForSelector("button.lab-cta");
    await playLab(page);
    assert.equal(await text(page, ".lab-end-actions > :first-child"), wantPrimary);
    await page.waitForTimeout(300);
    const all = (await liveTexts(page)).join(" | ");
    assert.doesNotMatch(all, /exam is unlocked/i, all);
    if (finish.examPassed) assert.match(await text(page, ".lab-end-progress"), /Exam passed/);
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ W1-9 */
test("W1-9: after Begin, the first scene's top is within 0-120 px at 390 and 1280 wide", async () => {
  for (const w of [390, 1280]) {
    const { ctx, page } = await H.newPage(w);
    const labs = labRoutes({});
    await stubApi(page, (m, p, b) => p === "/api/courses/ven-120" ? outline({ done: [0, 1] }) : labs(m, p, b));
    await page.goto(H.origin + `/learn/lab/?course=ven-120&lab=${LAB_ID}`);
    const b = await page.waitForSelector("button.lab-cta");
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await page.waitForSelector(".lab-scene");
    let last = null, top = null;
    await until(async () => { top = await page.evaluate(() => Math.round(document.querySelector(".lab-scene").getBoundingClientRect().top)); const still = top === last; last = top; return still; }, 4000, 150);
    assert.ok(top >= 0 && top <= 120, `scene top ${top}px at ${w}`);
    assert.match(await text(page, ".lab-hud-step"), /^Decision 1 of 2–4$/, "a range while paths of different lengths remain");
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ W1-5 */
const meFor = kind => ({ learner: { id: "l1", name: "Pat Lee", email: "pat@example.com", emailVerified: true },
  enrollments: kind === "first" ? [] : [{ courseId: "fnd-001", title: "What Is AI?", grantedAt: "2026-10-01", progress: { done: 3, total: 7 }, exam: NO_EXAM, certificate: null }],
  certificates: [], purchases: [], pass: null, passCourses: [] });

test("W1-5: first-run dashboard (Welcome, starters, finder) vs returning (Welcome back); Enroll free opens lesson 1", async () => {
  for (const kind of ["first", "returning"]) {
    const { ctx, page } = await H.newPage(390);
    await stubApi(page, (m, p) => {
      if (p === "/api/me") return meFor(kind);
      if (/\/enroll-free$/.test(p)) return { enrolled: true, already: false };
      if (/\/lessons\/0$/.test(p)) return { ...lesson(0), title: "First lesson" };
      if (/^\/api\/courses\/[a-z0-9-]+$/.test(p)) return { ...outline(), course: { id: "fnd-001", title: "What Is AI?" }, modules: [{ module: 1, title: "M1", lessons: [{ idx: 0, title: "First lesson", completed: false }] }], progress: { done: 0, total: 1 } };
      if (p.startsWith("/api/ai/")) return { __status: 404, error: "off" };
    });
    await page.goto(H.origin + "/learn/");
    await page.waitForSelector(".wl-pagehead h1");
    const h1 = await text(page, ".wl-pagehead h1");
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    assert.equal(focused, "H1", "W1-11: focus lands on the h1 after mount");
    assert.deepEqual(await bigLive(page), [], "W1-11: no live region holds more than 300 characters");
    if (kind === "returning") { assert.equal(h1, "Welcome back, Pat."); assert.equal(await page.$("section[aria-labelledby=h-start]"), null); await ctx.close(); continue; }
    assert.equal(h1, "Welcome, Pat.");
    const cards = await page.$$eval("section[aria-labelledby=h-start] li", els => els.map(e => ({ code: e.querySelector(".wl-code").textContent, hint: e.querySelector(".wl-hint").textContent })));
    assert.equal(cards.length, 3);
    assert.equal(cards[0].code, "fnd-001");
    for (const c of cards) assert.doesNotMatch(c.hint, /Decision Lab/, `${c.code}: the catalog lists no labs for it, so the card promises none`);
    await Promise.all([page.waitForURL(/\/learn\/lesson\/\?c=fnd-001&l=0$/), page.click("section[aria-labelledby=h-start] li:first-child button")]);
    await page.waitForSelector("#lesson-title");
    assert.ok(await page.$(".wl-orient"), "W1-13: the first free enrollment shows the one-time orientation strip");
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ W1-6 */
test("W1-6: Buy now, Enroll free and a team invite open on Create account with one context line; returning browsers open on Sign in", async () => {
  const cases = [
    ["buy", "/learn/cart/?add=course:exe-501&buy=1", {}, "Create account", /^Create an account to buy “/],
    ["free", "/learn/?next=" + encodeURIComponent("/courses/fnd-001/?enroll=free"), {}, "Create account", /^Create a free account to start/],
    ["team", "/learn/team/#join=abc123", {}, "Create account", /accept your team invitation/],
    ["buy, returning browser", "/learn/cart/?add=course:exe-501&buy=1", { wia_has_account: "1" }, "Sign in", /^Sign in to buy/],
    ["buy, empty cart", "/learn/?intent=buy&next=%2Flearn%2Fcart%2F", {}, "Create account", /^Create an account to continue/],
  ];
  for (const [name, url, ls, tab, line] of cases) {
    const { ctx, page } = await H.newPage(390, { token: false, ls });
    await stubApi(page, (m, p) => { if (p === "/api/quote") return { items: [], total_minor: 0, currency: "usd" }; });
    await page.goto(H.origin + url);
    await page.waitForSelector("[role=tab][aria-selected=true]", { timeout: 8000 });
    assert.equal(await text(page, "[role=tab][aria-selected=true]"), tab, name);
    const notices = await page.$$eval(".wl-auth .wl-notice", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
    assert.equal(notices.length, 1, `${name}: one notice, not a stack: ${JSON.stringify(notices)}`);
    assert.match(notices[0], line, name);
    assert.doesNotMatch(notices[0], /buy your cart/, name);
    if (name === "team") assert.equal(await page.evaluate(() => sessionStorage.getItem("wia_join")), "abc123", "the invite token survives the redirect");
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ W1-13 */
test("W1-13: /go/ Start free -> Create account -> lesson 1 of fnd-001 in at most 2 navigations after signup, with the orientation strip", async () => {
  const { ctx, page } = await H.newPage(1280, { token: false });
  await stubApi(page, (m, p) => {
    if (p === "/api/auth/signup") return { token: "tok-new", learner: { id: "l9", name: "Pat Lee", email: "pat@example.com", emailVerified: false } };
    if (p === "/api/courses/fnd-001/enroll-free") return { enrolled: true, already: false };
    if (p === "/api/courses/fnd-001/lessons/0") return { ...lesson(0), title: "What AI is, and is not" };
    if (p === "/api/courses/fnd-001") return { ...outline(), course: { id: "fnd-001", title: "What Is AI?" }, modules: [{ module: 1, title: "M1", lessons: [{ idx: 0, title: "What AI is, and is not", completed: false }] }], progress: { done: 0, total: 1 } };
  });
  await page.goto(H.origin + "/go/business/");
  await Promise.all([page.waitForURL(/\/learn\/\?mode=signup/), page.click("a[data-start=fnd-001]")]);
  await page.waitForSelector("[role=tab][aria-selected=true]");
  assert.equal(await text(page, "[role=tab][aria-selected=true]"), "Create account");
  await page.fill("form input[name=name]", "Pat Lee");
  await page.fill("form input[name=email]", "pat@example.com");
  await page.fill("form input[name=password]", "a long enough password");
  const navs = [];   // document loads only; history.replaceState (dropping ?enroll=free) is not a navigation
  page.on("request", r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navs.push(r.url().replace(H.origin, "")); });
  await page.click("form button[type=submit]");
  await page.waitForURL(/\/learn\/lesson\/\?c=fnd-001&l=0$/, { timeout: 10000 });
  await page.waitForSelector("#lesson-title");
  assert.ok(navs.length <= 2, "navigations after signup: " + JSON.stringify(navs));
  assert.equal(await text(page, "#lesson-title"), "What AI is, and is not");
  assert.ok(await page.$(".wl-orient"), "the one-time orientation strip shows");
  await ctx.close();
});

/* ------------------------------------------------------------------ W1-3 / W1-10 / W1-11: exam */
const QS = [1, 2, 3, 4].map(n => ({ n, type: "single", stem: "Question " + n + " about the board pack?", options: ["Alpha", "Bravo", "Charlie", "Delta"] }));
async function openExam(width, putReply) {
  const { ctx, page } = await H.newPage(width);
  const puts = [];
  await stubApi(page, (m, p, b) => {
    if (p === "/api/courses/ven-120") return outline({ done: [0, 1, 2], labFinished: true, exam: EXAM_OPEN });
    if (p.endsWith("/exam/start")) return { attemptId: "at_1", deadline: new Date(Date.now() + 40 * 60000).toISOString(), minutes: 40, questions: QS, answers: {} };
    if (p === "/api/attempts/at_1/answers" && m === "PUT") { puts.push(b.answers); return putReply(puts.length, b); }
  });
  await page.goto(H.origin + "/learn/exam/?c=ven-120");
  await page.waitForSelector("#ack");
  await page.check("#ack");
  await page.click("button:has-text('Start the exam')");
  await page.waitForSelector(".wl-q");
  return { ctx, page, puts };
}

test("W1-11: after Start, focus is on question 1's legend; W1-10: the offline banner never covers the exam bar", async () => {
  for (const w of [390, 1280]) {
    const { ctx, page } = await openExam(w, () => ({ saved: 1, savedAt: new Date().toISOString() }));
    await page.waitForTimeout(100);
    const active = await page.evaluate(() => { const a = document.activeElement; return a.tagName + " " + a.textContent.trim(); });
    assert.match(active, /^LEGEND Question 1\./, active);
    assert.deepEqual(await bigLive(page), []);
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForSelector(".wl-offline");
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      return { banner: Math.round(box(".wl-offline").bottom), timer: Math.round(box(".wl-timer").top), saved: Math.round(box(".wl-exam-saved").top),
        bannerRole: document.querySelector(".wl-offline").getAttribute("role"), live: (document.getElementById("wl-conn-live") || {}).textContent || "" };
    });
    assert.ok(r.banner <= r.timer && r.banner <= r.saved, `${w}px: banner bottom ${r.banner} vs timer ${r.timer}, save status ${r.saved}`);
    assert.equal(r.bannerRole, null, "the banner is not itself a live region");
    assert.match(r.live, /You are offline/, "announced through the status region created at load");
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await until(() => page.evaluate(() => !document.querySelector(".wl-offline") && !document.documentElement.classList.contains("wl-has-offline")));
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("wl-has-offline")), false);
    await ctx.close();
  }
});

test("W1-3: autosave stops and says why on 403, and backs off on 429 instead of hammering the Worker", async () => {
  {
    const { ctx, page, puts } = await openExam(1280, () => ({ __status: 403, error: "not enrolled" }));
    await page.click("label[for=q1-o1]");
    await until(() => puts.length >= 1, 4000);
    await until(() => page.evaluate(() => /no longer have access/.test(document.querySelector(".wl-exam-saved").textContent)), 2000);
    assert.match(await text(page, ".wl-exam-saved"), /no longer have access/);
    await page.click("label[for=q1-o2]");
    await page.waitForTimeout(2600);
    assert.equal(puts.length, 1, "no retries after a 403");
    await ctx.close();
  }
  {
    const { ctx, page, puts } = await openExam(1280, n => n === 1 ? { __status: 429, error: "too many saves", reason: "rate" } : { saved: 2, savedAt: new Date().toISOString() });
    await page.click("label[for=q1-o1]");
    await until(() => puts.length >= 1, 4000);
    await until(() => page.evaluate(() => /kept in this browser/.test(document.querySelector(".wl-exam-saved").textContent)), 2000);
    await page.click("label[for=q1-o2]");
    await page.waitForTimeout(3000);
    assert.equal(puts.length, 1, "a new pick does not cut the 429 back-off short");
    await ctx.close();
  }
});

test("W1-10: a route that never answers shows Try again within 16 s", async () => {
  const { ctx, page } = await H.newPage(390);
  await stubApi(page, () => ({ __hang: true }));
  await page.goto(H.origin + "/learn/");
  const t0 = Date.now();
  await page.waitForSelector("button:has-text('Try again')", { timeout: 17000 });
  const ms = Date.now() - t0;
  assert.ok(ms <= 16000, `Try again after ${ms} ms`);
  await ctx.close();
});

test("W1-14/W1-7: Dismiss on the verify banner moves focus to a heading, not to <body> (WCAG 2.4.3)", async () => {
  const { ctx, page } = await H.newPage(1280);
  await stubApi(page, (m, p) => {
    if (p === "/api/courses/ven-120") return outline({ done: [0] });
    if (/\/lessons\/0$/.test(p)) return { ...lesson(0), learner: { email: "pat@example.com", emailVerified: false } };
  });
  await page.goto(H.origin + "/learn/lesson/?c=ven-120&l=0");
  await page.waitForSelector(".wl-verify-banner button[aria-label^='Dismiss']");
  await page.focus(".wl-verify-banner button[aria-label^='Dismiss']");
  await page.keyboard.press("Enter");
  await until(() => page.evaluate(() => !document.querySelector(".wl-verify-banner")));
  const active = await page.evaluate(() => document.activeElement.tagName);
  assert.match(active, /^H[1-3]$/, "focus after Dismiss: " + active);
  await ctx.close();
});

test("no uncaught page errors in any of the above", () => {
  assert.deepEqual(H.errors, []);
});
