// test/raids.test.js — scheduled rival raids (S16, M8 slice 8i, D49b).
//
// The UNCHOSEN half of D49: a rival turns up at your HQ whether or not you took
// a job about it. What has to hold is the fairness — you are warned, you have a
// window, and a Firm whose connection just dropped is never a target.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { buildView } from "../engine/view.js";
import { hashState } from "../engine/snapshot.js";
import {
  stepRaids, scheduleRaid, raidAgainst, raidBy, raidableFirms, availableRaiders,
  RAID_WARNING, RAID_INBOUND, RAID_DONE,
} from "../engine/raids.js";
import { stepHqs } from "../engine/hq.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const CFG = RULES.security.raids;
const always = (lo, hi) => lo;            // deterministic roll: always the low end

// A world with a player Firm holding an HQ and an AI Firm able to raid it.
function raidWorld() {
  const s = makeWorld();
  s.firms[0].state = 1; s.firms[0].isAi = 0;
  s.firms[1].state = 1; s.firms[1].isAi = 1;
  // Every field the hasher writes. A partial HQ record throws "i32 out of
  // range: undefined" the moment anything hashes the world — which is the
  // hasher being right, not the fixture being unlucky.
  s.hqs.push({
    id: 0, firmId: 0, cellX: 20, cellY: 20, buildingId: -1,
    condition: 100, cacheResources: 100,
    evacActive: 0, evacTicks: 0, evacPaused: 0,
    alarmTicks: 0, lootTicks: 0, lootedBy: -1,
  });
  placeAgent(s, { agentId: 0, firmId: 0, cellX: 20, cellY: 20 });
  placeAgent(s, { agentId: 1, firmId: 1, cellX: 30, cellY: 30 });
  return s;
}

// ── Fairness ───────────────────────────────────────────────────────────────

test("a raid is ANNOUNCED before the raider is sent", () => {
  // The warning window is the whole fairness of the mechanism. A rival that
  // materialises unannounced reads as unfair; one you can hear coming is a
  // decision — run home, set up, or write the cache off and keep working.
  const s = raidWorld();
  const raid = scheduleRaid(s, 0, 1, CFG);
  assert.equal(raid.state, RAID_WARNING, "the raider was dispatched immediately");
  assert.ok(s.events.some((e) => e.type === "raidIncoming" && e.firmId === 0),
    "the target was never told");
  assert.ok(CFG.warningTicks > 0, "the configured warning window is zero");
  assert.equal(raid.dispatchTick, s.tick + CFG.warningTicks);
});

test("the raider is dispatched only when the window closes", () => {
  const s = raidWorld();
  const raid = scheduleRaid(s, 0, 1, CFG);
  s.tick = raid.dispatchTick - 1;
  stepRaids(s, CFG, always);
  assert.equal(raid.state, RAID_WARNING, "dispatched a tick early");
  s.tick = raid.dispatchTick;
  stepRaids(s, CFG, always);
  assert.equal(raid.state, RAID_INBOUND);
  assert.ok(s.events.some((e) => e.type === "raidDispatched"));
});

test("D31: a Firm inside its disconnect grace is never a target", () => {
  // Raiding somebody whose connection just dropped is the most obviously unfair
  // thing this system could do, and D31 already answers it.
  const s = raidWorld();
  assert.ok(raidableFirms(s).some((f) => f.id === 0), "the target is not raidable to begin with");
  s.firms[0].graceTicks = 100;
  assert.ok(!raidableFirms(s).some((f) => f.id === 0),
    "a disconnected Firm is being offered up as a raid target");
});

test("a Firm with no HQ cannot be raided", () => {
  // D7: an offline Firm has no footprint. There is nothing to raid.
  const s = raidWorld();
  s.hqs = [];
  assert.equal(raidableFirms(s).length, 0);
});

test("a Firm already under threat is not re-targeted", () => {
  const s = raidWorld();
  scheduleRaid(s, 0, 1, CFG);
  assert.ok(!raidableFirms(s).some((f) => f.id === 0), "stacked a second raid on one HQ");
});

test("a Firm never raids itself, and only AI Firms raid in V1", () => {
  const s = raidWorld();
  assert.ok(!availableRaiders(s, 0).some((f) => f.id === 0), "a Firm was offered its own HQ");
  s.firms[1].isAi = 0;
  assert.equal(availableRaiders(s, 0).length, 0, "a human Firm was dispatched as a raider");
});

// ── The raid ends ──────────────────────────────────────────────────────────

test("a raid that never lands EXPIRES", () => {
  // Without this, a raider arrested on the way leaves its target permanently
  // "under raid" and therefore permanently un-raidable — the bug where a
  // feature fires once and then silently switches itself off forever.
  const s = raidWorld();
  const raid = scheduleRaid(s, 0, 1, CFG);
  s.tick = raid.expiresTick;
  stepRaids(s, CFG, always);
  assert.ok(s.events.some((e) => e.type === "raidEnded"));
  assert.equal(raidAgainst(s, 0), null, "the finished raid is still blocking new ones");
  assert.equal(s.raids.length, 0, "a resolved raid stayed in the collection and keeps hashing");
});

