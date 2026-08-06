// engine/citygen.js — seeded urban world generation (S01).
//
// Deterministic from (seed, size, ruleset): the static world is never stored,
// it is reconstructed. Generation uses its OWN PRNG derived from the world
// seed — it must never consume state.rng, which belongs to runtime.
//
// The city must have an identity, not just texture: a street lattice with
// jitter, districts with traits, a transit spine, and (on port traits) water.

import { mix32, seedSfc32, sfc32Next } from "../shared/prng.js";
import {
  T_OPEN, T_STREET, T_ALLEY, T_PLAZA, T_BLOCK, T_ENTRANCE,
  T_TRANSIT, T_YARD, T_ROUGH, T_WATER,
} from "./terrain.js";
import { setTile, tileAt } from "./state.js";
import { placeCameras } from "./cameras.js";
import { placeBeams } from "./sensors.js";
import { placeJunctions } from "./security.js";

export const TRAIT_INDUSTRIAL = 0;
export const TRAIT_RESIDENTIAL = 1;
export const TRAIT_COMMERCIAL = 2;
export const TRAIT_GOVERNMENT = 3;
export const TRAIT_RESEARCH = 4;
export const TRAIT_PORT = 5;
export const TRAIT_COUNT = 6;

// Site types (S01/S06)
export const SITE_CACHE = 0;
export const SITE_VAULT = 1;
export const SITE_LAB = 2;
export const SITE_RELAY = 3;
export const SITE_TRANSIT_HUB = 4;
export const SITE_WAREHOUSE = 5;
export const SITE_TYPE_COUNT = 6;

// Building kinds (S09)
export const BUILDING_SAFEHOUSE = 0;
export const BUILDING_MARKET = 1;
export const BUILDING_COVERSHOP = 2;   // D38 — the re-spray, for people

const SALT_LAYOUT = 0x5ade;
const SALT_DISTRICT = 0x0d15;
const SALT_SITES = 0x51e5;
const SALT_PATROL = 0x9a70;

// A mutable cursor over the pure sfc32 step — generation-local convenience.
// The engine's runtime PRNG lives in state.rng and is never touched here.
function derive(seed, salt) {
  return { s: seedSfc32(mix32((seed ^ salt) >>> 0)) };
}

function nextU32(rng) {
  const { value, nextState } = sfc32Next(rng.s);
  rng.s = nextState;
  return value >>> 0;
}

// Integer range roll, inclusive of lo and hi.
function roll(rng, lo, hi) {
  if (hi <= lo) return lo;
  return (lo + (nextU32(rng) % ((hi - lo + 1) >>> 0))) | 0;
}

function key(x, y) { return y * 4096 + x; }

// ── Street lattice ───────────────────────────────────────────────────────
// Streets are laid on a jittered grid. Jitter is what stops every seeded city
// looking like the same chessboard; the spacing floor is what keeps blocks
// large enough to hold buildings.
function laneOffsets(rng, size, spacing) {
  const lanes = [];
  let pos = roll(rng, 2, spacing - 1);
  while (pos < size - 2) {
    lanes.push(pos);
    pos += spacing + roll(rng, -2, 2);
    if (lanes.length > 1 && pos - lanes[lanes.length - 1] < 4) pos = lanes[lanes.length - 1] + 4;
  }
  return lanes;
}

function paintStreets(map, rng, size, spacing) {
  const cols = laneOffsets(rng, size, spacing);
  const rows = laneOffsets(rng, size, spacing);
  for (const x of cols) for (let y = 0; y < size; y++) setTile(map, x, y, T_STREET);
  for (const y of rows) for (let x = 0; x < size; x++) setTile(map, x, y, T_STREET);
  return { cols, rows };
}

