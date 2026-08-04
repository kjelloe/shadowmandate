// shared/fixedmath.js — integer / 256-unit fixed-point helpers.
// Reconstructed for the 1E contract from test/fixtures/0E (milestone 0).
// One cell = 256 fixed world units. All functions are pure integer math.

export const CELL_SIZE = 256;

export function clampI32(v, min, max) {
  if (v < min) return min | 0;
  if (v > max) return max | 0;
  return v | 0;
}

export function floorDivI32(a, b) {
  return Math.floor(a / b) | 0;
}

// Signed division rounded TOWARD ZERO — for quantities where negative
// and positive must shrink by the same magnitude. floorDivI32 on a
// signed product rounds -inf-ward, which made westward/northward
// movement steps up to a unit longer than their mirrors (the riverline
// east-edge root cause, 2026-07-27).
export function truncDivI32(a, b) {
  return Math.trunc(a / b) | 0;
}

export function absI32(v) {
  return v < 0 ? (-v | 0) : (v | 0);
}

// Entities live at the CENTRE of their cell, not its left edge.
//
// The left-edge convention (cell * 256) made exact mirror-equivariance
// unreachable: a left edge does not reflect onto a left edge, so a
// mirrored world started up to 255 units (~1 cell) out of step with the
// normal one and every mirror measurement carried that artifact. Centres
// reflect onto centres exactly — (W*256-1) - (c*256+128) is precisely
// the centre of cell W-1-c — so the mirror world is finally a true
// mirror. See specs/08 §4.
export function cellToWorld(cell) {
  return ((cell * CELL_SIZE) + (CELL_SIZE >> 1)) | 0;
}

// THE BOUNDARY-PARITY LAW (2026-08-01, the directional residue's
// root): plain floor does NOT commute with the x-mirror at exact
// cell boundaries (world % 256 === 0) — the mirror maps boundary
// points to boundary points and floor assigns both to the RIGHT-hand
// cell, so mirrored worlds sample different cells. For any DECISION
// keyed to a continuous x-position, use this instead: on a boundary,
// the EAST half rounds down (the exact map centre is a self-mirror
// point and stays consistent). y needs nothing — the mirror is
// x-only. Plain worldToCellFloor stays correct for y, for UI, and
// for anything already cell-latticed.
export function sampleCellX(world, mapWidth = 128) {
  const c = world >> 8;
  return (world & 255) === 0 && 2 * world > mapWidth * 256 ? c - 1 : c;
}

export function worldToCellFloor(world) {
  return floorDivI32(world, CELL_SIZE);
}

export function manhattanDistanceI32(x0, y0, x1, y1) {
  return (absI32(x1 - x0) + absI32(y1 - y0)) | 0;
}

export function mulFixed(a, b) {
  return floorDivI32(a * b, CELL_SIZE);
}

export function divFixed(a, b) {
  return floorDivI32(a * CELL_SIZE, b);
}
