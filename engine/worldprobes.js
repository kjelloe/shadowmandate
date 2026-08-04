// engine/worldprobes.js — S01 validation probes.
//
// A generated city that fails a probe is not shipped: it is regenerated or the
// seed is rejected. These run over the whole corpus at BOTH sizes (D26), and
// they are the reason a bad seed can never quietly produce an unplayable world.

import { T_BLOCK, T_WATER, T_STREET, T_ALLEY, T_TRANSIT, T_ENTRANCE, isPassable } from "./terrain.js";
import { tileAt } from "./state.js";

function passable(map, x, y) {
  const t = tileAt(map, x, y);
  return t >= 0 && isPassable(t);
}

// Flood fill from a start cell over passable terrain.
export function reachableFrom(map, sx, sy) {
  const seen = new Uint8Array(map.width * map.height);
  if (!passable(map, sx, sy)) return seen;
  const queue = [sx + sy * map.width];
  seen[sx + sy * map.width] = 1;
  while (queue.length) {
    const idx = queue.pop();
    const x = idx % map.width, y = (idx / map.width) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const n = nx + ny * map.width;
      if (seen[n] || !passable(map, nx, ny)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

// Probe 1 — connectivity: every district core, site, building entrance and
// holding site must sit in ONE connected traversable component. A stranded
// contract site is an unplayable world, not a hard one.
export function probeConnectivity(world) {
  const { map, districts, sites, buildings, holdingSites } = world;
  const start = districts[0];
  if (!start) return { ok: false, reason: "no districts" };
  let sx = start.coreX, sy = start.coreY;
  if (!passable(map, sx, sy)) {
    outer:
    for (let r = 1; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (passable(map, start.coreX + dx, start.coreY + dy)) {
          sx = start.coreX + dx; sy = start.coreY + dy; break outer;
        }
      }
    }
  }
  const seen = reachableFrom(map, sx, sy);
  const unreachable = [];
  const check = (x, y, what) => {
    if (!seen[x + y * map.width]) unreachable.push(`${what} @${x},${y}`);
  };
  for (const s of sites) check(s.cellX, s.cellY, `site${s.id}`);
  for (const b of buildings) check(b.entranceX, b.entranceY, `building${b.id}`);
  for (const h of holdingSites) check(h.cellX, h.cellY, `holding${h.id}`);
  return { ok: unreachable.length === 0, unreachable };
}

// Probe 2 — site spacing: contracts must not stack on top of each other, or
// "travel to the objective" stops being a decision.
export function probeSiteSpacing(world, minSpacing) {
  const bad = [];
  for (let i = 0; i < world.sites.length; i++) {
    for (let j = i + 1; j < world.sites.length; j++) {
      const a = world.sites[i], b = world.sites[j];
      const d = Math.abs(a.cellX - b.cellX) + Math.abs(a.cellY - b.cellY);
      if (d < minSpacing) bad.push(`${a.id}~${b.id} d=${d}`);
    }
  }
  return { ok: bad.length === 0, bad };
}

// Probe 3 — route redundancy: no single cell may be the only way between two
// district cores. A one-cell choke is a kill box, and an AI traffic jam.
export function probeRouteRedundancy(world) {
  const { map, districts } = world;
  if (districts.length < 2) return { ok: true, chokes: [] };
  const a = districts[0], b = districts[1];
  const base = reachableFrom(map, a.coreX, a.coreY);
  if (!base[b.coreX + b.coreY * map.width]) {
    return { ok: false, chokes: ["cores not connected"] };
  }
  // Sample the corridor rather than every cell: cutting any single passable
  // cell on the straight line between cores must not disconnect them.
  //
  // INSTRUMENT NOTE (2026-08-04): the endpoints must be excluded. Integer
  // truncation on a short line maps early samples back onto core A's own cell;
  // cutting the flood-fill's START makes it return nothing, and the probe
  // reported every such world as choked. That was the instrument lying, not a
  // bad map — verify the instrument before believing the reading.
  const chokes = [];
  const steps = 24;
  const isCore = (x, y) =>
    (x === a.coreX && y === a.coreY) || (x === b.coreX && y === b.coreY);
  for (let i = 1; i < steps; i++) {
    const x = a.coreX + Math.trunc(((b.coreX - a.coreX) * i) / steps);
    const y = a.coreY + Math.trunc(((b.coreY - a.coreY) * i) / steps);
    if (isCore(x, y)) continue;
    if (!passable(map, x, y)) continue;
    const saved = map.cells[y * map.width + x];
    map.cells[y * map.width + x] = T_BLOCK;
    const cut = reachableFrom(map, a.coreX, a.coreY);
    map.cells[y * map.width + x] = saved;
    if (!cut[b.coreX + b.coreY * map.width]) chokes.push(`${x},${y}`);
  }
  return { ok: chokes.length === 0, chokes };
}

// Probe 4 — patrol coverage: every district is patrolled, and no district is
// left without pressure (a district with no patrols is a free farm).
export function probePatrolCoverage(world) {
  const counts = new Map();
  for (const d of world.districts) counts.set(d.id, 0);
  for (const p of world.patrols) counts.set(p.districtId, (counts.get(p.districtId) ?? 0) + 1);
  const empty = [...counts.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  return { ok: empty.length === 0, empty };
}

// Probe 5 — entrance validity: every interactive building's door is adjacent
// to a street or alley and stands on an entrance tile.
export function probeEntrances(world) {
  const bad = [];
  for (const b of world.buildings) {
    if (tileAt(world.map, b.entranceX, b.entranceY) !== T_ENTRANCE) {
      bad.push(`building${b.id} not an entrance tile`);
      continue;
    }
    let onRoute = false;
    for (const [nx, ny] of [[b.entranceX + 1, b.entranceY], [b.entranceX - 1, b.entranceY],
      [b.entranceX, b.entranceY + 1], [b.entranceX, b.entranceY - 1]]) {
      const t = tileAt(world.map, nx, ny);
      if (t === T_STREET || t === T_ALLEY || t === T_TRANSIT) { onRoute = true; break; }
    }
    if (!onRoute) bad.push(`building${b.id} unreachable door`);
  }
  return { ok: bad.length === 0, bad };
}

// Probe 6 — drop-zone availability: every district can take a dropship in an
// empty world, or a player can be locked out of a whole region at drop-in.
export function probeDropZones(world, cfg) {
  const size = world.map.width;
  const clear = cfg.dropZones?.minClearRadius ?? 8;
  const perDistrict = new Map();
  for (const d of world.districts) perDistrict.set(d.id, 0);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const t = tileAt(world.map, x, y);
      if (t === T_BLOCK || t === T_WATER || !isPassable(t)) continue;
      // A drop zone in a sealed courtyard strands whoever lands in it.
      if (world.reachable && !world.reachable[y * size + x]) continue;
      let ok = true;
      for (const p of world.patrols) {
        if (Math.abs(p.x - x) + Math.abs(p.y - y) < clear) { ok = false; break; }
      }
      if (!ok) continue;
      const d = world.districtOwner[y * size + x];
      perDistrict.set(d, (perDistrict.get(d) ?? 0) + 1);
    }
  }
  const min = cfg.dropZones?.minPerDistrict ?? 3;
  const starved = [...perDistrict.entries()].filter(([, n]) => n < min);
  return { ok: starved.length === 0, starved: starved.map(([id, n]) => `d${id}:${n}`) };
}

export function runAllProbes(world, cfg) {
  return {
    connectivity: probeConnectivity(world),
    spacing: probeSiteSpacing(world, cfg.sites.minSpacing),
    redundancy: probeRouteRedundancy(world),
    patrols: probePatrolCoverage(world),
    entrances: probeEntrances(world),
    dropZones: probeDropZones(world, cfg),
  };
}

export function probesPassed(results) {
  return Object.values(results).every((r) => r.ok);
}
