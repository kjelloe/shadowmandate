// engine/areas.js — mission areas (S17, D63c/D64): the playable INSIDE of
// extraction and surveillance contracts.
//
// An area is a LIVE SHARED SPACE on the same world tick — never a modal
// (D45 as revised): any agent at the site can enter the same area, to work
// it, help, or sabotage (PvP takedowns are ruled IN). Compound scale (D64):
// 24x16 with courtyards between walled wings.
//
// Doctrine holds everywhere: pure and deterministic, integer maths, seeded
// from (worldSeed, siteId) so every client and every replay grows the same
// compound; disable-only (D6) — a takedown puts a guard DOWN, nothing is
// ever deleted; detection inside feeds the SAME ladder and the district's
// heat, so a blown area is a blown street presence.
//
// THE GRID IS DERIVED, NEVER STORED (the season-clock pattern): only the
// mutable things — guards, terminals, alarm — live in state, so the hash
// stays small and the four-places rule touches only what actually changes.

import { mix32, seedSfc32, sfc32Next } from "../shared/prng.js";
import { findPath } from "./pathfind.js";
import { hasLineOfSight, burnAgent, decayDetection } from "./detection.js";
import { sightPctAt } from "./season.js";
import { hasCredential } from "./access.js";
import {
  AGENT_ACTIVE, AGENT_DOWNED, DET_UNSEEN, DET_NOTICED, DET_BURNED,
} from "./state.js";

// Area tile ids reuse the street vocabulary where it fits (data note):
// 0 open court, 1 corridor, 4 wall (blocks movement AND sight), 5 door,
// 8 cover crates.
export const AT_COURT = 0, AT_CORRIDOR = 1, AT_WALL = 4, AT_DOOR = 5, AT_COVER = 8;

// Carrying the extraction asset out is the work (S17 AR-a).
export const CARRY_AREA_ASSET = 7;

// sfc32Next is PURE ({value, nextState}) — the box advances the state the
// same way citygen's nextU32 does.
const rngFor = (worldSeed, siteId, salt) =>
  ({ s: seedSfc32(mix32(((worldSeed | 0) ^ Math.imul((siteId | 0) + 1, 0x9e3779b1) ^ salt) >>> 0)) });
function nextU32(rng) {
  const r = sfc32Next(rng.s);
  rng.s = r.nextState;
  return r.value >>> 0;
}
function roll(rng, lo, hi) {
  if (hi <= lo) return lo;
  return (lo + (nextU32(rng) % ((hi - lo + 1) >>> 0))) | 0;
}

// ── Interior templates (playtest 13, finding 6) ────────────────────────────
// "The interior was generic, did not look like even a big warehouse. We need
// templates for what the buildings are."
//
// The vocabulary already existed and nothing used it: SITE_TYPE_COUNT is 6 and
// every site has carried a type since M1 — a vault, a lab, a transit depot —
// which the STREET marker has rendered faithfully since playtest 5 while the
// inside of all six was the same walled yard with wings. A player walked into a
// vault and a warehouse and could not tell which one they were in.
//
// Four templates, mapped from the site type. They differ in the thing that
// actually reads from a 45-degree camera — the FLOOR PLAN — rather than in
// decoration: a warehouse is long racking aisles you break line of sight
// behind, an office is a corridor spine with cellular rooms, industrial is an
// open yard around a plant block, transit is parallel loading bays.
export const AREA_WAREHOUSE = 0, AREA_OFFICE = 1, AREA_INDUSTRIAL = 2, AREA_TRANSIT = 3;

// Site types (engine/citygen.js order): 0 cache, 1 vault, 2 lab, 3 relay,
// 4 transit, 5 warehouse. A cache is a depot and a lab is a building full of
// rooms, so both fold onto the plan that fits them.
const TEMPLATE_BY_SITE_TYPE = [
  AREA_WAREHOUSE,   // cache
  AREA_OFFICE,      // vault
  AREA_OFFICE,      // lab
  AREA_INDUSTRIAL,  // relay
  AREA_TRANSIT,     // transit
  AREA_WAREHOUSE,   // warehouse
];

