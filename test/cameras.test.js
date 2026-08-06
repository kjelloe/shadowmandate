// test/cameras.test.js — sweeping camera cones (S16, M8 slice 8b).
//
// The design promises under test:
//   1. the sweep is DETERMINISTIC and CYCLICAL, so it can be learned and timed
//      (a stealth obstacle that fires randomly is a tax, not a puzzle);
//   2. a camera feeds the EXISTING detection currency rather than a second one;
//   3. the client is never handed the schedule — learning it by watching IS
//      the mechanic;
//   4. it mirrors correctly, in position AND facing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView } from "../engine/view.js";
import { mirrorState, POSITIONAL_FIELDS } from "../engine/mirror.js";
import { perceivedBy } from "../engine/detection.js";
import { alarmStageOf, stepAlarms, ALARM_LOCAL } from "../engine/security.js";
import {
  sweepSequence, cameraFacingAt, octantDistance, cameraCoversCell, camerasCovering,
} from "../engine/cameras.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const CAM_CFG = RULES.citygen.cameras;

function fixedCamera(over = {}) {
  return {
    id: 0, siteId: 0, districtId: 0, cellX: 10, cellY: 10,
    baseFacing: 0, span: 0, arc: 1, range: 6,
    dwellTicks: 10, phase: 0, disabledUntil: 0, ...over,
  };
}

// ── The sweep: learnable by construction ───────────────────────────────────

test("the sweep is a triangle wave that returns to where it started", () => {
  assert.deepEqual(sweepSequence(0), [0], "a span-0 camera must be fixed");
  assert.deepEqual(sweepSequence(1), [0, 1, 0, -1]);
  assert.deepEqual(sweepSequence(2), [0, 1, 2, 1, 0, -1, -2, -1]);
  // No repeated endpoints: a camera that lingered at the extremes would have an
  // uneven rhythm, which is much harder to time a crossing against.
  for (const span of [1, 2, 3]) {
    const seq = sweepSequence(span);
    assert.equal(new Set(seq).size, span * 2 + 1, `span ${span} visits an offset twice`);
  }
});

test("the facing is a pure function of the tick — same tick, same answer", () => {
  const cam = fixedCamera({ span: 2, dwellTicks: 7, phase: 3 });
  for (const t of [0, 1, 50, 999, 12345]) {
    assert.equal(cameraFacingAt(cam, t), cameraFacingAt(cam, t),
      "the sweep is not deterministic");
  }
  // And it CYCLES: a full period returns the same facing, which is what makes
  // "wait for the gap" a real plan rather than a guess.
  const period = sweepSequence(cam.span).length * cam.dwellTicks;
  for (const t of [0, 13, 400]) {
    assert.equal(cameraFacingAt(cam, t), cameraFacingAt(cam, t + period),
      "the sweep does not repeat on its own period — it cannot be learned");
  }
});

test("the facing is always a legal octant, including under a large phase", () => {
  const cam = fixedCamera({ span: 3, baseFacing: 6, phase: 5000, dwellTicks: 3 });
  for (let t = 0; t < 400; t++) {
    const f = cameraFacingAt(cam, t);
    assert.ok(Number.isInteger(f) && f >= 0 && f <= 7, `illegal facing ${f} at tick ${t}`);
  }
});

test("a fixed camera never moves, however long the world runs", () => {
  const cam = fixedCamera({ span: 0 });
  for (const t of [0, 5, 500, 50000]) assert.equal(cameraFacingAt(cam, t), cam.baseFacing);
});

test("octant distance is cyclic — 0 and 7 are neighbours, not opposites", () => {
  assert.equal(octantDistance(0, 7), 1);
  assert.equal(octantDistance(7, 0), 1);
  assert.equal(octantDistance(0, 4), 4);
  assert.equal(octantDistance(3, 3), 0);
});

// ── The cone ───────────────────────────────────────────────────────────────

