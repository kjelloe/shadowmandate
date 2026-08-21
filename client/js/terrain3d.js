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
let COLOUR = null, BLOCK_LO = null, BLOCK_SPAN = null, WINDOWS = null, CLUTTER = null;

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
  if (!terrain) { COLOUR = null; BLOCK_LO = null; BLOCK_SPAN = null; WINDOWS = null; CLUTTER = null; return; }
  COLOUR = {};
  for (const [id, hex] of Object.entries(terrain.tiles)) COLOUR[Number(id)] = hexRgb(hex);
  COLOUR.unknown = hexRgb(terrain.unknown);
  BLOCK_LO = hexRgb(terrain.blockLo);
  const hi = hexRgb(terrain.blockHi);
  BLOCK_SPAN = hi.map((c, i) => c - BLOCK_LO[i]);
  WINDOWS = terrain.windows ?? null;
  CLUTTER = terrain.clutter ?? null;
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
// roof under the tilted camera would read as a lit plaza, which is a
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

// ── Block massing (playtest 4, finding 1) ──────────────────────────────────
// The first pass extruded every mass CELL into its own hashed-height tower, so
// every city block read as a lone highriser and the city read as a bar chart —
// the playtest complaint verbatim. Massing now groups contiguous mass cells
// into BLOCKS (4-connectivity) and gives each block ONE architectural
// character from a template set, the way a real city has courtyard blocks and
// rowhouses and podium towers rather than towers everywhere.
//
// Pure functions ahead of the mesh build, so the properties are testable
// without inspecting instance matrices (the clutter pattern). The honesty rule
// is untouched: the drawn footprint is exactly the block tiles either way, and
// height still implies nothing the simulation does not model.

export const MASSING_MAX_H = 3.8;
// Cells of a multi-cell block overlap their neighbours slightly. Exactly
// touching boxes leave coincident faces that z-fight, and any visible seam
// splits the building back into the tower row this pass exists to kill.
export const MASSING_JOIN_W = 1.02;

export function blockRegions(tiles, size) {
  const seen = new Uint8Array(size * size);
  const regions = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const start = y * size + x;
      if (tiles[start] !== BLOCK_TILE || seen[start]) continue;
      seen[start] = 1;
      const cells = [];
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (tiles[ni] !== BLOCK_TILE || seen[ni]) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      // Row-major order gives a stable anchor (the north-west cell), which is
      // what every per-region hash draw keys on — determinism by construction.
      cells.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
      const inRegion = new Set(cells.map(([cx, cy]) => cy * size + cx));
      const interior = cells.filter(([cx, cy]) =>
        cx > 0 && cy > 0 && cx < size - 1 && cy < size - 1 &&
        [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inRegion.has((cy + dy) * size + cx + dx)));
      regions.push({ cells, interior, anchor: cells[0] });
    }
  }
  return regions;
}

