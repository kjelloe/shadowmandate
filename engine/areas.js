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

// ── The compound (derived) ─────────────────────────────────────────────────
// A walled yard with two-to-three interior wings along the north half, door
// gaps into each, cover crates in the courts, and the entry door(s) on the
// south wall. The objective room is the deepest wing.
export function areaTiles(worldSeed, siteId, cfg) {
  const w = cfg.width | 0, h = cfg.height | 0;
  const t = new Uint8Array(w * h).fill(AT_COURT);
  const rng = rngFor(worldSeed, siteId, 0x0a11);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < w && y < h) t[y * w + x] = v; };

  for (let x = 0; x < w; x++) { set(x, 0, AT_WALL); set(x, h - 1, AT_WALL); }
  for (let y = 0; y < h; y++) { set(0, y, AT_WALL); set(w - 1, y, AT_WALL); }

  // Entry doors on the south wall.
  const doorX = 4 + roll(rng, 0, w - 9);
  set(doorX, h - 1, AT_DOOR);
  set(doorX + 1, h - 1, AT_DOOR);

  // Wings: walled rooms along the north, each with a south-facing door gap.
  const wings = 2 + roll(rng, 0, 1);
  const wingW = Math.trunc((w - 4) / wings);
  for (let i = 0; i < wings; i++) {
    const x0 = 2 + i * wingW, x1 = x0 + wingW - 2;
    const y0 = 2, y1 = 5 + roll(rng, 0, 2);
    for (let x = x0; x <= x1; x++) { set(x, y0, AT_WALL); set(x, y1, AT_WALL); }
    for (let y = y0; y <= y1; y++) { set(x0, y, AT_WALL); set(x1, y, AT_WALL); }
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) set(x, y, AT_CORRIDOR);
    set(x0 + 1 + roll(rng, 0, x1 - x0 - 2), y1, AT_DOOR);   // the wing's door
  }

  // Cover in the yard: crates to hide behind, never on the entry line.
  const crates = 6 + roll(rng, 0, 4);
  for (let i = 0; i < crates; i++) {
    const x = 2 + roll(rng, 0, w - 5), y = 7 + roll(rng, 0, h - 10);
    if (t[y * w + x] === AT_COURT) set(x, y, AT_COVER);
  }
  return t;
}

export function areaMapOf(state, area, cfg) {
  return { width: cfg.width | 0, height: cfg.height | 0,
    cells: areaTiles(state.worldSeed, area.siteId, cfg) };
}

// The objective (asset spot / vantage): centre of the deepest (first) wing.
export function areaObjective(worldSeed, siteId, cfg) {
  const tiles = areaTiles(worldSeed, siteId, cfg);
  const w = cfg.width | 0, h = cfg.height | 0;
  // The first corridor cell scanning from the top is inside the first wing.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] === AT_CORRIDOR) return { x: x + 1, y: y + 1 };
    }
  }
  return { x: Math.trunc(w / 2), y: 3 };   // template degenerated; stay honest
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
export function guardRoute(worldSeed, siteId, cfg, guardIdx) {
  const w = cfg.width | 0, h = cfg.height | 0;
  const rng = rngFor(worldSeed, siteId, 0x60a2 + guardIdx);
  const inset = 2 + roll(rng, 0, 2);
  // The ring is pinned to rows 8..h-6: the ENTRY strip (south) and the WING
  // DOORS (north) are both approaches, and a leg adjacent to either puts an
  // entrance inside sight unconditionally — the 8a camera-on-the-objective
  // defect, indoors, which is exactly how the first ring (rows 7 and h-3)
  // burned every entrant within thirty ticks of the door. Gaps are temporal
  // now: a crossing is safe when no guard is horizontally near your column.
  const pts = [
    { x: inset, y: 8 }, { x: w - 1 - inset, y: 8 },
    { x: w - 1 - inset, y: h - 6 }, { x: inset, y: h - 6 },
  ];
  // Rotate the loop so guards start on different legs.
  const off = guardIdx % pts.length;
  return pts.slice(off).concat(pts.slice(0, off));
}

// ── State ──────────────────────────────────────────────────────────────────
export function areaFor(state, siteId, cfg) {
  let area = state.areas.find((a) => a.siteId === siteId);
  if (area) return area;
  area = {
    id: state.areas.length, siteId,
    alarmStage: 0, alarmTicks: 0, suppressedUntil: 0,
    assetTaken: 0,
    guards: Array.from({ length: cfg.guardsPerArea | 0 }, (_, i) => {
      const start = guardRoute(state.worldSeed, siteId, cfg, i)[0];
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
  const tiles = areaTiles(state.worldSeed, site.id, cfg);
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
  const tiles = areaTiles(state.worldSeed, area.siteId, cfg);
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
    bumpAlarm(state, area, cfg);
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

function bumpAlarm(state, area, cfg) {
  if (area.suppressedUntil > state.tick) return;
  if (area.alarmStage < (cfg.alarmMaxStage | 0)) {
    area.alarmStage += 1;
    state.events.push({ type: "areaAlarm", areaId: area.id, stage: area.alarmStage });
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
    const map = areaMapOf(state, area, cfg);
    stepOccupants(state, area, map, occupants, cfg);
    stepGuards(state, area, map, occupants, cfg, detCfg);
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

function stepOccupants(state, area, map, occupants, cfg) {
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
    const obj = areaObjective(state.worldSeed, area.siteId, cfg);
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

function stepGuards(state, area, map, occupants, cfg, detCfg) {
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
      const route = guardRoute(state.worldSeed, area.siteId, cfg, g.id);
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
        bumpAlarm(state, area, cfg);
      }
    } else {
      decayDetection(state, a, detCfg, 0);
    }
  }
}
