// test/massing.test.js — the block-massing pass (playtest 4, finding 1).
//
// The complaint being fixed: every building-mass CELL extruded into its own
// tower, so every city block read as a lone highriser and the city read as a
// bar chart. Massing now groups contiguous mass cells into BLOCKS and gives
// each block an architectural character. The properties protected here:
//   - grouping is by real 4-connectivity, interiors detected correctly;
//   - massing is deterministic per seed (two players see the same city);
//   - every block cell is drawn, and nothing is drawn off the block footprint
//     (the honesty rule: the visual mass IS the gameplay mass);
//   - multi-cell blocks join into one continuous building, not a tower row;
//   - the template set actually varies — low-rise blocks EXIST, which is the
//     entire point of the pass — while the skyline keeps real towers;
//   - courtyard blocks are hollow and podium towers rise above their slab.
//
// Also here: viewHalfSpans, the camera-rotation clamp maths for the 45-degree
// Syndicate-style view — pure, so it is tested where it can fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  setTerrainTokens, blockRegions, blockMassing, buildBlocks, buildWindowData,
  BLOCK_TILE, MASSING_MAX_H, MASSING_JOIN_W, PARCEL_MAX, WIN_TEX,
} from "../client/js/terrain3d.js";
import { clampMargin, clampCamera } from "../client/js/scene.js";

const root = new URL("../", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("client/assets/metadata/style_tokens.json", root)));

function rectMap(size, rects) {
  const tiles = new Uint8Array(size * size);
  for (const [x0, y0, w, h] of rects) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) tiles[y * size + x] = BLOCK_TILE;
    }
  }
  return tiles;
}

// A city's worth of block shapes, separated so each rect is its own region:
// singles, strips, squares — every size class the template picker branches on.
function varietyMap(size = 40) {
  const shapes = [[1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 3]];
  const rects = [];
  let i = 0;
  for (let y = 1; y + 4 < size; y += 5) {
    for (let x = 1; x + 4 < size; x += 5) {
      const [w, h] = shapes[i++ % shapes.length];
      rects.push([x, y, w, h]);
    }
  }
  return { tiles: rectMap(size, rects), size };
}

const regionOf = (regions, x, y) =>
  regions.find((r) => r.cells.some(([cx, cy]) => cx === x && cy === y));

test("regions: 4-connectivity grouping, and interiors detected correctly", () => {
  const size = 12;
  // A 3x3 square, an isolated single, and an L that touches neither.
  const tiles = rectMap(size, [[1, 1, 3, 3], [6, 1, 1, 1], [1, 6, 1, 2]]);
  tiles[7 * size + 2] = BLOCK_TILE;   // completes the L: (1,6),(1,7),(2,7)
  const regions = blockRegions(tiles, size);
  assert.equal(regions.length, 3, "three separated shapes must be three regions");
  const square = regionOf(regions, 2, 2);
  assert.equal(square.cells.length, 9);
  assert.deepEqual(square.interior, [[2, 2]],
    "a 3x3 square has exactly one interior cell — its centre");
  assert.equal(regionOf(regions, 6, 1).cells.length, 1);
  const ell = regionOf(regions, 2, 7);
  assert.equal(ell.cells.length, 3, "the L is one region — diagonals alone must NOT join");
  assert.equal(ell.interior.length, 0, "an L-shape has no interior");
});

test("massing is deterministic per seed, and different across seeds", () => {
  const { tiles, size } = varietyMap();
  const a = blockMassing(tiles, size, 4711);
  const b = blockMassing(tiles, size, 4711);
  assert.deepEqual(a.instances, b.instances,
    "the same seed must build the same city on every machine");
  assert.notDeepEqual(a.instances, blockMassing(tiles, size, 90210).instances,
    "different worlds should not share a skyline");
});

test("massing covers every block cell, and draws only on block cells", () => {
  const { tiles, size } = varietyMap();
  const { instances } = blockMassing(tiles, size, 4711);
  const baseAt = new Map();
  for (const inst of instances) {
    assert.equal(tiles[inst.y * size + inst.x], BLOCK_TILE,
      `instance at ${inst.x},${inst.y} sits off the block footprint — the honesty rule`);
    if (!inst.sub) baseAt.set(inst.y * size + inst.x, (baseAt.get(inst.y * size + inst.x) ?? 0) + 1);
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== BLOCK_TILE) continue;
    assert.equal(baseAt.get(i), 1,
      `block cell ${i % size},${Math.floor(i / size)} must carry exactly one base box`);
  }
});