// Connected components (4-connectivity) within an arbitrary cell list.
function components(cells) {
  const inList = new Set(cells.map(([x, y]) => `${x},${y}`));
  const seen = new Set();
  const out = [];
  for (const [sx, sy] of cells) {
    const startKey = `${sx},${sy}`;
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const comp = [];
    const stack = [[sx, sy]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      comp.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${cx + dx},${cy + dy}`;
        if (!inList.has(key) || seen.has(key)) continue;
        seen.add(key);
        stack.push([cx + dx, cy + dy]);
      }
    }
    comp.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    out.push(comp);
  }
  return out;
}

// Large regions split into PARCELS before templating. Measured on seed 4711:
// 59% of the map is mass and half the regions run 21–69 cells — one template
// painted across 69 cells is a monolith, which is the wall-of-windows the
// playtest saw. A hashed 2–4 cell grid pitch per region carves the block the
// way a real block carves into lots; grid buckets that land disconnected
// become separate parcels.
export const PARCEL_MAX = 9;
function parcelize(region, seed) {
  if (region.cells.length <= PARCEL_MAX) return [region.cells];
  const [ax, ay] = region.anchor;
  const pw = 2 + Math.floor(hash2(seed ^ 0x9a2c, ax, ay) * 3);
  const ph = 2 + Math.floor(hash2(seed ^ 0x2c9a, ax, ay) * 3);
  const byKey = new Map();
  for (const [x, y] of region.cells) {
    const key = `${Math.floor(x / pw)}:${Math.floor(y / ph)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push([x, y]);
  }
  const parcels = [];
  for (const cells of byKey.values()) parcels.push(...components(cells));
  return parcels;
}

// One character per parcel, keyed on the parcel anchor. Singles are towers or
// huts; short strips are slabs or stepped terraces; anything with a genuine
// interior can hollow into a courtyard; the rest split between podium-and-
// tower, rows and industrial sheds. Weights are a look judgement, refined by
// eye against the gallery — the tests only pin that the variety EXISTS.
function pickTemplate(cells, interior, seed) {
  const [ax, ay] = cells[0];
  const r = hash2(seed ^ 0xb10c, ax, ay);
  const n = cells.length;
  if (n === 1) return r < 0.6 ? "tower" : "hut";
  if (n <= 3) return r < 0.55 ? "slab" : "steps";
  if (interior.length && r < 0.30) return "courtyard";
  const pool = ["podium", "rows", "industrial", "slab"];
  return pool[Math.floor(hash2(seed ^ 0x5ab5, ax, ay) * pool.length) % pool.length];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The massing itself: box descriptors in cell units. `sub` marks the boxes
// that ride on a base cell (podium towers, factory stacks) rather than being
// the cell's own mass. Every height carries a per-cell jitter term — two
// coplanar roofs in the overlap strip would z-fight, and a dead-flat block
// reads as printed rather than built.
export function blockMassing(tiles, size, seed) {
  const regions = blockRegions(tiles, size);
  const instances = [];
  for (const region of regions) {
    // Join width is a REGION property: parcels inside one block terrace
    // against each other, distinguished by height and paint, not by gaps.
    const joined = region.cells.length > 1;
    const parcels = parcelize(region, seed);
    region.parcels = [];
    for (const cells of parcels) {
      const [ax, ay] = cells[0];
      const n = cells.length;
      const inParcel = new Set(cells.map(([x, y]) => y * size + x));
      const interior = cells.filter(([x, y]) =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inParcel.has((y + dy) * size + x + dx)));
      const template = pickTemplate(cells, interior, seed);
      region.parcels.push({ cells, template });
      // Tone is anchored per PARCEL so each building on the block reads as one
      // paint, with a small per-cell drift for weathering.
      const baseTone = hash2(seed ^ 0x9e37, ax, ay);
      const parcelRoll = hash2(seed ^ 0x51ab, ax, ay);
      const inSet = new Set(interior.map(([x, y]) => y * size + x));
      const phase = hash2(seed ^ 0x0517, ax, ay) < 0.5 ? 0 : 1;
      for (let k = 0; k < n; k++) {
        const [x, y] = cells[k];
        const j = hash2(seed, x, y);
        let h;
        if (template === "tower") h = 1.8 + j * 1.8;
        else if (template === "hut") h = 0.8 + j * 0.6;
        else if (template === "slab") h = 1.3 + parcelRoll * 0.9 + (j - 0.5) * 0.25;
        else if (template === "steps") h = 2.0 - (k / Math.max(1, n - 1)) * 1.2 + (j - 0.5) * 0.12;
        else if (template === "courtyard") {
          h = inSet.has(y * size + x) ? 0.3 + j * 0.1
            : 1.3 + parcelRoll * 0.6 + (j - 0.5) * 0.3;
        } else if (template === "podium") h = 0.9 + j * 0.4;
        else if (template === "rows") h = ((x + y + phase) % 2 ? 1.25 : 0.8) + (j - 0.5) * 0.2;
        else h = 0.55 + j * 0.35;   // industrial sheds
        instances.push({
          x, y,
          w: joined ? MASSING_JOIN_W : 0.86 + hash2(seed ^ 0x51ed, x, y) * 0.10,
          h: Math.min(MASSING_MAX_H, h),
          tone: clamp01(baseTone + (hash2(seed ^ 0x0b70, x, y) - 0.5) * 0.12),
          sub: false,
        });
      }
      // The vertical accents: towers out of a podium, stacks out of a works.
      if (template === "podium" || template === "industrial") {
        const count = template === "podium"
          ? Math.max(1, Math.round(n / 6))
          : 1 + (hash2(seed ^ 0x57ac, ax, ay) < 0.4 ? 1 : 0);
        const ranked = [...cells].sort((a, b) =>
          hash2(seed ^ 0x7071, a[0], a[1]) - hash2(seed ^ 0x7071, b[0], b[1]));
        for (let t = 0; t < Math.min(count, ranked.length); t++) {
          const [x, y] = ranked[t];
          const j = hash2(seed ^ 0x7071, x, y);
          instances.push(template === "podium"
            ? { x, y, w: 0.58, h: Math.min(MASSING_MAX_H, 2.4 + j * 1.6), tone: clamp01(baseTone - 0.1), sub: true }
            : { x, y, w: 0.16, h: 2.2 + j * 0.8, tone: clamp01(baseTone - 0.15), sub: true });
        }
      }
    }
    // Single-parcel regions keep the flat template field the tests and any
    // probe read; a carved block is honestly "mixed".
    region.template = region.parcels.length === 1 ? region.parcels[0].template : "mixed";
  }
  return { regions, instances };
}

// Building mass, as one instanced box mesh over the massing descriptors.
export function buildBlocks(tiles, size, seed) {
  const { instances } = blockMassing(tiles, size, seed);
  if (!instances.length) return null;
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

  // Per-instance colour rides the massing's tone: anchored per block, drifted
  // per cell, so a block reads as one painted building rather than a row of
  // strangers — while two blocks still differ.
  const mesh = new THREE.InstancedMesh(geo, mat, instances.length);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  for (let i = 0; i < instances.length; i++) {
    const { x, y, w, h, tone } = instances[i];
    // A quarter-turn per instance: four different facades from one window
    // sheet, which breaks the repetition an instanced texture would otherwise
    // print across the whole city.
    quat.setFromAxisAngle(up, Math.floor(hash2(seed ^ 0x2b5f, x, y) * 4) * (Math.PI / 2));
    pos.set(x + 0.5, h / 2, y + 0.5);
    scl.set(w, h, w);
    m.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m);
    colour.setRGB(BLOCK_LO[0] + tone * BLOCK_SPAN[0],
      BLOCK_LO[1] + tone * BLOCK_SPAN[1],
      BLOCK_LO[2] + tone * BLOCK_SPAN[2]);
    mesh.setColorAt(i, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  return mesh;
}

// ── Street clutter (playtest 3, finding 3 — the deferred half) ─────────────
// The reference city is CLUTTERED at ground level: crates, drums, ducting,
// dumped tarps. Purely cosmetic set dressing, deterministic per seed like
// everything else here.
//
// THE HONESTY RULE APPLIES HARDEST HERE. Gameplay is flat 2D cells with
// entities at cell CENTRES, so clutter (a) only lands on alleys, yards and
// rough ground — streets stay clear because they are the navigation surface,
// (b) sits OFF the cell centre so it can never cover a standing agent, and
// (c) stays knee-high so it cannot read as an obstacle the simulation does
// not model.

export const CLUTTER_TILES = new Set([2, 8, 9]);
export const CLUTTER_KINDS = ["crate", "barrel", "vent", "tarp"];
// The exclusion ring around a cell centre, in cell units. Entities stand at
// the centre; nothing decorative may sit within this radius of one.
export const CLUTTER_CLEARANCE = 0.2;

// Pure placement, split from the mesh build so it is testable without
// inspecting instance matrices. Offsets are drawn from [CLEARANCE+0.06, 0.38]
// and pushed to one side per axis, so every prop keeps the clearance ring by
// construction rather than by luck.
export function clutterPlacements(tiles, size, seed, density) {
  const out = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!CLUTTER_TILES.has(tiles[y * size + x])) continue;
      if (hash2(seed ^ 0xc1a7, x, y) >= density) continue;
      const n = hash2(seed ^ 0x5eed, x, y) < 0.35 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const salt = k * 0x101;
        out.push({
          x, y,
          kind: CLUTTER_KINDS[Math.floor(hash2((seed + salt) ^ 0x9a11, x, y) * CLUTTER_KINDS.length) % CLUTTER_KINDS.length],
          dx: (hash2((seed + salt) ^ 0x0ff1, x, y) < 0.5 ? -1 : 1)
            * (CLUTTER_CLEARANCE + 0.06 + hash2((seed + salt) ^ 0x0ff2, x, y) * 0.12),
          dz: (hash2((seed + salt) ^ 0x0ff3, x, y) < 0.5 ? -1 : 1)
            * (CLUTTER_CLEARANCE + 0.06 + hash2((seed + salt) ^ 0x0ff4, x, y) * 0.12),
          rot: hash2((seed + salt) ^ 0x0ff5, x, y) * Math.PI * 2,
          s: 0.8 + hash2((seed + salt) ^ 0x0ff6, x, y) * 0.4,
        });
      }
    }
  }
  return out;
}