// Blocks become building mass; alleys carve through them so the city has back
// routes (the stealth player's road network — alleys are cover-2 terrain).
function paintBlocksAndAlleys(map, rng, size, lattice, alleyChance) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (tileAt(map, x, y) === T_STREET) continue;
      setTile(map, x, y, T_BLOCK);
    }
  }
  const { cols, rows } = lattice;
  for (let ci = 0; ci + 1 < cols.length; ci++) {
    for (let ri = 0; ri + 1 < rows.length; ri++) {
      const x0 = cols[ci] + 1, x1 = cols[ci + 1] - 1;
      const y0 = rows[ri] + 1, y1 = rows[ri + 1] - 1;
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      if (roll(rng, 0, 255) > alleyChance) continue;
      if (roll(rng, 0, 1) === 0) {
        const ay = roll(rng, y0, y1);
        for (let x = x0; x <= x1; x++) setTile(map, x, ay, T_ALLEY);
      } else {
        const ax = roll(rng, x0, x1);
        for (let y = y0; y <= y1; y++) setTile(map, ax, y, T_ALLEY);
      }
    }
  }
}

// A single straight transit lane — the fastest surface route, and a landmark
// that gives each seed a recognisable spine.
function paintTransit(map, rng, size, lattice) {
  const horizontal = roll(rng, 0, 1) === 0;
  const lanes = horizontal ? lattice.rows : lattice.cols;
  if (!lanes.length) return;
  const at = lanes[roll(rng, 0, lanes.length - 1)];
  for (let i = 0; i < size; i++) {
    if (horizontal) setTile(map, i, at, T_TRANSIT);
    else setTile(map, at, i, T_TRANSIT);
  }
}

// ── Districts ────────────────────────────────────────────────────────────
// Nearest-seed (Manhattan) partition: contiguous by construction, cheap, and
// stable under the mirror transform.
function partitionDistricts(map, rng, size, count) {
  const seeds = [];
  const margin = size >> 3;
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: roll(rng, margin, size - 1 - margin),
      y: roll(rng, margin, size - 1 - margin),
    });
  }
  const owner = new Array(size * size).fill(0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = 0, bestD = 0x7fffffff;
      for (let i = 0; i < seeds.length; i++) {
        const d = Math.abs(x - seeds[i].x) + Math.abs(y - seeds[i].y);
        if (d < bestD) { bestD = d; best = i; }
      }
      owner[y * size + x] = best;
    }
  }
  const traitPool = [
    TRAIT_INDUSTRIAL, TRAIT_RESIDENTIAL, TRAIT_COMMERCIAL,
    TRAIT_GOVERNMENT, TRAIT_RESEARCH, TRAIT_PORT,
  ];
  // Deterministic shuffle so trait assignment varies by seed without repeats.
  for (let i = traitPool.length - 1; i > 0; i--) {
    const j = roll(rng, 0, i);
    const t = traitPool[i]; traitPool[i] = traitPool[j]; traitPool[j] = t;
  }
  const districts = seeds.map((s, i) => ({
    id: i,
    trait: traitPool[i % traitPool.length],
    coreX: s.x, coreY: s.y,
    heat: 0,
    heatTimer: 0,
  }));
  return { owner, districts };
}

// Trait dressing: what makes a district read as itself on sight.
function dressDistricts(map, rng, size, owner, districts) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = tileAt(map, x, y);
      if (tile !== T_BLOCK) continue;
      const d = districts[owner[y * size + x]];
      const r = roll(rng, 0, 99);
      if (d.trait === TRAIT_INDUSTRIAL && r < 22) setTile(map, x, y, T_YARD);
      else if (d.trait === TRAIT_PORT && r < 14) setTile(map, x, y, T_WATER);
      else if (d.trait === TRAIT_PORT && r < 26) setTile(map, x, y, T_YARD);
      else if (d.trait === TRAIT_GOVERNMENT && r < 12) setTile(map, x, y, T_PLAZA);
      else if (d.trait === TRAIT_COMMERCIAL && r < 10) setTile(map, x, y, T_PLAZA);
      else if (d.trait === TRAIT_RESIDENTIAL && r < 14) setTile(map, x, y, T_OPEN);
      else if (d.trait === TRAIT_RESEARCH && r < 10) setTile(map, x, y, T_ROUGH);
    }
  }
  // The outskirts: the map edge is never solid building mass, so a dropship
  // always has somewhere to put an agent and emergency evac has an edge to run for.
  for (let i = 0; i < size; i++) {
    for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]]) {
      if (tileAt(map, x, y) === T_BLOCK) setTile(map, x, y, T_OPEN);
    }
  }
}

