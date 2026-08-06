// engine/cameras.js — sweeping camera cones (S16, M8 slice 8b).
//
// A camera is the first thing in the game that can see you which is not a
// person. Per S16 it feeds the EXISTING detection currency rather than inventing
// a second one: being caught on camera makes you noticed, then burned, through
// the same machine patrols already drive. A parallel "camera suspicion" track
// would have doubled every balance question for no design gain.
//
// DETERMINISTIC AND CYCLICAL, because a stealth obstacle that fires randomly is
// a tax rather than a puzzle (S16). The sweep is a pure function of `state.tick`
// and the camera's own static fields — the current facing is DERIVED, never
// stored, so it cannot drift from the tick it describes and adds nothing to the
// state hash beyond the camera's fixed definition.
//
// A LEAF MODULE ON PURPOSE. It imports only `octantFor` from agents.js (which
// imports no detection code), so `detection.js` can import THIS without a cycle.
// The line-of-sight check deliberately stays in detection.js, which already owns
// it — duplicating a visibility walk is how two surfaces come to disagree about
// what can be seen.

import { octantFor } from "./agents.js";

// A camera's sweep, as a triangle wave over octant offsets. Expressed as a
// sequence rather than as trigonometry because the whole point is that a player
// can LEARN it: "it looks left, centre, right, centre" is a pattern you can
// time a crossing against. It is also exact in integers, which the engine
// requires (no floats in engine/).
//
//   span 0 -> [0]                     a fixed camera
//   span 1 -> [0, 1, 0, -1]           45 degrees each way
//   span 2 -> [0, 1, 2, 1, 0, -1, -2, -1]
export function sweepSequence(span) {
  if ((span | 0) <= 0) return [0];
  const s = span | 0;
  const seq = [];
  for (let i = 0; i <= s; i++) seq.push(i);
  for (let i = s - 1; i >= -s; i--) seq.push(i);
  for (let i = -s + 1; i < 0; i++) seq.push(i);
  return seq;
}

// Where the camera is looking on a given tick. `phase` staggers cameras so a
// facility's cameras do not all sweep in lockstep — synchronised cameras leave
// one global safe moment, which is a much weaker puzzle than several
// overlapping ones.
export function cameraFacingAt(cam, tick) {
  const seq = sweepSequence(cam.span);
  const dwell = Math.max(1, cam.dwellTicks | 0);
  const step = Math.trunc((Math.max(0, tick | 0) + (cam.phase | 0)) / dwell);
  // `% seq.length` after a non-negative trunc: no negative-modulo surprise.
  const offset = seq[step % seq.length];
  return (((cam.baseFacing | 0) + offset) % 8 + 8) % 8;
}

// Cyclic distance between two octants: 0 and 7 are neighbours.
export function octantDistance(a, b) {
  const d = Math.abs((a | 0) - (b | 0)) % 8;
  return Math.min(d, 8 - d);
}

export function isDisabled(cam, tick) {
  return (cam.disabledUntil | 0) > (tick | 0);
}

// Does the cone cover this cell? Range and arc only — the caller does the
// line-of-sight walk, so a camera cannot see through building mass.
//
// Chebyshev range, matching how movement works: an 8-connected world measured
// with a circle would lie about the corners.
export function cameraCoversCell(cam, cellX, cellY, tick) {
  if (isDisabled(cam, tick)) return false;
  const dx = (cellX | 0) - (cam.cellX | 0);
  const dy = (cellY | 0) - (cam.cellY | 0);
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  // Standing directly under a camera is always covered: a cone has no direction
  // at zero distance, and "hide on the camera's own cell" would be a silly
  // exploit to leave open.
  if (dist === 0) return true;
  if (dist > (cam.range | 0)) return false;
  const oct = octantFor(Math.sign(dx), Math.sign(dy));
  return octantDistance(oct, cameraFacingAt(cam, tick)) <= (cam.arc | 0);
}