// Base geometry per kind: footprint and height in cell units, all knee-high.
const CLUTTER_GEO = {
  crate: () => new THREE.BoxGeometry(0.20, 0.20, 0.20),
  barrel: () => new THREE.CylinderGeometry(0.095, 0.10, 0.26, 7),
  vent: () => new THREE.BoxGeometry(0.28, 0.12, 0.20),
  tarp: () => new THREE.BoxGeometry(0.32, 0.09, 0.26),
};
const CLUTTER_BASE_H = { crate: 0.20, barrel: 0.26, vent: 0.12, tarp: 0.09 };

export function buildClutter(tiles, size, seed) {
  if (!CLUTTER) return null;
  const placements = clutterPlacements(tiles, size, seed, CLUTTER.density ?? 0.55);
  if (!placements.length) return null;
  const byKind = {};
  for (const p of placements) (byKind[p.kind] ??= []).push(p);
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [kind, list] of Object.entries(byKind)) {
    const mesh = new THREE.InstancedMesh(
      CLUTTER_GEO[kind](),
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(CLUTTER[kind])) }),
      list.length);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      quat.setFromAxisAngle(up, p.rot);
      pos.set(p.x + 0.5 + p.dx, (CLUTTER_BASE_H[kind] * p.s) / 2, p.y + 0.5 + p.dz);
      scl.set(p.s, p.s, p.s);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    group.add(mesh);
  }
  return group;
}

export function countBlocks(tiles) {
  let n = 0;
  for (const t of tiles) if (t === BLOCK_TILE) n++;
  return n;
}
