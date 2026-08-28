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
let COLOUR = null, BLOCK_LO = null, BLOCK_SPAN = null, WINDOWS = null, CLUTTER = null, ROAD = null;
let DISTRICT_STYLES = null, ROOF_DECOR = null;

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
  if (!terrain) {
    COLOUR = null; BLOCK_LO = null; BLOCK_SPAN = null;
    WINDOWS = null; CLUTTER = null; ROAD = null;
    DISTRICT_STYLES = null; ROOF_DECOR = null;
    return;
  }
  COLOUR = {};
  for (const [id, hex] of Object.entries(terrain.tiles)) COLOUR[Number(id)] = hexRgb(hex);
  COLOUR.unknown = hexRgb(terrain.unknown);
  BLOCK_LO = hexRgb(terrain.blockLo);
  const hi = hexRgb(terrain.blockHi);
  BLOCK_SPAN = hi.map((c, i) => c - BLOCK_LO[i]);
  WINDOWS = terrain.windows ?? null;
  CLUTTER = terrain.clutter ?? null;
  ROAD = terrain.road ?? null;
  DISTRICT_STYLES = terrain.districtStyles ?? null;
  ROOF_DECOR = terrain.roofDecor ?? null;
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
// `scale` multiplies the socket size and pitch (playtest 5: a factory window
// is a WALL of glass, not an apartment grid); `warmShare` splits sodium
// interiors from screen glow, so a research district can read as monitors.
export function buildWindowData(seed, windows, scale = 1) {
  const data = new Uint8Array(WIN_TEX * WIN_TEX * 4);
  const warm = hexRgb(windows.lit).map((c) => Math.round(c * 255));
  const cool = hexRgb(windows.cool).map((c) => Math.round(c * 255));
  const density = windows.density ?? 0.16;
  const warmShare = windows.warmShare ?? 0.72;
  const pw = 4 * scale, ph = 5 * scale;           // socket pitch
  const sw = 2 * scale, sh = 3 * scale;           // lit pane size
  for (let wy = 0; wy * ph + ROOF_BAND + sh < WIN_TEX; wy++) {
    for (let wx = 0; wx * pw + sw + 1 <= WIN_TEX; wx++) {
      if (hash2(seed ^ 0x33b1, wx, wy) >= density) continue;
      const c = hash2(seed ^ 0x77aa, wx, wy) < warmShare ? warm : cool;
      // A lit socket flickers in brightness a little between neighbours, so a
      // facade reads as many rooms rather than one printed pattern.
      const dim = 0.6 + hash2(seed ^ 0x1234, wx, wy) * 0.4;
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          const x = wx * pw + 1 + px, y = ROOF_BAND + wy * ph + 1 + py;
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

// District trait -> style key. A DELIBERATE mirror of the engine's TRAIT_*
// constants in citygen.js (0..5) — the client cannot import the engine, so a
// test asserts the two lists agree (the D46 duplicate-constants lesson).
export const TRAIT_STYLES = ["industrial", "residential", "commercial", "government", "research", "port"];

function styleAt(districts, size, x, y) {
  if (!districts?.owner || !districts?.traits || !DISTRICT_STYLES) return null;
  const trait = districts.traits[districts.owner[y * size + x]];
  const key = TRAIT_STYLES[trait] ?? null;
  return key && DISTRICT_STYLES[key] ? key : null;
}

// One character per parcel, keyed on the parcel anchor. Singles are towers or
// huts; short strips are slabs or stepped terraces; anything with a genuine
// interior can hollow into a courtyard; the rest split between podium-and-
// tower, rows and industrial sheds. The district style biases the pool
// (playtest 5): an industrial district grows sheds and stacks, a residential
// one rows and courtyards — the trait look, not just a tint. Weights are a
// look judgement, refined by eye against the gallery — the tests only pin
// that the variety EXISTS.
const STYLE_POOLS = {
  industrial: ["industrial", "industrial", "podium", "slab"],
  port: ["industrial", "industrial", "slab", "rows"],
  residential: ["rows", "rows", "courtyard", "slab"],
  government: ["slab", "courtyard", "podium", "slab"],
  research: ["slab", "podium", "rows", "slab"],
  commercial: ["podium", "rows", "industrial", "slab"],
};

function pickTemplate(cells, interior, seed, style) {
  const [ax, ay] = cells[0];
  const r = hash2(seed ^ 0xb10c, ax, ay);
  const n = cells.length;
  const lowRise = style === "industrial" || style === "port";
  if (n === 1) return r < (lowRise ? 0.25 : 0.6) ? "tower" : "hut";
  if (n <= 3) return r < 0.55 ? "slab" : "steps";
  if (interior.length && r < (style === "residential" ? 0.45 : 0.30)) return "courtyard";
  const pool = STYLE_POOLS[style] ?? STYLE_POOLS.commercial;
  return pool[Math.floor(hash2(seed ^ 0x5ab5, ax, ay) * pool.length) % pool.length];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The massing itself: box descriptors in cell units. `sub` marks the boxes
// that ride on a base cell (podium towers, factory stacks) rather than being
// the cell's own mass. Every height carries a per-cell jitter term — two
// coplanar roofs in the overlap strip would z-fight, and a dead-flat block
// reads as printed rather than built.
// Streets a facade can address (for balconies and shopfronts).
const FACES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const streetFace = (tiles, size, x, y) => {
  for (const [dx, dy] of FACES) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const t = tiles[ny * size + nx];
    if (t === STREET_TILE || t === TRANSIT_TILE || t === 2) return [dx, dy];
  }
  return null;
};

// Shared instancing helpers. These lived inside the decor builder until parks
// (playtest 13, finding 7) needed the same two lines; a second copy is how the
// tile palette ended up in three places and two colour spaces.
const lambert = (hex) => new THREE.MeshLambertMaterial({
  color: new THREE.Color().setRGB(...hexRgb(hex)),
});
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3(), _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
function put(mesh, i, px, py, pz, sx = 1, sy = 1, sz = 1) {
  _quat.identity();
  _pos.set(px, py, pz); _scl.set(sx, sy, sz);
  _m.compose(_pos, _quat, _scl);
  mesh.setMatrixAt(i, _m);
}

export function blockMassing(tiles, size, seed, districts = null) {
  const regions = blockRegions(tiles, size);
  const instances = [];
  const decor = [];
  for (const region of regions) {
    // Join width is a REGION property: parcels inside one block terrace
    // against each other, distinguished by height and paint, not by gaps.
    const joined = region.cells.length > 1;
    const [rx, ry] = region.anchor;
    const style = styleAt(districts, size, rx, ry);
    region.style = style;
    const styleCfg = style ? DISTRICT_STYLES[style] : null;
    const hScale = styleCfg?.heightScale ?? 1;
    const parcels = parcelize(region, seed);
    region.parcels = [];
    for (const cells of parcels) {
      const [ax, ay] = cells[0];
      const n = cells.length;
      const inParcel = new Set(cells.map(([x, y]) => y * size + x));
      const interior = cells.filter(([x, y]) =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inParcel.has((y + dy) * size + x + dx)));
      const template = pickTemplate(cells, interior, seed, style);
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
        // The district's height scale bends the whole skyline: industrial
        // stays low even when its templates would not (playtest 5), but a
        // scaled building never drops below a hut.
        h = Math.min(MASSING_MAX_H, Math.max(0.5, h * hScale));
        const w = joined ? MASSING_JOIN_W : 0.86 + hash2(seed ^ 0x51ed, x, y) * 0.10;
        const tone = clamp01(baseTone + (hash2(seed ^ 0x0b70, x, y) - 0.5) * 0.12);
        instances.push({ x, y, w, h, tone, style, sub: false });

        // ── Roof and facade decoration (playtest 5) ──
        // Slimmer setback tops on the tall buildings…
        if (h >= 2.0 && hash2(seed ^ 0x5e7b, x, y) < 0.3) {
          instances.push({
            x, y, w: w * 0.55, h: 0.3 + j * 0.5, lift: h,
            tone: clamp01(baseTone - 0.06), style, sub: true,
          });
        }
        // …antenna masts on the towers, water tanks on the mid-rise…
        if (h >= 2.4 && hash2(seed ^ 0x0a57, x, y) < 0.22) {
          decor.push({ kind: "mast", x, y, top: h, h: 0.4 + j * 0.5 });
        } else if (h >= 1.0 && h <= 2.4 && hash2(seed ^ 0x7a2c, x, y) < 0.14) {
          decor.push({ kind: "tank", x, y, top: h });
        }
        // …gardens on residential flats, balconies and shopfronts on the
        // street-facing residential/commercial facades.
        if (styleCfg?.garden && h <= 1.8 && hash2(seed ^ 0x9a2d, x, y) < 0.13) {
          decor.push({ kind: "garden", x, y, top: h });
        }
        const face = streetFace(tiles, size, x, y);
        if (face && styleCfg?.balcony && h >= 1.1) {
          decor.push({
            kind: "balcony", x, y, dirX: face[0], dirZ: face[1],
            floors: Math.max(1, Math.min(4, Math.floor(h / 0.38) - 1)),
          });
        }
        if (face && styleCfg?.shopfront && hash2(seed ^ 0x5a0f, x, y) < 0.5) {
          decor.push({ kind: "shopfront", x, y, dirX: face[0], dirZ: face[1], style });
        }
        // DC-2 (ref cyperpunk-example.png): NEON on the street faces — the
        // commercial identity lever. The roll picks colour and shape too, so
        // one hash decides the whole sign and reruns are stable.
        if (face && styleCfg?.neon && h >= 0.9) {
          const roll = hash2(seed ^ 0x2e02, x, y);
          if (roll < (styleCfg.neonDensity ?? 0)) {
            decor.push({
              kind: "neon", x, y, dirX: face[0], dirZ: face[1], top: h, style,
              variant: hash2(seed ^ 0x7e01, x, y),
            });
          }
        }
        // …and industrial facades grow external PIPE runs, the works worn
        // on the outside of the building.
        if (face && styleCfg?.pipes && h >= 0.7
          && hash2(seed ^ 0x9199, x, y) < (styleCfg.pipeDensity ?? 0)) {
          decor.push({ kind: "pipes", x, y, dirX: face[0], dirZ: face[1], top: h,
            style, variant: hash2(seed ^ 0x9139, x, y) });
        }
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
          const stackH = 2.2 + j * 0.8;
          instances.push(template === "podium"
            ? { x, y, w: 0.58, h: Math.min(MASSING_MAX_H, (2.4 + j * 1.6) * Math.max(hScale, 0.75)), tone: clamp01(baseTone - 0.1), style, sub: true }
            : { x, y, w: 0.16, h: stackH, tone: clamp01(baseTone - 0.15), style, sub: true });
          // "Industrial area, with smoke coming out" (playtest 13, finding 7).
          // Emitted WITH the stack rather than placed independently, so a plume
          // can never end up hanging over open ground with nothing under it.
          if (template === "industrial"
            && hash2(seed ^ 0x50e7, x, y) < (styleCfg?.smokeDensity ?? 0)) {
            decor.push({ kind: "smoke", x, y, top: stackH, style,
              variant: hash2(seed ^ 0x5e11, x, y) });
          }
        }
      }
    }
    // Single-parcel regions keep the flat template field the tests and any
    // probe read; a carved block is honestly "mixed".
    region.template = region.parcels.length === 1 ? region.parcels[0].template : "mixed";
  }
  return { regions, instances, decor };
}

