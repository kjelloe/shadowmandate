// test/sensors.test.js — sensor beams (S16, M8 slice 8c).
//
// The mechanism whose counter-play is PURE TIMING, so the properties that
// matter are: there IS a gap, the gap is learnable, and the gap is not readable
// off the wire. Plus the lesson 8b paid for: a security fixture must never make
// the objective itself unworkable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { buildView } from "../engine/view.js";
import { mirrorState, POSITIONAL_FIELDS } from "../engine/mirror.js";
import { hashState } from "../engine/snapshot.js";
import { stepAlarms, alarmStageOf, ALARM_LOCAL } from "../engine/security.js";
import { beamLiveAt, ticksUntilDark, beamCells, beamCoversCell } from "../engine/sensors.js";
import { makeWorld, placeAgent, RULES, tickCollecting } from "./helpers.js";

const CFG = RULES.security.alarm;
const BEAM_CFG = RULES.citygen.beams;

const beam = (over = {}) => ({
  id: 0, siteId: 0, districtId: 0,
  cellX: 10, cellY: 10, toX: 14, toY: 10,
  onTicks: 60, offTicks: 30, phase: 0, disabledUntil: 0, ...over,
});

// ── The cycle ──────────────────────────────────────────────────────────────

test("a beam cycles on and off deterministically", () => {
  const b = beam({ onTicks: 3, offTicks: 2, phase: 0 });
  const seen = [];
  for (let t = 0; t < 10; t++) seen.push(beamLiveAt(b, t) ? 1 : 0);
  assert.deepEqual(seen, [1, 1, 1, 0, 0, 1, 1, 1, 0, 0], "the cycle is not a clean square wave");
});

test("EVERY beam has a gap — a beam with no gap is a wall", () => {
  // The counter-play IS the gap. `offMin` of 0 would produce a permanently live
  // beam, which is not a timing puzzle but an impassable line.
  assert.ok(BEAM_CFG.offMin > 0,
    "beams can be configured never to go dark, which removes the only counter-play they have");
  const s = makeWorld();
  for (const b of s.beams) {
    assert.ok(b.offTicks > 0, `beam ${b.id} is never dark`);
    assert.ok(b.onTicks > 0, `beam ${b.id} is never live — it is decoration`);
  }
});

test("the gap is long enough to actually cross", () => {
  // FOUND BY THIS TEST, at offMin 25. Crossing a beam means stepping INTO its
  // cell and out again — two cell-moves, ~28 ticks each at baseSpeed 9. A dark
  // window shorter than that can never be used, so the beam would read as a
  // random punishment rather than as something to time, which is the one thing
  // a timing mechanism must not be. Checked against baseSpeed rather than a
  // literal so a movement retune cannot silently make every beam uncrossable.
  const ticksPerCell = Math.trunc(256 / RULES.agents.baseSpeed);
  assert.ok(BEAM_CFG.offMin >= ticksPerCell * 2,
    `the dark window (${BEAM_CFG.offMin} ticks) is shorter than the two cells of `
    + `movement a crossing takes (${ticksPerCell * 2}) — nobody can finish it`);
});

test("ticksUntilDark tells the truth, and says -1 when there is no dark", () => {
  const b = beam({ onTicks: 5, offTicks: 3, phase: 0 });
  assert.equal(ticksUntilDark(b, 0), 5);
  assert.equal(ticksUntilDark(b, 4), 1);
  assert.equal(ticksUntilDark(b, 5), 0, "already dark should report 0");
  assert.equal(ticksUntilDark(beam({ offTicks: 0 }), 0), -1);
});

test("a disabled beam is dark, whatever its cycle says", () => {
  const b = beam({ onTicks: 100, offTicks: 1, disabledUntil: 50 });
  assert.equal(beamLiveAt(b, 10), false);
  assert.equal(beamLiveAt(b, 50), true, "the beam never came back after its disable expired");
});

test("phase staggers beams so a facility does not blink as one", () => {
  // Synchronised beams leave a single global safe moment, a much weaker puzzle
  // than several overlapping ones.
  const a = beam({ onTicks: 4, offTicks: 4, phase: 0 });
  const b = beam({ onTicks: 4, offTicks: 4, phase: 4 });
  let differed = false;
  for (let t = 0; t < 8; t++) if (beamLiveAt(a, t) !== beamLiveAt(b, t)) differed = true;
  assert.ok(differed, "phase does nothing — every beam blinks together");
});

// ── Geometry ───────────────────────────────────────────────────────────────

