// test/hq.test.js — M3 gate: the full session loop and the ledger.
//
// Every interruption row of the S05 evac table is exercised here: leaving the
// perimeter pauses, a rival triggers the alarm without stopping the clock
// (D28), a downed agent cancels, and only a clean extraction banks the cache.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import {
  CMD_ADVANCE_TICK, CMD_DROP_IN, CMD_ACTIVATE_EVAC, CMD_CANCEL_EVAC, CMD_EXTRACT, CMD_MOVE,
} from "../engine/commands.js";
import { AGENT_ACTIVE, AGENT_DOWNED, FIRM_DEPLOYED, FIRM_UNDEPLOYED, FIRM_EVACUATING } from "../engine/state.js";
import { extract, hqOf, destroyHq, EVAC_EMERGENCY } from "../engine/hq.js";
import { findDropZones } from "../engine/citygen.js";
import { LedgerStore, emptyLedger } from "../server/ledger.js";
import { makeWorld, placeAgent, quietCell, centralDropZone, cellAwayFrom, tickCollecting, RULES } from "./helpers.js";
import { cellToWorld } from "../shared/fixedmath.js";

function deployed(seed = 4711) {
  let s = makeWorld({ seed });
  const zones = findDropZones(s, RULES.citygen);
  assert.ok(zones.length, "no drop zones in the reference world");
  const z = centralDropZone(s, zones);
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: z.cellX, cellY: z.cellY });
  return { s, zone: z };
}

test("drop-in places an HQ and a lead agent, and marks the Firm deployed", () => {
  const { s, zone } = deployed();
  assert.equal(s.hqs.length, 1);
  assert.equal(s.hqs[0].cellX, zone.cellX);
  assert.equal(s.firms[0].state, FIRM_DEPLOYED);
  const agent = s.agents.find((a) => a.firmId === 0);
  assert.ok(agent && agent.state === AGENT_ACTIVE, "no lead agent landed");
  assert.ok(s.events.some((e) => e.type === "firmDeployed"));
});

test("drop-in is refused onto unlandable ground and next to a rival HQ", () => {
  let { s } = deployed();
  const hq = s.hqs[0];

  // A building-mass cell is unlandable (checked before proximity).
  let blockCell = null;
  for (let y = 0; y < s.size && !blockCell; y++) {
    for (let x = 0; x < s.size; x++) {
      if (s.map.cells[y * s.size + x] === 4) { blockCell = { x, y }; break; }
    }
  }
  const onBlock = apply(s, { type: CMD_DROP_IN, firmId: 1, cellX: blockCell.x, cellY: blockCell.y });
  assert.equal(onBlock.events[0].reason, "unlandable");

  // A LANDABLE cell inside the rival's clear radius is refused for proximity.
  let nearCell = null;
  for (let r = 1; r < RULES.hq.dropZoneMinClearRadius && !nearCell; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = hq.cellX + dx, y = hq.cellY + dy;
      if (x < 1 || y < 1 || x >= s.size - 1 || y >= s.size - 1) continue;
      const t = s.map.cells[y * s.size + x];
      if (t !== 4 && t !== 10) { nearCell = { x, y }; break; }
    }
  }
  assert.ok(nearCell, "no landable cell near the HQ to test proximity");
  const tooClose = apply(s, { type: CMD_DROP_IN, firmId: 1, cellX: nearCell.x, cellY: nearCell.y });
  assert.equal(tooClose.events[0].reason, "too_close_to_rival_hq");
});

test("the evac beacon runs for the ruled hold and then reports ready", () => {
  let { s } = deployed();
  s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
  assert.ok(s.events.some((e) => e.type === "evacStarted"));
  assert.equal(s.firms[0].state, FIRM_EVACUATING);

  const run = tickCollecting(s, apply, RULES.hq.evacHoldTicks + 2);
  assert.ok(run.saw("evacReady"), "evac never became ready");
});

test("leaving the perimeter pauses the evac clock and returning resumes it", () => {
  let { s } = deployed();
  s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
  const agent = s.agents.find((a) => a.firmId === 0);
  const hq = s.hqs[0];

  // Teleport the agent genuinely outside the perimeter (a move order would
  // take ticks, and an edge HQ leaves no room in one direction).
  const away = cellAwayFrom(s, hq.cellX, hq.cellY, RULES.hq.perimeterRadius + 3);
  assert.ok(away, "nowhere outside the perimeter to stand");
  agent.x = cellToWorld(away.x);
  agent.y = cellToWorld(away.y);
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.ok(s.events.some((e) => e.type === "evacPaused"), "leaving did not pause the clock");
  const frozen = s.hqs[0].evacTicks;
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(s.hqs[0].evacTicks, frozen, "clock advanced while the agent was away");

  const back = s.agents.find((a) => a.firmId === 0);
  back.x = cellToWorld(hq.cellX);
  back.y = cellToWorld(hq.cellY);
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.ok(s.events.some((e) => e.type === "evacResumed"));
  assert.ok(s.hqs[0].evacTicks < frozen, "clock did not resume");
});