// ── Placement helpers ────────────────────────────────────────────────────
//
// THE MAIN-COMPONENT RULE (found by probe 1 on the very first corpus run,
// 2026-08-04): dressing a district turns some block mass back into open
// ground, and some of those cells are interior courtyards fully enclosed by
// buildings. They look like fine ground and are utterly unreachable. Every
// placement — sites, holding sites, entrances, patrol starts — must come from
// the component connected to the street network, never from a pocket.
export function mainComponent(map) {
  const { width, height, cells } = map;
  let sx = -1, sy = -1;
  for (let i = 0; i < cells.length && sx < 0; i++) {
    if (cells[i] === T_STREET) { sx = i % width; sy = (i / width) | 0; }
  }
  const seen = new Uint8Array(width * height);
  if (sx < 0) return seen;
  const stack = [sx + sy * width];
  seen[sx + sy * width] = 1;
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width, y = (idx / width) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = nx + ny * width;
      if (seen[n]) continue;
      const t = cells[n];
      if (t === T_BLOCK || t === T_WATER) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

function isOpenGround(map, x, y) {
  const t = tileAt(map, x, y);
  return t === T_OPEN || t === T_YARD || t === T_PLAZA || t === T_ROUGH;
}

function neighbours(x, y) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
}

function adjacentToRoute(map, x, y) {
  for (const [nx, ny] of neighbours(x, y)) {
    const t = tileAt(map, nx, ny);
    if (t === T_STREET || t === T_ALLEY || t === T_TRANSIT) return true;
  }
  return false;
}

// Building entrances are carved out of block mass ON a street or alley, which
// is what makes "walk to the door and go in" (D9) legible without interiors.
// An entrance is carved out of block mass that fronts a route. Because the
// route side is in the main component, the door is reachable by construction.
function placeEntrance(map, rng, size, owner, districtId, taken, reachable) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const x = roll(rng, 1, size - 2);
    const y = roll(rng, 1, size - 2);
    if (owner[y * size + x] !== districtId) continue;
    if (tileAt(map, x, y) !== T_BLOCK) continue;
    if (!adjacentToRoute(map, x, y)) continue;
    if (taken.has(key(x, y))) continue;
    setTile(map, x, y, T_ENTRANCE);
    reachable[y * size + x] = 1;  // now connected via its route frontage
    taken.add(key(x, y));
    return { x, y };
  }
  return null;
}

function placeOnGround(map, rng, size, owner, districtId, taken, minSpacing, placed, reachable) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const x = roll(rng, 1, size - 2);
    const y = roll(rng, 1, size - 2);
    if (!reachable[y * size + x]) continue;   // main-component rule
    if (districtId >= 0 && owner[y * size + x] !== districtId) continue;
    if (!isOpenGround(map, x, y) && tileAt(map, x, y) !== T_ALLEY) continue;
    if (taken.has(key(x, y))) continue;
    let tooClose = false;
    for (const p of placed) {
      if (Math.abs(p.cellX - x) + Math.abs(p.cellY - y) < minSpacing) { tooClose = true; break; }
    }
    if (tooClose) continue;
    taken.add(key(x, y));
    return { x, y };
  }
  return null;
}

