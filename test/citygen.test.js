// test/citygen.test.js — M1 gate: the 20-seed corpus must pass every probe at
// BOTH world sizes (D26), and generation must be reproducible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateCity, findDropZones, mainComponent } from "../engine/citygen.js";
import { runAllProbes, probesPassed } from "../engine/worldprobes.js";
import { createInitialState, tileAt } from "../engine/state.js";
import { hashState } from "../engine/snapshot.js";
import { T_STREET, T_BLOCK, T_ALLEY, T_ENTRANCE, T_TRANSIT } from "../engine/terrain.js";

const CFG = JSON.parse(
  readFileSync(new URL("../data/citygen.json", import.meta.url).pathname, "utf8")
);

// The two pinned reference seeds. Every later sim gate uses these, so their
// identities are part of the contract, not a convenience.
export const REFERENCE_SEEDS = [4711, 90210];
const CORPUS = Array.from({ length: 20 }, (_, i) => 1000 + i * 137);

test("generation is reproducible for a given seed and size", () => {
  for (const size of [64, 128]) {
    const a = generateCity(4711, size, CFG);
    const b = generateCity(4711, size, CFG);
    assert.deepEqual(a.map.cells, b.map.cells, `map differs at ${size}`);
    assert.deepEqual(a.sites, b.sites);
    assert.deepEqual(a.districts, b.districts);
    assert.deepEqual(a.patrols, b.patrols);
  }
});

test("different seeds produce different cities", () => {
  const a = generateCity(1, 64, CFG);
  const b = generateCity(2, 64, CFG);
  assert.notDeepEqual(a.map.cells, b.map.cells);
});

test("the 20-seed corpus passes every probe at 64 and at 128", () => {
  const failures = [];
  for (const size of [64, 128]) {
    for (const seed of CORPUS) {
      const world = generateCity(seed, size, CFG);
      const results = runAllProbes(world, CFG);
      if (!probesPassed(results)) {
        for (const [name, r] of Object.entries(results)) {
          if (!r.ok) failures.push(`seed ${seed} @${size}: ${name} ${JSON.stringify(r).slice(0, 160)}`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `probe failures:\n${failures.join("\n")}`);
});

test("the pinned reference seeds pass every probe at both sizes", () => {
  for (const size of [64, 128]) {
    for (const seed of REFERENCE_SEEDS) {
      const world = generateCity(seed, size, CFG);
      const results = runAllProbes(world, CFG);
      assert.ok(probesPassed(results),
        `reference seed ${seed}@${size} failed: ${JSON.stringify(results)}`);
    }
  }
});

test("a generated city has the structures the design promises", () => {
  const world = generateCity(REFERENCE_SEEDS[0], 64, CFG);
  const counts = {};
  for (const t of world.map.cells) counts[t] = (counts[t] ?? 0) + 1;
  assert.ok(counts[T_STREET] > 100, "no street network");
  assert.ok(counts[T_BLOCK] > 100, "no building mass");
  assert.ok(counts[T_ALLEY] > 20, "no back routes — stealth has no geography");
  assert.ok(counts[T_TRANSIT] > 0, "no transit spine");
  assert.ok(counts[T_ENTRANCE] > 0, "no building entrances");
  assert.ok(world.districts.length >= CFG.districts.min);
  assert.ok(world.districts.length <= CFG.districts.max);
  assert.ok(world.sites.length >= CFG.sites.min, `only ${world.sites.length} sites`);
  assert.equal(world.holdingSites.length, world.districts.length);
  assert.ok(world.buildings.length >= world.districts.length * 2);
});

test("districts have distinct traits where the pool allows", () => {
  const world = generateCity(REFERENCE_SEEDS[1], 64, CFG);
  const traits = new Set(world.districts.map((d) => d.trait));
  assert.equal(traits.size, world.districts.length, "duplicate district traits");
});

test("a city-backed state hashes deterministically and is size-sensitive", () => {
  const mk = (seed, size) => createInitialState({
    seed, size, city: generateCity(seed, size, CFG),
  });
  assert.equal(hashState(mk(4711, 64)), hashState(mk(4711, 64)));
  assert.notEqual(hashState(mk(4711, 64)), hashState(mk(4711, 128)));
  assert.notEqual(hashState(mk(4711, 64)), hashState(mk(90210, 64)));
});

test("drop zones are found in an empty world and avoid patrols", () => {
  const seed = REFERENCE_SEEDS[0];
  const state = createInitialState({ seed, size: 64, city: generateCity(seed, 64, CFG) });
  const zones = findDropZones(state, CFG);
  assert.ok(zones.length > 20, `too few drop zones: ${zones.length}`);
  const clear = CFG.dropZones.minClearRadius;
  for (const z of zones) {
    for (const p of state.patrols) {
      const d = Math.abs(p.x - z.cellX) + Math.abs(p.y - z.cellY);
      assert.ok(d >= clear, `drop zone ${z.cellX},${z.cellY} too close to patrol`);
    }
  }
});

test("the microscope fixture still renders exactly as committed", async () => {
  // A generator you cannot read is a generator you cannot debug. This 16x16
  // dump is meant to be EYEBALLED in review: if it changed, look at it before
  // regenerating it (`node tools/render_city.mjs 4711 16 5`).
  const { renderCity } = await import("../tools/render_city.mjs");
  const cfg = { ...CFG, streetSpacing: 5 };
  const world = generateCity(4711, 16, cfg);
  const committed = readFileSync(
    new URL("./fixtures/microscope.txt", import.meta.url).pathname, "utf8"
  );
  const body = committed.split("\n").filter((l) => !l.startsWith("#") && !l.startsWith("legend")
    && !l.startsWith("        ") && !l.startsWith("marks")).join("\n").trim();
  assert.equal(renderCity(world).trim(), body,
    "microscope drift — inspect the new city before re-pinning it");
});

test("THE STRANDING GUARD: every drop zone is somewhere you can leave", () => {
  // A courtyard enclosed by building mass is open ground you can land on and
  // never walk out of. An AI Firm dropped into one and spent an entire
  // world-day accepting contracts it could not reach; a player would simply
  // have been stuck with no recourse but to close the tab.
  for (const seed of [...REFERENCE_SEEDS, 1822, 1137, 2233]) {
    for (const size of [64, 128]) {
      const world = generateCity(seed, size, CFG);
      const state = createInitialState({ seed, size, city: world });
      const zones = findDropZones(state, CFG);
      assert.ok(zones.length, `seed ${seed}@${size} has no drop zones at all`);
      const component = mainComponent(world.map);
      for (const z of zones) {
        assert.ok(component[z.cellY * size + z.cellX],
          `seed ${seed}@${size}: drop zone ${z.cellX},${z.cellY} is in a sealed pocket`);
      }
    }
  }
});

test("patrol routes stand on traversable ground", () => {
  const world = generateCity(REFERENCE_SEEDS[0], 64, CFG);
  for (const p of world.patrols) {
    assert.ok(p.route.length >= CFG.patrols.routeLengthMin, `patrol ${p.id} route too short`);
    for (const step of p.route) {
      const t = tileAt(world.map, step.x, step.y);
      assert.notEqual(t, T_BLOCK, `patrol ${p.id} routes through building mass`);
    }
  }
});
