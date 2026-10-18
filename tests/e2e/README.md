# Learner app browser tests (Wave 1)

Acceptance tests for the Wave 1 learner-experience items (worker repo `ai/plans/learning-experience-2026-10.md`):
W1-3 (autosave 403/429), W1-4 (lesson → lab → exam by primary buttons; unlock announced once; no exam offer after a pass),
W1-5 (first-run vs returning dashboard), W1-6 (three auth entry URLs), W1-9 (first lab scene in view at 390 and 1280 px),
W1-10 (hung route shows "Try again" within 16 s; offline banner never covers the exam bar), W1-11 (focus after mount and on
exam start; no live region over 300 characters) W1-13 (`/go/` Start free to lesson 1 in at most 2 navigations after signup) and the focus after Dismiss on the
verify banner (W1-14). Audit regressions: WIA-014 (an overlapping keepalive flush and a delayed older autosave never leave
older answers stored behind "All answers saved"; saves carry an increasing `rev`) and WIA-015 ("Next in your path" offers
Open course, not Add to cart, for a course the learner's All-Access Pass covers).

They run in Chromium against a static Jekyll build of this repo, with the learning Worker's API stubbed per test
(`page.route` on `site.api_base`); nothing reaches the network. This directory is excluded from the published site.

```sh
cd tests/e2e
npm install                    # playwright (devDependency); then: npx playwright install chromium
npm test                       # builds the site with `jekyll` on PATH, then runs every spec
```

Environment overrides: `E2E_SITE=<built site dir>` (skip the Jekyll build), `JEKYLL=<jekyll executable>`,
`PLAYWRIGHT=<path to the playwright package>`, `E2E_CHROME=<Chromium executable>`.

`fixtures/lab.json` holds a lab's API responses produced by the Worker's real engine; regenerate it when the lab
response shapes change: `node gen-lab-fixture.mjs <path to wirewalk-institute-worker> fixtures/lab.json`.

Not covered here: the manual NVDA and VoiceOver pass that W1-11 asks for; record it in the PR.