// District cores are Voronoi seeds and can land inside a building — or, worse,
// inside a courtyard joined to the world by a single carved cell. Snap each
// core to the nearest cell of the ROUTE NETWORK (street / alley / transit):
// a core is by definition a place on the road, which is what patrol rings, AI
// navigation and the redundancy probe all assume. Snapping merely to
// "reachable" put cores in courtyards and made a one-cell throat look like a
// genuine choke (found by probe 3, 2026-08-04).
function snapCoresToRoute(map, districts, size, reachable) {
  for (const d of districts) {
    const onRoute = (x, y) => {
      const t = tileAt(map, x, y);
      return (t === T_STREET || t === T_ALLEY || t === T_TRANSIT)
        && reachable[y * size + x];
    };
    if (onRoute(d.coreX, d.coreY)) continue;
    let best = -1, bestD = 0x7fffffff;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!onRoute(x, y)) continue;
        const dist = Math.abs(x - d.coreX) + Math.abs(y - d.coreY);
        if (dist < bestD) { bestD = dist; best = y * size + x; }
      }
    }
    if (best >= 0) { d.coreX = best % size; d.coreY = (best / size) | 0; }
  }
}

// ── Patrol routes ────────────────────────────────────────────────────────
// A route is a circuit over the district's OWN road cells. Fixed routes are
// the readable half of alarm-first doctrine — a player can learn them, and
// that is the point.
//
// This walks the road network rather than stamping a geometric ring. A ring
// intersected with dense building mass could be filtered down below the
// minimum length, which silently left whole districts unpatrolled — a free
// farm for any agent who found one (caught by probe 4 on seed 90210).
function buildPatrolRoute(map, rng, size, district, owner, reachable) {
  const cx = district.coreX, cy = district.coreY;
  const wanted = roll(rng, 10, 18);

  // Collect this district's road cells, nearest-first from the core.
  const candidates = [];
  const radius = 14;
  for (let y = Math.max(1, cy - radius); y <= Math.min(size - 2, cy + radius); y++) {
    for (let x = Math.max(1, cx - radius); x <= Math.min(size - 2, cx + radius); x++) {
      if (!reachable[y * size + x]) continue;
      if (owner[y * size + x] !== district.id) continue;
      const t = tileAt(map, x, y);
      if (t !== T_STREET && t !== T_ALLEY && t !== T_TRANSIT) continue;
      candidates.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
    }
  }
  if (candidates.length < 4) return [];
  candidates.sort((a, b) => (a.d - b.d) || (a.y - b.y) || (a.x - b.x));

  // A nearest-neighbour tour: deterministic, integer-only, and it always
  // yields a walkable circuit when the district has any road at all.
  const pool = candidates.slice(0, Math.min(candidates.length, wanted * 3));
  const used = new Array(pool.length).fill(false);
  const route = [];
  let cur = 0;
  used[0] = true;
  route.push({ x: pool[0].x, y: pool[0].y });
  while (route.length < Math.min(wanted, pool.length)) {
    let best = -1, bestD = 0x7fffffff;
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const d = Math.abs(pool[i].x - pool[cur].x) + Math.abs(pool[i].y - pool[cur].y);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) break;
    used[best] = true;
    cur = best;
    route.push({ x: pool[best].x, y: pool[best].y });
  }
  return route;
}

