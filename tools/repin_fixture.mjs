#!/usr/bin/env node
// tools/repin_fixture.mjs — re-pin the baseline fixture, deliberately.
//
//   node tools/repin_fixture.mjs "<reason>"
//
// ABORTS ON EVENT DRIFT: if the events emitted by the pinned script changed,
// the reducer is what changed, not the fixture — re-pinning would bury the
// evidence. Override only with FORCE_EVENTS=1 and only when the ruling that
// justifies it is written in the reason.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createInitialState } from "../engine/state.js";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { FIXTURE_SCRIPT, FIXTURE_SEED, FIXTURE_SIZE } from "../test/fixture_script.js";

const reason = process.argv[2];
if (!reason) {
  console.error('usage: node tools/repin_fixture.mjs "<reason for the re-pin>"');
  process.exit(1);
}

const PATH = new URL("../test/fixtures/baseline.json", import.meta.url).pathname;
const previous = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : null;

let state = createInitialState({ seed: FIXTURE_SEED, size: FIXTURE_SIZE });
const steps = [{ step: -1, command: "init", hash: hashState(state), events: [] }];
for (const [i, command] of FIXTURE_SCRIPT.entries()) {
  state = apply(state, command);
  steps.push({
    step: i,
    command: command.type,
    hash: hashState(state),
    events: state.events.map((e) => e.type),
  });
}

if (previous && process.env.FORCE_EVENTS !== "1") {
  const drift = [];
  for (const [i, step] of steps.entries()) {
    const before = previous.steps[i];
    if (!before) continue; // appended steps are allowed
    const a = JSON.stringify(before.events);
    const b = JSON.stringify(step.events);
    if (a !== b) drift.push(`  step ${step.step}: ${a} -> ${b}`);
  }
  if (drift.length) {
    console.error("EVENT DRIFT — refusing to re-pin.");
    console.error(drift.join("\n"));
    console.error("\nThe events inside the pinned script changed. That means the");
    console.error("reducer changed behaviour, not the fixture. Fix the reducer, or");
    console.error("re-run with FORCE_EVENTS=1 if a ruling requires the new events.");
    process.exit(2);
  }
}

const out = {
  era: "sm-era-0",
  reason,
  seed: FIXTURE_SEED,
  size: FIXTURE_SIZE,
  steps,
};
writeFileSync(PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`re-pinned ${steps.length} steps -> test/fixtures/baseline.json`);
console.log(`reason: ${reason}`);
console.log(`final hash: ${steps[steps.length - 1].hash}`);
