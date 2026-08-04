// debugging/dbg_choke.mjs — print the neighbourhood of a redundancy choke.
//   node debugging/dbg_choke.mjs <seed> <size>
// Kept per the sibling-project practice: one-off probes are documentation of
// past hunts, so keep them even after the bug dies.

import { readFileSync } from "node:fs";
import { generateCity } from "../engine/citygen.js";
import { probeRouteRedundancy, reachableFrom } from "../engine/worldprobes.js";

const CFG = JSON.parse(readFileSync(new URL("../data/citygen.json", import.meta.url).pathname, "utf8"));
const seed = Number(process.argv[2] ?? 1548);
const size = Number(process.argv[3] ?? 64);

const world = generateCity(seed, size, CFG);
const r = probeRouteRedundancy(world);
console.log(`seed ${seed}@${size} redundancy:`, JSON.stringify(r));

const [a, b] = world.districts;
console.log(`core A d${a.id} @${a.coreX},${a.coreY} tile=${world.map.cells[a.coreY * size + a.coreX]}`);
console.log(`core B d${b.id} @${b.coreX},${b.coreY} tile=${world.map.cells[b.coreY * size + b.coreX]}`);

const GLYPH = ["·", "=", ":", "□", "#", "D", "T", "!", "y", ",", "~"];
for (const choke of r.chokes ?? []) {
  if (!choke.includes(",")) { console.log(choke); continue; }
  const [cx, cy] = choke.split(",").map(Number);
  console.log(`\n--- choke ${cx},${cy} (tile ${world.map.cells[cy * size + cx]}) ---`);
  for (let y = cy - 6; y <= cy + 6; y++) {
    let row = "";
    for (let x = cx - 12; x <= cx + 12; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) { row += " "; continue; }
      if (x === cx && y === cy) { row += "X"; continue; }
      if (x === a.coreX && y === a.coreY) { row += "A"; continue; }
      if (x === b.coreX && y === b.coreY) { row += "B"; continue; }
      row += GLYPH[world.map.cells[y * size + x]] ?? "?";
    }
    console.log(row);
  }
  // How large is each side after the cut?
  const saved = world.map.cells[cy * size + cx];
  world.map.cells[cy * size + cx] = 4; // T_BLOCK
  const seen = reachableFrom(world.map, a.coreX, a.coreY);
  let n = 0; for (const v of seen) n += v;
  world.map.cells[cy * size + cx] = saved;
  console.log(`after cut, component containing A = ${n} cells`);
}