// One window-sheeted box geometry + material pair per district style, so an
// industrial facade can carry factory glazing while a research block glows
// like a wall of monitors — the texture is per MATERIAL, so styles need their
// own mesh each (there are at most seven: six traits plus unstyled).
function blockMaterialFor(seed, styleKey, styleIdx) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const styleCfg = styleKey ? DISTRICT_STYLES?.[styleKey] : null;
  if (WINDOWS) {
    const merged = { ...WINDOWS, ...(styleCfg?.windows ?? {}) };
    const tex = new THREE.DataTexture(
      buildWindowData(seed ^ (styleIdx * 0x0101), merged, merged.scale ?? 1),
      WIN_TEX, WIN_TEX);
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
  const lo = styleCfg?.blockLo ? hexRgb(styleCfg.blockLo) : BLOCK_LO;
  const hi = styleCfg?.blockHi ? hexRgb(styleCfg.blockHi) : null;
  const span = hi ? hi.map((c, i) => c - lo[i]) : BLOCK_SPAN;
  return { geo, mat, lo, span };
}

// Building mass over the massing descriptors, plus the decoration meshes.
export function buildBlocks(tiles, size, seed, districts = null) {
  const { instances, decor } = blockMassing(tiles, size, seed, districts);
  if (!instances.length) return null;
  if (!BLOCK_LO) throw new Error("terrain3d: setTerrainTokens() was never called");
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();

  const byStyle = new Map();
  for (const inst of instances) {
    const key = inst.style ?? "";
    if (!byStyle.has(key)) byStyle.set(key, []);
    byStyle.get(key).push(inst);
  }
  let styleIdx = 0;
  for (const [styleKey, list] of byStyle) {
    const { geo, mat, lo, span } = blockMaterialFor(seed, styleKey || null, styleIdx++);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const { x, y, w, h, tone, lift } = list[i];
      // A quarter-turn per instance: four different facades from one window
      // sheet, which breaks the repetition an instanced texture would
      // otherwise print across the whole city.
      quat.setFromAxisAngle(up, Math.floor(hash2(seed ^ 0x2b5f, x, y) * 4) * (Math.PI / 2));
      pos.set(x + 0.5, (lift ?? 0) + h / 2, y + 0.5);
      scl.set(w, h, w);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
      colour.setRGB(lo[0] + tone * span[0], lo[1] + tone * span[1], lo[2] + tone * span[2]);
      mesh.setColorAt(i, colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    group.add(mesh);
  }

  // ── The decoration meshes (playtest 5) ──
  const kinds = new Map();
  for (const d of decor) {
    if (!kinds.has(d.kind)) kinds.set(d.kind, []);
    kinds.get(d.kind).push(d);
  }
  // Balconies expand to one slab per floor before instancing.
  const balconies = [];
  for (const b of kinds.get("balcony") ?? []) {
    for (let f = 1; f <= b.floors; f++) {
      balconies.push({ x: b.x, y: b.y, dirX: b.dirX, dirZ: b.dirZ, fy: f * 0.38 });
    }
  }
  const styleHex = (d, field, fallback) =>
    (d.style && DISTRICT_STYLES?.[d.style]?.[field]) || fallback;

  if (ROOF_DECOR) {
    const masts = kinds.get("mast") ?? [];
    if (masts.length) {
      const mast = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.03, 1, 0.03), lambert(ROOF_DECOR.mast), masts.length);
      const tip = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.05),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...hexRgb(ROOF_DECOR.beacon)) }),
        masts.length);
      for (let i = 0; i < masts.length; i++) {
        const d = masts[i];
        put(mast, i, d.x + 0.5 + 0.18, d.top + d.h / 2, d.y + 0.5 - 0.14, 1, d.h, 1);
        put(tip, i, d.x + 0.5 + 0.18, d.top + d.h + 0.02, d.y + 0.5 - 0.14);
      }
      mast.instanceMatrix.needsUpdate = true; tip.instanceMatrix.needsUpdate = true;
      group.add(mast, tip);
    }
    const tanks = kinds.get("tank") ?? [];
    if (tanks.length) {
      const tank = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.14, 7), lambert(ROOF_DECOR.tank), tanks.length);
      for (let i = 0; i < tanks.length; i++) {
        const d = tanks[i];
        put(tank, i, d.x + 0.5 - 0.2, d.top + 0.07, d.y + 0.5 + 0.16);
      }
      tank.instanceMatrix.needsUpdate = true;
      group.add(tank);
    }
  }
  const gardens = kinds.get("garden") ?? [];
  if (gardens.length) {
    const hex = styleHex(gardens[0].style ? gardens[0] : { style: "residential" }, "garden", null)
      ?? DISTRICT_STYLES?.residential?.garden;
    if (hex) {
      const garden = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.58, 0.05, 0.58), lambert(hex), gardens.length);
      for (let i = 0; i < gardens.length; i++) {
        const d = gardens[i];
        put(garden, i, d.x + 0.5, d.top + 0.025, d.y + 0.5);
      }
      garden.instanceMatrix.needsUpdate = true;
      group.add(garden);
    }
  }
  if (balconies.length) {
    const hex = DISTRICT_STYLES?.residential?.balcony;
    if (hex) {
      const slab = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.5, 0.035, 0.5), lambert(hex), balconies.length);
      for (let i = 0; i < balconies.length; i++) {
        const b = balconies[i];
        put(slab, i,
          b.x + 0.5 + b.dirX * 0.56, b.fy, b.y + 0.5 + b.dirZ * 0.56,
          b.dirX ? 0.24 : 1, 1, b.dirZ ? 0.24 : 1);
      }
      slab.instanceMatrix.needsUpdate = true;
      group.add(slab);
    }
  }
  // DC-2: neon signs. Vertical strips and small marquees, emissive-flat and
  // bucketed by colour like the shopfronts; the variant hash picks colour,
  // shape and mounting height so the street never repeats a rhythm.
  const neons = kinds.get("neon") ?? [];
  if (neons.length) {
    const byHex = new Map();
    for (const d of neons) {
      const palette = DISTRICT_STYLES?.[d.style]?.neon;
      if (!palette?.length) continue;
      const hex = palette[Math.trunc(d.variant * 997) % palette.length];
      if (!byHex.has(hex)) byHex.set(hex, []);
      byHex.get(hex).push(d);
    }
    for (const [hex, list] of byHex) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...hexRgb(hex)) }),
        list.length);
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        const vertical = d.variant < 0.6;   // the reference skews vertical
        const len = vertical
          ? Math.min(d.top * 0.55, 0.45 + d.variant * 0.5)
          : 0.09;
        const wide = vertical ? 0.07 : 0.38 + d.variant * 0.2;
        const mountY = vertical
          ? Math.min(d.top - len / 2 - 0.06, 0.55 + d.variant * 0.9)
          : Math.min(d.top - 0.12, 0.5 + d.variant * 1.1);
        put(mesh, i,
          d.x + 0.5 + d.dirX * 0.56, mountY, d.y + 0.5 + d.dirZ * 0.56,
          d.dirX ? 0.045 : wide, len, d.dirZ ? 0.045 : wide);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }
  // DC-2: industrial pipe runs — a vertical line up the facade with a stub
  // elbow near the top. Utility, not decoration: the works worn outside.
  const pipes = kinds.get("pipes") ?? [];
  if (pipes.length) {
    const hex = DISTRICT_STYLES?.industrial?.pipes;
    if (hex) {
      const run = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1), lambert(hex), pipes.length);
      const stub = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1), lambert(hex), pipes.length);
      for (let i = 0; i < pipes.length; i++) {
        const d = pipes[i];
        const off = 0.18 + d.variant * 0.5;   // where along the face it climbs
        const px = d.x + 0.5 + d.dirX * 0.55 + (d.dirX ? 0 : off - 0.5);
        const pz = d.y + 0.5 + d.dirZ * 0.55 + (d.dirZ ? 0 : off - 0.5);
        put(run, i, px, d.top * 0.5, pz, 0.05, d.top * 0.96, 0.05);
        put(stub, i,
          px + (d.dirZ ? 0.09 : 0), d.top * (0.62 + d.variant * 0.25),
          pz + (d.dirX ? 0.09 : 0),
          d.dirX ? 0.05 : 0.2, 0.05, d.dirZ ? 0.05 : 0.2);
      }
      run.instanceMatrix.needsUpdate = true;
      stub.instanceMatrix.needsUpdate = true;
      group.add(run, stub);
    }
  }
  // SMOKE (playtest 13, finding 7). Four soft puffs climbing off each works
  // stack, widening and fading as they rise. Handed back through userData so
  // scene.js can DRIFT them off the world tick — like the faulty street lamps,
  // the animation keys off the same clock as everything else, and a still
  // plume would read as a grey lump rather than as a working chimney.
  const smokes = kinds.get("smoke") ?? [];
  if (smokes.length) {
    const hex = DISTRICT_STYLES?.industrial?.smoke;
    if (hex) {
      const PUFFS = 4;
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color().setRGB(...hexRgb(hex)),
        transparent: true, opacity: 0.42, depthWrite: false,
      });
      const puffs = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 7, 5), mat, smokes.length * PUFFS);
      const drift = [];
      for (let i = 0; i < smokes.length; i++) {
        const d = smokes[i];
        for (let k = 0; k < PUFFS; k++) {
          const idx = i * PUFFS + k;
          // SIZED AGAINST THE CAMERA, not against the stack. The first cut used
          // radii of 0.07-0.22 cells, which at street-planning zoom is about two
          // pixels — geometry that exists, renders, passes its emission test and
          // is completely invisible. A plume has to read as a plume from where
          // the district is actually looked at.
          const rise = 0.3 + k * 0.42;
          const r = 0.2 + k * 0.12;
          put(puffs, idx, d.x + 0.5, d.top + rise, d.y + 0.5, r, r * 0.8, r);
          // Every puff remembers its own anchor so the drift can be recomputed
          // per frame without re-deriving the layout.
          drift.push({ idx, x: d.x + 0.5, z: d.y + 0.5, base: d.top + rise, r,
            phase: d.variant * 6.28 + k * 1.1, k });
        }
      }
      puffs.instanceMatrix.needsUpdate = true;
      group.add(puffs);
      group.userData.smoke = { mesh: puffs, drift };
    }
  }

  const shopfronts = kinds.get("shopfront") ?? [];
  if (shopfronts.length) {
    // Bucketed by style so a residential café strip and a commercial neon
    // strip carry their own colour.
    const byHex = new Map();
    for (const d of shopfronts) {
      const hex = styleHex(d, "shopfront", null);
      if (!hex) continue;
      if (!byHex.has(hex)) byHex.set(hex, []);
      byHex.get(hex).push(d);
    }
    for (const [hex, list] of byHex) {
      const strip = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.7, 0.16, 0.05),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...hexRgb(hex)) }),
        list.length);
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        // An x-facing strip swaps its long axis onto z (0.05/0.7 and back),
        // so the glow always runs ALONG the facade, never into it.
        put(strip, i,
          d.x + 0.5 + d.dirX * 0.53, 0.16, d.y + 0.5 + d.dirZ * 0.53,
          d.dirX ? 0.05 / 0.7 : 1, 1, d.dirX ? 0.7 / 0.05 : 1);
      }
      strip.instanceMatrix.needsUpdate = true;
      group.add(strip);
    }
  }
  return group;
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