// DERIVED FROM THE SITE, so the compound you walk into matches the marker you
// walked to. A site with no type falls to the warehouse plan rather than
// throwing — a missing template must not be able to make a contract unplayable.
export function areaTemplateFor(state, siteId) {
  const site = state.sites?.find((s) => s.id === siteId);
  return TEMPLATE_BY_SITE_TYPE[site?.type | 0] ?? AREA_WAREHOUSE;
}

// ── The compound (derived) ─────────────────────────────────────────────────
// Returns the grid AND the objective together. They used to be computed by two
// functions that had to agree, with the objective found by scanning for "the
// first corridor cell from the top" — a heuristic that silently returns the
// wrong room the moment a plan puts a corridor anywhere else, and would have
// broken on three of the four templates below. The builder that places the room
// is the thing that knows where the objective is.
export function buildAreaGrid(worldSeed, siteId, cfg, template) {
  // A FORGOTTEN TEMPLATE MUST NOT BE SURVIVABLE. Two readers computing this
  // grid from different templates is the worst bug this file could have: the
  // client would draw an office while the reducer paths through a warehouse,
  // and both would look entirely correct on their own. A default parameter here
  // would make that failure silent and plausible, so there is none.
  if (!(template >= 0 && template <= AREA_TRANSIT)) {
    throw new Error(`buildAreaGrid: no template (got ${template}) — use areaGridFor(state, ...)`);
  }
  const w = cfg.width | 0, h = cfg.height | 0;
  const t = new Uint8Array(w * h).fill(AT_COURT);
  const rng = rngFor(worldSeed, siteId, 0x0a11);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < w && y < h) t[y * w + x] = v; };
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? t[y * w + x] : AT_WALL);

  for (let x = 0; x < w; x++) { set(x, 0, AT_WALL); set(x, h - 1, AT_WALL); }
  for (let y = 0; y < h; y++) { set(0, y, AT_WALL); set(w - 1, y, AT_WALL); }

  // Entry doors on the south wall, on every plan: you come in off the street.
  const doorX = 4 + roll(rng, 0, w - 9);
  set(doorX, h - 1, AT_DOOR);
  set(doorX + 1, h - 1, AT_DOOR);

  // A walled room with a door on its south face. Shared by every template,
  // because "the objective is behind a door" is the one structural promise all
  // four make. Returns the room's interior centre — the objective spot.
  // `objectiveRoom` gets a SECOND door on a side wall. A room with one door is
  // a choke a single guard seals by standing in it, and "every mechanism must
  // have a usable gap" (S16 8b) is a rule about floor plans too — the room
  // holding the thing you came for is the last place that should have exactly
  // one way in. Ordinary rooms keep their single door: they are scenery, and
  // nothing the contract needs is behind them.
  const room = (x0, y0, x1, y1, floor, objectiveRoom = false) => {
    for (let x = x0; x <= x1; x++) { set(x, y0, AT_WALL); set(x, y1, AT_WALL); }
    for (let y = y0; y <= y1; y++) { set(x0, y, AT_WALL); set(x1, y, AT_WALL); }
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) set(x, y, floor);
    set(x0 + 1 + roll(rng, 0, Math.max(0, x1 - x0 - 2)), y1, AT_DOOR);
    if (objectiveRoom && y1 - y0 >= 2) {
      // On the side, so the two approaches are genuinely different bearings
      // rather than two holes in the same wall.
      const side = roll(rng, 0, 1) === 0 ? x0 : x1;
      set(side, y0 + 1 + roll(rng, 0, Math.max(0, y1 - y0 - 2)), AT_DOOR);
    }
    return { x: Math.trunc((x0 + x1) / 2), y: Math.trunc((y0 + y1) / 2) };
  };

  let objective;
  if (template === AREA_OFFICE) {
    // OFFICE / LAB: a corridor spine across the building with cellular rooms
    // opening off it. Sight lines are short and the danger is turning a corner
    // into someone, which is what a building full of rooms should feel like.
    const spineY = Math.trunc(h / 2);
    for (let x = 1; x < w - 1; x++) { set(x, spineY, AT_CORRIDOR); set(x, spineY + 1, AT_CORRIDOR); }
    const cellW = 5;
    for (let x0 = 2; x0 + cellW < w - 2; x0 += cellW) {
      room(x0, 2, x0 + cellW - 1, spineY - 1, AT_CORRIDOR);
    }
    // The objective room is the deepest one, off the far end of the spine.
    objective = room(w - 8, spineY + 2, w - 3, h - 3, AT_CORRIDOR, true);
    // Cover along the spine — a long straight corridor with nothing in it is a
    // shooting gallery, and the guard ring crosses this floor. Placed on a
    // stride rather than by rolling positions: three random rolls produced as
    // few as three crates, some of them landing on cells that were not corridor
    // at all, so the plan that most needed cover had the least.
    for (let cx = 4; cx < w - 3; cx += 4) {
      const row = ((cx / 4) | 0) % 2 === 0 ? spineY : spineY + 1;
      if (at(cx, row) === AT_CORRIDOR) set(cx, row, AT_COVER);
    }
    // ...and a filing block inside a couple of the cellular rooms, so a room is
    // somewhere to hide rather than a box with one exit.
    for (let x0 = 3; x0 + 4 < w - 2; x0 += 10) {
      if (at(x0, 4) === AT_CORRIDOR) set(x0, 4, AT_COVER);
      if (at(x0 + 1, 4) === AT_CORRIDOR) set(x0 + 1, 4, AT_COVER);
    }
  } else if (template === AREA_INDUSTRIAL) {
    // INDUSTRIAL: an open yard wrapped around a plant block, with tank clusters
    // for cover. Long sight lines, and the cover is where you choose to put
    // yourself rather than handed to you in rows.
    objective = room(Math.trunc(w / 2) - 3, 2, Math.trunc(w / 2) + 3, 7, AT_CORRIDOR, true);
    const clusters = 4 + roll(rng, 0, 2);
    for (let i = 0; i < clusters; i++) {
      const cx = 2 + roll(rng, 0, w - 5), cy = 9 + roll(rng, 0, h - 12);
      // A cluster, not a lone crate: three cells in an L, so it blocks sight
      // from more than one bearing.
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
        if (at(cx + dx, cy + dy) === AT_COURT) set(cx + dx, cy + dy, AT_COVER);
      }
    }
  } else if (template === AREA_TRANSIT) {
    // TRANSIT: parallel loading bays. Long container rows running north-south
    // with wide aisles between them — the crossings are the exposure, and which
    // aisle you commit to is the whole decision.
    const bays = 4;
    const step = Math.trunc((w - 4) / bays);
    for (let b = 0; b < bays; b++) {
      const x = 3 + b * step;
      for (let y = 3; y < h - 4; y++) {
        // Gaps in each row, so a bay is a route rather than a wall. Every 4
        // rather than every 5, for the same reason the racking loosened.
        if (y % 4 !== 0) set(x, y, AT_COVER);
        if (y % 4 !== 0 && x + 1 < w - 1) set(x + 1, y, AT_COVER);
      }
    }
    objective = room(2, 2, 8, 6, AT_CORRIDOR, true);
  } else {
    // WAREHOUSE: long racking aisles across the floor and a foreman's office in
    // a corner. The racking is what you break line of sight behind, and the
    // aisles are what a guard walks down.
    // Racking rows with FOUR gaps each, not two. The first cut put a gap every
    // 7 columns across rows every 3 — two openings per row, which turned the
    // floor into a funnel: every route through the building crossed the same
    // two columns, which is exactly where a patrolling guard is. The M5 gate
    // caught it as "the world is not alive" on two seeds. A warehouse should
    // break sight lines, not force a single path.
    for (let row = 4; row < h - 4; row += 4) {
      for (let x = 3; x < w - 3; x++) {
        if (x % 5 !== 0) set(x, row, AT_COVER);      // gaps to slip through
      }
    }
    objective = room(w - 9, 2, w - 3, 6, AT_CORRIDOR, true);
  }

  // The objective must never be a wall — a plan whose room degenerated would
  // otherwise leave a contract that cannot be completed anywhere in the world,
  // which is the 8a camera-on-the-objective defect in a different costume.
  if (at(objective.x, objective.y) === AT_WALL) set(objective.x, objective.y, AT_CORRIDOR);

  // Keep the entry strip clear: crates on the door line make the first two
  // moves of every infiltration a routing problem instead of a stealth one.
  for (let x = 1; x < w - 1; x++) {
    if (at(x, h - 2) === AT_COVER) set(x, h - 2, AT_COURT);
  }

  // THE CONNECTED FLOOR, flooded from the entry door. Passable is not the same
  // as reachable, and the difference is not academic: legalising guard
  // waypoints against "not a wall" alone moved office waypoints INSIDE sealed
  // cellular rooms, where a guard parks exactly as permanently as it does in a
  // wall. Computed once with the plan, so every reader gets the same answer.
  const open = new Uint8Array(w * h);
  const start = [];
  for (let x = 0; x < w; x++) if (at(x, h - 2) !== AT_WALL) start.push(x + (h - 2) * w);
  const queue = start.slice();
  for (const i of start) open[i] = 1;
  while (queue.length) {
    const i = queue.pop();
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (open[j] || t[j] === AT_WALL) continue;
      open[j] = 1;
      queue.push(j);
    }
  }
  return { tiles: t, objective, open };
}