test("the cone covers what it faces and not what is behind it", () => {
  const cam = fixedCamera({ baseFacing: 0, arc: 1, range: 6 });   // 0 = East
  assert.ok(cameraCoversCell(cam, 14, 10, 0), "did not see straight ahead");
  assert.ok(!cameraCoversCell(cam, 6, 10, 0), "saw directly behind itself");
});

test("range is Chebyshev, matching how an agent actually walks", () => {
  const cam = fixedCamera({ baseFacing: 0, arc: 4, range: 6 });   // arc 4 = all round
  assert.ok(cameraCoversCell(cam, 16, 10, 0), "missed a cell exactly at range");
  assert.ok(!cameraCoversCell(cam, 17, 10, 0), "saw past its range");
  // A circle would exclude the diagonal corner an 8-connected agent can stand on.
  assert.ok(cameraCoversCell(cam, 16, 16, 0), "the diagonal corner at range was a blind spot");
});

test("standing on the camera's own cell is never a hiding place", () => {
  const cam = fixedCamera({ baseFacing: 4 });
  assert.ok(cameraCoversCell(cam, cam.cellX, cam.cellY, 0),
    "hiding directly under the camera worked — a cone has no direction at zero distance");
});

test("a disabled camera sees nothing until its timer expires", () => {
  const cam = fixedCamera({ baseFacing: 0, disabledUntil: 100 });
  assert.ok(!cameraCoversCell(cam, 14, 10, 50), "a disabled camera still saw");
  assert.ok(cameraCoversCell(cam, 14, 10, 100), "the camera never came back");
});

test("a sweeping camera has a gap you can cross — the whole point of 8b", () => {
  // If a sweeping camera covered a cell at every tick of its cycle there would
  // be no timing puzzle at all, and the mechanism would just be a wall.
  const cam = fixedCamera({ baseFacing: 0, span: 2, arc: 1, range: 6, dwellTicks: 10 });
  const period = sweepSequence(cam.span).length * cam.dwellTicks;
  let covered = 0, clear = 0;
  for (let t = 0; t < period; t++) {
    if (cameraCoversCell(cam, 14, 10, t)) covered++; else clear++;
  }
  assert.ok(covered > 0, "the camera never sees the cell in front of it");
  assert.ok(clear > 0, "the cell is covered for the entire cycle — no gap to time");
});

// ── Feeding the existing detection currency ────────────────────────────────

test("a camera makes an agent perceived, through the SAME machine as a patrol", () => {
  const s = makeWorld();
  s.patrols = [];                                     // isolate the camera
  const agent = placeAgent(s, { cellX: 20, cellY: 20 });
  s.cameras = [fixedCamera({ cellX: 20, cellY: 20, siteId: s.sites[0].id })];
  const seen = perceivedBy(s, RULES.detection, RULES.agents, agent, 0);
  assert.ok(seen, "the camera did not register through perceivedBy");
  assert.equal(seen.siteId, s.sites[0].id, "the observer returned was not the camera");
});

test("a camera cannot HEAR — noise is a patrol affordance", () => {
  // A microphone would be a different mechanism with different counter-play.
  // Hurrying past a camera you are behind must stay safe.
  const s = makeWorld();
  s.patrols = [];
  const agent = placeAgent(s, { cellX: 20, cellY: 20, stance: 2 });   // hurry = loud
  s.cameras = [fixedCamera({ cellX: 26, cellY: 20, baseFacing: 0, arc: 1, range: 8 })];
  // Camera at x=26 looking EAST; the agent is to its WEST, i.e. behind it.
  assert.ok(!perceivedBy(s, RULES.detection, RULES.agents, agent, 0),
    "a camera heard a noisy agent standing behind it");
});