// Base geometry per kind: footprint and height in cell units. Re-sized for
// the D60 world scale (figures at 1/8 of a cell): a crate is about one
// figure-height, a drum is chest-high — props keep their human proportions
// while the city towers over everyone.
const CLUTTER_GEO = {
  crate: () => new THREE.BoxGeometry(0.1, 0.1, 0.1),
  barrel: () => new THREE.CylinderGeometry(0.032, 0.035, 0.095, 7),
  vent: () => new THREE.BoxGeometry(0.15, 0.06, 0.11),
  tarp: () => new THREE.BoxGeometry(0.18, 0.045, 0.15),
};
const CLUTTER_BASE_H = { crate: 0.1, barrel: 0.095, vent: 0.06, tarp: 0.045 };

// ── Parks (playtest 13, finding 7) ─────────────────────────────────────────
// "Residential areas should have some parks." Residential was the one district
// whose identity was carried almost entirely by window temperature — a warm
// glow and nothing on the ground. A park is the cheapest thing that says
// somebody LIVES here rather than works here.
//
// Grown on OPEN and YARD ground only. Never on roads (they are the playfield),
// never on building mass, and never on a door cell — a tree in a doorway is
// exactly the class of prop the clutter clearance rule exists to prevent.
export const PARK_TILES = [0, 8];      // T_OPEN, T_YARD