export function areaTiles(worldSeed, siteId, cfg, template) {
  return buildAreaGrid(worldSeed, siteId, cfg, template).tiles;
}

// THE ONE ENTRY POINT every reader in the game uses. The template is derived
// here from the site, so no caller can pick a different one by accident — the
// grid, the objective and the doors always come from the same plan.
export function areaGridFor(state, siteId, cfg) {
  return buildAreaGrid(state.worldSeed, siteId, cfg, areaTemplateFor(state, siteId));
}

export function areaMapOf(state, area, cfg) {
  return { width: cfg.width | 0, height: cfg.height | 0,
    cells: areaGridFor(state, area.siteId, cfg).tiles };
}

// The objective (asset spot / vantage): the room the template placed.
export function areaObjective(worldSeed, siteId, cfg, template) {
  return buildAreaGrid(worldSeed, siteId, cfg, template).objective;
}

export function areaDoors(tiles, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (tiles[y * w + x] === AT_DOOR) out.push({ x, y });
  }
  return out;
}

// The ENTRY doors: the south-wall pair. Wing doors are interior — you leave
// a compound the way compounds are left, not through an office doorway.
export function areaEntryDoors(tiles, w, h) {
  return areaDoors(tiles, w, h).filter((d) => d.y === h - 1);
}

