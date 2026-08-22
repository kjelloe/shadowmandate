// test/roads.test.js — the street dressing (playtest 5).
//
// "The gray streets need to be proper streets." What is protected here:
//   - road features are deterministic per seed;
//   - paint lands only on road tiles, and intersections stay unpainted;
//   - a transit avenue carries MORE paint than a street (4-lane vs 2-lane —
//     the visible difference is the feature);
//   - lamps keep the kerb: perpendicular offset outside the clearance ring,
//     so a post can never cover an agent standing at a cell centre;
//   - lamp states partition sanely and every state actually occurs — a city
//     where no lamp is broken is not this city, and a city where none is lit
//     is a render fault;
//   - buildRoads produces meshes and exposes the two blink groups.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  setTerrainTokens, roadFeatures, buildRoads,
  STREET_TILE, TRANSIT_TILE, LAMP_KERB, CLUTTER_CLEARANCE,
} from "../client/js/terrain3d.js";

const root = new URL("../", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("client/assets/metadata/style_tokens.json", root)));

// A grid of streets with one transit avenue and real intersections.
function roadMap(size = 32) {
  const tiles = new Uint8Array(size * size);
  for (let i = 4; i < size - 4; i += 8) {
    for (let k = 1; k < size - 1; k++) {
      tiles[i * size + k] = STREET_TILE;        // east-west streets
      tiles[k * size + i] = STREET_TILE;        // north-south streets
    }
  }
  for (let k = 1; k < size - 1; k++) tiles[16 * size + k] = TRANSIT_TILE;
  return { tiles, size };
}

test("road features are deterministic per seed, and differ across seeds", () => {
  const { tiles, size } = roadMap();
  const road = tokens.terrain.road;
  const a = roadFeatures(tiles, size, 4711, road);
  assert.deepEqual(a, roadFeatures(tiles, size, 4711, road),
    "the same seed must paint the same streets on every machine");
  assert.notDeepEqual(a.lamps, roadFeatures(tiles, size, 90210, road).lamps,
    "different worlds should not share their lamps");
});

test("paint stays on road tiles and intersections stay clean", () => {
  const { tiles, size } = roadMap();
  const { markings } = roadFeatures(tiles, size, 4711, tokens.terrain.road);
  assert.ok(markings.length > 0, "no paint at all — the pass silently did nothing");
  const isRoadTile = (x, y) =>
    tiles[y * size + x] === STREET_TILE || tiles[y * size + x] === TRANSIT_TILE;
  for (const k of markings) {
    assert.ok(isRoadTile(k.x, k.y), `paint at ${k.x},${k.y} is off the road`);
    const ew = isRoadTile(k.x - 1, k.y) || isRoadTile(k.x + 1, k.y);
    const ns = isRoadTile(k.x, k.y - 1) || isRoadTile(k.x, k.y + 1);
    assert.ok(!(ew && ns), `paint at ${k.x},${k.y} sits on an intersection`);
  }
});

test("streets are 4-lane, avenues wider still, and sidewalks hug the kerbs (playtest 6)", () => {
  const { tiles, size } = roadMap();
  const { markings, sidewalks } = roadFeatures(tiles, size, 4711, tokens.terrain.road);
  const perCell = new Map();
  for (const k of markings) {
    const key = `${k.x},${k.y}`;
    perCell.set(key, (perCell.get(key) ?? 0) + 1);
  }
  const count = (tile) => {
    const cells = [...perCell.entries()].filter(([key]) => {
      const [x, y] = key.split(",").map(Number);
      return tiles[y * size + x] === tile;
    });
    assert.ok(cells.length > 0, `no painted cells of tile ${tile}`);
    return cells.reduce((a, [, n]) => a + n, 0) / cells.length;
  };
  // A street cell is a full 4-lane carriageway: double centre + lane dashes.
  assert.ok(count(STREET_TILE) >= 4,
    "a street carries fewer than 4 markings per cell — the 4-lane read never happened");
  // An avenue reads wider on top of that: solid edge lines.
  assert.ok(count(TRANSIT_TILE) > count(STREET_TILE),
    "the avenue carries no more paint than a street");
  assert.ok(markings.some((k) => k.solid && tiles[k.y * size + k.x] === STREET_TILE),
    "streets lost their solid centre lines");

  // Sidewalks: on road cells only, only on edges that face OFF the road, and
  // hugging the kerb — never in the travel lanes or over a cell centre.
  assert.ok(sidewalks.length > 0, "no sidewalks at all — the refinement silently did nothing");
  const isRoadTile = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return tiles[y * size + x] === STREET_TILE || tiles[y * size + x] === TRANSIT_TILE;
  };
  for (const s of sidewalks) {
    assert.ok(isRoadTile(s.x, s.y), `sidewalk anchored off the road at ${s.x},${s.y}`);
    assert.ok(!isRoadTile(s.x + s.dx, s.y + s.dy),
      `sidewalk at ${s.x},${s.y} faces another road cell — a kerb in the middle of the street`);
    assert.ok(Math.abs(s.dx) + Math.abs(s.dy) === 1, "a sidewalk must face exactly one edge");
  }
});

test("lamps keep the kerb and every state actually occurs", () => {
  const { tiles, size } = roadMap();
  const { lamps } = roadFeatures(tiles, size, 4711, tokens.terrain.road);
  assert.ok(lamps.length > 4, "a city this size should have street lighting");
  const states = new Set();
  for (const l of lamps) {
    states.add(l.state === "blinkA" || l.state === "blinkB" ? "blink" : l.state);
    const perp = Math.max(Math.abs(l.dx), Math.abs(l.dz));
    assert.ok(perp >= LAMP_KERB - 1e-9,
      `lamp at ${l.x},${l.y} stands ${perp} from the centre line — inside the travel lane`);
    assert.ok(perp > CLUTTER_CLEARANCE,
      "a lamp post inside the clearance ring can cover a standing agent");
    assert.ok(["lit", "off", "blinkA", "blinkB"].includes(l.state));
  }
  assert.deepEqual([...states].sort(), ["blink", "lit", "off"],
    "lit, dead and blinking lamps must ALL exist — that mix is the whole look");
});

test("buildRoads yields meshes and the two blink phases", () => {
  setTerrainTokens(tokens.terrain);
  const { tiles, size } = roadMap();
  const group = buildRoads(tiles, size, 4711);
  assert.ok(group, "no road group built");
  assert.ok(group.children.length >= 3, "paint, posts and heads should all be present");
  const blink = group.userData.blink;
  assert.ok(blink && blink.A.length > 0 && blink.B.length > 0,
    "both blink phases must exist, or the faulty lamps read as a stage set in unison");
  // A world with no roads builds nothing.
  assert.equal(buildRoads(new Uint8Array(64), 8, 4711), null);
});
