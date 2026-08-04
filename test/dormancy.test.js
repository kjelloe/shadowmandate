// test/dormancy.test.js — M6 slice 6d: the world evolving while nobody watches
// (S10, D3, D16).
//
// The two properties that matter: it stays REPLAY-EXACT (wall time enters as a
// command field, never as free-running ticks), and it stays inside D16's scope
// (heat decay and contract refresh — rivals do not act in an empty world).

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { CMD_DORMANCY_TICK, CMD_ADVANCE_TICK, CMD_DROP_IN } from "../engine/commands.js";
import { elapsedTicks, worldNews } from "../engine/dormancy.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { findDropZones } from "../engine/citygen.js";
import { spawnAiFirms } from "../engine/ai_firms.js";
import { makeWorld, centralDropZone, RULES } from "./helpers.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function sleepingWorld(seed = 4711) {
  const s = makeWorld({ seed });
  refillPool(s, RULES.contracts, RULES.detection);
  return s;
}

test("elapsed real time converts to ticks and saturates rather than overflowing", () => {
  assert.equal(elapsedTicks(1000), 10, "1s should be 10 ticks at 10Hz");
  assert.equal(elapsedTicks(0), 0);
  assert.equal(elapsedTicks(-5), 0, "negative time must not rewind the world");
  // A world asleep for a month must not wrap an i32 and corrupt every timer.
  const month = 30 * DAY;
  assert.ok(elapsedTicks(month) > 0 && elapsedTicks(month) <= 0x3fffffff,
    "a long sleep overflowed");
});

test("D16: dormancy cools districts, arithmetically not by looping", () => {
  let s = sleepingWorld();
  s.districts[0].heat = 4;
  s.districts[1].heat = 2;
  const decay = RULES.detection.heat.decayTicks;
  // Enough sleep for exactly two decay steps.
  const ms = (decay * 2 / 10) * 1000;
  s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: ms });
  assert.equal(s.districts[0].heat, 2, "district 0 did not cool by two steps");
  assert.equal(s.districts[1].heat, 0, "district 1 did not cool to calm");
  assert.ok(s.events.some((e) => e.type === "dormancyApplied"));
});

test("a very long sleep is as cheap as a short one, and cools to calm", () => {
  let s = sleepingWorld();
  for (const d of s.districts) d.heat = 5;
  const started = Date.now();
  s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: 30 * DAY });
  const took = Date.now() - started;
  for (const d of s.districts) assert.equal(d.heat, 0, "a month of sleep left heat behind");
  assert.ok(took < 500, `waking a month-old world took ${took}ms — it should be arithmetic`);
});

test("dormancy expires timed contracts and refills the pool", () => {
  let s = sleepingWorld();
  const target = RULES.contracts.poolPerSlot * s.slots;
  assert.equal(s.contractPool.length, target, "precondition: pool is full");
  const timed = s.contractPool.filter((c) => c.expiresTick > 0).length;
  assert.ok(timed > 0, "precondition: some contracts are timed");

  s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: 12 * HOUR });
  const applied = s.events.find((e) => e.type === "dormancyApplied");
  assert.ok(applied.expired > 0, "no timed contract expired over 12 hours");
  assert.equal(s.contractPool.length, target, "the pool was not topped back up");
});

test("D16 SCOPE: rival Firms do not act while the world is empty", () => {
  // The ruling is explicit — dormancy is heat and contracts, not a story that
  // happened without you. If this ever loosens, it should be a deliberate
  // ruling change, not a quiet feature.
  let s = sleepingWorld();
  spawnAiFirms(s, RULES, 3, {});
  const before = s.firms.map((f) => ({
    state: f.state, rep: f.reputation, rec: f.recognition, tier: f.tierUnlocked,
  }));
  s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: 3 * DAY });
  for (const [i, f] of s.firms.entries()) {
    assert.equal(f.state, before[i].state, `Firm ${i} changed deployment while asleep`);
    assert.equal(f.reputation, before[i].rep, `Firm ${i} gained reputation while asleep`);
    assert.equal(f.recognition, before[i].rec, `Firm ${i} gained recognition while asleep`);
    assert.equal(f.tierUnlocked, before[i].tier, `Firm ${i} unlocked a tier while asleep`);
  }
  assert.equal(s.hqs.length, 0, "an HQ appeared in an empty world");
});

test("dormancy is refused while anyone is still deployed", () => {
  let s = sleepingWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const bad = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: HOUR });
  assert.equal(bad.events[0].reason, "world_not_empty");
});

test("REPLAY EXACTNESS: the same elapsed time reproduces the same world", () => {
  // This is why wall time is a command field. A free-running catch-up loop
  // would depend on when the server happened to wake, and no replay could
  // reproduce it.
  const run = () => {
    let s = sleepingWorld(90210);
    for (const d of s.districts) d.heat = 3;
    const hashes = [];
    s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: 5 * HOUR });
    hashes.push(hashState(s));
    for (let i = 0; i < 50; i++) { s = apply(s, { type: CMD_ADVANCE_TICK }); hashes.push(hashState(s)); }
    s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: 90 * MINUTE });
    hashes.push(hashState(s));
    return hashes;
  };
  assert.deepEqual(run(), run());
});

test("different sleep durations produce different worlds", () => {
  const after = (ms) => {
    let s = sleepingWorld();
    for (const d of s.districts) d.heat = 4;
    return hashState(apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: ms }));
  };
  assert.notEqual(after(HOUR), after(6 * HOUR));
});

test("a zero-length sleep is an explicit no-op, not a silent one", () => {
  let s = sleepingWorld();
  const before = hashState(s);
  s = apply(s, { type: CMD_DORMANCY_TICK, elapsedMs: 0 });
  assert.equal(hashState(s), before, "a zero sleep changed the world");
  assert.ok(s.events.some((e) => e.type === "dormancyNoop"),
    "a no-op must still say so — silence looks like success");
});

test("the return-visit briefing reports what a player would want to know", () => {
  let s = sleepingWorld();
  s.districts[0].heat = RULES.detection.heat.checkpointsActiveAt;
  s.districts[1].heat = RULES.detection.heat.extraPatrolsAt;
  const news = worldNews(s, 0, RULES.detection);
  assert.ok(news.some((n) => n.kind === "lockdown"), "a locked-down district was not reported");
  assert.ok(news.some((n) => n.kind === "tense"), "a tense district was not reported");
  assert.ok(news.some((n) => n.kind === "contractsAvailable"), "no work count reported");
  assert.ok(news.length <= 5, "the briefing should be a headline, not a log");
});