// Every camera at a site, in id order. Deterministic iteration matters: the
// FIRST camera to see an agent is reported, and a Map iteration order surprise
// would change which one that is, and therefore the event stream.
export function camerasAtSite(state, siteId) {
  return (state.cameras ?? []).filter((c) => c.siteId === siteId);
}

// The cameras covering a cell right now, cone and range only. Callers add LOS.
export function camerasCovering(state, cellX, cellY, tick) {
  const out = [];
  for (const cam of state.cameras ?? []) {
    if (cameraCoversCell(cam, cellX, cellY, tick)) out.push(cam);
  }
  return out;
}

// The eight cell-offsets of the octants, indexed to match `octantFor`:
// 0=E 1=NE 2=N 3=NW 4=W 5=SW 6=S 7=SE.
const OCTANT_STEP = [
  [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1],
];

// Placement, called from citygen so world LAYOUT stays in one place.
//
// TWO RULES, BOTH LEARNED THE HARD WAY (see dev-log, 8b):
//
// 1. Only a fraction of sites are watched. A city where every contract site is
//    watched removes the choice of which job to take, and D42 wants opposition
//    to make SOME contracts harder rather than all of them uniformly harder.
//
// 2. A camera stands OFF the site and looks AWAY from it, watching the
//    approach. The first version mounted cameras on the objective cell itself,
//    where `cameraCoversCell` returns true at distance 0 on every tick — so the
//    site was permanently observed, surveillance (which requires an unseen
//    hold) could never complete anywhere, and the AI burned itself repeatedly
//    trying. A camera with no gap in its cycle is a wall, not a puzzle.
//
// The geometry makes that a PROVABLE property rather than a hope: the camera
// faces directly away from the site, so the site sits at facing+4 octants. With
// `arc` 1 and `span` at most 2 the cone reaches 3 octants from the site at its
// nearest, and can never contain it. `test/cameras.test.js` asserts it for
// every camera in a generated city, so widening the arc or span in data cannot
// silently make site work impossible again.
export function placeCameras(sites, rng, cfg, roll, size = 0) {
  const cameras = [];
  if (!cfg || (cfg.perSite | 0) <= 0) return cameras;
  const standoff = Math.max(1, cfg.standoff | 0);
  for (const site of sites) {
    // Deterministic from the seeded stream, so a seed always produces the same
    // watched facilities.
    if (roll(rng, 1, 100) > (cfg.sitePercent | 0)) continue;
    const count = roll(rng, 1, cfg.perSite | 0);
    for (let i = 0; i < count; i++) {
      // Which way out from the site this camera is mounted; it then looks back
      // out along that same direction, i.e. away from the objective.
      const out = roll(rng, 0, 7);
      const [sx, sy] = OCTANT_STEP[out];
      const cellX = site.cellX + sx * standoff;
      const cellY = site.cellY + sy * standoff;
      // Off the map is not a camera position. Skipping keeps placement honest
      // rather than clamping several cameras onto the same edge cell.
      if (size > 0 && (cellX < 0 || cellY < 0 || cellX >= size || cellY >= size)) continue;
      cameras.push({
        id: cameras.length,
        siteId: site.id,
        districtId: site.districtId,
        cellX, cellY,
        baseFacing: out,
        span: roll(rng, cfg.spanMin | 0, cfg.spanMax | 0),
        arc: cfg.arc | 0,
        range: roll(rng, cfg.rangeMin | 0, cfg.rangeMax | 0),
        dwellTicks: roll(rng, cfg.dwellMin | 0, cfg.dwellMax | 0),
        // Stagger, so a facility's cameras do not sweep as one: synchronised
        // cameras leave one global safe moment, a much weaker puzzle than
        // several overlapping ones.
        phase: roll(rng, 0, 200),
        disabledUntil: 0,
      });
    }
  }
  return cameras;
}
