// engine/pathfind.js — deterministic grid A* over terrain cost (S02).
//
// Integer costs only. Ties are broken by a fixed rule (lower index first) so
// two runs on the same world always produce the SAME path — a path that varies
// by tie-break order would desync replays and make sim batteries unreadable.
//
// Work is bounded: a search that exceeds the node budget returns the best
// partial path found. Movement must never be able to stall the tick.

import { tileAt } from "./state.js";
import { speedMultiplier, isPassable } from "./terrain.js";

const MAX_NODES = 4096;

// Cost of entering a cell: cheaper on faster terrain. Scaled so a street
// (358) costs less than open (256) which costs less than yard (179).
function enterCost(map, x, y) {
  const t = tileAt(map, x, y);
  if (t < 0 || !isPassable(t)) return -1;
  const speed = speedMultiplier(t);
  return Math.max(1, Math.trunc((256 * 256) / speed));
}

function heuristic(x0, y0, x1, y1) {
  // Manhattan, scaled by the cheapest possible step so it never overestimates.
  return (Math.abs(x1 - x0) + Math.abs(y1 - y0)) * 170;
}

// Returns an array of {x,y} cells from (but not including) the start, ending
// at the goal — or the best partial route toward it.
export function findPath(map, sx, sy, gx, gy, budget = MAX_NODES) {
  if (sx === gx && sy === gy) return [];
  if (enterCost(map, gx, gy) < 0) return [];

  const w = map.width, h = map.height;
  const startIdx = sy * w + sx;
  const goalIdx = gy * w + gx;

  const gScore = new Map();
  const cameFrom = new Map();
  gScore.set(startIdx, 0);

  // A simple binary-heap-free open list: an array kept sorted by insertion is
  // too slow, so use a bucketed scan. n is small (budget-capped) and this
  // keeps the ordering fully deterministic.
  const open = [{ idx: startIdx, f: heuristic(sx, sy, gx, gy) }];
  let expanded = 0;
  let bestIdx = startIdx;
  let bestH = heuristic(sx, sy, gx, gy);

  while (open.length && expanded < budget) {
    // Pick the lowest f; on a tie prefer the lowest index (determinism).
    let pick = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[pick].f
        || (open[i].f === open[pick].f && open[i].idx < open[pick].idx)) pick = i;
    }
    const current = open.splice(pick, 1)[0];
    const cx = current.idx % w, cy = (current.idx / w) | 0;
    expanded++;

    if (current.idx === goalIdx) return reconstruct(cameFrom, current.idx, w);

    const hHere = heuristic(cx, cy, gx, gy);
    if (hHere < bestH) { bestH = hHere; bestIdx = current.idx; }

    // Four-neighbour movement: diagonal steps through building corners would
    // let agents clip between two blocks, which reads as a bug to a player.
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const step = enterCost(map, nx, ny);
      if (step < 0) continue;
      const nIdx = ny * w + nx;
      const tentative = (gScore.get(current.idx) ?? 0) + step;
      if (gScore.has(nIdx) && tentative >= gScore.get(nIdx)) continue;
      gScore.set(nIdx, tentative);
      cameFrom.set(nIdx, current.idx);
      const f = tentative + heuristic(nx, ny, gx, gy);
      const existing = open.findIndex((o) => o.idx === nIdx);
      if (existing >= 0) open[existing].f = f;
      else open.push({ idx: nIdx, f });
    }
  }
  // Budget exhausted or no route: hand back progress toward the goal rather
  // than nothing, so an agent still moves and the player sees intent honoured.
  return bestIdx === startIdx ? [] : reconstruct(cameFrom, bestIdx, w);
}

function reconstruct(cameFrom, idx, w) {
  const path = [];
  let cur = idx;
  while (cameFrom.has(cur)) {
    path.push({ x: cur % w, y: (cur / w) | 0 });
    cur = cameFrom.get(cur);
  }
  path.reverse();
  return path;
}

// Straight-line cell walk, used for sight checks (S03). Bresenham on integers.
export function lineCells(x0, y0, x1, y1) {
  const cells = [];
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let guard = 0; guard < 512; guard++) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return cells;
}