export function parkPlacements(tiles, size, seed, districts = null) {
  if (!districts?.owner || !districts?.traits) return [];
  const out = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (styleAt(districts, size, x, y) !== "residential") continue;
      const t = tiles[y * size + x];
      if (!PARK_TILES.includes(t)) continue;
      const cfg = DISTRICT_STYLES?.residential?.park;
      if (!cfg) continue;
      if (hash2(seed ^ 0x9a4c, x, y) >= (cfg.density ?? 0)) continue;
      // Two or three trees per cell, off-centre and never all in a line, plus
      // a path stripe on about a third of them so a park reads as somewhere
      // people walk rather than a green square.
      const trees = [];
      const n = 2 + (hash2(seed ^ 0x7ee5, x, y) < 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const hx = hash2(seed ^ (0x1100 + i * 7), x, y);
        const hz = hash2(seed ^ (0x2200 + i * 13), x, y);
        trees.push({
          dx: -0.34 + hx * 0.68, dz: -0.34 + hz * 0.68,
          s: 0.7 + hash2(seed ^ (0x3300 + i), x, y) * 0.6,
          alt: hash2(seed ^ (0x4400 + i), x, y) < 0.4,
        });
      }
      out.push({ x, y, trees, path: hash2(seed ^ 0x5c0f, x, y) < 0.34 });
    }
  }
  return out;
}

