// test/hq.test.js — M3 gate: the full session loop and the ledger.
//
// Every interruption row of the S05 evac table is exercised here: leaving the
// perimeter pauses, a rival triggers the alarm without stopping the clock
// (D28), a downed agent cancels, and only a clean extraction banks the cache.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
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
import { hqLandingFor } from "../engine/hq.js";
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

test("Q50: a drop lands in the district the player CHOSE, or pitches a tent there", () => {
  // The defect: `hqLandingFor` searched every safehouse in the world, so a
  // district with no free one relocated the Field HQ clear across the map —
  // 62% of drops landed in a district the player had not chosen (median travel
  // 30 cells on a 64-cell map). Found while repeatedly failing to photograph
  // the industrial smoke and landing in Residential instead.
  //
  // A distance bound was the WRONG TOOL and the measurements said so: no radius
  // drove the wrong-district rate below ~4%, because a drop near a border
  // legitimately has a nearer safehouse across the line. Matching the DISTRICT
  // makes it zero by construction. Ruled 2026-08-28 with the safehouse density
  // raise that keeps the tent fallback rare.
  //
  // Asserted WITH RIVALS ALREADY DEPLOYED, because that is the state a
  // late-joining player drops into and the state the old density failed in: at
  // 1 safehouse per district, 51% of such drops got no building at all.
  for (const seed of [4711, 1000, 1411]) {
    const s = makeWorld({ seed });
    const zones = findDropZones(s, RULES.citygen);
    assert.ok(zones.length, `seed ${seed}: fixture has no drop zones`);
    // Four rival HQs holding safehouses.
    for (const z of zones.filter((_, i) => i % 23 === 0).slice(0, 4)) {
      const l = hqLandingFor(s, z.cellX, z.cellY, RULES.hq);
      s.hqs.push({ id: s.hqs.length, firmId: 90 + s.hqs.length, buildingId: l.buildingId,
        cellX: l.cellX, cellY: l.cellY });
    }
    let tents = 0, landings = 0;
    for (const z of zones.filter((_, i) => i % 5 === 0)) {
      const l = hqLandingFor(s, z.cellX, z.cellY, RULES.hq);
      const asked = s.districtOwner[z.cellY * s.size + z.cellX];
      if (l.buildingId < 0) {
        tents++;
        // The tent is honest: it pitches on the ground the player asked for.
        assert.equal(l.cellX, z.cellX, "the tent moved off the requested cell");
        assert.equal(l.cellY, z.cellY, "the tent moved off the requested cell");
        continue;
      }
      landings++;
      const got = s.districtOwner[l.cellY * s.size + l.cellX];
      assert.equal(got, asked,
        `seed ${seed}: a drop in district ${asked} landed the HQ in ${got}`);
    }
    assert.ok(landings > 0, `seed ${seed}: every drop tented — density is too low`);
    // The density ruling: tents must be the exception, not the norm. It was 51%.
    assert.ok(tents / (tents + landings) < 0.2,
      `seed ${seed}: ${tents}/${tents + landings} drops pitched a tent — safehouses are too sparse`);
  }
});

test("Q50: the secondary radius bound still works, so the lever cannot rot", () => {
  // The district rule does the honesty work, so `landingSearchRadius` ships
  // permissive. Exercised here at a tight value anyway: config that nothing
  // reads is the dead-`redropReputationHit` shape, and a lever nobody tests is
  // a lever nobody can trust when the owner does want it.
  const s = makeWorld({ seed: 4711 });
  const zones = findDropZones(s, RULES.citygen);
  const tight = { ...RULES.hq, landingSearchRadius: 6 };
  let tents = 0, bounded = 0;
  for (const z of zones.filter((_, i) => i % 11 === 0)) {
    const l = hqLandingFor(s, z.cellX, z.cellY, tight);
    const d = Math.abs(l.cellX - z.cellX) + Math.abs(l.cellY - z.cellY);
    if (l.buildingId < 0) { tents++; assert.equal(d, 0); } else { bounded++; assert.ok(d <= 6); }
  }
  assert.ok(tents > 0, "a 6-cell bound should force some tent fallbacks");
  assert.ok(bounded > 0, "a 6-cell bound should still find some doors");
});

