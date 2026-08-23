// test/daynight.test.js — the light cycle (D63a).
//
// The ruled 30%: at night, WATCHERS see shorter — patrol sight and camera
// range both, through the ONE shared sightPctAt. The agent's own senses are
// untouched. What is protected here:
//   - the derived clock: phases, boundaries, dormancy-safe wrap-around;
//   - a patrol that sees an agent by day MISSES the same agent at night at
//     the same distance (the actual gameplay promise, not an arithmetic echo);
//   - a camera's reach shortens identically — the two watcher classes cannot
//     disagree about what night means;
//   - the view reports the phase, so the client never duplicates the maths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lightPhase, sightPctAt } from "../engine/season.js";
import { perceivedBy } from "../engine/detection.js";
import { cameraCoversCell } from "../engine/cameras.js";
import { buildView } from "../engine/view.js";
import { makeWorld, placeAgent, quietCell, RULES } from "./helpers.js";

const DN = RULES.season.dayNight;

test("the light clock is derived, bounded, and wraps like dormancy needs it to", () => {
  assert.ok(DN, "no dayNight config — D63a never shipped");
  const cycle = DN.dayTicks + DN.nightTicks;
  assert.deepEqual(lightPhase(0, DN), { night: 0, phaseMille: 0 });
  assert.equal(lightPhase(DN.dayTicks, DN).night, 1, "dusk is the first night tick");
  assert.equal(lightPhase(cycle - 1, DN).night, 1);
  assert.equal(lightPhase(cycle, DN).night, 0, "dawn wraps");
  // A dormancy jump of many cycles lands on the same phase as the remainder.
  assert.deepEqual(lightPhase(cycle * 900 + 123, DN), lightPhase(123, DN));
  assert.equal(sightPctAt(0, DN), 100);
  assert.equal(sightPctAt(DN.dayTicks, DN), DN.nightSightPct);
  assert.equal(sightPctAt(0, null), 100, "a world without the config sees normally");
});

// A patrol and an agent on open ground with clear line of sight, at a
// distance inside day sight but outside the ruled 70%.
function watcherWorld() {
  const s = makeWorld({ seed: 4711 });
  const base = RULES.detection.patrolSightRadius;
  const nightR = Math.trunc((base * DN.nightSightPct) / 100);
  assert.ok(nightR < base, "precondition: the factor must actually shorten sight");
  const spot = quietCell(s) ?? { x: 8, y: 8 };
  // Flat open ground for the whole line: rewrite a strip of tiles to street.
  for (let dx = 0; dx <= base + 1; dx++) s.map.cells[spot.y * s.size + spot.x + dx] = 1;
  placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
  const agent = s.agents[0];
  agent.stance = 1;                                  // MOVE: no stance bonus
  const d = nightR + 1;                              // inside day, outside night
  assert.ok(d <= base, "the probe distance must still be inside DAY sight");
  s.patrols = [{ id: 0, x: spot.x + d, y: spot.y, alertTicks: 0, stunnedUntil: 0 }];
  return { s, agent };
}

test("a patrol that sees you by day misses you at night — the ruled 30%", () => {
  const { s, agent } = watcherWorld();
  s.tick = 100;                                       // day
  assert.ok(perceivedBy(s, RULES.detection, RULES.agents, agent, 0),
    "by day the patrol must see the agent (precondition)");
  s.tick = DN.dayTicks + 100;                         // night
  assert.equal(perceivedBy(s, RULES.detection, RULES.agents, agent, 0), null,
    "at night the same patrol at the same distance must MISS — or D63a did nothing");
});

test("a camera's reach shortens identically at night", () => {
  const cam = { cellX: 10, cellY: 10, range: 10, arc: 1, facing: 0,
    disabledUntil: 0, spanTicks: 0, dwellTicks: 1, phase: 0, sweep: [0] };
  // At the day edge: covered by day, out of reach at the night pct.
  const edge = 10, nightEdge = Math.trunc((10 * DN.nightSightPct) / 100);
  assert.ok(cameraCoversCell(cam, 10 + edge, 10, 0, 100), "day edge must be covered");
  assert.ok(!cameraCoversCell(cam, 10 + edge, 10, 0, DN.nightSightPct),
    "the day edge must fall outside the night reach");
  assert.ok(cameraCoversCell(cam, 10 + nightEdge, 10, 0, DN.nightSightPct),
    "the night edge itself is still covered");
});

test("the view reports the phase so the client never re-derives it", () => {
  const s = makeWorld({ seed: 4711 });
  s.tick = 100;
  assert.equal(buildView(s, 0, RULES.detection).night, 0);
  s.tick = DN.dayTicks + 100;
  const v = buildView(s, 0, RULES.detection);
  assert.equal(v.night, 1);
  assert.ok(v.phaseMille >= 0 && v.phaseMille < 1000);
});