test("a camera raises its own site's alarm the moment it sees someone", () => {
  // The 8b -> 8a seam. A patrol seeing you is a person noticing; a camera
  // seeing you is the BUILDING noticing, and the building acts at once — no
  // waiting for the agent to be burned.
  const s = makeWorld();
  const site = s.sites[0];
  s.events = [{ type: "agentNoticed", agentId: 0, patrolId: -1, cameraId: 0, siteId: site.id }];
  stepAlarms(s, RULES.security.alarm);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL,
    "a camera contact did not wake the facility it belongs to");
});

test("a PATROL sighting does not raise a facility alarm on its own", () => {
  // Otherwise every patrol glance anywhere near a site would shut it, and the
  // distinction between a street and a facility disappears.
  const s = makeWorld();
  const site = s.sites[0];
  s.events = [{ type: "agentNoticed", agentId: 0, patrolId: 2, cameraId: -1, siteId: -1 }];
  stepAlarms(s, RULES.security.alarm);
  assert.equal(alarmStageOf(s, site.id), 0);
});

test("camera ids and patrol ids never share a field", () => {
  // Camera 3 and patrol 3 are different things. A consumer that guessed would
  // converge patrols on a camera's position.
  const s = makeWorld();
  s.patrols = [];
  const agent = placeAgent(s, { cellX: 20, cellY: 20 });
  s.cameras = [fixedCamera({ id: 3, cellX: 20, cellY: 20, siteId: s.sites[0].id })];
  const seen = perceivedBy(s, RULES.detection, RULES.agents, agent, 0);
  assert.equal(seen.id, 3);
  assert.equal(seen.siteId, s.sites[0].id, "no siteId to tell a camera apart by");
});

// ── Placement ──────────────────────────────────────────────────────────────

test("cameras exist in a generated city, but not on every site", () => {
  // Watching every site would remove the choice of which job to take; watching
  // none would ship the mechanism dead.
  const s = makeWorld();
  assert.ok(s.cameras.length > 0, "no cameras were placed at all — 8b is dead content");
  const watched = new Set(s.cameras.map((c) => c.siteId));
  assert.ok(watched.size < s.sites.length,
    "every site is watched — there is no longer a choice of which job to take");
  assert.ok(watched.size >= 1);
});

test("camera placement is deterministic for a seed", () => {
  const a = makeWorld({ seed: 4711 });
  const b = makeWorld({ seed: 4711 });
  assert.deepEqual(a.cameras, b.cameras, "the same seed produced different cameras");
  const other = makeWorld({ seed: 90210 });
  assert.notDeepEqual(a.cameras, other.cameras, "every seed produces the same cameras");
});

test("every camera stands off its site and has a legal definition", () => {
  const s = makeWorld();
  const siteById = new Map(s.sites.map((x) => [x.id, x]));
  for (const c of s.cameras) {
    const site = siteById.get(c.siteId);
    assert.ok(site, `camera ${c.id} belongs to no site`);
    const d = Math.max(Math.abs(c.cellX - site.cellX), Math.abs(c.cellY - site.cellY));
    assert.equal(d, CAM_CFG.standoff, `camera ${c.id} is not at its standoff distance`);
    assert.ok(c.cellX >= 0 && c.cellY >= 0 && c.cellX < s.size && c.cellY < s.size,
      `camera ${c.id} was placed off the map`);
    assert.ok(c.baseFacing >= 0 && c.baseFacing <= 7, "illegal base facing");
    assert.ok(c.range >= CAM_CFG.rangeMin && c.range <= CAM_CFG.rangeMax, "range out of config");
    assert.ok(c.dwellTicks > 0, "a dwell of 0 would divide by zero every tick");
    assert.ok(c.span >= CAM_CFG.spanMin && c.span <= CAM_CFG.spanMax);
  }
});