export function buildParks(tiles, size, seed, districts = null) {
  const cfg = DISTRICT_STYLES?.residential?.park;
  const spots = parkPlacements(tiles, size, seed, districts);
  if (!cfg || !spots.length) return null;
  const group = new THREE.Group();

  // Lawn: one merged quad set, laid a hair above the ground so it wins the
  // depth fight with the tile beneath it without z-fighting.
  // FOLLOW THE GROUND. A flat quad at a constant height is buried by the
  // terrain's own relief: a YARD cell sits at 0.05 and the first cut laid the
  // lawn at 0.012, so every park on a yard was underground and the ones on open
  // ground showed as thin strips where the noise dipped below the quad. Found
  // by recolouring the lawn magenta and looking — it renders "wrong but
  // plausibly" in the intended green.
  const lawnPos = [];
  const pathPos = [];
  const LIFT = 0.012;
  const groundAt = (x, y) => heightAt(tiles, size, seed, x, y);
  for (const p of spots) {
    const x0 = p.x + 0.04, x1 = p.x + 0.96, z0 = p.y + 0.04, z1 = p.y + 0.96;
    // The cell's four lattice corners, so the lawn sits ON the relief rather
    // than through it.
    const h00 = groundAt(p.x, p.y) + LIFT, h01 = groundAt(p.x, p.y + 1) + LIFT;
    const h11 = groundAt(p.x + 1, p.y + 1) + LIFT, h10 = groundAt(p.x + 1, p.y) + LIFT;
    lawnPos.push(x0, h00, z0, x0, h01, z1, x1, h11, z1,
      x0, h00, z0, x1, h11, z1, x1, h10, z0);
    if (p.path) {
      const a = p.y + 0.44, b = p.y + 0.56;
      const hm = (h00 + h01 + h11 + h10) / 4 + 0.008;
      pathPos.push(x0, hm, a, x0, hm, b, x1, hm, b,
        x0, hm, a, x1, hm, b, x1, hm, a);
    }
    p.groundH = (h00 + h01 + h11 + h10) / 4;
  }
  const quads = (positions, hex) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    return new THREE.Mesh(geo, lambert(hex));
  };
  group.add(quads(lawnPos, cfg.lawn));
  if (pathPos.length) group.add(quads(pathPos, cfg.path));

  // Trees: trunk plus a two-tone canopy, instanced per colour so a stand of
  // them is three draw calls rather than one per tree.
  const all = spots.flatMap((p) => p.trees.map((t) => ({ ...t, x: p.x, y: p.y, g: p.groundH ?? 0 })));
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.022, 0.03, 1, 5), lambert(cfg.trunk), all.length);
  const main = all.filter((t) => !t.alt), alt = all.filter((t) => t.alt);
  const canopy = (list, hex) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 6), lambert(hex), list.length);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      put(m, i, t.x + 0.5 + t.dx, t.g + 0.16 * t.s + 0.11 * t.s,
        t.y + 0.5 + t.dz, 0.13 * t.s, 0.26 * t.s, 0.13 * t.s);
    }
    m.instanceMatrix.needsUpdate = true;
    return m;
  };
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    put(trunks, i, t.x + 0.5 + t.dx, t.g + 0.08 * t.s, t.y + 0.5 + t.dz, 1, 0.16 * t.s, 1);
  }
  trunks.instanceMatrix.needsUpdate = true;
  group.add(trunks);
  const a = canopy(main, cfg.foliage), b = canopy(alt, cfg.foliageAlt);
  if (a) group.add(a);
  if (b) group.add(b);
  return group;
}

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