test("heights and footprints stay inside the caps", () => {
  const { tiles, size } = varietyMap();
  const { instances } = blockMassing(tiles, size, 4711);
  for (const inst of instances) {
    assert.ok(inst.h > 0.25 && inst.h <= MASSING_MAX_H,
      `height ${inst.h} at ${inst.x},${inst.y} escapes (0.25, ${MASSING_MAX_H}]`);
    assert.ok(inst.w > 0 && inst.w <= MASSING_JOIN_W,
      `footprint ${inst.w} at ${inst.x},${inst.y} escapes (0, ${MASSING_JOIN_W}]`);
    assert.ok(inst.tone >= 0 && inst.tone <= 1, "tone must stay a 0..1 ramp position");
  }
});

test("multi-cell blocks join into one continuous building", () => {
  const { tiles, size } = varietyMap();
  const { regions, instances } = blockMassing(tiles, size, 4711);
  for (const inst of instances.filter((i) => !i.sub)) {
    const region = regionOf(regions, inst.x, inst.y);
    if (region.cells.length > 1) {
      assert.equal(inst.w, MASSING_JOIN_W,
        `cell ${inst.x},${inst.y} of a ${region.cells.length}-cell block leaves a seam — ` +
        "the block splits back into the tower row this pass exists to kill");
    } else {
      assert.ok(inst.w < 1, "an isolated building should keep its street gap");
    }
  }
});

test("the template set varies: low-rise blocks exist, and so do towers", () => {
  const { tiles, size } = varietyMap();
  const { regions, instances } = blockMassing(tiles, size, 4711);
  const used = new Set(regions.map((r) => r.template));
  assert.ok(used.size >= 4,
    `only ${[...used]} in a city of ${regions.length} blocks — the variety IS the feature`);
  const baseHeights = (region) => region.cells.map(([x, y]) =>
    instances.find((i) => !i.sub && i.x === x && i.y === y).h);
  const lowRise = regions.filter((r) => r.cells.length >= 4)
    .some((r) => Math.max(...baseHeights(r)) <= 1.6);
  assert.ok(lowRise,
    "no large block reads low-rise — every city block is still a highriser, the exact complaint");
  assert.ok(instances.some((i) => i.h >= 2.5), "no towers left at all — the skyline went flat");
});

test("courtyard blocks are hollow", () => {
  const { tiles, size } = varietyMap();
  const { regions, instances } = blockMassing(tiles, size, 4711);
  const courtyards = regions.filter((r) => r.template === "courtyard");
  assert.ok(courtyards.length > 0,
    "no courtyard block generated on this seed — the template never fires (a feature can silently do nothing)");
  for (const r of courtyards) {
    const inSet = new Set(r.interior.map(([x, y]) => `${x},${y}`));
    const hs = { interior: [], perimeter: [] };
    for (const [x, y] of r.cells) {
      const inst = instances.find((i) => !i.sub && i.x === x && i.y === y);
      hs[inSet.has(`${x},${y}`) ? "interior" : "perimeter"].push(inst.h);
    }
    assert.ok(Math.max(...hs.interior) < Math.min(...hs.perimeter),
      "a courtyard's well must sit below every perimeter wall or it is not a courtyard");
  }
});

test("podium towers rise above their slab", () => {
  const { tiles, size } = varietyMap();
  const { regions, instances } = blockMassing(tiles, size, 4711);
  const podiums = regions.filter((r) => r.template === "podium");
  assert.ok(podiums.length > 0,
    "no podium block generated on this seed — the template never fires");
  for (const r of podiums) {
    const cellKeys = new Set(r.cells.map(([x, y]) => `${x},${y}`));
    const subs = instances.filter((i) => i.sub && cellKeys.has(`${i.x},${i.y}`));
    assert.ok(subs.length >= 1, "a podium with no tower is just a slab");
    const baseMax = Math.max(...instances
      .filter((i) => !i.sub && cellKeys.has(`${i.x},${i.y}`)).map((i) => i.h));
    for (const s of subs) {
      assert.ok(s.w < 0.7, "a podium tower must be slimmer than its slab");
      assert.ok(s.h > baseMax, "a podium tower must rise above the slab");
    }
  }
});

test("large blocks carve into parcels with different characters", () => {
  // Measured on the real seed-4711 map: half the mass regions run 21–69
  // cells. One template painted across a region that size is a monolith —
  // the exact wall-of-windows playtest 4 reported. An 8x8 region stands in
  // for those here.
  const size = 12;
  const tiles = rectMap(size, [[2, 2, 8, 8]]);
  const { regions } = blockMassing(tiles, size, 4711);
  assert.equal(regions.length, 1);
  const region = regions[0];
  assert.ok(region.cells.length > PARCEL_MAX);
  assert.ok(region.parcels.length >= 4,
    `a 64-cell block became only ${region.parcels.length} parcels — still a monolith`);
  const templates = new Set(region.parcels.map((p) => p.template));
  assert.ok(templates.size >= 2,
    "every parcel of a large block drew the same template — the carve changed nothing visible");
  assert.equal(region.template, "mixed", "a carved block must not claim a single template");
  const covered = new Set(region.parcels.flatMap((p) => p.cells.map(([x, y]) => `${x},${y}`)));
  assert.equal(covered.size, region.cells.length,
    "parcels must partition the block — every cell in exactly one parcel");
});

