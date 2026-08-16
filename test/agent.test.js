// test/agent.test.js — M2 gate: movement, detection, heat, combat, capture.
//
// The four scenarios the milestone promises: sneak past a patrol unseen, get
// burned by hurrying, get downed and captured, and watch heat rise and decay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import {
  CMD_ADVANCE_TICK, CMD_MOVE, CMD_SET_STANCE, CMD_USE_ITEM, CMD_CAPTURE, CMD_RESCUE,
} from "../engine/commands.js";
import {
  AGENT_ACTIVE, AGENT_DOWNED, AGENT_HELD,
  DET_UNSEEN, DET_NOTICED, DET_BURNED, STANCE_SNEAK, STANCE_HURRY,
} from "../engine/state.js";
import { ITEM_SUPPRESSOR, ITEM_SIDEARM } from "../engine/combat.js";
import { findPath } from "../engine/pathfind.js";
import { makeWorld, placeAgent, quietCell, cellNearPatrol, coveredCellNearPatrol, reachableDestination, RULES } from "./helpers.js";
import { worldToCellFloor, cellToWorld } from "../shared/fixedmath.js";

const cellOf = (a) => ({ x: worldToCellFloor(a.x), y: worldToCellFloor(a.y) });

test("pathfinding returns a walkable route and is deterministic", () => {
  const s = makeWorld();
  const a = quietCell(s), b = s.districts[1] ? { x: s.districts[1].coreX, y: s.districts[1].coreY } : null;
  assert.ok(a && b);
  const p1 = findPath(s.map, a.x, a.y, b.x, b.y);
  const p2 = findPath(s.map, a.x, a.y, b.x, b.y);
  assert.deepEqual(p1, p2, "path is not deterministic");
  assert.ok(p1.length > 0, "no route between districts");
  for (const step of p1) {
    const t = s.map.cells[step.y * s.size + step.x];
    assert.notEqual(t, 4, "path crosses building mass");
    assert.notEqual(t, 10, "path crosses water");
  }
});

test("an agent walks to its destination and reports arrival", () => {
  let s = makeWorld();
  const start = quietCell(s);
  placeAgent(s, { cellX: start.x, cellY: start.y });
  const dest = reachableDestination(s, start, 4);
  assert.ok(dest, "no test route available");
  s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: dest.x, cellY: dest.y });
  let arrived = false;
  for (let i = 0; i < 400 && !arrived; i++) {
    s = apply(s, { type: CMD_ADVANCE_TICK });
    if (s.events.some((e) => e.type === "agentArrived")) arrived = true;
  }
  assert.ok(arrived, "agent never arrived");
  assert.deepEqual(cellOf(s.agents[0]), { x: dest.x, y: dest.y });
});

test("stance changes movement speed: sneak is slower than hurry", () => {
  const distanceAfter = (stance, ticks) => {
    let s = makeWorld();
    const start = quietCell(s);
    placeAgent(s, { cellX: start.x, cellY: start.y, stance });
    const dest = reachableDestination(s, start, 12);
    if (!dest) return 0;
    s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: dest.x, cellY: dest.y });
    const x0 = s.agents[0].x, y0 = s.agents[0].y;
    for (let i = 0; i < ticks; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
    return Math.abs(s.agents[0].x - x0) + Math.abs(s.agents[0].y - y0);
  };
  const sneak = distanceAfter(STANCE_SNEAK, 30);
  const hurry = distanceAfter(STANCE_HURRY, 30);
  assert.ok(hurry > sneak, `hurry (${hurry}) should outpace sneak (${sneak})`);
});

test("SCENARIO: sneaking in cover defeats a patrol that would spot you in the open", () => {
  // The promise of the stealth pillar, stated as an assertion that can fail:
  // cover plus the sneak stance must beat a patrol at a distance where the
  // same patrol would burn an agent standing in the street.
  //
  // (An earlier version of this test placed both stances 2 cells away on open
  // street and asserted `hurry >= sneak`. Both burned, so it passed while
  // proving nothing — the classic test that only records success.)
  const worstDetectionAt = (spot, stance, ticks = 150) => {
    let s = makeWorld();
    placeAgent(s, { cellX: spot.x, cellY: spot.y, stance });
    let worst = DET_UNSEEN;
    for (let i = 0; i < ticks; i++) {
      s = apply(s, { type: CMD_ADVANCE_TICK });
      worst = Math.max(worst, s.agents[0].detection);
    }
    return worst;
  };

  const base = makeWorld();
  const covered = coveredCellNearPatrol(base, 0, 4, 7);
  assert.ok(covered, "no covered cell near a patrol in the reference world");

  const hidden = worstDetectionAt(covered, STANCE_SNEAK);
  assert.equal(hidden, DET_UNSEEN,
    `sneaking in cover ${covered.d} cells away should stay unseen, got ${hidden}`);

  const exposed = cellNearPatrol(base, 0, 2);
  const caught = worstDetectionAt(exposed, STANCE_HURRY);
  assert.equal(caught, DET_BURNED,
    `hurrying 2 cells away in the open should get you burned, got ${caught}`);
});

