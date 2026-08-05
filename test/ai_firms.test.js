// test/ai_firms.test.js — M5 gate: AI Firms are players, not privileged
// subsystems, and they must actually play.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { createInitialState, FIRM_UNDEPLOYED } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms, aiLawfulView, aiDecide, scoreContract, workTicksFor, personalityOf } from "../engine/ai_firms.js";
import { COMMAND_NAMES } from "../engine/commands.js";
import { RULES } from "./helpers.js";

const PINNED_SEEDS = [1000, 1411, 4711, 90210, 2026];

function aiWorld(seed, { size = 64, ai = 3, swap = false } = {}) {
  const city = generateCity(seed, size, RULES.citygen);
  const s = createInitialState({ seed, size, rules: RULES, city });
  spawnAiFirms(s, RULES, ai, { swap });
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);
  return s;
}

function runAiWorld(seed, ticks, opts = {}) {
  let s = aiWorld(seed, opts);
  const census = new Map();
  const rejections = new Map();
  for (let t = 0; t < ticks; t++) {
    const ai = stepAiFirms(s, RULES, apply);
    s = ai.state;
    s = apply(s, { type: CMD_ADVANCE_TICK });
    for (const e of [...ai.events, ...s.events]) {
      census.set(e.type, (census.get(e.type) ?? 0) + 1);
      if (e.type === "rejected") {
        const key = `${e.command}:${e.reason}`;
        rejections.set(key, (rejections.get(key) ?? 0) + 1);
      }
    }
  }
  return { state: s, census, rejections };
}

test("AI Firms issue only valid commands — no rejection spam", () => {
  // The AI's rejected commands are its bug report. 1324 `move:no_route` and
  // 136 `activateEvac:not_at_hq` in one world-day is how the first two AI
  // defects were found, and neither showed up as a failing test.
  for (const seed of [1411, 4711]) {
    const { rejections } = runAiWorld(seed, 6000);
    assert.deepEqual([...rejections.entries()], [],
      `seed ${seed} AI issued invalid commands: ${JSON.stringify([...rejections])}`);
  }
});

test("M5 GATE: AI-only worlds run clean on all five pinned seeds", () => {
  const required = ["firmDeployed", "contractAccepted", "contractCompleted"];
  for (const seed of PINNED_SEEDS) {
    const { state, census, rejections } = runAiWorld(seed, 8000);
    assert.deepEqual([...rejections.keys()], [], `seed ${seed} had rejections`);
    for (const type of required) {
      assert.ok((census.get(type) ?? 0) > 0,
        `seed ${seed}: AI never produced '${type}' — the world is not alive`);
    }
    // Invariants that must survive any AI behaviour.
    for (const agent of state.agents) {
      assert.ok(agent.condition >= 0, "negative condition");
      assert.ok(agent.state >= 0 && agent.state <= 4, "impossible agent state");
    }
    for (const d of state.districts) {
      assert.ok(d.heat >= 0 && d.heat <= RULES.detection.heat.max, "heat out of band");
    }
    for (const c of state.contractPool) {
      assert.ok(!(c.acceptedBy >= 0 && c.reservedBy >= 0 && c.acceptedBy !== c.reservedBy),
        "a contract is accepted by one Firm and reserved to another");
    }
  }
});

test("AI Firms complete a full deployment cycle: drop in, work, extract", () => {
  const { census } = runAiWorld(1411, 12000);
  assert.ok((census.get("firmDeployed") ?? 0) > 0, "never deployed");
  assert.ok((census.get("contractCompleted") ?? 0) > 0, "never completed work");
  assert.ok((census.get("firmExtracted") ?? 0) > 0, "never extracted — no full cycle");
});

test("the AI reads only its lawful view", () => {
  // Enforced structurally: the decision function must not reach into rival
  // state. If it ever needs to, that is a design change, not a refactor.
  const src = readFileSync(new URL("../engine/ai_firms.js", import.meta.url).pathname, "utf8");
  const decide = src.slice(src.indexOf("export function aiDecide"),
    src.indexOf("function targetCellFor"));
  for (const forbidden of ["state.firms[", "state.agents.find", "state.contractPool.filter"]) {
    assert.ok(!decide.includes(forbidden),
      `aiDecide reaches past aiLawfulView via '${forbidden}' — lawful-knowledge rule`);
  }
});

test("the lawful view hides rival HQs the agent cannot see", () => {
  let s = aiWorld(4711);
  // Deploy two Firms far apart, then confirm neither sees the other's HQ.
  s = apply(s, { type: 10, firmId: 0, cellX: 4, cellY: 4 });
  s = apply(s, { type: 10, firmId: 1, cellX: s.size - 5, cellY: s.size - 5 });
  const view = aiLawfulView(s, 0);
  assert.equal(view.visibleRivalHqs.length, 0,
    "a Firm on the far side of the map can see a rival HQ");
});

