#!/usr/bin/env node
// tools/render_city.mjs — dump a generated city as ASCII, for eyes.
//   node tools/render_city.mjs [seed] [size] [streetSpacing]
//
// This is the microscope: a generator you cannot read is a generator you
// cannot debug. The committed 16x16 dump in test/fixtures/microscope.txt is
// produced by this tool and pinned by test/citygen.test.js.

import { readFileSync } from "node:fs";
import { generateCity } from "../engine/citygen.js";

export const GLYPH = {
  0: ".",   // open
  1: "=",   // street
  2: ":",   // alley
  3: "P",   // plaza
  4: "#",   // block
  5: "D",   // entrance (door)
  6: "T",   // transit
  7: "!",   // checkpoint
  8: "y",   // yard
  9: ",",   // rough
  10: "~",  // water
};

export function renderCity(world, { marks = true } = {}) {
  const { map } = world;
  const overlay = new Map();
  if (marks) {
    for (const s of world.sites) overlay.set(s.cellY * map.width + s.cellX, "S");
    for (const h of world.holdingSites) overlay.set(h.cellY * map.width + h.cellX, "H");
    for (const b of world.buildings) {
      const mark = b.kind === 0 ? "i" : b.kind === 1 ? "$" : "c";
      overlay.set(b.entranceY * map.width + b.entranceX, mark);
      // A cover shop's second door is the whole point of it (D38).
      if (b.kind === 2 && b.exitX >= 0) overlay.set(b.exitY * map.width + b.exitX, "x");
    }
    for (const p of world.patrols) overlay.set(p.y * map.width + p.x, "p");
    for (const d of world.districts) overlay.set(d.coreY * map.width + d.coreX, String(d.id));
  }
  const lines = [];
  for (let y = 0; y < map.height; y++) {
    let row = "";
    for (let x = 0; x < map.width; x++) {
      const idx = y * map.width + x;
      row += overlay.get(idx) ?? GLYPH[map.cells[idx]] ?? "?";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

export function cityLegend() {
  return [
    "legend: . open  = street  : alley  P plaza  # block  D door  T transit",
    "        ! checkpoint  y yard  , rough  ~ water",
    "marks:  S site  H holding  i informant  $ market  c cover shop  x its back door",
    "        p patrol  0-4 district core",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfgPath = new URL("../data/citygen.json", import.meta.url).pathname;
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const seed = Number(process.argv[2] ?? 4711);
  const size = Number(process.argv[3] ?? 64);
  if (process.argv[4]) cfg.streetSpacing = Number(process.argv[4]);
  const world = generateCity(seed, size, cfg);
  console.log(`# Shadow Mandate city — seed ${seed}, size ${size}, spacing ${cfg.streetSpacing}`);
  console.log(`# districts ${world.districts.length}  sites ${world.sites.length}  ` +
    `buildings ${world.buildings.length}  patrols ${world.patrols.length}`);
  console.log(cityLegend());
  console.log(renderCity(world));
}
