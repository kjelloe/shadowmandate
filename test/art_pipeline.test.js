// test/art_pipeline.test.js — S15 / D46 acceptance for the procedural pipeline.
//
// Art ships as code here, which means art can be unit-tested. What this file
// protects:
//   - the manifest is COMPLETE: every role the renderer can ask for resolves;
//   - every manifest entry names a builder that actually exists;
//   - triangle budgets hold, because the client runs on a phone (7b) and a busy
//     street draws dozens of these at once;
//   - a tintable slot exists wherever the manifest claims a tint, so a visual
//     can never silently accept a tint and show none;
//   - style tokens are the single source of truth — the renderer carries no
//     colours of its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  setStyleTokens, buildProcedural, proceduralKeys, applyTint, countTriangles,
} from "../client/js/asset_factory.js";
import {
  manifestEntry, resolveVisual, tintFor, firmToken, detectionMark,
} from "../client/js/asset_resolver.js";
import {
  portraitLayers, layerDiff, disguiseCount, drawableLayers,
} from "../client/js/portraits.js";
import {
  setTerrainTokens, hexRgb, buildGround, buildBlocks, buildWindowData,
  buildClutter, clutterPlacements, WIN_TEX, ROOF_BAND, BLOCK_TILE,
  CLUTTER_TILES, CLUTTER_KINDS, CLUTTER_CLEARANCE, SIDEWALK_W,
} from "../client/js/terrain3d.js";
import { buildingRole, siteVisual } from "../client/js/models.js";
import { TILE_COUNT } from "../engine/terrain.js";

const root = new URL("../", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("client/assets/metadata/style_tokens.json", root)));
const manifest = JSON.parse(readFileSync(new URL("client/assets/metadata/asset_manifest.json", root)));
setStyleTokens(tokens);

// DERIVED from the manifest, not restated. A hand-maintained list here would be
// one more copy that can drift out of step — the exact failure the palette had,
// and the reason the gallery test below checks coverage rather than trusting a
// second literal list.
const ROLES = Object.values(manifest)
  .filter((section) => section && typeof section === "object")
  .flatMap((section) => Object.keys(section));

test("every role resolves through the manifest to a real builder", () => {
  for (const role of ROLES) {
    const entry = manifestEntry(manifest, role);
    assert.ok(entry, `role "${role}" has no manifest entry`);
    const resolved = resolveVisual(manifest, role);
    assert.equal(resolved.kind, "procedural", `role "${role}" did not resolve to a stand-in`);
    assert.ok(proceduralKeys().includes(resolved.key),
      `manifest points "${role}" at builder "${resolved.key}", which does not exist`);
    assert.ok(buildProcedural(resolved.key), `builder "${resolved.key}" returned nothing`);
  }
});

test("an unknown role is reported, never silently substituted", () => {
  // The failure this prevents: a typo'd role quietly rendering as something
  // else, which looks like a design decision rather than a bug.
  assert.equal(resolveVisual(manifest, "no-such-role").kind, "missing");
  assert.equal(buildProcedural("no-such-builder"), null);
});

test("triangle budgets hold — the client runs on a phone", () => {
  const budgets = tokens.triBudget;
  const floors = tokens.triFloor;
  for (const role of ROLES) {
    const entry = manifestEntry(manifest, role);
    const group = buildProcedural(entry.procedural);
    const tris = countTriangles(group);
    const budget = budgets[entry.class];
    assert.ok(budget, `class "${entry.class}" has no triangle budget`);
    assert.ok(tris <= budget,
      `${role} (${entry.procedural}) is ${tris} triangles, over the ${entry.class} budget of ${budget}`);
    // The FLOOR is the detail pass's teeth (playtest 3, finding 3). A builder
    // that quietly regresses to boxes stays under budget and green — "a
    // feature can silently do nothing" is this project's signature failure,
    // and a ceiling alone cannot catch it.
    const floor = floors[entry.class];
    assert.ok(floor, `class "${entry.class}" has no triangle floor`);
    assert.ok(tris >= floor,
      `${role} (${entry.procedural}) is ${tris} triangles, under the ${entry.class} floor of ${floor} — the detail pass regressed`);
  }
});

