// test/vehicles.test.js — M6 slice 6b (S02, D34).
//
// The design intent a vehicle must NOT break: speed is bought with noise. If a
// vehicle were simply faster, the stealth walk would be strictly dominated and
// the whole detection pillar would collapse into "always drive".

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK, CMD_ENTER_VEHICLE, CMD_EXIT_VEHICLE, CMD_MOVE } from "../engine/commands.js";
import { noiseRadiusFor } from "../engine/detection.js";
import { VEHICLE_KINDS } from "../engine/agents.js";
import { makeWorld, placeAgent, quietCell, reachableDestination, RULES } from "./helpers.js";
import { cellToWorld, worldToCellFloor } from "../shared/fixedmath.js";

function withVehicle(kind = 1, { cellX, cellY } = {}) {
  const s = makeWorld();
  const spot = quietCell(s);
  const x = cellX ?? spot.x, y = cellY ?? spot.y;
  placeAgent(s, { agentId: 0, firmId: 0, cellX: x, cellY: y });
  s.vehicles.push({
    id: 0, kind, firmId: 0, x: cellToWorld(x), y: cellToWorld(y),
    riderAgentId: -1, facing: 0, moveProgress: 0,
  });
  return { state: s, spot: { x, y } };
}

test("an agent boards a vehicle it is standing on, and steps off again", () => {
  const { state } = withVehicle();
  let s = apply(state, { type: CMD_ENTER_VEHICLE, agentId: 0 });
  assert.ok(s.events.some((e) => e.type === "boardedVehicle"), "boarding failed");
  assert.equal(s.agents[0].vehicleId, 0);
  assert.equal(s.vehicles[0].riderAgentId, 0);

  s = apply(s, { type: CMD_EXIT_VEHICLE, agentId: 0 });
  assert.equal(s.agents[0].vehicleId, -1);
  assert.equal(s.vehicles[0].riderAgentId, -1);
});

test("boarding is refused where there is no vehicle", () => {
  const s = makeWorld();
  const spot = quietCell(s);
  placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
  const bad = apply(s, { type: CMD_ENTER_VEHICLE, agentId: 0 });
  assert.equal(bad.events[0].reason, "no_vehicle_here");
});

test("D34: the armoured car is not available in V1", () => {
  // data/vehicles.json marks it v1:false. The engine must honour the flag
  // rather than the roster being enforced only by nobody spawning one.
  const s = makeWorld();
  const spot = quietCell(s);
  placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
  s.vehicles.push({
    id: 0, kind: 3, firmId: 0, x: cellToWorld(spot.x), y: cellToWorld(spot.y),
    riderAgentId: -1, facing: 0, moveProgress: 0,
  });
  const bad = apply(s, { type: CMD_ENTER_VEHICLE, agentId: 0 });
  assert.equal(bad.events[0].reason, "not_available");
});

test("a motorbike carries nothing — you cannot ride off with the package", () => {
  const { state } = withVehicle(1);   // motorbike, cargo 0
  state.agents[0].carryKind = 1;      // CARRY_PACKAGE
  const bad = apply(state, { type: CMD_ENTER_VEHICLE, agentId: 0 });
  assert.equal(bad.events[0].reason, "no_cargo_space");

  const { state: van } = withVehicle(2);  // cargoVan
  van.agents[0].carryKind = 1;
  const ok = apply(van, { type: CMD_ENTER_VEHICLE, agentId: 0 });
  assert.ok(ok.events.some((e) => e.type === "boardedVehicle"), "the van refused cargo");
});

test("driving outruns walking", () => {
  // Measured as TIME TO ARRIVE, not distance covered in a fixed window: over a
  // long enough window both arrive and cover exactly the same ground, so a
  // displacement comparison reports a tie and proves nothing.
  const ticksToArrive = (drive) => {
    const { state, spot } = withVehicle(1);
    let s = state;
    if (drive) s = apply(s, { type: CMD_ENTER_VEHICLE, agentId: 0 });
    const dest = reachableDestination(s, spot, 14);
    if (!dest) return -1;
    s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: dest.x, cellY: dest.y });
    for (let i = 1; i <= 300; i++) {
      s = apply(s, { type: CMD_ADVANCE_TICK });
      if (s.events.some((e) => e.type === "agentArrived")) return i;
    }
    return -1;
  };
  const walked = ticksToArrive(false);
  const drove = ticksToArrive(true);
  assert.ok(walked > 0 && drove > 0, "one of the runs never arrived");
  assert.ok(drove < walked, `driving took ${drove} ticks, walking took ${walked}`);
});

test("THE TRADE: a vehicle is loud however carefully you drive", () => {
  // Sneaking in a van is not a thing. Without this, vehicles dominate.
  const { state } = withVehicle(2);   // cargoVan
  const agent = { ...state.agents[0], stance: 0, moveProgress: 1, targetX: 999 };
  const onFoot = noiseRadiusFor(RULES.detection, RULES.agents, agent, null);
  const spec = RULES.vehicles[VEHICLE_KINDS[2]];
  const driving = noiseRadiusFor(RULES.detection, RULES.agents, agent, spec);
  assert.equal(onFoot, RULES.agents.stances.sneak.noiseRadius,
    "precondition: sneaking on foot is quiet");
  assert.ok(driving > onFoot,
    `a sneaking driver (${driving}) must still be louder than a sneaking walker (${onFoot})`);
});

test("a ridden vehicle tracks its driver", () => {
  const { state, spot } = withVehicle(1);
  let s = apply(state, { type: CMD_ENTER_VEHICLE, agentId: 0 });
  const dest = reachableDestination(s, spot, 6);
  s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: dest.x, cellY: dest.y });
  for (let i = 0; i < 20; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(s.vehicles[0].x, s.agents[0].x, "the vehicle was left behind");
  assert.equal(s.vehicles[0].y, s.agents[0].y);
});
