// test/civilians.test.js — S17 ambient city life.
//
// Civilians are decoration with one honest behaviour: they flee trouble.
// What these tests protect is mostly what civilians must NOT do — watch,
// block, emit, or cost determinism.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { raiseAlarm, ALARM_LOCKDOWN } from "../engine/security.js";
import { speedMultiplier } from "../engine/terrain.js";
import { tileAt } from "../engine/state.js";
import { makeWorld, RULES } from "./helpers.js";

function run(s, n) {
  for (let i = 0; i < n; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
  return s;
}

test("the crowd seats itself: perDistrict per district, on walkable cells", () => {
  const s = makeWorld({ seed: 4711 });
  const want = RULES.civilians.perDistrict * s.districts.length;
  // Placement can miss in a cramped district; most seats must fill.
  assert.ok(s.civilians.length >= want - 2 && s.civilians.length <= want,
    `expected ~${want} civilians, got ${s.civilians.length}`);
  for (const c of s.civilians) {
    assert.ok(speedMultiplier(tileAt(s.map, c.x, c.y)) > 0,
      `civilian ${c.id} seated in building mass at ${c.x},${c.y}`);
  }
});

test("the crowd strolls, and identically for the same seed", () => {
  const a = run(makeWorld({ seed: 1411 }), 400);
  const b = run(makeWorld({ seed: 1411 }), 400);
  assert.equal(hashState(a), hashState(b), "civilian wander broke determinism");
  const fresh = makeWorld({ seed: 1411 });
  const moved = a.civilians.filter((c, i) =>
    c.x !== fresh.civilians[i].x || c.y !== fresh.civilians[i].y).length;
  assert.ok(moved > a.civilians.length / 2,
    `a peopled street must MOVE: only ${moved}/${a.civilians.length} strolled in 400 ticks`);
});

test("civilians flee an alarmed site — the street empties around trouble", () => {
  let s = makeWorld({ seed: 4711 });
  // Alarm the site with the most civilians nearby, so the assertion has subjects.
  const radius = RULES.civilians.fleeRadius;
  const near = (site) => s.civilians.filter((c) =>
    Math.max(Math.abs(c.x - site.cellX), Math.abs(c.y - site.cellY)) <= radius);
  const site = [...s.sites].sort((p, q) => near(q).length - near(p).length)[0];
  const subjects = near(site).map((c) => c.id);
  assert.ok(subjects.length > 0, "fixture: no civilians near any site — reseat the test");
  const distBefore = new Map(s.civilians.map((c) => [c.id,
    Math.max(Math.abs(c.x - site.cellX), Math.abs(c.y - site.cellY))]));

  raiseAlarm(s, site, RULES.security.alarm, ALARM_LOCKDOWN, "test");
  // The MECHANISM first: within a few ticks the subjects are in the fleeing
  // state, which no amount of ordinary strolling ever sets. (The original
  // distance-only assertion passed with flee disabled — wandering also
  // disperses a cluster, so it proved nothing.)
  s = run(s, 10);
  const fleeing = subjects.filter((id) =>
    s.civilians.find((x) => x.id === id).fleeTicks > 0).length;
  assert.ok(fleeing > subjects.length / 2,
    `only ${fleeing}/${subjects.length} near the alarm entered the fleeing state`);
  s = run(s, 110);

  let fledFarther = 0;
  for (const id of subjects) {
    const c = s.civilians.find((x) => x.id === id);
    const d = Math.max(Math.abs(c.x - site.cellX), Math.abs(c.y - site.cellY));
    if (d > distBefore.get(id)) fledFarther += 1;
  }
  assert.ok(fledFarther > subjects.length / 2,
    `only ${fledFarther}/${subjects.length} civilians got farther from the alarmed site`);
});

test("civilians are DECORATION: never watchers, never emitters", () => {
  // Structural, on stripped source (guards must read code, not prose): the
  // module must not import detection, and must never push an event.
  const src = readFileSync(new URL("../engine/civilians.js", import.meta.url).pathname, "utf8")
    .replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Reading agent.detection (a burned operative IS trouble) is fine; what a
  // civilian must never do is IMPORT the perception machinery.
  assert.ok(!src.includes("detection.js"),
    "civilians.js imports detection — a civilian must never be a watcher");
  assert.ok(!src.includes("events.push"),
    "civilians.js emits events — decoration must stay silent");
});

test("the view sends the crowd as position + flight, nothing else", async () => {
  const { buildView } = await import("../engine/view.js");
  let s = makeWorld({ seed: 4711 });
  // Give firm 0 an eye: an active agent sees the streets around it.
  const { placeAgent } = await import("./helpers.js");
  const c0 = s.civilians[0];
  placeAgent(s, { cellX: c0.x, cellY: c0.y });
  const view = buildView(s, 0, RULES.detection);
  assert.ok(view.civilians.length > 0, "a civilian in plain sight is missing from the view");
  assert.deepEqual(Object.keys(view.civilians[0]).sort(),
    ["facing", "fleeing", "id", "x", "y"],
    "the civilian view leaked fields — targets and timers are nobody's business");
  // Out of sight, out of view: a firm with no eyes sees no crowd.
  const blind = buildView(s, 1, RULES.detection);
  assert.equal(blind.civilians.length, 0, "the crowd leaked through the fog");
});

test("civilians also flee a BURNED operative in the open — the other trouble half", () => {
  // The alarm half was tested from day one; this half (troubleSpots reads
  // agent.detection) shipped untested. It must be tested AWAY from sites:
  // near one, a burned operative trips the S16 alarm cascade and civilians
  // flee THAT, so the first version of this test stayed green with the
  // burned half deleted — passing for the wrong reason, again.
  let s = makeWorld({ seed: 4711 });
  const radius = RULES.civilians.fleeRadius;
  const farFromSites = (x, y) => s.sites.every((site) =>
    Math.abs(site.cellX - x) + Math.abs(site.cellY - y) > radius * 2 + 4);
  let spot = null;
  outer: for (let y = 2; y < s.size - 2; y++) {
    for (let x = 2; x < s.size - 2; x++) {
      if (farFromSites(x, y) && speedMultiplier(tileAt(s.map, x, y)) > 0) {
        spot = { x, y }; break outer;
      }
    }
  }
  assert.ok(spot, "fixture: no site-free ground on this seed");
  // Stage three civilians around the spot — the scenario, not the geography.
  const subjects = s.civilians.slice(0, 3).map((c) => {
    c.x = spot.x; c.y = spot.y;
    c.targetX = spot.x; c.targetY = spot.y; c.fleeTicks = 0;
    return c.id;
  });
  const agent = s.agents[0];
  agent.state = 1; agent.firmId = 0;
  agent.x = spot.x * 256 + 128; agent.y = spot.y * 256 + 128;
  agent.detection = 2;   // BURNED, in the open
  s.firms[0].state = 1;
  s = run(s, 10);
  const fleeing = subjects.filter((id) =>
    s.civilians.find((x) => x.id === id).fleeTicks > 0).length;
  assert.equal(fleeing, subjects.length,
    `only ${fleeing}/${subjects.length} civilians fled the burned operative`);
});