// ── Road dressing (playtest 5) ─────────────────────────────────────────────
// "The gray streets need to be proper streets": 2-lane streets with centre
// dashes, 4-lane transit avenues with a double centre line and lane dashes,
// and kerbside lamp posts — some lit, some dead, some blinking. Same honesty
// contract as the clutter: markings are paint (flat), lamps stand OFF cell
// centres, and none of it implies anything the simulation does not model.

export const STREET_TILE = 1;
export const TRANSIT_TILE = 6;
// Sidewalk width in cell units. Sized by the D60 ruling: the agent walks it
// alongside three OTHERS — four 8x-scaled figures abreast (4 x 0.4 x 0.125).
export const SIDEWALK_W = 0.2;
export const LAMP_KERB = 0.38;       // perpendicular offset — ON the sidewalk
                                     // (0.30..0.50 from the centre line) and
                                     // outside the clearance ring

const isRoad = (tiles, size, x, y) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  const t = tiles[y * size + x];
  return t === STREET_TILE || t === TRANSIT_TILE;
};

// Pure: where the paint, the kerbs and the posts go. Markings carry an axis
// (0 = the road runs east-west, 1 = north-south) and a lane offset;
// intersections get no paint, which is also what real intersections do.
// Playtest 6 ("streets need to be much more refined"): a street cell is a
// full 4-lane carriageway now — double solid centre line plus a dash per
// outer lane — a transit avenue adds solid edge lines on top, and every road
// edge that borders non-road gets a SIDEWALK strip.
export function roadFeatures(tiles, size, seed, road) {
  const markings = [];
  const lamps = [];
  const sidewalks = [];
  const litShare = road?.litShare ?? 0.6;
  const blinkShare = road?.blinkShare ?? 0.15;
  const lampChance = road?.lampChance ?? 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = tiles[y * size + x];
      if (t !== STREET_TILE && t !== TRANSIT_TILE) continue;
      const ew = isRoad(tiles, size, x - 1, y) || isRoad(tiles, size, x + 1, y);
      const ns = isRoad(tiles, size, x, y - 1) || isRoad(tiles, size, x, y + 1);
      const axis = ew && !ns ? 0 : ns && !ew ? 1 : -1;
      const yLift = t === TRANSIT_TILE ? 0.062 : 0.042;   // above the relief

      // Sidewalks hug every edge that faces off the road — intersections
      // included, which is what keeps the kerb line continuous around
      // corners.
      for (const [dx, dy] of FACES) {
        if (isRoad(tiles, size, x + dx, y + dy)) continue;
        sidewalks.push({ x, y, dx, dy, h: yLift - 0.006 });
      }

      if (axis >= 0) {
        // 4-lane: double solid centre line + a dash per outer lane.
        markings.push({ x, y, axis, lane: -0.03, len: 1.0, solid: 1, h: yLift });
        markings.push({ x, y, axis, lane: 0.03, len: 1.0, solid: 1, h: yLift });
        markings.push({ x, y, axis, lane: -0.21, len: 0.3, solid: 0, h: yLift });
        markings.push({ x, y, axis, lane: 0.21, len: 0.3, solid: 0, h: yLift });
        if (t === TRANSIT_TILE) {
          // An avenue reads wider: solid edge lines along the outer lanes.
          markings.push({ x, y, axis, lane: -0.38, len: 1.0, solid: 1, h: yLift });
          markings.push({ x, y, axis, lane: 0.38, len: 1.0, solid: 1, h: yLift });
        }
      }

      if (hash2(seed ^ 0x1a90, x, y) < lampChance) {
        const side = hash2(seed ^ 0x51de, x, y) < 0.5 ? -1 : 1;
        const along = (hash2(seed ^ 0x0a10, x, y) - 0.5) * 0.5;
        const r = hash2(seed ^ 0x57a7, x, y);
        const state = r < litShare ? "lit"
          : r < litShare + blinkShare
            ? (hash2(seed ^ 0x0b1b, x, y) < 0.5 ? "blinkA" : "blinkB")
            : "off";
        const warm = hash2(seed ^ 0x3a3a, x, y) < 0.7;
        // Perpendicular to the road axis; on an intersection (axis -1) pick a
        // corner so the post never stands in either travel line.
        const dx = axis === 0 ? along : side * LAMP_KERB;
        const dz = axis === 0 ? side * LAMP_KERB : axis === 1 ? along : side * LAMP_KERB;
        lamps.push({ x, y, dx, dz, state, warm, h: yLift - 0.006 });
      }
    }
  }
  return { markings, lamps, sidewalks };
}