test("SCENARIO: an agent that lingers in view is burned, and heat rises", () => {
  let s = makeWorld();
  const p = s.patrols[0];
  placeAgent(s, { cellX: p.x, cellY: p.y, stance: STANCE_HURRY });
  s.agents[0].detection = DET_NOTICED;
  s.agents[0].detectTimer = RULES.detection.burnTicks;
  const districtId = s.districtOwner[p.y * s.size + p.x];
  const heatBefore = s.districts[districtId].heat;

  let burned = false;
  for (let i = 0; i < 60 && !burned; i++) {
    s = apply(s, { type: CMD_ADVANCE_TICK });
    if (s.events.some((e) => e.type === "agentBurned")) burned = true;
  }
  assert.ok(burned, "agent standing on a patrol was never burned");
  assert.equal(s.agents[0].detection, DET_BURNED);
  assert.ok(s.districts[districtId].heat > heatBefore, "burning did not raise district heat");
});

test("heat decays back down over time", () => {
  let s = makeWorld();
  s.districts[0].heat = 3;
  s.districts[0].heatTimer = 0;
  const decay = RULES.detection.heat.decayTicks;
  for (let i = 0; i < decay + 5; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(s.districts[0].heat, 2, "heat did not decay");
});

test("SCENARIO: a downed agent can be captured to a Holding Site", () => {
  let s = makeWorld();
  const spot = quietCell(s);
  const victim = placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
  const captor = placeAgent(s, { agentId: 1, firmId: 1, cellX: spot.x, cellY: spot.y });
  victim.condition = 1;

  s = apply(s, { type: CMD_USE_ITEM, agentId: 1, slot: ITEM_SIDEARM,
    cellX: spot.x, cellY: spot.y });
  assert.equal(s.agents[0].state, AGENT_DOWNED, "sidearm did not down the target");

  s = apply(s, { type: CMD_CAPTURE, agentId: 1, targetAgentId: 0 });
  assert.equal(s.agents[0].state, AGENT_HELD, "capture did not hold the agent");
  const site = s.holdingSites.find((h) => h.id === s.agents[0].holdingSiteId);
  assert.ok(site.heldAgentIds.includes(0), "holding site does not list the captive");
  assert.ok(s.events.some((e) => e.type === "agentCaptured"));
});

test("a friendly agent can rescue a downed one instead", () => {
  let s = makeWorld();
  const spot = quietCell(s);
  const victim = placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
  placeAgent(s, { agentId: 1, firmId: 0, cellX: spot.x, cellY: spot.y });
  victim.state = AGENT_DOWNED;
  s = apply(s, { type: CMD_RESCUE, agentId: 1, targetAgentId: 0 });
  assert.equal(s.agents[0].state, AGENT_ACTIVE, "rescue failed");
  assert.ok(s.events.some((e) => e.type === "agentRescued"));
});

test("the suppressor subdues silently, but fails when the user is burned", () => {
  const attempt = (detection) => {
    let s = makeWorld();
    const spot = quietCell(s);
    placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
    placeAgent(s, { agentId: 1, firmId: 1, cellX: spot.x, cellY: spot.y });
    s.agents[0].detection = detection;
    s = apply(s, { type: CMD_USE_ITEM, agentId: 0, slot: ITEM_SUPPRESSOR,
      cellX: spot.x, cellY: spot.y });
    return s;
  };
  const quiet = attempt(DET_UNSEEN);
  assert.ok(quiet.events.some((e) => e.type === "agentSubdued"), "silent subdue failed");
  assert.equal(quiet.agents[1].state, AGENT_DOWNED);

  const seen = attempt(DET_BURNED);
  assert.ok(seen.events.some((e) => e.type === "subdueFailed"), "burned subdue should fail");
  assert.equal(seen.agents[1].state, AGENT_ACTIVE, "target should be untouched");
});

test("D27: Authority patrols arrest a downed agent they reach", () => {
  let s = makeWorld();
  const p = s.patrols[0];
  const agent = placeAgent(s, { cellX: p.x, cellY: p.y });
  agent.state = AGENT_DOWNED;
  let arrested = false;
  for (let i = 0; i < 20 && !arrested; i++) {
    s = apply(s, { type: CMD_ADVANCE_TICK });
    if (s.events.some((e) => e.type === "agentArrested")) arrested = true;
  }
  assert.ok(arrested, "a patrol standing on a downed agent never arrested it");
  assert.equal(s.agents[0].state, AGENT_HELD);
});

test("the whole M2 world stays deterministic under replay", () => {
  const run = () => {
    let s = makeWorld({ seed: 90210 });
    const spot = quietCell(s);
    placeAgent(s, { cellX: spot.x, cellY: spot.y });
    const dest = reachableDestination(s, spot, 8) ?? spot;
    s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: dest.x, cellY: dest.y });
    const hashes = [];
    for (let i = 0; i < 120; i++) {
      s = apply(s, { type: CMD_ADVANCE_TICK });
      hashes.push(hashState(s));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});
