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
  s = run(s, 120);

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
