// debugging/dbg_area_ring.mjs — S17 guard-ring legality census (kept).
//
// Earned its place: this is the probe that found why the M5 gate went red when
// per-type templates landed (playtest 13, finding 6). The ring's four corners
// are pure geometry, drawn without reference to the floor plan, and against the
// office plan a quarter of all waypoints landed INSIDE the objective room's
// wall. A guard advances its route only on arrival, so an unreachable waypoint
// parks it permanently — a wall with eyes, watching the corridor forever.
//
// Then the naive fix put waypoints one cell from the objective, which is the
// 8a camera-on-the-site defect indoors: surveillance needs an unseen hold
// there, so the contract became impossible at every office site in the world.
//
// Four columns, and all four must read zero.
import { buildAreaGrid, guardRoute, AT_WALL, AREA_WAREHOUSE, AREA_OFFICE, AREA_INDUSTRIAL, AREA_TRANSIT } from "../engine/areas.js";
import { findPath } from "../engine/pathfind.js";
import { RULES } from "../test/helpers.js";
const CFG = RULES.areas, W = CFG.width | 0, H = CFG.height | 0;
const names = ["warehouse", "office", "industrial", "transit"];
for (const t of [AREA_WAREHOUSE, AREA_OFFICE, AREA_INDUSTRIAL, AREA_TRANSIT]) {
  let inWall = 0, unreachable = 0, total = 0, coversObj = 0, minD = 99;
  for (const seed of [1000, 1411, 4711, 90210, 2026]) {
    for (let site = 0; site < 14; site++) {
      const grid = buildAreaGrid(seed, site, CFG, t);
      const { tiles, objective } = grid;
      const map = { width: W, height: H, cells: tiles };
      for (let gi = 0; gi < (CFG.guardsPerArea | 0); gi++) {
        const route = guardRoute(seed, site, CFG, gi, grid);
        for (let i = 0; i < route.length; i++) {
          total++;
          const wp = route[i];
          if (tiles[wp.y * W + wp.x] === AT_WALL) { inWall++; continue; }
          const from = route[(i + route.length - 1) % route.length];
          if (tiles[from.y * W + from.x] === AT_WALL) continue;
          if (from.x === wp.x && from.y === wp.y) continue;   // duplicate, not unreachable
          if (!findPath(map, from.x, from.y, wp.x, wp.y).length) unreachable++;
          const d = Math.max(Math.abs(wp.x - objective.x), Math.abs(wp.y - objective.y));
          minD = Math.min(minD, d);
          if (d <= (CFG.guardSightRadius | 0)) coversObj++;
        }
      }
    }
  }
  console.log(`${names[t].padEnd(11)} waypoints ${total}  IN WALL ${inWall}  unreachable ${unreachable}  COVERS OBJECTIVE ${coversObj}  nearest ${minD}`);
}
