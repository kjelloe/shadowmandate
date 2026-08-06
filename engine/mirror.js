// engine/mirror.js — the world reflection used by the fairness batteries (S14).
//
// THE MIRROR MAINTENANCE RULE (learned twice in the sibling project, once
// expensively): when a new POSITIONAL subsystem lands, this transform must
// learn to mirror it — otherwise every mirror battery silently measures a
// malformed world and reports confident nonsense. Adding positional state
// without touching this file is a bug, and the test below is what catches it.
//
// The reflection is x-only: cell (x, y) -> (W-1-x, y). Entities live at cell
// centres, so centres reflect onto centres exactly (shared/fixedmath).

import { cellToWorld } from "../shared/fixedmath.js";

export function mirrorCellX(x, width) {
  return width - 1 - x;
}

// Reflection about the map's centre LINE: x' = W*256 - x.
//
// The tempting form is (W*256 - 1) - x, which reflects the index RANGE — but
// it lands a cell centre one unit short of the mirrored cell's centre
// (cell 0's centre 128 maps to 16255, while cell 63's centre is 16256), and
// that one unit is exactly the kind of residue that makes a mirror battery
// measure a world subtly unlike its original. Entities are never at x=0 (the
// minimum is a cell centre, 128), so this form stays in range.
export function mirrorWorldX(worldX, width) {
  return (width * 256 - worldX) | 0;
}

// Every positional field in the state, in one place, so the audit test can
// assert that nothing was forgotten.
export const POSITIONAL_FIELDS = Object.freeze({
  agents: ["x", "targetX"],
  patrols: ["x", "targetX"],
  vehicles: ["x"],
  sites: ["cellX"],
  cameras: ["cellX"],
  beams: ["cellX", "toX"],
  junctions: ["cellX"],
  buildings: ["entranceX", "exitX"],
  holdingSites: ["cellX"],
  hqs: ["cellX"],
  districts: ["coreX"],
});

export function mirrorState(state) {
  const width = state.size;
  const cells = new Array(state.map.cells.length);
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      cells[y * width + mirrorCellX(x, width)] = state.map.cells[y * width + x];
    }
  }
  const districtOwner = state.districtOwner ? new Array(state.districtOwner.length) : null;
  if (districtOwner) {
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < width; x++) {
        districtOwner[y * width + mirrorCellX(x, width)] = state.districtOwner[y * width + x];
      }
    }
  }

  const reachable = state.reachable ? new Uint8Array(state.reachable.length) : null;
  if (reachable) {
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < width; x++) {
        reachable[y * width + mirrorCellX(x, width)] = state.reachable[y * width + x];
      }
    }
  }

  return {
    ...state,
    map: { width: state.map.width, height: state.map.height, cells },
    districtOwner,
    reachable,
    agents: state.agents.map((a) => ({
      ...a,
      x: a.state === 0 ? a.x : mirrorWorldX(a.x, width),
      targetX: a.state === 0 ? a.targetX : mirrorWorldX(a.targetX, width),
      facing: mirrorFacing(a.facing),
      contractIds: a.contractIds.slice(),
    })),
    patrols: state.patrols.map((p) => ({
      ...p,
      x: mirrorCellX(p.x, width),
      targetX: p.targetX < 0 ? p.targetX : mirrorCellX(p.targetX, width),
      route: p.route.map((s) => ({ x: mirrorCellX(s.x, width), y: s.y })),
    })),
    vehicles: state.vehicles.map((v) => ({
      ...v, x: mirrorWorldX(v.x, width), facing: mirrorFacing(v.facing),
    })),
    sites: state.sites.map((s) => ({ ...s, cellX: mirrorCellX(s.cellX, width) })),
    // A camera mirrors in BOTH senses: its position and the direction it looks.
    // Reflecting the cell but not the facing would build a mirror world whose
    // cameras watch the wrong way — the world would look symmetric and play
    // asymmetrically, which is the exact silent corruption a fairness battery
    // is supposed to rule out and would instead be measuring.
    cameras: (state.cameras ?? []).map((c) => ({
      ...c,
      cellX: mirrorCellX(c.cellX, width),
      baseFacing: mirrorFacing(c.baseFacing),
    })),
    // A beam has TWO x coordinates and both must reflect, or the mirrored world
    // gets a beam running somewhere its original had none.
    beams: (state.beams ?? []).map((x) => ({
      ...x,
      cellX: mirrorCellX(x.cellX, width),
      toX: mirrorCellX(x.toX, width),
    })),
    junctions: (state.junctions ?? []).map((j) => ({
      ...j, cellX: mirrorCellX(j.cellX, width),
    })),
    buildings: state.buildings.map((b) => ({
      ...b,
      entranceX: mirrorCellX(b.entranceX, width),
      exitX: b.exitX >= 0 ? mirrorCellX(b.exitX, width) : b.exitX,
    })),
    holdingSites: state.holdingSites.map((h) => ({
      ...h, cellX: mirrorCellX(h.cellX, width), heldAgentIds: h.heldAgentIds.slice(),
    })),
    hqs: state.hqs.map((h) => ({ ...h, cellX: mirrorCellX(h.cellX, width) })),
    districts: state.districts.map((d) => ({ ...d, coreX: mirrorCellX(d.coreX, width) })),
    contractPool: state.contractPool.map((c) => ({
      ...c,
      contenders: (c.contenders ?? []).slice(),
      contestedBy: (c.contestedBy ?? []).slice(),
    })),
    offers: state.offers.map((o) => ({ ...o, contractIds: o.contractIds.slice() })),
    standoffs: state.standoffs.map((s) => ({ ...s })),
    // Alarms key off siteId and carry no coordinate, so there is nothing to
    // reflect — but they must still be COPIED. The `...state` spread above
    // would otherwise share the array by reference and let a mirrored world
    // mutate its twin, which is the silent kind of battery corruption the
    // MIRROR AUDIT exists to prevent.
    alarms: (state.alarms ?? []).map((a) => ({ ...a })),
    credentials: (state.credentials ?? []).map((c) => ({ ...c })),
    pacts: state.pacts.map((p) => ({ ...p })),
    firms: state.firms.map((f) => ({
      ...f,
      heatIntel: (f.heatIntel ?? []).map((h) => ({ ...h })),
      knownRivalHqs: (f.knownRivalHqs ?? []).slice(),
      upgrades: (f.upgrades ?? []).slice(),
    })),
    events: [],
  };
}

// Facing octants: 0=E, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE.
// An x-mirror maps E<->W and leaves N/S alone.
export function mirrorFacing(facing) {
  const table = [4, 3, 2, 1, 0, 7, 6, 5];
  return table[facing & 7];
}

// Sanity: mirroring twice is the identity. Cheap, and it catches an
// off-by-one in the reflection instantly.
export function isInvolution(state) {
  const twice = mirrorState(mirrorState(state));
  if (twice.map.cells.length !== state.map.cells.length) return false;
  for (let i = 0; i < state.map.cells.length; i++) {
    if (twice.map.cells[i] !== state.map.cells[i]) return false;
  }
  for (const [i, s] of state.sites.entries()) {
    if (twice.sites[i].cellX !== s.cellX) return false;
  }
  for (const [i, d] of state.districts.entries()) {
    if (twice.districts[i].coreX !== d.coreX) return false;
  }
  return true;
}