// Proportioned for 1/8-cell figures (playtest 12): a lamp is ~5 figure
// heights, which is what a street light actually is.
const LAMP_H = 0.56;

// The meshes. One instanced mesh per material; the blinking lamps' glowing
// parts land in two groups (A and B, opposite phases) that the scene toggles
// per frame — a city where every faulty tube blinks in unison reads as a
// stage set.
export function buildRoads(tiles, size, seed) {
  if (!ROAD) return null;
  const { markings, lamps, sidewalks } = roadFeatures(tiles, size, seed, ROAD);
  if (!markings.length && !lamps.length && !sidewalks.length) return null;
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const basic = (hex, opacity) => new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(...hexRgb(hex)),
    ...(opacity !== undefined
      ? { transparent: true, opacity, depthWrite: false } : {}),
  });

  if (sidewalks.length && ROAD.sidewalk) {
    const kerb = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.012, 1),
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(ROAD.sidewalk)) }),
      sidewalks.length);
    for (let i = 0; i < sidewalks.length; i++) {
      const s = sidewalks[i];
      pos.set(s.x + 0.5 + s.dx * (0.5 - SIDEWALK_W / 2), s.h,
        s.y + 0.5 + s.dy * (0.5 - SIDEWALK_W / 2));
      scl.set(s.dx ? SIDEWALK_W : 1, 1, s.dy ? SIDEWALK_W : 1);
      quat.identity();
      m.compose(pos, quat, scl);
      kerb.setMatrixAt(i, m);
    }
    kerb.instanceMatrix.needsUpdate = true;
    group.add(kerb);
  }

  if (markings.length) {
    const paint = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.008, 1),
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(ROAD.marking)) }),
      markings.length);
    for (let i = 0; i < markings.length; i++) {
      const k = markings[i];
      const alongOff = k.along ?? 0;
      pos.set(
        k.x + 0.5 + (k.axis === 0 ? alongOff : k.lane),
        k.h,
        k.y + 0.5 + (k.axis === 0 ? k.lane : alongOff));
      scl.set(k.axis === 0 ? k.len : 0.045, 1, k.axis === 0 ? 0.045 : k.len);
      quat.identity();
      m.compose(pos, quat, scl);
      paint.setMatrixAt(i, m);
    }
    paint.instanceMatrix.needsUpdate = true;
    group.add(paint);
  }

  if (lamps.length) {
    const postGeo = new THREE.CylinderGeometry(0.016, 0.02, LAMP_H, 5);
    const posts = new THREE.InstancedMesh(
      postGeo,
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(ROAD.lampPost)) }),
      lamps.length);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      pos.set(l.x + 0.5 + l.dx, LAMP_H / 2, l.y + 0.5 + l.dz);
      scl.set(1, 1, 1); quat.identity();
      m.compose(pos, quat, scl);
      posts.setMatrixAt(i, m);
    }
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);

    // A pavement pad under every post (playtest 8: "under lightposts, there
    // needs to be pavement colour, not road colour") — intersection corners
    // have no sidewalk strip, so the pad guarantees the kerb read everywhere.
    if (ROAD.sidewalk) {
      const pads = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.16, 0.012, 0.16),
        new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(ROAD.sidewalk)) }),
        lamps.length);
      for (let i = 0; i < lamps.length; i++) {
        const l = lamps[i];
        pos.set(l.x + 0.5 + l.dx, l.h ?? 0.036, l.y + 0.5 + l.dz);
        scl.set(1, 1, 1); quat.identity();
        m.compose(pos, quat, scl);
        pads.setMatrixAt(i, m);
      }
      pads.instanceMatrix.needsUpdate = true;
      group.add(pads);
    }

    // Heads, cones and light pools, bucketed by (state, warmth).
    const buckets = new Map();
    for (const l of lamps) {
      const key = l.state === "off" ? "off" : `${l.state}:${l.warm ? "warm" : "cool"}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(l);
    }
    const blink = { A: [], B: [] };
    const headGeo = new THREE.BoxGeometry(0.055, 0.035, 0.055);
    const coneGeo = new THREE.ConeGeometry(0.3, LAMP_H - 0.06, 8, 1, true);
    const poolGeo = new THREE.CircleGeometry(0.34, 12);
    for (const [key, list] of buckets) {
      const off = key === "off";
      const warm = key.endsWith("warm");
      const headHex = off ? ROAD.lampOff : warm ? ROAD.lampWarm : ROAD.lampCool;
      const head = new THREE.InstancedMesh(
        headGeo,
        off ? new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(headHex)) })
          : basic(headHex),
        list.length);
      const parts = [head];
      let cone = null, pool = null;
      if (!off) {
        cone = new THREE.InstancedMesh(coneGeo, basic(headHex, 0.1), list.length);
        pool = new THREE.InstancedMesh(poolGeo, basic(headHex, 0.2), list.length);
        parts.push(cone, pool);
      }
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        const cx = l.x + 0.5 + l.dx, cz = l.y + 0.5 + l.dz;
        quat.identity(); scl.set(1, 1, 1);
        pos.set(cx, LAMP_H, cz);
        m.compose(pos, quat, scl);
        head.setMatrixAt(i, m);
        if (cone) {
          pos.set(cx, (LAMP_H - 0.04) / 2 + 0.02, cz);
          m.compose(pos, quat, scl);
          cone.setMatrixAt(i, m);
        }
        if (pool) {
          quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
          pos.set(cx, 0.045, cz);
          m.compose(pos, quat, scl);
          pool.setMatrixAt(i, m);
          quat.identity();
        }
      }
      for (const p of parts) { p.instanceMatrix.needsUpdate = true; group.add(p); }
      if (key.startsWith("blinkA")) blink.A.push(...parts.slice(0));
      if (key.startsWith("blinkB")) blink.B.push(...parts.slice(0));
    }
    // The scene toggles these by tick phase; posts stay, only the glow blinks.
    group.userData.blink = blink;
  }
  return group;
}

export function countBlocks(tiles) {
  let n = 0;
  for (const t of tiles) if (t === BLOCK_TILE) n++;
  return n;
}