test("personalities differ in what they take on", () => {
  // Not "one is better" — that is a battery question. Only that the
  // temperaments are not the same object wearing three hats.
  const p = RULES.ai_firms.personalities;
  assert.equal(p.length, 3);
  const risk = p.map((x) => x.riskWeight);
  assert.equal(new Set(risk).size, 3, "all personalities price risk identically");
  const policies = p.map((x) => x.standoffPolicy);
  assert.equal(new Set(policies).size, 3, "all personalities answer standoffs identically");
});

test("AI worlds are deterministic and replay byte-identically", () => {
  const run = () => {
    let s = aiWorld(90210);
    const hashes = [];
    for (let i = 0; i < 400; i++) {
      s = stepAiFirms(s, RULES, apply).state;
      s = apply(s, { type: CMD_ADVANCE_TICK });
      hashes.push(hashState(s));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});

test("firm-swap changes seats without changing the world", () => {
  // The fairness instrument: the same city, the same seeds, personalities
  // traded. If a result tracks the swap it is the personality, not the seat.
  const a = aiWorld(4711, { swap: false });
  const b = aiWorld(4711, { swap: true });
  assert.deepEqual(a.map.cells, b.map.cells, "swap must not alter the city");
  const pa = a.firms.slice(0, 3).map((f) => f.aiPersonality);
  const pb = b.firms.slice(0, 3).map((f) => f.aiPersonality);
  assert.notDeepEqual(pa, pb, "firm-swap did not actually swap anything");
  assert.deepEqual([...pa].sort(), [...pb].sort(), "swap must permute, not replace");
});

test("the world-day harness produces the full metric row", async () => {
  const { runWorldDay, COLUMNS } = await import("../tools/sm_worldday.mjs");
  // Long enough for a deployment to actually happen: the AI's deploy gap is
  // 6000 ticks after the M6 pacing pass, so a 2000-tick sample now sees an
  // empty world and asserts nothing.
  const row = runWorldDay(1411, { ticks: 12000 });
  for (const col of COLUMNS) {
    assert.ok(row[col] !== undefined, `metric column '${col}' is missing`);
    assert.ok(Number.isInteger(row[col]), `metric '${col}' is not an integer: ${row[col]}`);
  }
  assert.ok(row.deployments > 0, "a 2000-tick world-day saw no deployment");
});

// The scorer is an INSTRUMENT: D11 pacing is verdicted from AI runs, so a
// scorer blind to time-on-objective produces confident, wrong balance numbers.
// It was blind — surveillance's three 1200-tick stationary holds priced as
// free, and a second leg cost nothing.
test("contract scoring prices time-on-objective and second legs", () => {
  const s = aiWorld(4711);
  const view = { hq: { cellX: 10, cellY: 10 } };
  const site = s.sites[0];
  const p = personalityOf(RULES, 0);
  // Identical pay, site and district. The ONLY difference is that one demands
  // three 1200-tick holds and the other demands nothing.
  const base = { siteId: site.id, siteIdB: -1, districtId: site.districtId, reward: 100 };
  const quick = scoreContract(s, view, { ...base, kind: 2 }, p, RULES);
  const slow = scoreContract(s, view, { ...base, kind: 1 }, p, RULES);
  assert.ok(quick > slow,
    `3600 ticks of standing still must score below identically-paid idleness-free work (quick=${quick} slow=${slow})`);

  // A second site is a second journey, so it must cost something.
  const far = s.sites.find((x) => Math.abs(x.cellX - site.cellX) + Math.abs(x.cellY - site.cellY) > 12);
  if (far) {
    const oneLeg = scoreContract(s, view, { ...base, kind: 0 }, p, RULES);
    const twoLeg = scoreContract(s, view, { ...base, kind: 0, siteIdB: far.id }, p, RULES);
    assert.ok(oneLeg > twoLeg, "a courier's second leg must not be free");
  }

  assert.equal(workTicksFor(RULES.contracts.types.surveillance), 3600, "holdTicks * passes");
  // Extraction gained a secure timer (Q37) — it used to be the one type with no
  // work at all, which is what let its score run away. It still costs far less
  // than three surveillance passes, which is what the ordering above rests on.
  assert.equal(workTicksFor(RULES.contracts.types.extraction), 900, "secureTicks");
  assert.ok(workTicksFor(RULES.contracts.types.surveillance)
    > workTicksFor(RULES.contracts.types.extraction));
});
