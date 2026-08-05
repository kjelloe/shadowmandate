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

const root = new URL("../", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("client/assets/metadata/style_tokens.json", root)));
const manifest = JSON.parse(readFileSync(new URL("client/assets/metadata/asset_manifest.json", root)));
setStyleTokens(tokens);

// Every visual key the renderer can ask for. If scene.js gains a role, it goes
// here — and the test below proves the manifest and factory both know it.
const ROLES = [
  "agent", "rival", "patrol", "patrolAlert",
  "siteScenery", "siteOffered", "siteActive",
  "informant", "market", "coverShop", "holding", "ownHq", "rivalHq",
];

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

test("the renderer carries no colours of its own — tokens are the source of truth", () => {
  // Guards must read CODE, not prose: strip comments first. This project has
  // been bitten twice by a guard matching the comment that explained it.
  const scene = readFileSync(new URL("client/js/scene.js", root), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const hexes = scene.match(/0x[0-9A-Fa-f]{6}/g) ?? [];
  assert.deepEqual(hexes, [],
    `scene.js still hardcodes colours (${hexes.join(", ")}) — they belong in style_tokens.json`);
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
