// client/js/terrain3d.js — the city as geometry (S12).
//
// Follows the sibling project's terrain-mesh approach: ONE vertex-coloured
// ground mesh rather than thousands of per-cell quads, plus instanced boxes for
// building mass. Everything derives from (tiles, seed), so it is reproducible
// and the renderer stays non-authoritative.
//
// THE HONESTY RULE, inherited: relief is SEMANTIC ONLY. Height must never
// imply something the simulation does not model — gameplay is flat 2D cells
// and stays that way. A raised kerb is decoration; it does not block sight or
// movement, and nothing here may suggest that it does.

import * as THREE from "three";

// Tile ids: 0 open, 1 street, 2 alley, 3 plaza, 4 block, 5 entrance,
// 6 transit, 7 checkpoint, 8 yard, 9 rough, 10 water.
const COLOUR = {
  0: [0.16, 0.18, 0.14], 1: [0.23, 0.25, 0.28], 2: [0.13, 0.14, 0.16],
  3: [0.27, 0.29, 0.33], 4: [0.09, 0.10, 0.12], 5: [0.42, 0.36, 0.24],
  6: [0.29, 0.33, 0.40], 7: [0.48, 0.29, 0.23], 8: [0.20, 0.21, 0.17],
  9: [0.18, 0.16, 0.14], 10: [0.10, 0.16, 0.20],
};
// Purely cosmetic relief. Water sinks, yards and rough sit slightly proud.
const RELIEF = { 0: 0, 1: 0.02, 2: 0, 3: 0.03, 4: 0, 5: 0.02, 6: 0.04, 7: 0.03, 8: 0.05, 9: 0.06, 10: -0.18 };
const NOISE = { 0: 0.05, 1: 0, 2: 0.01, 3: 0, 5: 0, 6: 0, 7: 0, 8: 0.07, 9: 0.09, 10: 0.01, 4: 0 };

export const BLOCK_TILE = 4;

// Deterministic hash — the same seeded micro-noise on every machine, so two
// players describing the same corner are describing the same corner.
export function hash2(seed, a, b) {
  let h = (seed ^ (a * 0x9e3779b1) ^ (b * 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

const tileAt = (tiles, size, x, y) =>
  tiles[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];

// Height of a LATTICE point: the mean relief of its four touching cells, so
// borders blend instead of stepping.
export function heightAt(tiles, size, seed, x, y) {
  let rel = 0, amp = 0;
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const t = tileAt(tiles, size, x + dx, y + dy);
    rel += RELIEF[t] ?? 0;
    amp += NOISE[t] ?? 0;
  }
  return rel / 4 + (hash2(seed, x, y) - 0.5) * (amp / 4);
}

function blendedColour(tiles, size, x, y) {
  let r = 0, g = 0, b = 0;
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const c = COLOUR[tileAt(tiles, size, x + dx, y + dy)] ?? COLOUR[0];
    r += c[0]; g += c[1]; b += c[2];
  }
  return [r / 4, g / 4, b / 4];
}

// The ground: one indexed mesh over the whole map.
export function buildGround(tiles, size, seed) {
  const verts = (size + 1) * (size + 1);
  const positions = new Float32Array(verts * 3);
  const colours = new Float32Array(verts * 3);
  let p = 0, c = 0;
  for (let y = 0; y <= size; y++) {
    for (let x = 0; x <= size; x++) {
      positions[p++] = x;
      positions[p++] = heightAt(tiles, size, seed, x, y);
      positions[p++] = y;
      const col = blendedColour(tiles, size, x, y);
      colours[c++] = col[0]; colours[c++] = col[1]; colours[c++] = col[2];
    }
  }
  const indices = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = y * (size + 1) + x, b = a + 1;
      const d = a + (size + 1), e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Building mass, as one instanced box mesh. Heights vary by district so a
// commercial block reads differently from a residential one at a glance — the
// silhouette is what makes a city legible from above.
export function buildBlocks(tiles, size, seed) {
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (tiles[y * size + x] === BLOCK_TILE) cells.push([x, y]);
    }
  }
  if (!cells.length) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  // Per-instance colour: one flat grey made the whole city read as a single
  // mass, which defeats the point of varying the heights at all. The tint uses
  // a SECOND hash draw so tone and height vary independently — keying both off
  // one value makes every tall block the same shade, which looks authored.
  const mat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
  const m = new THREE.Matrix4();
  const colour = new THREE.Color();
  for (let i = 0; i < cells.length; i++) {
    const [x, y] = cells[i];
    const h = 0.6 + hash2(seed, x, y) * 2.4;
    // Footprint varies slightly too: a uniform 0.94 grid reads as tiling.
    const w = 0.88 + hash2(seed ^ 0x51ed, x, y) * 0.10;
    m.makeScale(w, h, w);
    m.setPosition(x + 0.5, h / 2, y + 0.5);
    mesh.setMatrixAt(i, m);
    const t = hash2(seed ^ 0x9e37, x, y);
    colour.setRGB(0.145 + t * 0.075, 0.165 + t * 0.075, 0.20 + t * 0.085);
    mesh.setColorAt(i, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  return mesh;
}

export function countBlocks(tiles) {
  let n = 0;
  for (const t of tiles) if (t === BLOCK_TILE) n++;
  return n;
}
