// test/data.test.js — S13: the ruleset manifest, the data tree, and i18n
// parity. A missing key in one locale is a red suite, not a runtime fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));

test("every file named by the ruleset manifest exists and parses", () => {
  const manifest = read("data/ruleset.json");
  assert.ok(manifest.version, "ruleset must name its era version");
  for (const file of manifest.files) {
    const path = `data/${file}`;
    assert.ok(existsSync(ROOT + path), `missing ruleset file: ${path}`);
    assert.doesNotThrow(() => read(path), `unparseable: ${path}`);
  }
});

test("en and no catalogs have identical key sets", () => {
  const en = read("client/i18n/en.json");
  const no = read("client/i18n/no.json");
  const enKeys = Object.keys(en).sort();
  const noKeys = Object.keys(no).sort();
  const missingInNo = enKeys.filter((k) => !(k in no));
  const missingInEn = noKeys.filter((k) => !(k in en));
  assert.deepEqual(missingInNo, [], `keys missing from no.json: ${missingInNo.join(", ")}`);
  assert.deepEqual(missingInEn, [], `keys missing from en.json: ${missingInEn.join(", ")}`);
});

test("no catalog value is an empty string", () => {
  for (const locale of ["en", "no"]) {
    const cat = read(`client/i18n/${locale}.json`);
    for (const [k, v] of Object.entries(cat)) {
      assert.ok(typeof v === "string" && v.length > 0, `${locale}.${k} is empty`);
    }
  }
});

test("catalog placeholders match across locales", () => {
  const en = read("client/i18n/en.json");
  const no = read("client/i18n/no.json");
  const slots = (s) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");
  for (const key of Object.keys(en)) {
    assert.equal(slots(no[key]), slots(en[key]), `placeholder mismatch on ${key}`);
  }
});

test("terrain data agrees with the engine terrain module", async () => {
  const { TERRAIN_SPEED, TERRAIN_COVER } = await import("../engine/terrain.js");
  const data = read("data/terrain.json");
  for (const [name, spec] of Object.entries(data.tiles)) {
    assert.equal(TERRAIN_SPEED[spec.id], spec.speed, `speed mismatch for ${name}`);
    assert.equal(TERRAIN_COVER[spec.id], spec.cover, `cover mismatch for ${name}`);
    assert.equal(spec.speed > 0, spec.passable, `passable flag wrong for ${name}`);
  }
});

test("season data encodes the ruled values (D15, D31)", () => {
  const season = read("data/season.json");
  assert.equal(season.days, 28, "D15: official season is 4 weeks");
  assert.equal(season.reconnectGraceTicks, 1200, "D31: 120s grace at 10Hz");
  assert.ok(season.carriesAcrossSeasons.includes("recognition"), "D33");
});

test("contract data encodes the ruled economy (D18, D29)", () => {
  const c = read("data/contracts.json");
  assert.equal(c.poolPerSlot, 5, "D18: pool is 5 per player slot");
  assert.equal(c.offersShown, 5, "D18: each present Firm sees 5");
  assert.equal(c.maxActivePerAgent, 2, "D29");
  assert.equal(c.teaserRow, true, "D29");
});


// D42/D43: extraction reads over-chosen in the battery and the standing
// temptation is to cut its payout. That is ruled out — it is under-opposed, not
// mispriced, and the difficulty belongs in S16. These assertions exist so that
// "fix" fails loudly instead of quietly undoing the effort-pricing pass.
test("contract rewards stay priced by effort (D42, S06)", () => {
  const types = read("data/contracts.json").types;
  const work = (spec) =>
    ((spec.holdTicks ?? 0) * (spec.passes ?? 1))
    + ((spec.plantTicks ?? 0) * (spec.legs ?? 1))
    + (spec.crackTicks ?? 0) + (spec.secureTicks ?? 0) + (spec.fuseTicks ?? 0);

  // Extraction must never go back to being a walk-on with no work stage. That
  // was the shape that let its score run away in the first place.
  assert.ok((types.extraction.secureTicks ?? 0) > 0,
    "D42: extraction needs time on site; a zero-work contract is strictly the safest way to earn");

  // More time on objective must pay more. Surveillance asks for the most by far.
  assert.ok(work(types.surveillance) > work(types.extraction),
    "surveillance should demand more work than extraction");
  assert.ok(types.surveillance.reward > types.extraction.reward,
    `effort pricing inverted: surveillance asks ${work(types.surveillance)} ticks for `
    + `${types.surveillance.reward} while extraction asks ${work(types.extraction)} for `
    + `${types.extraction.reward}`);

  // Sabotage carries two plants plus a fuse to outrun, and is tier-gated above
  // courier, which has no work stage at all.
  assert.ok(work(types.sabotage) > work(types.courier));
  assert.ok(types.sabotage.reward > types.courier.reward,
    "sabotage does strictly more work than courier and must pay more");
});