// ── The generator ────────────────────────────────────────────────────────
export function generateCity(seed, size, cfg) {
  const layoutRng = derive(seed, SALT_LAYOUT);
  const districtRng = derive(seed, SALT_DISTRICT);
  const siteRng = derive(seed, SALT_SITES);
  const patrolRng = derive(seed, SALT_PATROL);

  const cells = new Array(size * size).fill(T_OPEN);
  const map = { width: size, height: size, cells };

  const spacing = cfg.streetSpacing ?? 8;
  const lattice = paintStreets(map, layoutRng, size, spacing);
  paintBlocksAndAlleys(map, layoutRng, size, lattice, cfg.alleyChance ?? 96);
  paintTransit(map, layoutRng, size, lattice);

  const districtCount = roll(districtRng, cfg.districts.min, cfg.districts.max);
  const { owner, districts } = partitionDistricts(map, districtRng, size, districtCount);
  dressDistricts(map, districtRng, size, owner, districts);

  // Terrain is final here; everything below places into the reachable world.
  const reachable = mainComponent(map);
  snapCoresToRoute(map, districts, size, reachable);

  // Sites, scaled by area so a 128 world is denser in absolute terms but
  // comparable per district (D26: both sizes must play).
  // Integer area scale: 1 at 64, 4 at 128.
  const areaScale = Math.trunc((size * size) / (64 * 64)) | 0;
  const siteTarget = Math.min(
    cfg.sites.max, Math.max(cfg.sites.min, (cfg.sites.min * areaScale) | 0)
  );
  const taken = new Set();
  const sites = [];
  for (let i = 0; i < siteTarget; i++) {
    const districtId = i % districts.length;
    const spot = placeOnGround(map, siteRng, size, owner, districtId, taken,
      cfg.sites.minSpacing, sites, reachable);
    if (!spot) continue;
    sites.push({
      id: sites.length,
      type: roll(siteRng, 0, SITE_TYPE_COUNT - 1),
      districtId,
      cellX: spot.x, cellY: spot.y,
      status: 0,
    });
  }

  // Interactive buildings: one safe house (informant) and one market (vendor)
  // per district — the D9 overlay's anchors.
  const buildings = [];
  for (const d of districts) {
    for (let n = 0; n < (cfg.buildings.safeHousesPerDistrict ?? 1); n++) {
      const e = placeEntrance(map, siteRng, size, owner, d.id, taken, reachable);
      if (e) buildings.push({
        id: buildings.length, kind: BUILDING_SAFEHOUSE, districtId: d.id,
        entranceX: e.x, entranceY: e.y, payloadIdx: 0,
        exitX: -1, exitY: -1,
      });
    }
    for (let n = 0; n < (cfg.buildings.marketsPerDistrict ?? 1); n++) {
      const e = placeEntrance(map, siteRng, size, owner, d.id, taken, reachable);
      if (e) buildings.push({
        id: buildings.length, kind: BUILDING_MARKET, districtId: d.id,
        entranceX: e.x, entranceY: e.y, payloadIdx: 0,
        exitX: -1, exitY: -1,
      });
    }
    // D38: a Cover Shop needs TWO doors — you pay to change your face and
    // leave by the other one. A single-entrance disguise is just a pause.
    for (let n = 0; n < (cfg.buildings.coverShopsPerDistrict ?? 1); n++) {
      const e = placeEntrance(map, siteRng, size, owner, d.id, taken, reachable);
      if (!e) continue;
      const back = placeEntrance(map, siteRng, size, owner, d.id, taken, reachable);
      buildings.push({
        id: buildings.length, kind: BUILDING_COVERSHOP, districtId: d.id,
        entranceX: e.x, entranceY: e.y, payloadIdx: 0,
        exitX: back ? back.x : e.x, exitY: back ? back.y : e.y,
      });
    }
  }

  // One Holding Site per district — where Authority and rivals take captives.
  const holdingSites = [];
  if (cfg.holdingSitePerDistrict) {
    for (const d of districts) {
      const spot = placeOnGround(map, siteRng, size, owner, d.id, taken, 3, holdingSites.map(
        (h) => ({ cellX: h.cellX, cellY: h.cellY })
      ), reachable);
      if (!spot) continue;
      holdingSites.push({
        id: holdingSites.length, districtId: d.id,
        cellX: spot.x, cellY: spot.y, heldAgentIds: [],
      });
    }
  }

  // Patrols.
  const patrols = [];
  for (const d of districts) {
    const count = cfg.patrols.perDistrictBase ?? 2;
    for (let n = 0; n < count; n++) {
      const route = buildPatrolRoute(map, patrolRng, size, d, owner, reachable);
      if (route.length < (cfg.patrols.routeLengthMin ?? 8)) continue;
      const startIdx = roll(patrolRng, 0, route.length - 1);
      patrols.push({
        id: patrols.length,
        districtId: d.id,
        x: route[startIdx].x, y: route[startIdx].y,
        routeIdx: startIdx,
        alertTicks: 0,
        targetX: -1, targetY: -1,
        route,
      });
    }
  }

  const cameras_ = placeCameras(sites, siteRng, cfg.cameras, roll, size);
  const beams_ = placeBeams(sites, siteRng, cfg.beams, roll, size);
  return {
    map, districtOwner: owner, districts, sites, buildings, holdingSites, patrols,
    // S16 cameras (8b). Placed here because world LAYOUT belongs in one place;
    // how a camera SEES lives in engine/cameras.js. Uses the site RNG stream so
    // a seed always produces the same watched facilities.
    cameras: cameras_,
    beams: beams_,
    // A junction only exists where there is something to switch off, so it is
    // derived from what was actually placed rather than rolled independently.
    junctions: placeJunctions(
      sites,
      new Set([...cameras_.map((c) => c.siteId), ...beams_.map((x) => x.siteId)]),
      siteRng, cfg.junctions, roll, size),
    // The traversable component, carried with the world. Placement used it at
    // generation time; DROP-IN needs it at runtime (see findDropZones).
    reachable,
  };
}

