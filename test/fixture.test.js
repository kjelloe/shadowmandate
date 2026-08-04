// test/fixture.test.js — the pinned baseline. Every intermediate hash and the
// event stream of the pinned script are contracts.
//
// A failure here means one of three things:
//   1. the reducer changed behaviour (usually: fix the reducer);
//   2. a hashed field was added to engine/snapshot.js but not to
//      test/fixture_hash.js, or vice versa (fix the pair);
//   3. the change was intended — re-pin with
//      `node tools/repin_fixture.mjs "<reason>"` and say why in dev-log.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInitialState } from "../engine/state.js";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { hashStateLocal } from "./fixture_hash.js";
import { FIXTURE_SCRIPT, FIXTURE_SEED, FIXTURE_SIZE } from "./fixture_script.js";

const baseline = JSON.parse(
  readFileSync(new URL("./fixtures/baseline.json", import.meta.url).pathname, "utf8")
);

test("the fixture pins the current era", () => {
  assert.equal(baseline.seed, FIXTURE_SEED);
  assert.equal(baseline.size, FIXTURE_SIZE);
  assert.equal(baseline.steps.length, FIXTURE_SCRIPT.length + 1, "step count moved");
});

test("every intermediate hash matches the pin", () => {
  let state = createInitialState({ seed: FIXTURE_SEED, size: FIXTURE_SIZE });
  assert.equal(hashState(state), baseline.steps[0].hash, "initial state hash moved");

  for (const [i, command] of FIXTURE_SCRIPT.entries()) {
    state = apply(state, command);
    const pinned = baseline.steps[i + 1];
    assert.equal(hashState(state), pinned.hash, `hash moved at step ${i}`);
    assert.deepEqual(
      state.events.map((e) => e.type), pinned.events,
      `EVENT DRIFT at step ${i} — the reducer changed, not the fixture`
    );
  }
});

test("the paired hash function agrees at every pinned step", () => {
  let state = createInitialState({ seed: FIXTURE_SEED, size: FIXTURE_SIZE });
  assert.equal(hashStateLocal(state), baseline.steps[0].hash);
  for (const [i, command] of FIXTURE_SCRIPT.entries()) {
    state = apply(state, command);
    assert.equal(hashStateLocal(state), baseline.steps[i + 1].hash, `paired hash split at step ${i}`);
  }
});

test("replaying the fixture script twice is byte-identical", () => {
  const run = () => {
    let s = createInitialState({ seed: FIXTURE_SEED, size: FIXTURE_SIZE });
    const hashes = [];
    for (const cmd of FIXTURE_SCRIPT) { s = apply(s, cmd); hashes.push(hashState(s)); }
    return hashes;
  };
  assert.deepEqual(run(), run());
});
