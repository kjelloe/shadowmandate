// test/fixture_populated.test.js — the paired-hash rule, on a world that has
// something in it.
//
// WHY THIS EXISTS. `fixture.test.js` builds its world with
// `createInitialState({seed, size})` — no ruleset, no city. That world has no
// sites, no buildings, no districts and an empty contract pool, and because
// hashing is deliberately hash-inert for empty collections (an empty list
// writes no bytes, so fixtures do not churn as the game grows), NONE of the
// contract/site/building code in `engine/snapshot.js` or its deliberate twin in
// `test/fixture_hash.js` was ever executed by the paired-hash test.
//
// So the project's strongest guarantee had a hole exactly where it mattered:
// add a field to one hasher's contract writer and forget the other, and every
// test stayed green. This file runs the same comparison against a fully
// populated world, so the twins are compared where they actually differ.
//
// It pins no hashes on purpose. Pinned eras are for catching intended-vs-
// unintended behaviour drift; the risks here — the twins splitting, and the
// world not replaying identically — are both provable from the run itself, so
// this file costs nothing to keep green when balance numbers change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../engine/state.js";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { hashState } from "../engine/snapshot.js";
import { hashStateLocal } from "./fixture_hash.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";
import { raiseAlarm, ALARM_LOCKDOWN } from "../engine/security.js";
import { grantCredential } from "../engine/access.js";
import { RULES } from "./helpers.js";

const SEED = 20260805;
const SIZE = 64;

function populatedWorld() {
  const city = generateCity(SEED, SIZE, RULES.citygen);
  const s = createInitialState({ seed: SEED, size: SIZE, rules: RULES, city });
  spawnAiFirms(s, RULES, 3, { swap: false });
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);
  // A live alarm (M8/S16). Alarms are hash-inert while empty by design, which
  // means the twins' alarm writers are only ever compared on a world that has
  // one — the same hole this file was written to close for contracts, which
  // reappeared the moment a new collection was added. Populate every
  // hash-inert collection here, or the guarantee quietly rots again.
  raiseAlarm(s, s.sites[0], RULES.security.alarm, ALARM_LOCKDOWN, "fixture");
  grantCredential(s, 0, 2, "fixture");
  
  return s;
}

test("the populated world actually populates — otherwise this file proves nothing", () => {
  const s = populatedWorld();
  // The lesson from M2: a test that passes because both sides are empty is a
  // test that proves nothing. Assert the fixture has teeth before using it.
  assert.ok(s.contractPool.length > 0, "no contracts — the hash comparison below would be vacuous");
  assert.ok(s.sites.length > 0, "no sites");
  assert.ok(s.buildings.length > 0, "no buildings");
  assert.ok(s.districts.length > 0, "no districts");
  assert.ok(s.agents.length > 0, "no agents");
  assert.ok(s.cameras.length > 0, "no cameras — the twins' camera writers go uncompared");
  assert.ok(s.beams.length > 0, "no beams — the twins' beam writers go uncompared");
  assert.ok(s.junctions.length > 0, "no junctions — the twins' junction writers go uncompared");
  assert.ok(s.credentials.length > 0, "no credentials — the twins' credential writers go uncompared");
  assert.ok(s.alarms.length > 0,
    "no alarms — the twins' alarm writers would never be compared, which is "
    + "exactly the hole this file exists to close");
});

test("the paired hash functions agree on a world containing contracts and city", () => {
  let s = populatedWorld();
  assert.equal(hashState(s), hashStateLocal(s),
    "snapshot.js and fixture_hash.js disagree on a POPULATED state — the twins have split");
  for (let i = 0; i < 40; i++) {
    const ai = stepAiFirms(s, RULES, apply);
    s = ai.state;
    s = apply(s, { type: CMD_ADVANCE_TICK });
    assert.equal(hashState(s), hashStateLocal(s), `paired hash split at tick ${i}`);
  }
});

test("a populated world replays byte-identically", () => {
  const run = () => {
    let s = populatedWorld();
    const hashes = [];
    for (let i = 0; i < 40; i++) {
      const ai = stepAiFirms(s, RULES, apply);
      s = ai.state;
      s = apply(s, { type: CMD_ADVANCE_TICK });
      hashes.push(hashState(s));
    }
    return hashes;
  };
  assert.deepEqual(run(), run(),
    "the populated world is not deterministic — contract generation or AI is reading something outside the seeded stream");
});

test("contract rewards reach the hash, so the economy is covered at all", () => {
  // Direct proof that the hole is closed: perturb a reward and the hash must
  // move. If it does not, the contract writer is not reached and this whole
  // file is decoration.
  const a = populatedWorld();
  const before = hashState(a);
  a.contractPool[0].reward = (a.contractPool[0].reward + 1) | 0;
  assert.notEqual(hashState(a), before, "a contract reward change did not move the hash");
  assert.equal(hashState(a), hashStateLocal(a), "twins disagree after the perturbation");
});
