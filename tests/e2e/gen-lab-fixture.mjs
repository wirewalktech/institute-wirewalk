// Regenerates fixtures/lab.json from the Worker's real lab engine (src/features/labs-engine.js):
//   node gen-lab-fixture.mjs <path to wirewalk-institute-worker> fixtures/lab.json
import { readFileSync, writeFileSync } from "node:fs";
const W = process.argv[2], OUT = process.argv[3];
const E = await import(W + "/src/features/labs-engine.js");
const { Marked } = await import(W + "/node_modules/marked/lib/marked.esm.js");
const H = x => new Marked().parse(String(x || ""));
const lab = { ...JSON.parse(readFileSync(W + "/test/fixtures/labs/m2-claims-pilot.json", "utf8")), course: "ven-120", module: 1 };
const steps = [["n1", "b"], ["n3", "c"]];   // a short path to an ending (the POOR path in test/labs-api.test.mjs)
let state = E.initialState(lab).state;
const out = {
  note: "Generated from the Worker's labs-engine over test/fixtures/labs/m2-claims-pilot.json (module set to 1, course ven-120). Regenerate with the script named in tests/e2e/README.md when the response shapes change.",
  get: { course: { id: "ven-120", title: "Claude for Professionals", level: "basic" }, access: "enrolled",
         lab: { ...E.publicMeta(lab, H), lessons: [], contentHash: "h" }, start: E.publicNode(lab, lab.start, [], H), activePlay: null, history: [] },
  play: { playId: "lp_1", startedAt: "2026-10-18T00:00:00.000Z", finishedAt: null, finished: false, metrics: state.metrics,
          timeline: E.timeline(lab, state.path), node: E.publicNode(lab, state.node, state.flags, H), resumed: false },
  steps: [],
};
for (const [nodeId, choiceId] of steps) {
  const r = E.step(lab, state, nodeId, choiceId); state = r.state; const end = r.ending;
  const o = { playId: "lp_1", choice: { id: r.choice.id, label: r.choice.label }, outcome: H(r.choice.outcome), deltas: r.deltas, metrics: state.metrics,
    events: r.events.map(ev => ({ ...E.publicNode(lab, ev.id, state.flags, H), deltas: ev.deltas })),
    node: end ? null : E.publicNode(lab, state.node, state.flags, H), finished: !!end, timeline: E.timeline(lab, state.path) };
  if (end) { o.result = E.debriefOf(lab, state, H); o.reckoning = o.result.reckoning; }
  out.steps.push({ nodeId, choiceId, response: o });
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log("steps", out.steps.length, "finished", out.steps.at(-1).response.finished, "decisions", out.get.lab.decisionsMin, out.get.lab.decisionsMax);