test("PLAYTEST 13: figures stand tall and lean enough for a trench coat", async () => {
  // Finding 5: "all figures need to be 40% taller and sleeker, need to fit a
  // trench coat". The old figure stood 1.03 model units and its bounding box
  // was 0.58 wide — ratio 1.78, a stocky little person.
  //
  // MEASURE THE WHOLE BOUNDING BOX. The first cut of this test compared height
  // against the COAT width and reported a flattering 2.7, missing that the
  // splayed arms and hands were the widest part of the figure by a long way —
  // and they were the actual reason it read as stocky. A silhouette test that
  // measures the part you were thinking about instead of the part that decides
  // the outline is measuring the wrong thing.
  //
  // These bounds are the design promise expressed as geometry, and they are the
  // only thing standing between this pass and a silent regression: nothing else
  // in the suite can tell a tall figure from a short one, and neither can a
  // green render.
  const THREE = await import("three");
  // Derived from the manifest, never a second hand-kept list (D46) — a new
  // figure role must meet the silhouette too, or it is not the same cast.
  const figures = ROLES.filter((r) => manifestEntry(manifest, r).class === "figure");
  assert.ok(figures.length >= 3, "expected the manifest to carry several figures");
  for (const role of figures) {
    const entry = manifestEntry(manifest, role);
    const group = buildProcedural(entry.procedural);
    const box3 = new THREE.Box3().setFromObject(group);
    const height = box3.max.y - box3.min.y;
    const width = Math.max(box3.max.x - box3.min.x, box3.max.z - box3.min.z);
    assert.ok(height >= 1.40,
      `${role} (${entry.procedural}) stands ${height.toFixed(2)} — the pre-playtest-13 figure was 1.03, and the ruling was 40% taller`);
    // Sleekness is a RATIO, not a width: a figure could meet the height bound
    // by growing in every direction at once, which is the same stocky person
    // scaled up and is exactly what the finding was complaining about.
    assert.ok(height / width >= 3.0,
      `${role} (${entry.procedural}) is ${(height / width).toFixed(2)} tall per unit wide — the old stocky figure was 1.78`);
    // Standing ON the ground, not floating above it or sunk into it. A figure
    // whose feet are at y=0.1 hovers; at a 1/8 cell scale that is invisible on
    // the street and obvious in the gallery.
    assert.ok(Math.abs(box3.min.y) < 0.02,
      `${role} (${entry.procedural}) does not stand on the ground (feet at ${box3.min.y.toFixed(3)})`);
  }
});

test("anything the manifest says is tintable actually has a tint slot", () => {
  for (const role of ROLES) {
    const entry = manifestEntry(manifest, role);
    if (!entry.tint) continue;
    const group = buildProcedural(entry.procedural);
    const touched = applyTint(group, "#ff00ff");
    assert.ok(touched > 0,
      `manifest says "${role}" takes tint "${entry.tint}" but the model has no mesh named "tint" — it would accept the tint and show nothing`);
  }
});

test("tints resolve to real palette entries, and detection state drives the agent", () => {
  for (const role of ROLES) {
    const entry = manifestEntry(manifest, role);
    if (!entry.tint || entry.tint === "state") continue;
    assert.ok(tintFor(tokens, entry), `tint "${entry.tint}" for ${role} is not in the mark palette`);
  }
  // The agent's tint is its DETECTION state — gameplay information, not identity.
  const agent = manifestEntry(manifest, "agent");
  assert.equal(tintFor(tokens, agent, detectionMark(0)), tokens.marks.agentUnseen);
  assert.equal(tintFor(tokens, agent, detectionMark(1)), tokens.marks.agentNoticed);
  assert.equal(tintFor(tokens, agent, detectionMark(2)), tokens.marks.agentBurned);
});