test("drop-in establishes the HQ in the nearest safehouse, and the agent lands with it", () => {
  const { s, zone } = deployed();
  assert.equal(s.hqs.length, 1);
  const hq = s.hqs[0];
  // A DELIBERATE duplicate of the landing rule (fixture-twin style): the
  // nearest CLEAR safehouse to the requested cell — clear of patrols by the
  // drop radius and outside every active camera's range (playtest 8) —
  // computed independently here so the engine's hqLandingFor cannot verify
  // itself.
  // Q50: ...and IN THE REQUESTED DISTRICT. The twin has to carry the district
  // rule too, or it stops being a check on the engine and becomes a check on
  // the engine's old behaviour.
  const asked = s.districtOwner[zone.cellY * s.size + zone.cellX];
  const safehouses = s.buildings.filter((b) => b.kind === 0).filter((b) =>
    s.districtOwner[b.entranceY * s.size + b.entranceX] === asked
    && s.patrols.every((p) =>
      Math.abs(p.x - b.entranceX) + Math.abs(p.y - b.entranceY) >= RULES.hq.dropZoneMinClearRadius)
    && (s.cameras ?? []).every((c) => c.disabled
      || Math.max(Math.abs(c.cellX - b.entranceX), Math.abs(c.cellY - b.entranceY)) > (c.range | 0)));
  assert.ok(safehouses.length, "no clear safehouse in the reference world");
  const dist = (b) => Math.abs(b.entranceX - zone.cellX) + Math.abs(b.entranceY - zone.cellY);
  const nearest = safehouses.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  assert.equal(hq.buildingId, nearest.id, "the HQ did not claim the nearest safehouse");
  assert.equal(hq.cellX, nearest.entranceX);
  assert.equal(hq.cellY, nearest.entranceY);
  assert.equal(s.firms[0].state, FIRM_DEPLOYED);
  const agent = s.agents.find((a) => a.firmId === 0);
  assert.ok(agent && agent.state === AGENT_ACTIVE, "no lead agent landed");
  assert.equal(Math.floor(agent.x / 256), hq.cellX, "the agent landed away from the HQ");
  assert.equal(Math.floor(agent.y / 256), hq.cellY);
  const ev = s.events.find((e) => e.type === "firmDeployed");
  assert.ok(ev && ev.buildingId === nearest.id && ev.cellX === hq.cellX,
    "the deploy event must report the LANDING, not the request");
});

