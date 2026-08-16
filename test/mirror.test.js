// test/mirror.test.js — the mirror instrument must stay honest (S14).
//
// The audit test at the bottom is the important one: it fails when a new
// positional field lands in the state without the mirror learning it. In the
// sibling project that omission silently invalidated whole mirror batteries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateCity } from "../engine/citygen.js";
import { createInitialState } from "../engine/state.js";
import { mirrorState, mirrorCellX, mirrorWorldX, mirrorFacing, isInvolution, POSITIONAL_FIELDS } from "../engine/mirror.js";
import { runAllProbes, probesPassed } from "../engine/worldprobes.js";
import { cellToWorld } from "../shared/fixedmath.js";

const CFG = JSON.parse(readFileSync(new URL("../data/citygen.json", import.meta.url).pathname, "utf8"));
const world = (seed = 4711, size = 64) => createInitialState({ seed, size, city: generateCity(seed, size, CFG) });

test("cell reflection is exact and self-inverse", () => {
  for (const w of [64, 128]) {
    for (const x of [0, 1, 7, 31, w - 1]) {
      assert.equal(mirrorCellX(mirrorCellX(x, w), w), x);
    }
  }
});

test("centre-anchored world reflection maps centres onto centres", () => {
  const w = 64;
  for (const cell of [0, 1, 17, 63]) {
    const centre = cellToWorld(cell);
    const mirrored = mirrorWorldX(centre, w);
    assert.equal(mirrored, cellToWorld(mirrorCellX(cell, w)),
      "a mirrored centre must be exactly the mirrored cell's centre");
  }
});

test("facing reflection swaps east and west, preserves north and south", () => {
  assert.equal(mirrorFacing(0), 4);   // E -> W
  assert.equal(mirrorFacing(4), 0);   // W -> E
  assert.equal(mirrorFacing(2), 2);   // N -> N
  assert.equal(mirrorFacing(6), 6);   // S -> S
  for (let f = 0; f < 8; f++) assert.equal(mirrorFacing(mirrorFacing(f)), f);
});

test("mirroring a world twice is the identity", () => {
  assert.ok(isInvolution(world(4711)));
  assert.ok(isInvolution(world(90210, 128)));
});

test("a mirrored world still passes every probe", () => {
  for (const seed of [4711, 90210, 1000]) {
    const s = mirrorState(world(seed));
    const results = runAllProbes({
      map: s.map, districts: s.districts, sites: s.sites, buildings: s.buildings,
      holdingSites: s.holdingSites, patrols: s.patrols, districtOwner: s.districtOwner,
    }, CFG);
    assert.ok(probesPassed(results),
      `mirrored seed ${seed} failed: ${JSON.stringify(results)}`);
  }
});

test("mirrored positions are the reflections of the originals", () => {
  const s = world(4711);
  const m = mirrorState(s);
  for (const [i, site] of s.sites.entries()) {
    assert.equal(m.sites[i].cellX, mirrorCellX(site.cellX, s.size));
    assert.equal(m.sites[i].cellY, site.cellY, "y must be untouched — the mirror is x-only");
  }
  for (const [i, p] of s.patrols.entries()) {
    assert.equal(m.patrols[i].x, mirrorCellX(p.x, s.size));
    assert.equal(m.patrols[i].route.length, p.route.length);
  }
  for (const [i, b] of s.buildings.entries()) {
    assert.equal(m.buildings[i].entranceX, mirrorCellX(b.entranceX, s.size));
  }
});

test("MIRROR AUDIT: every positional x-field in the state is declared and mirrored", () => {
  // Any field whose name ends in X (or is exactly "x") is positional. If one
  // appears that the mirror does not handle, this fails — deliberately loudly.
  const s = world(4711);
  s.hqs.push({ id: 0, firmId: 0, cellX: 10, cellY: 10, condition: 100,
    cacheResources: 0, evacActive: 0, evacTicks: 0, evacPaused: 0,
    alarmTicks: 0, lootTicks: 0, lootedBy: -1 });
  s.vehicles.push({ id: 0, kind: 0, firmId: 0, x: cellToWorld(5), y: cellToWorld(5),
    riderAgentId: -1, facing: 0, moveProgress: 0 });
  s.agents[0].state = 1;
  s.agents[0].x = cellToWorld(9);
  s.agents[0].targetX = cellToWorld(11);

  const undeclared = [];
  for (const [collection, items] of Object.entries(s)) {
    if (!Array.isArray(items) || !POSITIONAL_FIELDS[collection]) {
      // Collections with no declared positional fields must genuinely have none.
      if (Array.isArray(items) && items.length && typeof items[0] === "object") {
        for (const field of Object.keys(items[0])) {
          if ((field === "x" || /X$/.test(field)) && !POSITIONAL_FIELDS[collection]) {
            undeclared.push(`${collection}.${field}`);
          }
        }
      }
      continue;
    }
    for (const field of Object.keys(items[0] ?? {})) {
      if ((field === "x" || /X$/.test(field)) && !POSITIONAL_FIELDS[collection].includes(field)) {
        undeclared.push(`${collection}.${field}`);
      }
    }
  }
  assert.deepEqual(undeclared, [],
    `positional fields the mirror does not know about:\n  ${undeclared.join("\n  ")}\n` +
    "Add them to engine/mirror.js POSITIONAL_FIELDS and mirrorState, or every " +
    "mirror battery from here on measures a malformed world.");

  // And the declared ones must actually move.
  const m = mirrorState(s);
  assert.equal(m.hqs[0].cellX, mirrorCellX(10, s.size));
  assert.equal(m.vehicles[0].x, mirrorWorldX(cellToWorld(5), s.size));
  assert.equal(m.agents[0].x, mirrorWorldX(cellToWorld(9), s.size));
  assert.equal(m.agents[0].targetX, mirrorWorldX(cellToWorld(11), s.size));
});
