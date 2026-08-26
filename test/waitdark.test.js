// test/waitdark.test.js — S09/Q45: waiting for dark.
//
// Two ways to skip to nightfall in a world where time cannot skip: the free
// safehouse option and the paid (10) cubby hole. Both park the agent inside;
// the reducer pops them out the tick the phase crosses into night. The design
// promise under test: waiting is POSSIBLE, cancellable, refused when
// pointless, and the cubby's price is real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import {
  CMD_DROP_IN, CMD_ENTER_BUILDING, CMD_EXIT_BUILDING, CMD_DIALOGUE_CHOICE,
} from "../engine/commands.js";
import { findDropZones, BUILDING_SAFEHOUSE, BUILDING_CUBBY } from "../engine/citygen.js";
import { payloadFor } from "../engine/buildings.js";
import { makeWorld, placeAgent, centralDropZone, tickCollecting, RULES } from "./helpers.js";

const DN = RULES.season.dayNight;

function insideBuilding(kind, { agentId = 5 } = {}) {
  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const building = s.buildings.find((b) => b.kind === kind);
  assert.ok(building, `no building of kind ${kind} was generated`);
  placeAgent(s, { agentId, firmId: 0, cellX: building.entranceX, cellY: building.entranceY });
  s = apply(s, { type: CMD_ENTER_BUILDING, agentId });
  assert.equal(s.agents[agentId].insideBuildingId, building.id, "fixture: never got inside");
  return { s, building, agentId };
}

function waitOptionIdx(payload) {
  const idx = payload.options.findIndex((o) => o.effect?.type === "waitForDark");
  assert.ok(idx >= 0, "no waitForDark option in this payload");
  return idx;
}

test("citygen seats cubbies without disturbing anything that was already placed", () => {
  const s = makeWorld();
  const per = RULES.citygen.buildings.cubbiesPerDistrict;
  const cubbies = s.buildings.filter((b) => b.kind === BUILDING_CUBBY);
  assert.ok(cubbies.length >= (per - 1) * s.districts.length,
    `expected ~${per * s.districts.length} cubbies, got ${cubbies.length}`);
  // The other kinds keep their counts — cubbies draw from their OWN stream,
  // placed last, so the pre-cubby city is byte-identical (the microscope
  // fixture pins the exact layout; this asserts the invariant by kind).
  for (const kind of [0, 1, 2]) {
    assert.equal(s.buildings.filter((b) => b.kind === kind).length, s.districts.length,
      `building kind ${kind} count changed — the cubby pass disturbed the layout`);
  }
});

test("the safehouse waits you out for free; night pops you back on the street", () => {
  const { s, agentId } = insideBuilding(BUILDING_SAFEHOUSE);
  const payload = payloadFor(s.buildings.find((b) => b.kind === BUILDING_SAFEHOUSE),
    RULES.payloads, 0);
  const idx = waitOptionIdx(payload);
  assert.equal(payload.options[idx].cost, 0, "the safehouse wait is ruled FREE");

  // Choose it near dusk so the test does not tick out a whole compressed day.
  s.tick = DN.dayTicks - 5;
  let out = apply(s, { type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: idx, bank: 0 });
  assert.ok(out.events.some((e) => e.type === "waitingForDark"), "the wait never started");
  assert.equal(out.agents[agentId].waitUntilDark, 1);
  assert.ok(out.agents[agentId].insideBuildingId >= 0, "waiting happens INSIDE");

  const run = tickCollecting(out, apply, 10);
  assert.ok(run.saw("waitedForDark"), "night fell and nobody woke the agent");
  assert.equal(run.state.agents[agentId].insideBuildingId, -1, "must be back outside");
  assert.equal(run.state.agents[agentId].waitUntilDark, 0, "the flag must clear");
});

test("waiting is refused after dark — the option would be a no-op sold as one", () => {
  const { s, agentId } = insideBuilding(BUILDING_SAFEHOUSE);
  const payload = payloadFor(s.buildings.find((b) => b.kind === BUILDING_SAFEHOUSE),
    RULES.payloads, 0);
  s.tick = DN.dayTicks + 10;   // night
  const out = apply(s, {
    type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: waitOptionIdx(payload), bank: 0,
  });
  assert.ok(out.events.some((e) => e.type === "rejected" && e.reason === "already_dark"));
  assert.equal(out.agents[agentId].waitUntilDark, 0);
});

test("stepping out early is changing your mind — the wait cancels", () => {
  const { s, agentId } = insideBuilding(BUILDING_SAFEHOUSE);
  const payload = payloadFor(s.buildings.find((b) => b.kind === BUILDING_SAFEHOUSE),
    RULES.payloads, 0);
  let out = apply(s, {
    type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: waitOptionIdx(payload), bank: 0,
  });
  assert.equal(out.agents[agentId].waitUntilDark, 1);
  out = apply(out, { type: CMD_EXIT_BUILDING, agentId });
  assert.equal(out.agents[agentId].waitUntilDark, 0, "manual exit must clear the wait");
  // And nightfall later must NOT emit a phantom waitedForDark for this agent.
  out.tick = DN.dayTicks - 2;
  const run = tickCollecting(out, apply, 6);
  assert.ok(!run.saw("waitedForDark"), "a cancelled wait still fired");
});

test("the cubby is the same mechanic with a price tag of 10", () => {
  const { s, building, agentId } = insideBuilding(BUILDING_CUBBY);
  const payload = payloadFor(building, RULES.payloads, 0);
  assert.equal(payload.id, "cubby", "a cubby must offer the cubby dialogue");
  const idx = waitOptionIdx(payload);
  assert.equal(payload.options[idx].cost, 10, "the cubby price is RULED at 10");

  // Too poor: refused, and no wait starts.
  let out = apply(s, { type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: idx, bank: 5 });
  assert.ok(out.events.some((e) => e.type === "rejected" && e.reason === "cannot_afford"));
  assert.equal(out.agents[agentId].waitUntilDark, 0);

  // Paid: parked until dark, exactly like the safehouse.
  s.tick = DN.dayTicks - 5;
  out = apply(s, { type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: idx, bank: 10 });
  assert.equal(out.agents[agentId].waitUntilDark, 1);
  const run = tickCollecting(out, apply, 10);
  assert.ok(run.saw("waitedForDark"), "the paid wait never completed");
  assert.equal(run.state.agents[agentId].insideBuildingId, -1);
});

test("a cubby has no heat gate — a lockdown is when you need the hole", () => {
  const { s, building } = insideBuilding(BUILDING_CUBBY);
  const payload = payloadFor(building, RULES.payloads, 5);   // lockdown-level heat
  assert.ok(payload && !payload.quiet && payload.options.length > 0,
    "the cubby went quiet under heat — it is a recess, not an informant");
  void s;
});

test("dayOnly rows vanish from the overlay at night (client models)", async () => {
  const { overlayRows } = await import("../client/js/models.js");
  const payload = RULES.payloads.dialogues.find((d) => d.id === "cubby");
  assert.equal(overlayRows(payload, false).length, 1, "by day the option shows");
  assert.equal(overlayRows(payload, true).length, 0, "by night it is pointless and hidden");
});