test("Firm identity carries colour AND a symbol", () => {
  // Colour alone fails for a colourblind player — the same reason the 7a
  // silhouette pass exists. S15 pins three Firm palettes.
  assert.ok(tokens.firms.length >= 3, "S15 pins three Firm palettes");
  const symbols = new Set();
  for (const f of tokens.firms) {
    assert.ok(f.primary && f.accent && f.trim, `firm ${f.name} is missing a palette slot`);
    assert.ok(f.symbol, `firm ${f.name} has no symbol — colour alone is not identity`);
    symbols.add(f.symbol);
  }
  assert.equal(symbols.size, tokens.firms.length, "two Firms share a symbol");
  assert.equal(firmToken(tokens, 1).name, "insurgent");
  assert.ok(firmToken(tokens, 999), "an unknown firm id must still resolve to something drawable");
});

// Guards must read CODE, not prose: strip comments first. This project has been
// bitten twice by a guard that matched the comment explaining it.
function code(file) {
  return readFileSync(new URL(`client/js/${file}`, root), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
}

test("no world renderer carries colours of its own — tokens are the source of truth", () => {
  // Scope: every surface that draws. portraits.js JOINED this list on
  // 2026-08-07 — it was the last literal palette in the client, and while it
  // sat outside the token file a look candidate (Q41c/D48) reached the world
  // but not the faces, which is what kept acceptance criterion 14 at PARTIAL.
  //
  // BOTH literal forms, and this matters: the first version of this guard
  // matched only `0x......`, while the historical bug — the palette duplicated
  // into minimap.js — was written as "#RRGGBB" strings and would have walked
  // straight past it. \b keeps the seeded-hash constants in terrain3d.js
  // (0x9e3779b1) from reading as a six-digit colour.
  // WIDENED IN 8d. The first version scanned three files and missed a FOURTH
  // copy of the tile palette, in main.js's drop-zone map preview — so the
  // guard was green while the defect it exists to prevent was still present in
  // a file it did not read. A guard only protects what it reads.
  for (const file of ["scene.js", "minimap.js", "terrain3d.js", "area3d.js", "main.js", "portraits.js", "attract.js"]) {
    const hexes = code(file).match(/\b0x[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{6}\b/g) ?? [];
    assert.deepEqual(hexes, [],
      `${file} still hardcodes colours (${hexes.join(", ")}) — they belong in style_tokens.json`);
  }
});

test("the gallery shows every visual the game can draw", () => {
  // A review surface that silently shows fewer things than the renderer draws
  // is worse than no review surface: it makes an unreviewed asset look reviewed.
  const gallery = readFileSync(new URL("client/js/gallery.js", root), "utf8");
  for (const role of ROLES) {
    assert.ok(gallery.includes(`"${role}"`),
      `the manifest defines "${role}" but the gallery never renders it — it would ship unlooked-at`);
  }
});

test("every role the renderer's decision tables can produce is in the manifest", () => {
  // scene.js does not name most roles literally; it asks models.js. So the
  // guard has to walk the same tables rather than a list somebody kept by hand.
  const produced = [
    buildingRole(0), buildingRole(1), buildingRole(2), buildingRole(99),
    // Sites are typed since playtest 5: every role siteVisual can produce, for
    // every engine type and every contract state, must resolve.
    ...[0, 1, 2, 3, 4, 5, 99].flatMap((type) =>
      ["active", "offered", undefined].map((state) => siteVisual(state, type).role)),
  ];
  for (const role of produced) {
    assert.ok(manifestEntry(manifest, role),
      `models.js can return role "${role}", which the manifest does not define`);
  }
});

// ── The tile look (Q41c's other half) ──────────────────────────────────────
// Tiles were the last colours living in the renderer, in three copies and two
// colour spaces: float triples in terrain3d.js, a hand-synced hex table in
// minimap.js, and a third inline ramp for building mass. Nothing kept them
// equal, so "a candidate look is a token file" was only true of the figures.

test("every tile the engine can emit has a colour token", () => {
  // Fires the day citygen gains a tile id: without this, a new surface renders
  // as fallback grey in BOTH views and looks like a citygen bug.
  for (let id = 0; id < TILE_COUNT; id++) {
    assert.ok(tokens.terrain.tiles[id], `tile id ${id} has no colour in style_tokens.json`);
  }
  assert.ok(tokens.terrain.unknown, "no fallback colour for a tile id the tokens do not know");
  assert.ok(tokens.terrain.blockLo && tokens.terrain.blockHi, "building mass has no tone ramp");
});

test("the diorama and the radar read the SAME tile table", () => {
  // The minimap's own comment — "two views that disagree about what a thing
  // looks like are worse than one view" — is right, and duplicated constants
  // cannot deliver it. This is now checkable: the ground converts the very hex
  // string the radar fills with.
  setTerrainTokens(tokens.terrain);
  for (let id = 0; id < TILE_COUNT; id++) {
    const hex = tokens.terrain.tiles[id];
    const rgb = hexRgb(hex);
    assert.equal(rgb.length, 3);
    for (const c of rgb) assert.ok(c >= 0 && c <= 1, `${hex} converted out of range`);
  }
  // Raw /255, NOT a THREE.Color: colour management would sRGB-decode the value
  // and darken the ground about fivefold — a fault that renders "successfully".
  assert.deepEqual(hexRgb("#000000"), [0, 0, 0]);
  assert.deepEqual(hexRgb("#ffffff"), [1, 1, 1]);
  assert.deepEqual(hexRgb("#3B3F46").map((c) => Math.round(c * 255)), [59, 63, 70]);
});

test("terrain built before its tokens fails loudly, never as a grey slab", () => {
  // A ground that draws in one flat colour looks exactly like a citygen bug,
  // and the fog defect cost this project three playtests precisely because a
  // broken render still rendered.
  setTerrainTokens(null);
  const tiles = new Uint8Array(16 * 16);
  assert.throws(() => buildGround(tiles, 16, 1), /setTerrainTokens/);
  setTerrainTokens(tokens.terrain);   // leave the module usable for other tests
});

// ── The lit windows (playtest 3, finding 3) ────────────────────────────────
// The dystopian reference is mostly windows: a dark tower with none reads as
// a hole in the render. The sheet is raw bytes, so all of this is checkable
// without a browser.

test("the window sheet is deterministic per seed, and actually lit", () => {
  const a = buildWindowData(4711, tokens.terrain.windows);
  const b = buildWindowData(4711, tokens.terrain.windows);
  assert.deepEqual(a, b, "the same seed must print the same facade on every machine");
  const c = buildWindowData(90210, tokens.terrain.windows);
  assert.notDeepEqual(a, c, "different worlds should not share a facade");

  const lit = [];
  for (let i = 0; i < a.length; i += 4) if (a[i] || a[i + 1] || a[i + 2]) lit.push(i);
  assert.ok(lit.length > 0, "no window is lit — the city is a silhouette again");
  assert.ok(lit.length * 4 < a.length / 2, "more than half the sheet lit — that is an office at noon, not a dystopia");
});

test("the roof band stays black — a glowing roof reads as a lit plaza", () => {
  const data = buildWindowData(4711, tokens.terrain.windows);
  for (let y = 0; y < ROOF_BAND; y++) {
    for (let x = 0; x < WIN_TEX; x++) {
      const i = (y * WIN_TEX + x) * 4;
      assert.equal(data[i] + data[i + 1] + data[i + 2], 0,
        `texel ${x},${y} inside the roof band is lit`);
    }
  }
});

test("building mass carries the window sheet as an emissive map", () => {
  setTerrainTokens(tokens.terrain);
  const size = 8;
  const tiles = new Uint8Array(size * size);
  tiles[2 * size + 3] = BLOCK_TILE;
  tiles[5 * size + 5] = BLOCK_TILE;
  const group = buildBlocks(tiles, size, 4711);
  assert.ok(group, "no mass built from block tiles");
  // buildBlocks is a GROUP since the district pass (playtest 5): one
  // window-sheeted mesh per style plus the decoration meshes. Every mesh
  // whose material carries vertex colours is building mass and must carry
  // the sheet.
  const massMeshes = group.children.filter((c) => c.material?.vertexColors);
  assert.ok(massMeshes.length > 0, "no building-mass mesh in the block group");
  for (const mesh of massMeshes) {
    assert.ok(mesh.material.emissiveMap, "a facade has no emissive map — windows would be painted on, not lit");
    // The top face samples the reserved band: BoxGeometry verts 8..15 are the
    // +y and -y faces.
    const uv = mesh.geometry.attributes.uv;
    for (let v = 8; v < 16; v++) {
      assert.ok(uv.getY(v) * WIN_TEX < ROOF_BAND,
        `roof/floor vertex ${v} samples outside the dark band`);
    }
  }
});

// ── Street clutter (playtest 3, finding 3 — the deferred half) ─────────────
// Set dressing is where the honesty rule is easiest to break by accident:
// gameplay is flat cells with entities at cell CENTRES, so a crate that lands
// on a centre hides an agent, and clutter on a street muddies the one surface
// navigation depends on. Placement is a pure function, so all of it is
// checkable without a browser.

// A little map with every eligible surface: alleys, a yard, rough ground —
// plus streets, a block and water that must all stay clean.
function clutterTestTiles(size) {
  const tiles = new Uint8Array(size * size);
  for (let i = 0; i < tiles.length; i++) tiles[i] = [1, 2, 8, 9, 4, 10][i % 6];
  return tiles;
}

test("clutter is deterministic per seed, present, and only on its tiles", () => {
  const size = 24;
  const tiles = clutterTestTiles(size);
  const a = clutterPlacements(tiles, size, 4711, tokens.terrain.clutter.density);
  const b = clutterPlacements(tiles, size, 4711, tokens.terrain.clutter.density);
  assert.deepEqual(a, b, "the same seed must dress the same streets on every machine");
  assert.notDeepEqual(a, clutterPlacements(tiles, size, 90210, tokens.terrain.clutter.density),
    "different worlds should not share their litter");
  assert.ok(a.length > 0, "no clutter at all — the pass silently did nothing");
  // A DELIBERATE duplicate, like the fixture hash twin: checking placements
  // against CLUTTER_TILES alone is self-referential — widen the set in the
  // code and the check widens with it. Mutation-tested: adding streets to the
  // set must fail HERE, not somewhere incidental.
  assert.deepEqual([...CLUTTER_TILES].sort((x, y) => x - y), [2, 8, 9],
    "the eligible-tile set changed — alleys, yards and rough ground only, or re-decide deliberately");
  for (const p of a) {
    assert.ok(CLUTTER_TILES.has(tiles[p.y * size + p.x]),
      `clutter on tile ${tiles[p.y * size + p.x]} at ${p.x},${p.y} — streets, blocks and water must stay clean`);
    assert.ok(CLUTTER_KINDS.includes(p.kind), `unknown clutter kind "${p.kind}"`);
  }
});

test("clutter keeps the clearance ring — a prop must never cover a standing agent", () => {
  // Entities are at cell centres; the reducer knows nothing about crates. A
  // prop inside the ring is a lie about where an agent can be seen.
  const size = 24;
  const a = clutterPlacements(clutterTestTiles(size), size, 4711, 1.0);
  for (const p of a) {
    assert.ok(Math.abs(p.dx) >= CLUTTER_CLEARANCE && Math.abs(p.dz) >= CLUTTER_CLEARANCE,
      `prop at ${p.x},${p.y} sits ${p.dx.toFixed(2)},${p.dz.toFixed(2)} from centre — inside the ${CLUTTER_CLEARANCE} clearance ring`);
    assert.ok(Math.abs(p.dx) < 0.5 && Math.abs(p.dz) < 0.5,
      `prop at ${p.x},${p.y} drifted out of its own cell`);
  }
});

test("clutter colours are tokens, and the build honours them", () => {
  setTerrainTokens(tokens.terrain);
  for (const kind of CLUTTER_KINDS) {
    assert.ok(tokens.terrain.clutter[kind],
      `clutter kind "${kind}" has no colour in style_tokens.json`);
  }
  const size = 24;
  const group = buildClutter(clutterTestTiles(size), size, 4711);
  assert.ok(group, "no clutter group built from an eligible map");
  assert.ok(group.children.length > 0, "clutter group is empty");
  let instances = 0;
  for (const mesh of group.children) {
    assert.ok(mesh.isInstancedMesh, "clutter must be instanced — a busy city draws hundreds of props");
    instances += mesh.count;
  }
  assert.ok(instances > 0, "clutter meshes carry no instances");
  // A map with nothing to dress builds nothing, quietly and legally.
  assert.equal(buildClutter(new Uint8Array(16 * 16).fill(1), 16, 4711), null);
});

// ── Portraits (D47) ────────────────────────────────────────────────────────
// The design promise is comic and specific: it is the SAME agent wearing one
// absurd thing. That is only true if the layer stacks actually share their
// base, so it is testable — and worth testing, because "six unrelated
// pictures" is exactly what a fixed image set would silently produce.

test("every disguise in the ruleset has a portrait layer stack", () => {
  const disguises = JSON.parse(readFileSync(new URL("data/buildings/disguises.json", root))).disguises;
  assert.equal(disguiseCount(), disguises.length,
    `ruleset has ${disguises.length} disguises, portraits.js knows ${disguiseCount()}`);
  for (const d of disguises) {
    const p = portraitLayers(d.id);
    assert.ok(p.layers.length > 0, `disguise ${d.id} (${d.key}) produced no layers`);
  }
});

test("a disguise is a DIFF: the moustache changes exactly one thing", () => {
  // "An enormous moustache and nothing else changed" — the ruleset's own words.
  assert.deepEqual(layerDiff(0, 1), ["moustache"],
    "the moustache disguise must change the moustache and nothing else, or it is not the same person");
});

test("the pink glasses swap the glasses, not the face", () => {
  const diff = layerDiff(0, 2);
  assert.deepEqual(diff, ["eyes"],
    `pink glasses should differ from the house look in the eyes layer alone, got ${diff.join(", ")}`);
  // ...and they must actually LOOK different, or the Cover Shop sold nothing.
  const base = portraitLayers(0).layers.find((l) => l.id === "eyes");
  const pink = portraitLayers(2).layers.find((l) => l.id === "eyes");
  assert.notEqual(base.variant, pink.variant);
});

test("every disguise is visibly different from the house look", () => {
  // A disguise that changes no layer is one the player paid for and cannot see.
  for (let id = 1; id < disguiseCount(); id++) {
    assert.ok(layerDiff(0, id).length > 0, `disguise ${id} is indistinguishable from the base`);
  }
});

test("no portrait layer is silently unrenderable", () => {
  // A layer in the stack with no draw routine is a disguise that quietly does
  // nothing — the failure mode that looks like a design choice.
  const drawable = new Set(drawableLayers());
  for (let id = 0; id < disguiseCount(); id++) {
    for (const layer of portraitLayers(id).layers) {
      assert.ok(drawable.has(layer.id),
        `disguise ${id} stacks layer "${layer.id}", which has no draw routine`);
    }
  }
});

test("D60: the world scale tokens exist, cover every class, and honour the 8x ruling", () => {
  const scale = tokens.scale;
  assert.ok(scale, "no scale tokens — the D60 world-scale pass would silently not apply");
  const classes = new Set(ROLES.map((role) => manifestEntry(manifest, role).class));
  for (const cls of classes) {
    const s = manifestEntry(manifest, [...ROLES].find((r) => manifestEntry(manifest, r).class === cls)) && scale[cls];
    assert.ok(typeof s === "number" && s > 0 && s <= 1,
      `class "${cls}" has no sane scale token (${s})`);
  }
  // The ruling, verbatim: the agent walks the sidewalk alongside at least
  // THREE OTHER figures of his size — four abreast. Figure width is ~0.4
  // cells pre-scale; the sidewalk width is the shared constant the renderer
  // actually builds with, so this cannot drift into a second copy.
  assert.ok(scale.figure <= 0.14,
    `figure scale ${scale.figure} breaks the 8x ruling`);
  assert.ok(0.4 * scale.figure * 4 <= SIDEWALK_W + 1e-9,
    "the agent plus three others no longer fit the sidewalk abreast — the exact playtest-7 ask");
  // Per-entry overrides must stay sane too (the dropship).
  for (const role of ROLES) {
    const entry = manifestEntry(manifest, role);
    if (entry.scale !== undefined) {
      assert.ok(entry.scale > 0 && entry.scale <= 1, `role ${role} has a wild scale override`);
    }
  }
});