test("drop-in refuses garbage requests, snaps away from rivals, never doubles a safehouse", () => {
  let { s } = deployed();
  const hq0 = s.hqs[0];

  // A building-mass REQUEST is still refused loudly (intent validation).
  let blockCell = null;
  for (let y = 0; y < s.size && !blockCell; y++) {
    for (let x = 0; x < s.size; x++) {
      if (s.map.cells[y * s.size + x] === 4) { blockCell = { x, y }; break; }
    }
  }
  const onBlock = apply(s, { type: CMD_DROP_IN, firmId: 1, cellX: blockCell.x, cellY: blockCell.y });
  assert.equal(onBlock.events[0].reason, "unlandable");

  // A request right on the rival's doorstep SNAPS to a different safehouse
  // rather than refusing — the landing rule owns proximity now.
  const snapped = apply(s, { type: CMD_DROP_IN, firmId: 1, cellX: hq0.cellX, cellY: hq0.cellY });
  const hq1 = snapped.hqs.find((h) => h.firmId === 1);
  assert.ok(hq1, "a drop near a rival must land somewhere, not refuse");
  assert.ok(hq1.buildingId >= 0, "the second Firm should still get a safehouse");
  assert.notEqual(hq1.buildingId, hq0.buildingId, "two HQs may never share one safehouse");
  assert.ok(Math.abs(hq1.cellX - hq0.cellX) + Math.abs(hq1.cellY - hq0.cellY)
    >= RULES.hq.dropZoneMinClearRadius, "the snapped landing broke the clear radius");

  // The TENT FALLBACK (no safehouse anywhere) keeps the old proximity rule.
  let nearCell = null;
  for (let r = 1; r < RULES.hq.dropZoneMinClearRadius && !nearCell; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = hq0.cellX + dx, y = hq0.cellY + dy;
      if (x < 1 || y < 1 || x >= s.size - 1 || y >= s.size - 1) continue;
      const t = s.map.cells[y * s.size + x];
      if (t !== 4 && t !== 10) { nearCell = { x, y }; break; }
    }
  }
  assert.ok(nearCell, "no landable cell near the HQ to test proximity");
  const bare = { ...s, buildings: [] };
  const tooClose = apply(bare, { type: CMD_DROP_IN, firmId: 1, cellX: nearCell.x, cellY: nearCell.y });
  assert.equal(tooClose.events[0].reason, "too_close_to_rival_hq");
  // And far enough away, the tent still stands where asked.
  const farCell = cellAwayFrom(s, hq0.cellX, hq0.cellY, RULES.hq.dropZoneMinClearRadius + 2);
  const tent = apply(bare, { type: CMD_DROP_IN, firmId: 1, cellX: farCell.x, cellY: farCell.y });
  const tentHq = tent.hqs.find((h) => h.firmId === 1);
  assert.ok(tentHq && tentHq.buildingId === -1 && tentHq.cellX === farCell.x,
    "with no safehouse in the world the HQ must fall back to the tent at the request");
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

test("a fresh identity starts with the ruled bank, and a rotated season restores it (playtest 5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-startbank-"));
  const path = join(dir, "ledger.json");
  try {
    // A fresh player with bank 0 could afford NO action at all — the cheapest
    // informant option costs 30. The starting bank is data (rules.hq).
    assert.ok(RULES.hq.startingBank >= 30,
      "the starting bank cannot afford the cheapest informant option — the exact playtest-5 defect");
    const store = new LedgerStore(path, { startingBank: RULES.hq.startingBank });
    assert.equal(store.get("world-a", 0).bank, RULES.hq.startingBank,
      "a brand-new identity must start with the ruled bank");

    // A season rotation is a fresh start too — resetting to ZERO would
    // re-open the same defect every 28 days.
    store.applyDebrief("world-a", {
      firmId: 0, banked: 500, reputationDelta: 10, recognition: 340,
      tierUnlocked: 3, contractsCompleted: 7,
    }, 1000);
    store.rotateSeason("world-a");
    const led = store.get("world-a", 0);
    assert.equal(led.bank, RULES.hq.startingBank, "rotation must restore the STARTING bank, not zero");
    assert.equal(led.recognition, 340, "recognition still carries (D33)");

    // Spending draws it down and persists.
    assert.ok(store.spendBank("world-a", 0, 30));
    assert.equal(new LedgerStore(path, { startingBank: RULES.hq.startingBank }).get("world-a", 0).bank,
      RULES.hq.startingBank - 30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the landing prefers a patrol-clear safehouse door (playtest 5: burned during the cinematic)", () => {
  // Reproduces the reported burn: seed 42, district 0 — the nearest safehouse
  // door had a patrol at distance 1, and the operative was noticed at tick 0
  // and burned at tick 38, before the player ever had control.
  let s = makeWorld({ seed: 42 });
  const zones = findDropZones(s, RULES.citygen).filter((z) => z.districtId === 0);
  const z = zones[Math.floor(zones.length / 2)];
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: z.cellX, cellY: z.cellY });
  const hq = s.hqs[0];
  assert.ok(hq.buildingId >= 0, "the drop should still land at a safehouse");
  const patrolDist = Math.min(...s.patrols.map((p) =>
    Math.abs(p.x - hq.cellX) + Math.abs(p.y - hq.cellY)));
  assert.ok(patrolDist >= RULES.hq.dropZoneMinClearRadius,
    `landed with a patrol ${patrolDist} cells from the door — inside the clear radius the drop zones promise`);
  // Cameras feed detection too (playtest 8: a camera six cells from the door
  // noticed the spawn at tick 80). The clear pass must keep them out of range.
  const camDist = Math.min(...(s.cameras ?? []).filter((c) => !c.disabled).map((c) =>
    Math.max(Math.abs(c.cellX - hq.cellX), Math.abs(c.cellY - hq.cellY)) - (c.range | 0)));
  assert.ok(camDist > 0, "landed inside an active camera's range — the intro-reading burn returns");
  // And the operative survives standing at spawn for a full 15 seconds —
  // the time a new player spends reading the intro — unseen.
  const run = tickCollecting(s, apply, 150);
  assert.ok(!run.saw("agentBurned") && !run.saw("agentNoticed"),
    "the operative was seen while standing at spawn — the landing gave back its clearance");
});

test("legacy ledgers are floored to the starting bank ONCE, and spending below it sticks", () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-ledgerfloor-"));
  const path = join(dir, "ledger.json");
  try {
    // A pre-floor file: a firm entry persisted at bank 0, no version stamp.
    const legacy = new LedgerStore(path);   // startingBank 0 — the old world
    legacy.applyDebrief("world-a", {
      firmId: 0, banked: 0, reputationDelta: 1, recognition: 5,
      tierUnlocked: 1, contractsCompleted: 0,
    }, 100);
    // Strip the version stamp so the file reads as genuinely pre-migration.
    const raw = JSON.parse(readFileSync(path, "utf8"));
    delete raw.version;
    writeFileSync(path, JSON.stringify(raw));

    const start = RULES.hq.startingBank;
    const store = new LedgerStore(path, { startingBank: start });
    assert.equal(store.get("world-a", 0).bank, start,
      "a legacy bank below the floor must be raised — that player could afford nothing, forever");

    // Spend below the floor, reopen: the floor must NOT re-apply.
    assert.ok(store.spendBank("world-a", 0, start - 10));
    const reopened = new LedgerStore(path, { startingBank: start });
    assert.equal(reopened.get("world-a", 0).bank, 10,
      "the migration re-ran on a stamped file and refunded the spend");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