test("NO camera can ever see its own objective cell — at any point in its sweep", () => {
  // THE PROPERTY THE FIRST VERSION BROKE. Cameras were mounted on the objective
  // cell, where coverage is unconditional at distance 0: the site was watched
  // every tick, surveillance (which needs an unseen hold) could never complete
  // anywhere in the world, and the AI burned itself repeatedly trying.
  //
  // Checked across a FULL sweep cycle for every camera in several cities, so
  // widening `arc` or `spanMax` in data cannot silently make site work
  // impossible again — the data note says the same thing, but a note is not a
  // guard.
  for (const seed of [4711, 90210, 1548]) {
    const s = makeWorld({ seed });
    const siteById = new Map(s.sites.map((x) => [x.id, x]));
    for (const c of s.cameras) {
      const site = siteById.get(c.siteId);
      const period = sweepSequence(c.span).length * c.dwellTicks;
      for (let t = 0; t < period; t++) {
        assert.ok(!cameraCoversCell(c, site.cellX, site.cellY, t),
          `seed ${seed}: camera ${c.id} covers its own site at tick ${t} — `
          + "the objective can never be worked unseen");
      }
    }
  }
});

// ── The view seam ──────────────────────────────────────────────────────────

test("the view NEVER carries the sweep schedule", () => {
  // With span/dwell/phase a client computes every future safe window and plays
  // the stealth layer perfectly without looking at it. Learning the pattern by
  // watching is the mechanic; being handed it is the mechanic deleted.
  const s = makeWorld();
  const cam = s.cameras[0];
  placeAgent(s, { cellX: cam.cellX, cellY: cam.cellY });
  const view = buildView(s, 0, RULES.detection);
  const row = view.cameras.find((c) => c.id === cam.id);
  assert.ok(row, "a camera the agent is standing on was not in the view");
  for (const leak of ["span", "dwellTicks", "phase", "baseFacing", "disabledUntil"]) {
    assert.equal(row[leak], undefined, `the view leaks "${leak}" — the sweep is solvable offline`);
  }
  assert.equal(typeof row.facing, "number", "the client cannot draw a cone it is not told about");
});

test("a camera the Firm cannot see is not in the view at all", () => {
  const s = makeWorld();
  const cam = s.cameras[0];
  const far = s.cameras.find((c) =>
    Math.abs(c.cellX - cam.cellX) > 40 || Math.abs(c.cellY - cam.cellY) > 40);
  placeAgent(s, { cellX: cam.cellX, cellY: cam.cellY });
  const view = buildView(s, 0, RULES.detection);
  assert.ok(view.cameras.some((c) => c.id === cam.id));
  if (far) {
    assert.ok(!view.cameras.some((c) => c.id === far.id),
      "a camera across the map crossed the wire — the fog is not applied");
  }
});

// ── Mirror ─────────────────────────────────────────────────────────────────

test("MIRROR: a camera reflects in position AND in facing", () => {
  // Reflecting the cell but not the facing builds a world that LOOKS symmetric
  // and PLAYS asymmetrically — exactly the silent corruption a fairness battery
  // would then be measuring instead of ruling out.
  const s = makeWorld();
  const m = mirrorState(s);
  assert.equal(m.cameras.length, s.cameras.length);
  const width = s.size;
  for (const [i, c] of s.cameras.entries()) {
    assert.equal(m.cameras[i].cellX, width - 1 - c.cellX, "camera position did not mirror");
    assert.equal(m.cameras[i].cellY, c.cellY);
  }
  const east = s.cameras.find((c) => c.baseFacing === 0);
  if (east) {
    const idx = s.cameras.indexOf(east);
    assert.equal(m.cameras[idx].baseFacing, 4, "an east-facing camera did not mirror to west");
  }
});

test("MIRROR AUDIT knows about cameras", () => {
  assert.ok(POSITIONAL_FIELDS.cameras, "cameras are not declared positional — batteries would rot");
  assert.ok(POSITIONAL_FIELDS.cameras.includes("cellX"));
});

test("mirroring does not share camera objects with the original", () => {
  const s = makeWorld();
  const m = mirrorState(s);
  m.cameras[0].disabledUntil = 999;
  assert.equal(s.cameras[0].disabledUntil, 0,
    "the mirror shares camera objects with its twin — one world can mutate the other");
});