test("buildBlocks draws one box per massing instance, windows intact", () => {
  setTerrainTokens(tokens.terrain);
  const { tiles, size } = varietyMap();
  const { instances } = blockMassing(tiles, size, 4711);
  const group = buildBlocks(tiles, size, 4711);
  const massMeshes = group.children.filter((c) => c.material?.vertexColors);
  const drawn = massMeshes.reduce((a, c) => a + c.count, 0);
  assert.equal(drawn, instances.length,
    "the meshes and the massing disagree about how many boxes the city has");
  for (const mesh of massMeshes) {
    assert.ok(mesh.material.emissiveMap, "the massing pass lost the lit-window sheet");
  }
});

// ── The rotated-view clamp margin (the 45-degree camera) ───────────────────
// The first cut clamped the whole rotated view rectangle inside the map,
// which near a corner pushed the camera 18 cells off the agent — the followed
// operative left the screen entirely. The margin's ONE promise: wherever the
// target is on the map, its rotated screen offset after clamping fits inside
// the view. That promise is checked directly, over every map position.
test("clampMargin keeps a clamped target on screen at every map position", () => {
  const halfX = 13, halfY = 8.125, pitch = 40 * (Math.PI / 180);
  const azimuth = Math.PI / 4;
  const halfYg = halfY / Math.sin(pitch);
  const margin = clampMargin(halfX, halfY, pitch, azimuth);
  const size = 64;
  for (let y = 0; y <= size; y += 2) {
    for (let x = 0; x <= size; x += 2) {
      const c = clampCamera({ x, y }, size, margin, margin);
      const dx = x - c.x, dz = y - c.y;
      const screenX = dx * Math.cos(azimuth) - dz * Math.sin(azimuth);
      const groundY = dx * Math.sin(azimuth) + dz * Math.cos(azimuth);
      assert.ok(Math.abs(screenX) <= halfX + 1e-9 && Math.abs(groundY) <= halfYg + 1e-9,
        `target at ${x},${y} leaves the screen after clamping — the corner-drop bug is back`);
    }
  }
  assert.ok(margin < halfX + halfYg,
    "the margin must be tighter than the full rotated footprint, or corners over-clamp again");
});

// ── District identity (playtest 5) ─────────────────────────────────────────

test("TRAIT_STYLES mirrors the engine's trait constants — a deliberate duplicate", async () => {
  const { TRAIT_STYLES } = await import("../client/js/terrain3d.js");
  const engine = await import("../engine/citygen.js");
  // The client cannot import the engine at runtime, so the mapping is a
  // duplicate by design — and this is the guard that keeps the two in step.
  assert.equal(TRAIT_STYLES.length, engine.TRAIT_COUNT);
  assert.equal(TRAIT_STYLES[engine.TRAIT_INDUSTRIAL], "industrial");
  assert.equal(TRAIT_STYLES[engine.TRAIT_RESIDENTIAL], "residential");
  assert.equal(TRAIT_STYLES[engine.TRAIT_COMMERCIAL], "commercial");
  assert.equal(TRAIT_STYLES[engine.TRAIT_GOVERNMENT], "government");
  assert.equal(TRAIT_STYLES[engine.TRAIT_RESEARCH], "research");
  assert.equal(TRAIT_STYLES[engine.TRAIT_PORT], "port");
  // And every style the mapping names has tokens to back it.
  for (const key of TRAIT_STYLES) {
    assert.ok(tokens.terrain.districtStyles[key], `no districtStyles tokens for "${key}"`);
  }
});

// A map split into two districts down the middle, with a street between the
// blocks so facades have something to address.
function districtMap(size = 24, traitA = 0, traitB = 2) {
  const { tiles } = { tiles: new Uint8Array(size * size) };
  const rects = [];
  for (let y = 2; y + 3 < size; y += 5) {
    for (let x = 2; x + 3 < size; x += 5) rects.push([x, y, 3, 3]);
  }
  for (const [x0, y0, w, h] of rects) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tiles[y * size + x] = BLOCK_TILE;
  }
  for (let x = 0; x < size; x++) tiles[(0) * size + x] = 1;   // a street row
  const owner = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) owner[y * size + x] = x < size / 2 ? 0 : 1;
  }
  return { tiles, size, districts: { owner, traits: [traitA, traitB] } };
}

