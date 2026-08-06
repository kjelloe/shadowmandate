// test/junctions.test.js — junction boxes (S16, M8 slice 8d).
//
// The counter-play, and D45 in one mechanism: the answer to a camera is not a
// lock-picking widget, it is walking to the box and cutting it, in the world.
//
// The property that matters most is the TRADE. Cutting is free in stealth terms
// but costs district heat — a local problem swapped for a global one. Without
// that cost the correct play is always "cut everything first" and the whole
// stealth layer collapses into an errand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { CMD_CUT_JUNCTION } from "../engine/commands.js";
import { hashState } from "../engine/snapshot.js";
import { mirrorState, POSITIONAL_FIELDS } from "../engine/mirror.js";
import { cutJunction, junctionAt, stepAlarms, alarmStageOf } from "../engine/security.js";
import { cameraCoversCell } from "../engine/cameras.js";
import { beamLiveAt } from "../engine/sensors.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const JCFG = RULES.security.junction;

// A world where the agent is standing at a junction that actually controls
// something. Derived from the generated city, never hand-placed.
function atJunction(seed = 4711) {
  const s = makeWorld({ seed });
  const j = s.junctions.find((x) =>
    s.cameras.some((c) => c.siteId === x.siteId) || s.beams.some((b) => b.siteId === x.siteId));
  assert.ok(j, "no junction controls anything — placement is wrong");
  const agent = placeAgent(s, { cellX: j.cellX, cellY: j.cellY });
  return { s, j, agent };
}

test("a junction only exists where there is something to switch off", () => {
  // A switch with nothing behind it is set dressing that looks like a mechanic.
  for (const seed of [4711, 90210, 1548]) {
    const s = makeWorld({ seed });
    assert.ok(s.junctions.length > 0, `seed ${seed}: no junctions placed at all`);
    for (const j of s.junctions) {
      const controls = s.cameras.filter((c) => c.siteId === j.siteId).length
        + s.beams.filter((b) => b.siteId === j.siteId).length;
      assert.ok(controls > 0, `junction ${j.id} controls nothing`);
    }
  }
});

test("cutting blacks out every fixture at that site", () => {
  const { s, j, agent } = atJunction();
  const before = s.tick;
  const r = cutJunction(s, agent, j.id, JCFG, RULES.detection);
  assert.ok(r.ok, `cut refused: ${r.reason}`);
  assert.ok(r.blacked > 0, "the cut switched nothing off");
  for (const c of s.cameras.filter((x) => x.siteId === j.siteId)) {
    assert.ok(!cameraCoversCell(c, c.cellX + 1, c.cellY, before + 1),
      "a camera at the cut site still sees");
  }
  for (const b of s.beams.filter((x) => x.siteId === j.siteId)) {
    assert.equal(beamLiveAt(b, before + 1), false, "a beam at the cut site is still live");
  }
});

test("the blackout ENDS — it is a window, not a solution", () => {
  const { s, j, agent } = atJunction();
  cutJunction(s, agent, j.id, JCFG, RULES.detection);
  const after = s.tick + JCFG.blackoutTicks;
  const cam = s.cameras.find((c) => c.siteId === j.siteId);
  if (cam) {
    assert.ok(cameraCoversCell(cam, cam.cellX, cam.cellY, after),
      "the camera never came back — one cut disabled the site forever");
  }
});

test("THE TRADE: cutting costs district heat", () => {
  // Without a cost the correct play is always "cut everything first", and the
  // stealth layer becomes an errand rather than a set of decisions.
  const { s, j, agent } = atJunction();
  const district = s.districts[j.districtId];
  district.heat = 0;
  cutJunction(s, agent, j.id, JCFG, RULES.detection);
  assert.equal(district.heat, JCFG.districtHeat,
    "cutting power was free — there is no reason not to cut every box in the city");
  assert.ok(JCFG.districtHeat > 0, "the configured cost is zero, which is the same failure");
});

test("cutting is SILENT — it does not burn you or raise the site alarm", () => {
  // The trade is heat, not detection. Cutting must stay the stealthy option or
  // it is strictly worse than walking past.
  const { s, j, agent } = atJunction();
  agent.detection = 0;
  cutJunction(s, agent, j.id, JCFG, RULES.detection);
  assert.equal(agent.detection, 0, "cutting a junction burned the agent");
  stepAlarms(s, RULES.security.alarm);
  assert.equal(alarmStageOf(s, j.siteId), 0, "cutting raised the site alarm it was meant to defeat");
});

test("you must be AT the box — no cutting from across the street", () => {
  // Reaching it unseen is the half of the puzzle that is interesting.
  const { s, j } = atJunction();
  const far = placeAgent(s, { cellX: j.cellX + 6, cellY: j.cellY + 6 });
  const r = cutJunction(s, far, j.id, JCFG, RULES.detection);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_adjacent");
});

test("a refusal always says WHY", () => {
  // A control that silently does nothing is the defect playtest 1 shipped.
  const { s, agent } = atJunction();
  assert.equal(cutJunction(s, agent, 9999, JCFG, RULES.detection).reason, "no_junction");
  const downed = placeAgent(s, { agentId: 2, cellX: 5, cellY: 5 });
  downed.state = 2;
  assert.equal(cutJunction(s, downed, 0, JCFG, RULES.detection).reason, "not_active");
});

test("a box cannot be re-cut while it is already down", () => {
  // Otherwise the heat cost is paid once and the blackout extends forever.
  const { s, j, agent } = atJunction();
  assert.ok(cutJunction(s, agent, j.id, JCFG, RULES.detection).ok);
  const again = cutJunction(s, agent, j.id, JCFG, RULES.detection);
  assert.equal(again.ok, false);
  assert.equal(again.reason, "already_cut");
});

test("the command goes through the reducer and is rejected with a reason", () => {
  const { s, j } = atJunction();
  const far = placeAgent(s, { agentId: 3, cellX: j.cellX + 9, cellY: j.cellY + 9 });
  const next = apply(s, { type: CMD_CUT_JUNCTION, agentId: far.id, junctionId: j.id });
  assert.ok(next.events.some((e) => e.type === "rejected" && e.reason === "not_adjacent"),
    "the reducer swallowed the rejection reason");
});

test("a successful cut is announced", () => {
  const { s, j, agent } = atJunction();
  const next = apply(s, { type: CMD_CUT_JUNCTION, agentId: agent.id, junctionId: j.id });
  const e = next.events.find((x) => x.type === "junctionCut");
  assert.ok(e, "the cut was silent — the client has nothing to show");
  assert.equal(e.siteId, j.siteId);
  assert.ok(e.blacked > 0);
});

test("junctions hash, mirror and survive a copy", () => {
  const s = makeWorld();
  const before = hashState(s);
  s.junctions[0].cutUntil = 900;
  assert.notEqual(hashState(s), before, "a cut junction is not hashed");
  const m = mirrorState(s);
  assert.equal(m.junctions[0].cellX, s.size - 1 - s.junctions[0].cellX);
  assert.deepEqual(POSITIONAL_FIELDS.junctions, ["cellX"]);
  const next = apply(s, { type: 1 });
  assert.equal(next.junctions[0].cutUntil, 900, "junctions did not survive copyState");
});
