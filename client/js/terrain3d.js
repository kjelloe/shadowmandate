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
//
// The tile COLOURS used to live here as float triples, hand-synced against a
// hex copy in minimap.js. They are style tokens now (D46) — Q41c is a judgement
// about the tile look, and it cannot be a token edit while the tiles are hard
// wired into two renderers that can drift apart.
let COLOUR = null, BLOCK_LO = null, BLOCK_SPAN = null, WINDOWS = null;

// Raw /255, deliberately NOT THREE.Color: these floats are written straight
// into a vertex-colour buffer, and three's colour management would sRGB-decode
// a Color and hand back linear values, darkening the whole ground about
// fivefold. A ground that renders "wrong but plausibly" is the hardest kind of
// render fault to spot, so the conversion stays explicit.
export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function setTerrainTokens(terrain) {
  if (!terrain) { COLOUR = null; BLOCK_LO = null; BLOCK_SPAN = null; WINDOWS = null; return; }
  COLOUR = {};
  for (const [id, hex] of Object.entries(terrain.tiles)) COLOUR[Number(id)] = hexRgb(hex);
  COLOUR.unknown = hexRgb(terrain.unknown);
  BLOCK_LO = hexRgb(terrain.blockLo);
  const hi = hexRgb(terrain.blockHi);
  BLOCK_SPAN = hi.map((c, i) => c - BLOCK_LO[i]);
  WINDOWS = terrain.windows ?? null;
}

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
  // Loud, not grey. A terrain built before the tokens loaded would render as a
  // uniform slab and look exactly like a citygen bug.
  if (!COLOUR) throw new Error("terrain3d: setTerrainTokens() was never called");
  let r = 0, g = 0, b = 0;
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const c = COLOUR[tileAt(tiles, size, x + dx, y + dy)] ?? COLOUR.unknown;
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

// The lit-window sheet (playtest 3, finding 3). What makes a dark tower read
// as a TOWER instead of a hole in the render is its windows — the reference
// image is mostly windows. Built as raw RGBA bytes rather than a canvas so it
// is identical on every machine and testable without a DOM. Deterministic
// from the seed via hash2, like everything else here.
//
// Layout: WIN_TEX x WIN_TEX texels; the bottom ROOF_BAND rows stay black and
// the box's top face is remapped onto them, so roofs never glow — a glowing
// roof under a 52-degree camera would read as a lit plaza, which is a
// gameplay lie. Sockets are 2x3 texels on a 4x5 pitch; a socket is lit with
// probability `density`, warm or cool by a second draw.
export const WIN_TEX = 64;
export const ROOF_BAND = 5;
export function buildWindowData(seed, windows) {
  const data = new Uint8Array(WIN_TEX * WIN_TEX * 4);
  const warm = hexRgb(windows.lit).map((c) => Math.round(c * 255));
  const cool = hexRgb(windows.cool).map((c) => Math.round(c * 255));
  const density = windows.density ?? 0.16;
  for (let wy = 0; wy * 5 + ROOF_BAND + 3 < WIN_TEX; wy++) {
    for (let wx = 0; wx * 4 + 3 <= WIN_TEX; wx++) {
      if (hash2(seed ^ 0x33b1, wx, wy) >= density) continue;
      const c = hash2(seed ^ 0x77aa, wx, wy) < 0.72 ? warm : cool;
      // A lit socket flickers in brightness a little between neighbours, so a
      // facade reads as many rooms rather than one printed pattern.
      const dim = 0.6 + hash2(seed ^ 0x1234, wx, wy) * 0.4;
      for (let py = 0; py < 3; py++) {
        for (let px = 0; px < 2; px++) {
          const x = wx * 4 + 1 + px, y = ROOF_BAND + wy * 5 + 1 + py;
          const i = (y * WIN_TEX + x) * 4;
          data[i] = Math.round(c[0] * dim);
          data[i + 1] = Math.round(c[1] * dim);
          data[i + 2] = Math.round(c[2] * dim);
          data[i + 3] = 255;
        }
      }
    }
  }
  return data;
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
  if (!BLOCK_LO) throw new Error("terrain3d: setTerrainTokens() was never called");

  // The dystopian pass (playtest 3, finding 3): every facade carries the lit
  // window sheet as an EMISSIVE map, so windows glow out of the dark instead
  // of being painted on. The box's top face is remapped into the sheet's
  // reserved black band — roofs must not glow (see buildWindowData).
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (WINDOWS) {
    const tex = new THREE.DataTexture(buildWindowData(seed, WINDOWS), WIN_TEX, WIN_TEX);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    mat.emissive = new THREE.Color(1, 1, 1);
    mat.emissiveMap = tex;
    // BoxGeometry face order: +x,-x,+y,-y,+z,-z, four uv pairs each. Faces 2
    // and 3 (top and bottom) collapse onto one texel inside the roof band.
    const uv = geo.attributes.uv;
    const dead = (ROOF_BAND - 2) / WIN_TEX;
    for (let v = 8; v < 16; v++) uv.setXY(v, dead, dead);
    uv.needsUpdate = true;
  }

  // Per-instance colour: one flat grey made the whole city read as a single
  // mass, which defeats the point of varying the heights at all. The tint uses
  // a SECOND hash draw so tone and height vary independently — keying both off
  // one value makes every tall block the same shade, which looks authored.
  const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  for (let i = 0; i < cells.length; i++) {
    const [x, y] = cells[i];
    // Taller and meaner than the first pass (0.6–3.0): the reference city is
    // a canyon. Skewed toward height, with the occasional genuine tower —
    // capped so the 52-degree camera can still see over the mass into the
    // streets the player actually plays in.
    let h = 0.9 + Math.pow(hash2(seed, x, y), 0.8) * 3.1;
    if (hash2(seed ^ 0x70e5, x, y) > 0.94) h += 1.8;
    const w = 0.88 + hash2(seed ^ 0x51ed, x, y) * 0.10;
    // A quarter-turn per instance: four different facades from one window
    // sheet, which breaks the repetition an instanced texture would otherwise
    // print across the whole city.
    quat.setFromAxisAngle(up, Math.floor(hash2(seed ^ 0x2b5f, x, y) * 4) * (Math.PI / 2));
    pos.set(x + 0.5, h / 2, y + 0.5);
    scl.set(w, h, w);
    m.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m);
    const t = hash2(seed ^ 0x9e37, x, y);
    colour.setRGB(BLOCK_LO[0] + t * BLOCK_SPAN[0],
      BLOCK_LO[1] + t * BLOCK_SPAN[1],
      BLOCK_LO[2] + t * BLOCK_SPAN[2]);
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