test("D28: evac may be activated with a rival already inside the perimeter", () => {
  let { s } = deployed();
  const hq = s.hqs[0];
  placeAgent(s, { agentId: 40, firmId: 1, cellX: hq.cellX + 1, cellY: hq.cellY });
  s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
  assert.ok(s.events.some((e) => e.type === "evacStarted"),
    "the hold is the fight — activation must not be blocked");
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.ok(s.events.some((e) => e.type === "perimeterAlarm"), "no alarm for the intruder");
  assert.ok(s.hqs[0].evacTicks < RULES.hq.evacHoldTicks, "the clock must keep running");
});

test("a downed lead agent cancels the evac", () => {
  let { s } = deployed();
  s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
  s.agents.find((a) => a.firmId === 0).state = AGENT_DOWNED;
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.ok(s.events.some((e) => e.type === "evacCancelled"));
  assert.equal(s.hqs[0].evacActive, 0);
});

test("a rival that reaches the tent loots the cache", () => {
  let { s } = deployed();
  const hq = s.hqs[0];
  hq.cacheResources = 250;
  placeAgent(s, { agentId: 40, firmId: 1, cellX: hq.cellX, cellY: hq.cellY });
  const run = tickCollecting(s, apply, RULES.hq.lootTicks + 5);
  assert.ok(run.saw("cacheLooted"), "cache was never looted");
  assert.equal(run.state.hqs[0].cacheResources, 0);
  const loot = run.events.find((e) => e.type === "cacheLooted");
  assert.equal(loot.amount, 250);
  assert.equal(loot.byFirmId, 1);
});

test("SCENARIO: a clean extraction banks the cache; an emergency evac does not", () => {
  // Clean.
  let { s } = deployed();
  s.hqs[0].cacheResources = 480;
  s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
  for (let i = 0; i < RULES.hq.evacHoldTicks; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
  const clean = extract(s, 0, RULES.hq);
  assert.ok(!clean.error, `clean extract failed: ${clean.error}`);
  assert.equal(clean.debrief.banked, 480);
  assert.equal(clean.debrief.hqIntact, 1);
  assert.equal(s.firms[0].state, FIRM_UNDEPLOYED);
  assert.equal(s.hqs.length, 0, "the HQ must leave with the player (D7)");
  assert.ok(!s.agents.some((a) => a.firmId === 0 && a.state !== 0), "agent still in the world");

  // Emergency: the cache is already gone.
  let { s: s2 } = deployed();
  s2.hqs[0].cacheResources = 480;
  destroyHq(s2, s2.hqs[0], RULES.hq);
  assert.equal(s2.hqs[0].evacActive, EVAC_EMERGENCY);
  const emergency = extract(s2, 0, RULES.hq);
  assert.equal(emergency.debrief.banked, 0, "emergency evac must not bank");
  assert.equal(emergency.debrief.hqIntact, 0);
  assert.ok(emergency.debrief.reputationDelta < 0);
});

test("the ledger persists across a re-drop and survives a reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-ledger-"));
  const path = join(dir, "ledger.json");
  try {
    const store = new LedgerStore(path);
    let { s } = deployed();
    s.hqs[0].cacheResources = 300;
    s.firms[0].recognition = 120;
    s.firms[0].tierUnlocked = 2;
    s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
    for (let i = 0; i < RULES.hq.evacHoldTicks; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
    const { debrief } = extract(s, 0, RULES.hq);
    const led = store.applyDebrief("world-a", debrief, s.tick);
    assert.equal(led.bank, 300);
    assert.equal(led.tierUnlocked, 2);

    // A fresh process reads the same numbers back.
    const reopened = new LedgerStore(path);
    const again = reopened.get("world-a", 0);
    assert.equal(again.bank, 300);
    assert.equal(again.recognition, 120);

    // And a re-drop carries them into the new deployment.
    let s2 = makeWorld();
    const zone = findDropZones(s2, RULES.citygen)[0];
    s2 = apply(s2, {
      type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY, ledger: again,
    });
    assert.equal(s2.firms[0].tierUnlocked, 2, "tier unlock did not survive the re-drop");
    assert.equal(s2.firms[0].recognition, 120);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D33: season rotation resets the world numbers but keeps lifetime honor", () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-season-"));
  const path = join(dir, "ledger.json");
  try {
    const store = new LedgerStore(path);
    store.applyDebrief("world-a", {
      firmId: 0, banked: 500, reputationDelta: 10, recognition: 340,
      tierUnlocked: 3, contractsCompleted: 7,
    }, 1000);
    store.rotateSeason("world-a");
    const led = store.get("world-a", 0);
    assert.equal(led.bank, 0, "bank must reset with the world");
    assert.equal(led.tierUnlocked, 1, "tier must reset with the world");
    assert.equal(led.reputation, 0);
    assert.equal(led.recognition, 340, "recognition is lifetime honor and must carry");
    assert.equal(led.contractsCompleted, 7, "career totals carry");
    assert.equal(led.seasonsPlayed, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the session loop stays deterministic under replay", () => {
  const run = () => {
    const { s: start } = deployed(90210);
    let s = start;
    const hashes = [];
    s = apply(s, { type: CMD_ACTIVATE_EVAC, firmId: 0 });
    for (let i = 0; i < 200; i++) {
      s = apply(s, { type: CMD_ADVANCE_TICK });
      hashes.push(hashState(s));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});