test("after a raid ends the Firm can be targeted again", () => {
  const s = raidWorld();
  const raid = scheduleRaid(s, 0, 1, CFG);
  s.tick = raid.expiresTick;
  stepRaids(s, CFG, always);
  assert.ok(raidableFirms(s).some((f) => f.id === 0),
    "the target was permanently retired from the raid system");
});

// ── Scheduling ─────────────────────────────────────────────────────────────

test("raids are scheduled on a cadence, not every tick", () => {
  const s = raidWorld();
  s.tick = 1;                                   // not on the heartbeat
  stepRaids(s, CFG, always);
  assert.equal(s.raids.length, 0, "a raid was scheduled off-cadence");
  s.tick = CFG.everyTicks;
  stepRaids(s, CFG, always);
  assert.equal(s.raids.length, 1, "no raid on the heartbeat with a guaranteed roll");
});

test("the chance roll can decline", () => {
  const s = raidWorld();
  s.tick = CFG.everyTicks;
  stepRaids(s, CFG, () => 100);                 // roll above any percentage
  assert.equal(s.raids.length, 0, "the roll is ignored — every heartbeat raids");
});

test("disabling raids in data actually disables them", () => {
  const s = raidWorld();
  s.tick = CFG.everyTicks;
  stepRaids(s, { ...CFG, enabled: 0 }, always);
  assert.equal(s.raids.length, 0);
});

// ── Seams ──────────────────────────────────────────────────────────────────

test("the target's view carries the countdown, in ticks-from-now", () => {
  // A warning the client cannot see is not a warning. Sent as a delta so the
  // client never has to know the world's clock to draw a countdown.
  const s = raidWorld();
  scheduleRaid(s, 0, 1, CFG);
  const view = buildView(s, 0, RULES.detection);
  assert.ok(view.raid, "the target's view says nothing about the raid");
  assert.equal(view.raid.ticksToDispatch, CFG.warningTicks);
  assert.equal(view.raid.state, RAID_WARNING);
});

test("a Firm that is NOT the target sees no raid", () => {
  const s = raidWorld();
  scheduleRaid(s, 0, 1, CFG);
  assert.equal(buildView(s, 1, RULES.detection).raid, null,
    "the raider's own view is leaking the raid as if it were the victim");
});

test("raids are hash-inert while quiet, and hashed once live", () => {
  const s = raidWorld();
  assert.equal(s.raids.length, 0);
  const before = hashState(s);
  scheduleRaid(s, 0, 1, CFG);
  assert.notEqual(hashState(s), before, "a live raid is not part of the world state");
});

test("raids survive the reducer, and the scheduler uses the world's own stream", () => {
  const s = raidWorld();
  scheduleRaid(s, 0, 1, CFG);
  const next = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(next.raids.length, 1, "the raid did not survive copyState");
  // Determinism: the same world advanced twice must produce the same raids.
  const a = apply(raidWorld(), { type: CMD_ADVANCE_TICK });
  const b = apply(raidWorld(), { type: CMD_ADVANCE_TICK });
  assert.equal(hashState(a), hashState(b), "raid scheduling is not deterministic");
});

test("a raid ENDS when it succeeds — a raider does not camp on the tent", () => {
  // Found by probe, not by test. Leaving a successful raid "inbound" made the
  // raider stand on the tent for its whole window and re-loot every time the
  // owner banked anything: 5020 loots in one world-day, which is a siege rather
  // than a raid.
  const s = raidWorld();
  // Off the scheduler heartbeat. At tick 0 (0 % everyTicks === 0) the same
  // stepRaids call that retires this raid immediately schedules a fresh one,
  // and the assertion below reads that new raid as "still committed" — a test
  // failing on its own fixture rather than on the engine.
  s.tick = 1;
  const raid = scheduleRaid(s, 0, 1, CFG);
  raid.state = RAID_INBOUND;
  s.events = [{ type: "cacheLooted", firmId: 0, byFirmId: 1, amount: 100 }];
  stepRaids(s, CFG, always);
  assert.ok(s.events.some((e) => e.type === "raidSucceeded" && e.amount === 100),
    "a successful raid was never reported as such");
  assert.equal(raidBy(s, 1), null, "the raider is still committed after taking the cache");
});

test("looting resets its own dwell timer", () => {
  // The timer stayed past its threshold, so the tent emptied on EVERY later
  // tick the owner had anything in it. Invisible while raids were rare
  // accidents; pathological once 8i parked a raider there deliberately.
  const s = raidWorld();
  const hq = s.hqs[0];
  hq.lootTicks = RULES.hq.lootTicks + 5;
  hq.cacheResources = 50;
  placeAgent(s, { agentId: 1, firmId: 1, cellX: hq.cellX, cellY: hq.cellY });
  stepHqs(s, RULES.hq);
  assert.equal(hq.cacheResources, 0, "the loot did not happen at all");
  assert.equal(hq.lootTicks, 0, "the dwell timer survived the loot — the next tick loots again");
});
