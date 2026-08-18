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
  WIN_TEX, ROOF_BAND, BLOCK_TILE,
} from "../client/js/terrain3d.js";
import { buildingRole, siteRole } from "../client/js/models.js";
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
  for (const role of ROLES) {
    const entry = manifestEntry(manifest, role);
    const group = buildProcedural(entry.procedural);
    const tris = countTriangles(group);
    const budget = budgets[entry.class];
    assert.ok(budget, `class "${entry.class}" has no triangle budget`);
    assert.ok(tris <= budget,
      `${role} (${entry.procedural}) is ${tris} triangles, over the ${entry.class} budget of ${budget}`);
    assert.ok(tris > 0, `${role} built no geometry at all`);
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
  for (const file of ["scene.js", "minimap.js", "terrain3d.js", "main.js", "portraits.js"]) {
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
    siteRole("active"), siteRole("offered"), siteRole(undefined),
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
  const mesh = buildBlocks(tiles, size, 4711);
  assert.ok(mesh, "no mass built from block tiles");
  assert.ok(mesh.material.emissiveMap, "the facade has no emissive map — windows would be painted on, not lit");
  // The top face samples the reserved band: BoxGeometry verts 8..15 are the
  // +y and -y faces.
  const uv = mesh.geometry.attributes.uv;
  for (let v = 8; v < 16; v++) {
    assert.ok(uv.getY(v) * WIN_TEX < ROOF_BAND,
      `roof/floor vertex ${v} samples outside the dark band`);
  }
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