// Guard spawn cells and patrol waypoints: a loop around the yard, offset per
// guard so they do not clump.
export function guardRoute(worldSeed, siteId, cfg, guardIdx, grid = null) {
  const w = cfg.width | 0, h = cfg.height | 0;
  const rng = rngFor(worldSeed, siteId, 0x60a2 + guardIdx);
  const inset = 2 + roll(rng, 0, 2);
  // LEGALISE EVERY WAYPOINT AGAINST THE FLOOR PLAN. Two separate defects, both
  // introduced the moment there was more than one plan for the ring to be drawn
  // around (playtest 13, finding 6), and both of them cost pinned seeds:
  //
  //  1. A WAYPOINT INSIDE A WALL IS A PARKED GUARD. The route advances only when
  //     a guard REACHES its waypoint, so an unreachable one freezes that guard
  //     for the rest of the session — and a permanently parked guard watching a
  //     corridor is not a patrol, it is a wall with eyes. The office plan put
  //     25% of its waypoints inside the objective room's north wall.
  //
  //  2. A WAYPOINT ON THE OBJECTIVE IS THE 8a DEFECT, INDOORS. Merely snapping
  //     to the nearest floor cell moved office waypoints to Chebyshev 1 of the
  //     objective — and surveillance requires an UNSEEN hold there, so the
  //     contract became impossible at every office site in the world. This is
  //     exactly the camera-on-the-site bug that S16 8a was written about:
  //     fixtures go on the APPROACH, and the work itself stays possible.
  //
  // So a legal waypoint is one that is passable AND outside guard sight of the
  // objective. Searching outward from the nominal ring point keeps the patrol
  // shaped like a ring rather than scattering it.
  const sight = cfg.guardSightRadius | 0;
  const legal = (x, y) => {
    if (!(x > 0 && y > 0 && x < w - 1 && y < h - 1)) return false;
    // REACHABLE, not merely passable: a waypoint sealed inside a cellular room
    // parks a guard exactly as permanently as one inside a wall does.
    if (!grid.open[y * w + x]) return false;
    return Math.max(Math.abs(x - grid.objective.x), Math.abs(y - grid.objective.y)) > sight;
  };
  const snap = (p) => {
    if (!grid) return p;
    if (legal(p.x, p.y)) return p;
    for (let r = 1; r <= Math.max(w, h); r++) {
      for (const [dx, dy] of [[0, r], [0, -r], [r, 0], [-r, 0], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        if (legal(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
      }
    }
    return p;   // nowhere legal at all: the plan is degenerate, and a test says so
  };
  // The ring is pinned to rows 8..h-6: the ENTRY strip (south) and the WING
  // DOORS (north) are both approaches, and a leg adjacent to either puts an
  // entrance inside sight unconditionally — the 8a camera-on-the-objective
  // defect, indoors, which is exactly how the first ring (rows 7 and h-3)
  // burned every entrant within thirty ticks of the door. Gaps are temporal
  // now: a crossing is safe when no guard is horizontally near your column.
  const pts = [
    { x: inset, y: 8 }, { x: w - 1 - inset, y: 8 },
    { x: w - 1 - inset, y: h - 6 }, { x: inset, y: h - 6 },
  ].map(snap);
  // Rotate the loop so guards start on different legs.
  const off = guardIdx % pts.length;
  return pts.slice(off).concat(pts.slice(0, off));
}

// ── State ──────────────────────────────────────────────────────────────────
export function areaFor(state, siteId, cfg) {
  let area = state.areas.find((a) => a.siteId === siteId);
  if (area) return area;
  // The plan, so guard starts land on legal ground for THIS floor plan.
  const grid = areaGridFor(state, siteId, cfg);
  area = {
    id: state.areas.length, siteId,
    alarmStage: 0, alarmTicks: 0, suppressedUntil: 0,
    assetTaken: 0,
    guards: Array.from({ length: cfg.guardsPerArea | 0 }, (_, i) => {
      const start = guardRoute(state.worldSeed, siteId, cfg, i, grid)[0];
      return { id: i, x: start.x, y: start.y, wp: 1, facing: 0,
        cool: 0, alertTicks: 0, downedUntil: 0, targetX: -1, targetY: -1 };
    }),
    terminals: [(() => {
      const rng = rngFor(state.worldSeed, siteId, 0x7e12);
      return { id: 0, x: 3 + roll(rng, 0, (cfg.width | 0) - 7), y: (cfg.height | 0) - 4 };
    })()],
  };
  state.areas.push(area);
  return area;
}

export function occupantsOf(state, areaId) {
  return state.agents.filter((a) => a.insideAreaId === areaId
    && (a.state === AGENT_ACTIVE || a.state === AGENT_DOWNED));
}

const passable = (tiles, w, h, x, y) =>
  x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] !== AT_WALL;

// ── Commands ───────────────────────────────────────────────────────────────
export function enterArea(state, agent, cfg) {
  if (!agent || agent.state !== AGENT_ACTIVE) return "agent_not_active";
  if (agent.insideAreaId >= 0) return "already_inside";
  if (agent.insideBuildingId >= 0) return "agent_inside_building";
  const ax = Math.trunc(agent.x / 256), ay = Math.trunc(agent.y / 256);
  const site = state.sites.find((s) =>
    Math.max(Math.abs(s.cellX - ax), Math.abs(s.cellY - ay)) <= 1);
  if (!site) return "no_site_here";
  const area = areaFor(state, site.id, cfg);
  const tiles = areaGridFor(state, site.id, cfg).tiles;
  const door = areaEntryDoors(tiles, cfg.width | 0, cfg.height | 0)[0]
    ?? { x: Math.trunc(cfg.width / 2), y: (cfg.height | 0) - 1 };
  agent.insideAreaId = area.id;
  agent.areaCol = door.x; agent.areaRow = door.y; agent.areaCool = 0;
  agent.route = []; agent.routeIdx = 0;
  state.events.push({ type: "areaEntered", agentId: agent.id, firmId: agent.firmId,
    areaId: area.id, siteId: site.id });
  return null;
}

export function exitArea(state, agent, cfg) {
  if (!agent || agent.insideAreaId < 0) return "not_in_area";
  const area = state.areas.find((a) => a.id === agent.insideAreaId);
  const tiles = areaGridFor(state, area.siteId, cfg).tiles;
  const doors = areaEntryDoors(tiles, cfg.width | 0, cfg.height | 0);
  const atDoor = doors.some((d) =>
    Math.max(Math.abs(d.x - agent.areaCol), Math.abs(d.y - agent.areaRow)) <= 1);
  if (!atDoor && agent.state !== AGENT_DOWNED) return "not_at_door";
  const site = state.sites.find((s) => s.id === area.siteId);
  agent.insideAreaId = -1;
  agent.x = site.cellX * 256 + 128;
  agent.y = site.cellY * 256 + 128;
  agent.route = []; agent.routeIdx = 0;
  state.events.push({ type: "areaExited", agentId: agent.id, firmId: agent.firmId,
    areaId: area.id, siteId: area.siteId, carrying: agent.carryKind | 0 });
  return null;
}

export function orderAreaMove(state, agent, cfg, cellX, cellY) {
  const area = state.areas.find((a) => a.id === agent.insideAreaId);
  if (!area) return "not_in_area";
  const map = areaMapOf(state, area, cfg);
  if ((cellX | 0) === agent.areaCol && (cellY | 0) === agent.areaRow) {
    // A move to your own cell is a STOP — freezing in place is a real stealth
    // action, not a routing failure.
    agent.route = []; agent.routeIdx = 0;
    return null;
  }
  const path = findPath(map, agent.areaCol, agent.areaRow, cellX | 0, cellY | 0);
  if (!path.length) return "no_route";
  agent.route = path;
  agent.routeIdx = 0;
  return null;
}

// Bloodless takedown (D6/D64): from the flank or behind, range 1 Chebyshev.
// Guards go DOWN for a window; a rival AGENT goes down and is DUMPED at the
// street door — "left for the guards" is literal (the street arrest machine
// takes over), and that is what sabotage means.
export function takedown(state, agent, cfg, combatCfg) {
  if (!agent || agent.insideAreaId < 0) return "not_in_area";
  if (agent.state !== AGENT_ACTIVE) return "agent_not_active";
  const area = state.areas.find((a) => a.id === agent.insideAreaId);
  const near = (x, y) =>
    Math.max(Math.abs(x - agent.areaCol), Math.abs(y - agent.areaRow)) <= (cfg.takedownRange | 0);
  const guard = area.guards.find((g) =>
    (g.downedUntil | 0) <= state.tick && near(g.x, g.y) && !guardFacing(g, agent));
  if (guard) {
    guard.downedUntil = state.tick + (cfg.guardDownTicks | 0);
    guard.alertTicks = 0;
    state.events.push({ type: "guardDowned", areaId: area.id, guardId: guard.id,
      byAgentId: agent.id, byFirmId: agent.firmId });
    return null;
  }
  const rival = occupantsOf(state, area.id).find((o) =>
    o.id !== agent.id && o.firmId !== agent.firmId
    && o.state === AGENT_ACTIVE && near(o.areaCol, o.areaRow));
  if (rival) {
    rival.state = AGENT_DOWNED;
    if (rival.carryKind === CARRY_AREA_ASSET) {
      rival.carryKind = 0; rival.carryRef = -1;
      area.assetTaken = 0;   // the asset falls; the mission is open again
    }
    exitArea(state, rival, cfg);   // dumped at the door for the street to find
    bumpAlarm(state, area, cfg, agent.firmId);
    state.events.push({ type: "agentDumped", areaId: area.id,
      agentId: rival.id, firmId: rival.firmId, byFirmId: agent.firmId });
    return null;
  }
  return "no_target";
}

function guardFacing(guard, agent) {
  // Flank rule: a guard "faces" the attacker when the attacker sits in the
  // half-plane the guard walks toward. facing: 0 E, 1 N, 2 W, 3 S.
  const dx = agent.areaCol - guard.x, dy = agent.areaRow - guard.y;
  return (guard.facing === 0 && dx > 0) || (guard.facing === 2 && dx < 0)
    || (guard.facing === 1 && dy < 0) || (guard.facing === 3 && dy > 0);
}

export function hackTerminal(state, agent, cfg) {
  if (!agent || agent.insideAreaId < 0) return "not_in_area";
  const area = state.areas.find((a) => a.id === agent.insideAreaId);
  const term = area.terminals.find((t) =>
    Math.max(Math.abs(t.x - agent.areaCol), Math.abs(t.y - agent.areaRow)) <= 1);
  if (!term) return "no_terminal_here";
  area.suppressedUntil = state.tick + (cfg.terminalSuppressTicks | 0);
  area.alarmStage = 0; area.alarmTicks = 0;
  for (const g of area.guards) g.alertTicks = 0;
  state.events.push({ type: "areaSuppressed", areaId: area.id, agentId: agent.id,
    firmId: agent.firmId, until: area.suppressedUntil });
  return null;
}

function bumpAlarm(state, area, cfg, firmId = -1) {
  if (area.suppressedUntil > state.tick) return;
  if (area.alarmStage < (cfg.alarmMaxStage | 0)) {
    area.alarmStage += 1;
    // firmId: whose action tripped it — the wire drops firm-less events, and
    // an alarm nobody is told about is the invisible difficulty D45 forbids.
    state.events.push({ type: "areaAlarm", areaId: area.id,
      stage: area.alarmStage, firmId });
  }
  area.alarmTicks = 0;
}

// ── The per-tick step ──────────────────────────────────────────────────────
// Occupied areas only: an empty compound holds its breath (cheap AND
// deterministic — occupancy is itself deterministic).
export function stepAreas(state, cfg, detCfg) {
  for (const area of state.areas) {
    const occupants = occupantsOf(state, area.id);
    // An ALERTED compound keeps breathing while empty: bailing out and
    // letting the alarm cool is the recovery the design promises, and a
    // frozen alarm would greet the returning agent exactly as it left them.
    if (!occupants.length && area.alarmStage === 0
      && area.guards.every((g) => g.alertTicks === 0)) continue;
    // One grid build per area per tick, shared by movement, perception and the
    // patrol route — three readers that must agree about where the walls are.
    const grid = areaGridFor(state, area.siteId, cfg);
    const map = { width: cfg.width | 0, height: cfg.height | 0, cells: grid.tiles };
    stepOccupants(state, area, map, occupants, cfg, grid);
    stepGuards(state, area, map, occupants, cfg, detCfg, grid);
    // Alarm decay while nobody is alert.
    if (area.alarmStage > 0 && area.guards.every((g) => g.alertTicks === 0)) {
      area.alarmTicks += 1;
      if (area.alarmTicks >= (cfg.alarmStageTicks | 0)) {
        area.alarmStage -= 1; area.alarmTicks = 0;
      }
    }
  }
}

const STANCE_STEP = [7, 5, 3];   // sneak, move, hurry: ticks per cell inside

function stepOccupants(state, area, map, occupants, cfg, grid) {
  for (const a of occupants) {
    if (a.state !== AGENT_ACTIVE) continue;
    const route = a.route ?? [];
    if (!route.length || a.routeIdx >= route.length) continue;
    a.areaCool = (a.areaCool | 0) + 1;
    const stepTicks = STANCE_STEP[a.stance] ?? 5;
    if (a.areaCool < stepTicks) continue;
    a.areaCool = 0;
    const next = route[a.routeIdx];
    if (!passable(map.cells, map.width, map.height, next.x, next.y)) {
      a.route = []; a.routeIdx = 0; continue;
    }
    a.areaCol = next.x; a.areaRow = next.y;
    a.routeIdx += 1;
    // Extraction pickup: stepping onto the objective takes the asset.
    // S16 8f, indoors: at a SECURED facility the asset itself is behind
    // access control — the door stays open (surveillance needs no badge; a
    // saboteur-rival needs none) but the goods do not move without the
    // tier's credential. Same single rule the street work obeyed.
    const site = state.sites.find((x) => x.id === area.siteId);
    const need = site?.securityTier | 0;
    const obj = grid.objective;
    if (!area.assetTaken && a.areaCol === obj.x && a.areaRow === obj.y
      && (need <= 0 || hasCredential(state, a.id, need))) {
      area.assetTaken = 1;
      a.carryKind = CARRY_AREA_ASSET;
      a.carryRef = area.siteId;
      state.events.push({ type: "areaAssetTaken", areaId: area.id,
        agentId: a.id, firmId: a.firmId, siteId: area.siteId });
    }
  }
}

function stepGuards(state, area, map, occupants, cfg, detCfg, grid) {
  const pct = sightPctAt(state.tick, state.rules?.season?.dayNight);
  const alarmPct = area.alarmStage > 0 ? (cfg.alarmSightBonusPct | 0) : 100;
  let sight = Math.trunc(((cfg.guardSightRadius | 0) * pct) / 100);
  sight = Math.max(1, Math.trunc((sight * alarmPct) / 100));
  const speed = area.alarmStage > 0
    ? Math.max(4, Math.trunc(((cfg.guardSpeed | 0) * 100) / (cfg.guardAlertSpeedPct | 0)))
    : (cfg.guardSpeed | 0);

  // Perception first, ladder second: each guard picks its nearest visible
  // occupant for alert/convergence, but the DETECTION LADDER runs once per
  // occupant — four guards staring at you is one sighting, not four clocks.
  const seenIds = new Set();
  for (const g of area.guards) {
    if ((g.downedUntil | 0) > state.tick) continue;

    // Perception: nearest visible ACTIVE occupant. Cover-adjacent occupants
    // are harder to see: crates shave a cell of range, like street cover.
    let seen = null, seenD = Infinity;
    for (const a of occupants) {
      if (a.state !== AGENT_ACTIVE) continue;
      const d = Math.max(Math.abs(a.areaCol - g.x), Math.abs(a.areaRow - g.y));
      const behindCover = map.cells[a.areaRow * map.width + a.areaCol] === AT_COVER;
      const r = behindCover ? sight - 2 : sight - (a.stance === 0 ? 1 : 0);
      if (d <= Math.max(1, r)
        && hasLineOfSight(map, g.x, g.y, a.areaCol, a.areaRow)
        && d < seenD) { seen = a; seenD = d; }
    }
    if (seen) {
      g.alertTicks = (g.alertTicks | 0) + 1;
      g.targetX = seen.areaCol; g.targetY = seen.areaRow;
      seenIds.add(seen.id);
    } else if (g.alertTicks > 0) {
      g.alertTicks = 0;
    }

    // Movement: converge on the last seen spot when alert, else walk the
    // loop. A converging guard STOPS a cell short — standing on the agent's
    // square would keep it at distance 0 forever, which no cover or darkness
    // can beat, and four guards on one cell read as a rendering bug anyway.
    g.cool = (g.cool | 0) + 1;
    if (g.cool < speed) continue;
    g.cool = 0;
    let target;
    if (g.alertTicks > 0 && g.targetX >= 0) {
      target = { x: g.targetX, y: g.targetY };
      if (Math.max(Math.abs(g.x - target.x), Math.abs(g.y - target.y)) <= 1) continue;
    } else {
      const route = guardRoute(state.worldSeed, area.siteId, cfg, g.id, grid);
      const wp = route[g.wp % route.length];
      if (g.x === wp.x && g.y === wp.y) g.wp = (g.wp + 1) % route.length;
      target = route[g.wp % route.length];
    }
    const step = findPath(map, g.x, g.y, target.x, target.y)[0];
    if (step) {
      g.facing = step.x > g.x ? 0 : step.x < g.x ? 2 : step.y < g.y ? 1 : 3;
      g.x = step.x; g.y = step.y;
    }
  }

  // The ladder, once per occupant, on the street's own thresholds. Decay runs
  // with heat 0: a compound has no checkpoints, and gating the indoor cooldown
  // on street heat would deadlock surveillance forever after a single burn.
  for (const a of occupants) {
    if (a.state !== AGENT_ACTIVE) continue;
    if (seenIds.has(a.id)) {
      a.detectTimer = (a.detectTimer | 0) + 1;
      if (a.detection === DET_UNSEEN) {
        a.detection = DET_NOTICED; a.detectTimer = 0;
        state.events.push({ type: "agentNoticed", agentId: a.id, firmId: a.firmId });
      } else if (a.detection === DET_NOTICED && a.detectTimer >= detCfg.burnTicks) {
        const site = state.sites.find((s) => s.id === area.siteId);
        burnAgent(state, a, detCfg, site?.districtId ?? -1);
        bumpAlarm(state, area, cfg, a.firmId);
      }
    } else {
      decayDetection(state, a, detCfg, 0);
    }
  }
}