// D37: the auto-pick when the 15-second timer runs out. Priority order:
// (a) the district with the most tier-appropriate contracts, then (b) clear of
// the map edge, then (c) as far from patrol routes as possible.
//
// The naive "first zone found" is always a map corner — technically safe and
// miserable to play. This is the difference between a system that is correct
// and one that is kind.
export function autoSelectDropZone(state, zones, cfg, hqCfg, tierUnlocked = 1) {
  if (!zones.length) return null;
  const margin = hqCfg?.dropZoneEdgeMargin ?? 6;

  const contractsPerDistrict = new Map();
  for (const c of state.contractPool) {
    if (c.tier > tierUnlocked || c.acceptedBy >= 0) continue;
    contractsPerDistrict.set(c.districtId, (contractsPerDistrict.get(c.districtId) ?? 0) + 1);
  }

  const scored = zones.map((z) => {
    const edgeDist = Math.min(z.cellX, z.cellY, state.size - 1 - z.cellX, state.size - 1 - z.cellY);
    let patrolDist = 0x7fffffff;
    for (const p of state.patrols) {
      patrolDist = Math.min(patrolDist, Math.abs(p.x - z.cellX) + Math.abs(p.y - z.cellY));
    }
    return {
      zone: z,
      contracts: contractsPerDistrict.get(z.districtId) ?? 0,
      edgeOk: edgeDist >= margin ? 1 : 0,
      patrolDist: patrolDist === 0x7fffffff ? 0 : patrolDist,
    };
  });

  scored.sort((a, b) =>
    (b.contracts - a.contracts)
    || (b.edgeOk - a.edgeOk)
    || (b.patrolDist - a.patrolDist)
    || (a.zone.cellY - b.zone.cellY) || (a.zone.cellX - b.zone.cellX));
  return scored[0].zone;
}

// Drop zones are computed against the LIVE world (rival HQs move), so this is
// a query, not a baked artifact (S01/S05).
export function findDropZones(state, cfg, districtId = -1) {
  const zones = [];
  const size = state.size;
  const clear = cfg.dropZones?.minClearRadius ?? 8;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (!isOpenGround(state.map, x, y)) continue;
      // THE STRANDING BUG (2026-08-04): open ground is not the same as
      // CONNECTED ground. District dressing carves courtyards fully enclosed
      // by building mass; they look like perfect drop zones and an agent
      // landing in one can never leave. An AI Firm dropped into a sealed plaza
      // and spent a whole world-day accepting contracts it could not reach —
      // 610 unreachable-abandon cycles. A player would simply have been stuck.
      if (state.reachable && !state.reachable[y * size + x]) continue;
      const d = state.districtOwner ? state.districtOwner[y * size + x] : 0;
      if (districtId >= 0 && d !== districtId) continue;
      let ok = true;
      for (const p of state.patrols) {
        if (Math.abs(p.x - x) + Math.abs(p.y - y) < clear) { ok = false; break; }
      }
      if (ok) for (const h of state.hqs) {
        if (Math.abs(h.cellX - x) + Math.abs(h.cellY - y) < clear) { ok = false; break; }
      }
      if (ok) zones.push({ cellX: x, cellY: y, districtId: d });
    }
  }
  return zones;
}
