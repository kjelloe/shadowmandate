// test/determinism.test.js — the determinism contract: stable hashing, honest
// copyState, and byte-exact replay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState, STANCE_HURRY, AGENT_ACTIVE } from "../engine/state.js";
import { apply, copyState } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { hashStateLocal } from "./fixture_hash.js";
import { CMD_ADVANCE_TICK, CMD_SET_STANCE } from "../engine/commands.js";

test("the paired hash functions agree", () => {
  const s = createInitialState({ seed: 7, size: 64 });
  assert.equal(hashState(s), hashStateLocal(s));
  let t = s;
  for (let i = 0; i < 20; i++) t = apply(t, { type: CMD_ADVANCE_TICK });
  assert.equal(hashState(t), hashStateLocal(t));
});

test("same seed, same commands, same hash", () => {
  const run = () => {
    let s = createInitialState({ seed: 2026, size: 64 });
    for (let i = 0; i < 50; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
    return hashState(s);
  };
  assert.equal(run(), run());
});

test("different seeds diverge", () => {
  const h = (seed) => hashState(createInitialState({ seed, size: 64 }));
  assert.notEqual(h(1), h(2));
});

test("apply never mutates the input state", () => {
  const s = createInitialState({ seed: 5, size: 64 });
  const before = hashState(s);
  apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(hashState(s), before);
});

test("copyState deep-copies every nested mutable collection", () => {
  const s = createInitialState({ seed: 5, size: 64 });
  s.agents[0].state = AGENT_ACTIVE;
  s.agents[0].contractIds.push(3);
  s.patrols.push({ id: 0, districtId: 0, x: 0, y: 0, routeIdx: 0, alertTicks: 0,
    targetX: 0, targetY: 0, route: [{ x: 1, y: 1 }] });
  s.holdingSites.push({ id: 0, districtId: 0, cellX: 2, cellY: 2, heldAgentIds: [1] });
  s.offers.push({ firmId: 0, contractIds: [9] });

  const c = copyState(s);
  c.agents[0].contractIds.push(99);
  c.patrols[0].route.push({ x: 5, y: 5 });
  c.holdingSites[0].heldAgentIds.push(42);
  c.offers[0].contractIds.push(77);

  assert.deepEqual(s.agents[0].contractIds, [3], "agent contractIds aliased");
  assert.equal(s.patrols[0].route.length, 1, "patrol route aliased");
  assert.deepEqual(s.holdingSites[0].heldAgentIds, [1], "heldAgentIds aliased");
  assert.deepEqual(s.offers[0].contractIds, [9], "offer contractIds aliased");
});

test("replay: re-applying a command log reproduces every intermediate hash", () => {
  const log = [];
  for (let i = 0; i < 30; i++) log.push({ type: CMD_ADVANCE_TICK });

  let live = createInitialState({ seed: 99, size: 64 });
  const hashes = [hashState(live)];
  for (const cmd of log) { live = apply(live, cmd); hashes.push(hashState(live)); }

  let replay = createInitialState({ seed: 99, size: 64 });
  const replayHashes = [hashState(replay)];
  for (const cmd of log) { replay = apply(replay, cmd); replayHashes.push(hashState(replay)); }

  assert.deepEqual(replayHashes, hashes);
});

test("an invalid command is rejected and changes nothing else", () => {
  const s = createInitialState({ seed: 3, size: 64 });
  const before = hashState(s);
  const next = apply(s, { type: 9999 });
  assert.equal(hashState(next), before);
  assert.equal(next.events[0].type, "rejected");
  assert.equal(next.events[0].reason, "invalid_command");
});

test("setStance is rejected for an agent that is not active", () => {
  const s = createInitialState({ seed: 3, size: 64 });
  const next = apply(s, { type: CMD_SET_STANCE, agentId: 0, stance: STANCE_HURRY });
  assert.equal(next.events[0].reason, "agent_not_active");
});

test("the world hashes identically at 64 and differently at 128", () => {
  const a = createInitialState({ seed: 11, size: 64 });
  const b = createInitialState({ seed: 11, size: 128 });
  assert.notEqual(hashState(a), hashState(b));
});