test("a beam occupies an exact integer cell list, endpoints included", () => {
  assert.deepEqual(beamCells(beam({ cellX: 2, cellY: 5, toX: 5, toY: 5 })).map((c) => c.x),
    [2, 3, 4, 5]);
  const diag = beamCells(beam({ cellX: 0, cellY: 0, toX: 3, toY: 3 }));
  assert.deepEqual(diag, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
  assert.ok(beamCoversCell(beam(), 12, 10));
  assert.ok(!beamCoversCell(beam(), 12, 11));
});

test("NO beam crosses the objective cell it guards", () => {
  // The lesson 8b paid for: a fixture laid over the objective makes the WORK
  // impossible rather than the APPROACH interesting.
  for (const seed of [4711, 90210, 1548]) {
    const s = makeWorld({ seed });
    const siteById = new Map(s.sites.map((x) => [x.id, x]));
    for (const b of s.beams) {
      const site = siteById.get(b.siteId);
      assert.ok(!beamCoversCell(b, site.cellX, site.cellY),
        `seed ${seed}: beam ${b.id} runs through its own objective cell`);
    }
  }
});

test("beams are placed, on some sites, deterministically", () => {
  const s = makeWorld();
  assert.ok(s.beams.length > 0, "no beams placed at all — 8c is dead content");
  const guarded = new Set(s.beams.map((b) => b.siteId));
  assert.ok(guarded.size < s.sites.length, "every site is beamed — no choice of job left");
  assert.deepEqual(makeWorld({ seed: 4711 }).beams, makeWorld({ seed: 4711 }).beams);
});

test("no beam is placed off the map", () => {
  for (const seed of [4711, 90210]) {
    const s = makeWorld({ seed });
    for (const b of s.beams) {
      for (const c of beamCells(b)) {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x < s.size && c.y < s.size,
          `beam ${b.id} leaves the map at ${c.x},${c.y}`);
      }
    }
  }
});

// ── Tripping ───────────────────────────────────────────────────────────────

test("standing in a LIVE beam trips the facility alarm", () => {
  const s = makeWorld();
  const site = s.sites[0];
  const b = beam({ siteId: site.id, cellX: 20, cellY: 20, toX: 24, toY: 20, offTicks: 0 });
  s.beams = [b];
  placeAgent(s, { cellX: 22, cellY: 20 });
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL, "a live beam did not trip");
  assert.ok(s.events.some((e) => e.type === "beamTripped"),
    "the trip was silent — the client has nothing to show or sound");
});

test("a DARK beam is safe to walk through — that is the whole mechanism", () => {
  const s = makeWorld();
  const site = s.sites[0];
  s.beams = [beam({ siteId: site.id, cellX: 20, cellY: 20, toX: 24, toY: 20, onTicks: 0, offTicks: 10 })];
  placeAgent(s, { cellX: 22, cellY: 20 });
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), 0, "a dark beam still tripped — there is no gap to use");
});

test("a beam does NOT change your detection state — it knows something, not who", () => {
  // The texture that distinguishes a beam from a camera: you can trip a beam
  // and still be unseen, which is what makes "trip it and hurry" a real choice.
  const s = makeWorld();
  const site = s.sites[0];
  s.beams = [beam({ siteId: site.id, cellX: 20, cellY: 20, toX: 24, toY: 20, offTicks: 0 })];
  const agent = placeAgent(s, { cellX: 22, cellY: 20 });
  agent.detection = 0;
  stepAlarms(s, CFG);
  assert.equal(agent.detection, 0, "a beam burned the agent — it cannot see, only notice a crossing");
});

test("an agent inside a building trips nothing", () => {
  const s = makeWorld();
  const site = s.sites[0];
  s.beams = [beam({ siteId: site.id, cellX: 20, cellY: 20, toX: 24, toY: 20, offTicks: 0 })];
  const agent = placeAgent(s, { cellX: 22, cellY: 20 });
  agent.insideBuildingId = 0;
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), 0);
});

// ── Seams ──────────────────────────────────────────────────────────────────

test("the view shows a beam and whether it is live, never its cycle", () => {
  const s = makeWorld();
  const b = s.beams[0];
  placeAgent(s, { cellX: b.cellX, cellY: b.cellY });
  const view = buildView(s, 0, RULES.detection);
  const row = view.beams.find((x) => x.id === b.id);
  assert.ok(row, "a beam under the agent's feet was not in the view");
  assert.equal(typeof row.live, "number");
  for (const leak of ["onTicks", "offTicks", "phase", "disabledUntil"]) {
    assert.equal(row[leak], undefined, `the view leaks "${leak}" — the timing is solvable offline`);
  }
});

test("MIRROR: both ends of a beam reflect", () => {
  const s = makeWorld();
  const m = mirrorState(s);
  const width = s.size;
  for (const [i, b] of s.beams.entries()) {
    assert.equal(m.beams[i].cellX, width - 1 - b.cellX);
    assert.equal(m.beams[i].toX, width - 1 - b.toX, "a beam's far end did not mirror");
  }
  assert.deepEqual(POSITIONAL_FIELDS.beams, ["cellX", "toX"]);
});

test("beams are hashed, and survive the reducer's deep copy", () => {
  const s = makeWorld();
  const before = hashState(s);
  s.beams[0].disabledUntil = 500;
  assert.notEqual(hashState(s), before, "a beam's disabled state is not hashed");
  const stepped = tickCollecting(s, apply, 2).state;
  assert.equal(stepped.beams.length, s.beams.length, "beams did not survive copyState");
  assert.equal(stepped.beams[0].disabledUntil, 500);
});