test("district styles bend the massing: industrial stays low, commercial keeps its towers", () => {
  setTerrainTokens(tokens.terrain);
  const { tiles, size, districts } = districtMap(24, 0, 2);   // industrial | commercial
  const { regions, instances } = blockMassing(tiles, size, 4711, districts);
  assert.deepEqual(a4(blockMassing(tiles, size, 4711, districts).instances),
    a4(instances), "district massing must be deterministic");
  const mean = (style) => {
    const hs = instances.filter((i) => !i.sub && !i.lift && i.style === style).map((i) => i.h);
    assert.ok(hs.length > 0, `no base instances styled ${style}`);
    return hs.reduce((a, b) => a + b, 0) / hs.length;
  };
  assert.ok(mean("industrial") < mean("commercial") * 0.8,
    "the industrial half is not visibly lower — heightScale never applied");
  assert.ok(regions.every((r) => r.style === "industrial" || r.style === "commercial"),
    "a region escaped both districts");
  function a4(list) { return list.map((i) => `${i.x},${i.y},${i.h.toFixed(4)}`); }
});

test("residential districts grow balconies, gardens and shopfronts; industrial does not", () => {
  setTerrainTokens(tokens.terrain);
  const { tiles, size, districts } = districtMap(24, 1, 0);   // residential | industrial
  // Give every block column a street to face, so balconies are possible.
  for (let y = 0; y < size; y += 5) for (let x = 0; x < size; x++) tiles[y * size + x] = 1;
  const { decor } = blockMassing(tiles, size, 4711, districts);
  const kinds = new Set(decor.map((d) => d.kind));
  assert.ok(kinds.has("balcony"), "no balconies in a residential district");
  assert.ok(kinds.has("garden"), "no rooftop gardens in a residential district");
  assert.ok(kinds.has("shopfront"), "no lit shopfronts in a residential district");
  const half = size / 2;
  for (const d of decor) {
    if (["balcony", "garden", "shopfront"].includes(d.kind)) {
      assert.ok(d.x < half, `${d.kind} at ${d.x},${d.y} grew on the industrial side`);
    }
    assert.ok(tiles[d.y * size + d.x] === BLOCK_TILE,
      `${d.kind} anchored off the building mass at ${d.x},${d.y}`);
  }
});

test("roof furniture exists and stays on the roofs it claims", () => {
  setTerrainTokens(tokens.terrain);
  const { tiles, size, districts } = districtMap(24, 2, 2);
  const { instances, decor } = blockMassing(tiles, size, 4711, districts);
  const baseAt = new Map(instances.filter((i) => !i.sub)
    .map((i) => [`${i.x},${i.y}`, i.h]));
  const masts = decor.filter((d) => d.kind === "mast");
  const tanks = decor.filter((d) => d.kind === "tank");
  assert.ok(masts.length + tanks.length > 0, "no roof furniture at all on a commercial map");
  for (const d of [...masts, ...tanks]) {
    assert.equal(d.top, baseAt.get(`${d.x},${d.y}`),
      `${d.kind} at ${d.x},${d.y} floats at ${d.top}, roof is ${baseAt.get(`${d.x},${d.y}`)}`);
  }
  // Setback tops sit ON their building, never inside it.
  for (const s of instances.filter((i) => i.lift)) {
    assert.equal(s.lift, baseAt.get(`${s.x},${s.y}`), "a setback is not seated on its own roof");
    assert.ok(s.w < 1, "a setback must be slimmer than its building");
  }
});

test("bigger factory windows: scale actually widens the lit panes", () => {
  const windows = tokens.terrain.windows;
  const one = buildWindowData(4711, windows, 1);
  const two = buildWindowData(4711, { ...windows, density: 0.3 }, 2);
  const maxRun = (data) => {
    let best = 0;
    for (let y = 0; y < WIN_TEX; y++) {
      let run = 0;
      for (let x = 0; x < WIN_TEX; x++) {
        const lit = data[(y * WIN_TEX + x) * 4 + 3] > 0;
        run = lit ? run + 1 : 0;
        best = Math.max(best, run);
      }
    }
    return best;
  };
  assert.ok(maxRun(one) <= 2, "scale-1 panes should be 2 texels wide");
  assert.ok(maxRun(two) >= 4, "scale-2 panes never got wider — factory glazing silently did nothing");
});

test("buildBlocks with districts yields one window sheet per style present", () => {
  setTerrainTokens(tokens.terrain);
  const { tiles, size, districts } = districtMap(24, 0, 2);
  const group = buildBlocks(tiles, size, 4711, districts);
  const massMeshes = group.children.filter((c) => c.material?.vertexColors);
  assert.equal(massMeshes.length, 2,
    "two districts with different traits must draw as two styled meshes");
});
