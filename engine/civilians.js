// engine/civilians.js — ambient city life (S17, D64 delegated).
//
// Civilians are ENGINE entities so every client and every AI Firm sees the
// same crowd — a "person" only some observers can see is the lie the honesty
// rule refuses — but they PARTICIPATE in nothing: never watchers (this file
// must never import detection), never targets (D6 has nothing to say to
// them), never obstacles. They walk short seeded wanders, and they FLEE
// trouble: an alarmed site, or a burned operative in the open. Their whole
// job is that a street full of them reads as a city, and a street they are
// running from reads as trouble before the HUD says so.
//
// Doctrine holds: deterministic (their randomness derives from worldSeed +
// their own id + a wander counter — no draw on the shared rng stream, so
// adding them shifted no other system's rolls), integer cells, pure.

import { speedMultiplier } from "./terrain.js";
import { mix32, seedSfc32, sfc32Next } from "../shared/prng.js";

const rngFor = (worldSeed, a, b) =>
  ({ s: seedSfc32(mix32(((worldSeed | 0) ^ Math.imul((a | 0) + 1, 0x9e3779b1) ^ Math.imul((b | 0) + 1, 0x85ebca6b)) >>> 0)) });
function nextU32(rng) {
  const r = sfc32Next(rng.s);
  rng.s = r.nextState;
  return r.value >>> 0;
}
function roll(rng, lo, hi) {
  if (hi <= lo) return lo;
  return (lo + (nextU32(rng) % ((hi - lo + 1) >>> 0))) | 0;
}

function walkable(state, x, y) {
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return false;
  // Direct map indexing rather than state.js's tileAt: this module is
  // imported BY state.js for the spawn, and importing back would cycle.
  const t = state.map.cells[y * state.map.width + x];
  if (t === undefined || speedMultiplier(t) <= 0) return false;
  if (state.reachable && !state.reachable[y * state.size + x]) return false;
  return true;
}

// Seat the crowd at world creation: perDistrict walkers, each on a walkable
// cell near its district core. A district with no room seats fewer — honest,
// and the count is asserted loosely for exactly this reason.
export function spawnCivilians(state, cfg) {
  const out = [];
  for (const d of state.districts) {
    for (let n = 0; n < (cfg.perDistrict | 0); n++) {
      const rng = rngFor(state.worldSeed, d.id, n);
      let spot = null;
      for (let tries = 0; tries < 24 && !spot; tries++) {
        const x = d.coreX + roll(rng, -8, 8), y = d.coreY + roll(rng, -8, 8);
        if (walkable(state, x, y)) spot = { x, y };
      }
      if (!spot) continue;
      out.push({
        id: out.length, districtId: d.id,
        x: spot.x, y: spot.y,
        targetX: spot.x, targetY: spot.y,
        wander: 0, fleeTicks: 0, facing: 6,
      });
    }
  }
  return out;
}

// What a civilian runs from — the ALARM half is supplied by the reducer
// (which already knows the security layer); importing security here would
// close a cycle back through detection into state.js. The burned-operative
// half is plain agent state.
export function troubleSpots(state, alarmedSiteCells) {
  const spots = [...alarmedSiteCells];
  for (const a of state.agents) {
    if (a.state === 1 && a.detection === 2
      && a.insideBuildingId < 0 && a.insideAreaId < 0) {
      spots.push({ x: Math.trunc(a.x / 256), y: Math.trunc(a.y / 256) });
    }
  }
  return spots;
}

export function stepCivilians(state, cfg, alarmedSiteCells = []) {
  if (!state.civilians?.length) return;
  const spots = troubleSpots(state, alarmedSiteCells);
  const radius = cfg.fleeRadius | 0;
  for (const c of state.civilians) {
    // Flee check first: trouble overrides whatever stroll was happening.
    for (const t of spots) {
      if (Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) <= radius) {
        c.fleeTicks = cfg.fleeHoldTicks | 0;
        // Away from the trouble, as far as the flee radius again; the walker
        // below routes around whatever is in the way, one axis at a time.
        c.targetX = Math.max(0, Math.min(state.size - 1,
          c.x + Math.sign(c.x - t.x || 1) * radius));
        c.targetY = Math.max(0, Math.min(state.size - 1,
          c.y + Math.sign(c.y - t.y || 1) * radius));
        break;
      }
    }
    // Cadence: a stroll steps rarely, a flight often. Phased by id so the
    // whole crowd never steps on the same tick.
    const every = c.fleeTicks > 0 ? (cfg.fleeEveryTicks | 0) : (cfg.walkEveryTicks | 0);
    if ((state.tick + c.id) % Math.max(1, every) !== 0) continue;
    if (c.fleeTicks > 0) c.fleeTicks -= 1;

    const dx = Math.sign(c.targetX - c.x), dy = Math.sign(c.targetY - c.y);
    if (dx !== 0 && walkable(state, c.x + dx, c.y)) {
      c.x += dx; c.facing = dx > 0 ? 0 : 4;
    } else if (dy !== 0 && walkable(state, c.x, c.y + dy)) {
      c.y += dy; c.facing = dy > 0 ? 6 : 2;
    } else if (dx !== 0 || dy !== 0) {
      // Boxed in: give up on this destination and stroll somewhere else.
      c.targetX = c.x; c.targetY = c.y;
    }
    if (c.x === c.targetX && c.y === c.targetY && c.fleeTicks === 0) {
      // Arrived: pick the next stroll from the civilian's OWN stream.
      c.wander = (c.wander + 1) | 0;
      const rng = rngFor(state.worldSeed, 0x0c1f + c.id, c.wander);
      for (let tries = 0; tries < 8; tries++) {
        const nx = c.x + roll(rng, -(cfg.wanderRadius | 0), cfg.wanderRadius | 0);
        const ny = c.y + roll(rng, -(cfg.wanderRadius | 0), cfg.wanderRadius | 0);
        if (walkable(state, nx, ny)) { c.targetX = nx; c.targetY = ny; break; }
      }
    }
  }
}
