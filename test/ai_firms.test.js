// test/ai_firms.test.js — M5 gate: AI Firms are players, not privileged
// subsystems, and they must actually play.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { createInitialState, FIRM_UNDEPLOYED, AGENT_ACTIVE, AGENT_DOWNED, AGENT_HELD } from "../engine/state.js";
import { captureAgent } from "../engine/combat.js";
import { generateCity, findDropZones } from "../engine/citygen.js";
import { refillPool, rebuildOffers, KIND_NAMES } from "../engine/contracts.js";
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

test("Q48: the AI takes the redrop, and the gate is REACHABLE", () => {
  // The first version of this gate required `reputation - cost >= floor`, which
  // AI Firms can never satisfy: they start at reputation 0 and only earn it by
  // extracting cleanly, so nothing could pay 8 up front. Zero redrops across
  // four seeds and eighteen captures — the dead-8f-scorer-gate shape, and the
  // branch READS perfectly. Only counting the outcome found it.
  //
  // So this asserts the decision REACHES the command, not that the code looks
  // right. Unit tests prove behaviour; they never prove reachability.
  let s = aiWorld(4711);
  // A REAL drop zone, never a hand-picked cell: (8,8) was tried and is
  // unlandable on this seed, which is exactly the `x + 3` trap the test
  // conventions warn about.
  const zone = findDropZones(s, RULES.citygen)[0];
  s = apply(s, { type: 10, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const firm = s.firms[0];
  const agent = s.agents.find((a) => a.firmId === 0 && a.state === AGENT_ACTIVE);
  assert.ok(agent, "fixture: the AI never deployed");

  // Give it unfinished accepted work, then take its operative into custody.
  const contract = s.contractPool.find((c) => c.acceptedBy < 0);
  contract.acceptedBy = 0;
  contract.stage = 1;
  agent.state = AGENT_DOWNED;
  captureAgent(s, agent, -1, RULES.detection, RULES.agents);
  assert.equal(s.agents[agent.id].state, AGENT_HELD, "fixture: capture failed");

  const decision = aiDecide(s, 0, RULES);
  assert.equal(decision.command?.type, 14,
    `with unfinished work the AI should redrop, got ${JSON.stringify(decision.command)}`);

  // With NOTHING left to finish, folding banks the cache and is correct —
  // the incentives oppose, which is the whole point of the choice.
  contract.stage = 4;                                   // STAGE_DONE
  const folding = aiDecide(s, 0, RULES);
  assert.equal(folding.command?.type, 11,
    "with no work left the AI should fold and bank, not pay to stay");

  // And deep in reputation debt it stops buying its way back.
  contract.stage = 1;
  firm.reputation = RULES.ai_firms.redropDebtFloor - 1;
  const broke = aiDecide(s, 0, RULES);
  assert.equal(broke.command?.type, 11,
    "past the debt floor the AI should fold rather than redrop forever");
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

// D71. `deploysToTier3` is graded against D19's PER-FIRM band of 3-4, but it
// was reading `m.deployments` — every Firm's deployments — at the moment the
// FIRST Firm reached tier 3. With 3 AI Firms that is roughly a 3x inflation,
// and it is what every tier-3 verdict this project printed was measured with
// (5.0 at M8, 6.0 on eras 2 and 3, all graded HIGH against 3-4). Corrected, the
// same worlds read 3.0 — inside the band. D19 was never failing.
//
// Asserts the RELATIONSHIP, because the value is a tuning outcome: one Firm's
// deployments can never exceed the whole world's.
test("D71: deploysToTier3 counts ONE Firm's deployments, not the world's", async () => {
  const { runWorldDay } = await import("../tools/sm_worldday.mjs");
  let checked = 0;
  for (const seed of [1411, 4711, 1000]) {
    const row = runWorldDay(seed, { ticks: 30000 });
    if (!row.deploysToTier3) continue;          // never reached tier 3 in this run
    checked++;
    assert.ok(row.deploysToTier3 <= row.deployments,
      `seed ${seed}: deploysToTier3=${row.deploysToTier3} exceeds total deployments=${row.deployments}`);
    // The real teeth: with several Firms deploying, a per-WORLD count is
    // multiples of a per-FIRM one. A Firm cannot make every deployment in a
    // world where its rivals also deploy, so equality across seeds is the
    // signature of the defect rather than of a busy Firm.
    assert.ok(row.deploysToTier3 < row.deployments,
      `seed ${seed}: deploysToTier3 equals the world's total deployments `
      + `(${row.deployments}) — it is counting every Firm again`);
    assert.ok(row.ticksToTier3 > 0,
      "ticksToTier3 must be set whenever deploysToTier3 is (D71 measures D19 in time)");
  }
  assert.ok(checked > 0, "no seed reached tier 3 — the assertion never ran");
});

// The scorer is an INSTRUMENT: D11 pacing is verdicted from AI runs, so a
// scorer blind to time-on-objective produces confident, wrong balance numbers.
// It was blind — surveillance's three 1200-tick stationary holds priced as
// free, and a second leg cost nothing.
test("contract scoring prices time-on-objective and second legs", () => {
  const s = aiWorld(4711);
  const view = { hq: { cellX: 10, cellY: 10 } };
  // An UNSECURED site on purpose. 8f makes the scorer decline extraction and
  // acquisition at a facility the agent has no pass for, which is correct — but
  // the subject here is time-on-objective pricing, and a fixture that trips the
  // access rule would compare -1 against -1 and prove nothing.
  const site = s.sites.find((x) => (x.securityTier | 0) === 0) ?? s.sites[0];
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

  // The RELATIONSHIP, not the literal. Pinning `secureTicks` at 900 made this
  // test fail the moment extraction's grab was lengthened for pacing (D41) —
  // a tuning knob moving is not a regression, and a test that treats it as one
  // just has to be edited every time somebody tunes.
  //
  // What actually matters here: every work-priced type HAS work (extraction was
  // once the only one without, which is what let its score run away), and
  // surveillance's three passes remain the most expensive, since the ordering
  // asserted above rests on that.
  const W = (k) => workTicksFor(RULES.contracts.types[k]);
  assert.equal(W("surveillance"), 3600, "holdTicks * passes");
  // Courier is excluded: it is priced by TRAVEL, not by time on an objective.
  // Giving it a work stage was tried for pacing on 2026-08-07 and reverted —
  // see the dev-log; it doubled burns and captures by pushing the AI onto
  // extraction instead.
  for (const k of ["surveillance", "extraction", "sabotage", "acquisition", "defend"]) {
    assert.ok(W(k) > 0, `${k} has no work at all — its score has no denominator`);
  }
  assert.ok(W("surveillance") > W("extraction"),
    "three surveillance passes should still cost more than one grab");
});

// D69. The test above says courier "is priced by TRAVEL" — and for a long time
// that was a comment describing an intention nobody had carried out. D53
// levelled pay-per-effort at a common rate per WORK-tick; courier has no work
// ticks, so the pass computed nothing for it and its 69 stayed as it was. The
// scorer, meanwhile, charged courier for two full legs. Result: courier ranked
// DEAD LAST on every board the AI ever saw, and the era-2 battery read it at
// 0.17x preference — which looks exactly like a balance problem and was
// actually a type that had never been priced at all.
//
// Ranking, not a literal: the reward is a tuning knob and pinning it here would
// make this test a chore. What must hold is that courier is a live option —
// never the worst thing on the board, and never (having corrected it) the best.
test("courier is a live option on the board, not the worst row on it", () => {
  const totals = new Map();
  for (const seed of PINNED_SEEDS) {
    const s = aiWorld(seed);
    // A real drop zone, not a hand-picked cell: distance from the HQ is the
    // whole subject here, and a corner would bias every leg the same way.
    const zones = findDropZones(s, RULES.citygen);
    const z = zones[Math.floor(zones.length / 2)] ?? zones[0];
    const view = { hq: { cellX: z.cellX, cellY: z.cellY } };
    const p = personalityOf(RULES, 0);
    for (const c of s.contractPool) {
      const score = scoreContract(s, view, c, p, RULES);
      // -1 is "declined for access", not a low price (8f). Averaging it in
      // would silently move whichever type happens to sit behind a door.
      if (score < 0) continue;
      const name = KIND_NAMES[c.kind];
      const acc = totals.get(name) ?? { sum: 0, n: 0 };
      acc.sum += score; acc.n += 1;
      totals.set(name, acc);
    }
  }

  const ranked = [...totals.entries()]
    .map(([k, v]) => [k, Math.round(v.sum / v.n)])
    .sort((a, b) => b[1] - a[1]);
  const shown = ranked.map(([k, v]) => `${k}=${v}`).join(" ");
  assert.ok(ranked.length >= 5, `too few kinds scored to rank: ${shown}`);

  const place = ranked.findIndex(([k]) => k === "courier");
  assert.ok(place >= 0, `courier never scored at all: ${shown}`);
  assert.notEqual(place, ranked.length - 1,
    `courier is the worst-scoring contract on the board — the AI will never take it (${shown})`);
  assert.notEqual(place, 0,
    `courier now outscores every other contract — travel-pricing has overcorrected (${shown})`);
});
