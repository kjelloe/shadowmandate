// test/defend.test.js — the Defend contract (S16, M8 slice 8j, D49a).
//
// The sixth type and the one INBOUND job. Every other contract is "go
// somewhere, do something, come home"; this one is "be somewhere while
// something comes to you". The texture inverts, and these tests are mostly
// about that inversion holding:
//
//   - being SEEN is not failure (the only contract with no stealth clause);
//   - leaving IS failure, immediately;
//   - a rival arriving PAUSES the hold rather than losing it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import {
  KIND_DEFEND, KIND_NAMES, KIND_COUNT, STAGE_WORK, STAGE_TRAVEL,
  STAGE_DONE, STAGE_FAILED, stepContracts, stageTargetTicks,
  refillPool,
} from "../engine/contracts.js";
import { workTicksFor } from "../engine/ai_firms.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const SPEC = RULES.contracts.types.defend;

// An agent standing on a site with an accepted Defend contract.
function onPost({ seen = false } = {}) {
  const s = makeWorld();
  const site = s.sites[0];
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  agent.detection = seen ? 2 : 0;
  const contract = {
    id: 900, kind: KIND_DEFEND, tier: SPEC.tier, districtId: site.districtId,
    siteId: site.id, siteIdB: -1, reward: SPEC.reward, expiresTick: 0,
    reservedBy: 0, acceptedBy: 0, stage: STAGE_WORK, stageTicks: 0,
    graceTicks: 0, burnsTaken: 0, legsDone: 0,
    contested: 0, contenders: [], contestedBy: [],
  };
  s.contractPool.push(contract);
  agent.contractIds.push(contract.id);
  return { s, site, agent, contract };
}

const run = (s, n) => { for (let i = 0; i < n; i++) stepContracts(s, RULES.contracts, RULES.detection); };

// ── It exists ──────────────────────────────────────────────────────────────

test("Defend is a real sixth type, wired end to end", () => {
  assert.equal(KIND_COUNT, 6);
  assert.equal(KIND_NAMES[KIND_DEFEND], "defend");
  assert.ok(RULES.contracts.types.defend, "no tuning for the defend type");
  assert.ok(SPEC.holdTicks > 0, "a defence with no hold is not a contract");
});

// ── The inversion ──────────────────────────────────────────────────────────

test("BEING SEEN IS NOT FAILURE — the point of the whole type", () => {
  // Every other contract either resets or fails when you are spotted. Here you
  // are supposed to be there, and this is the only contract with no stealth
  // clause at all.
  const { s, contract } = onPost({ seen: true });
  run(s, 50);
  assert.equal(contract.stage, STAGE_WORK, "a burned defender lost the contract");
  assert.ok(contract.stageTicks > 0, "the hold did not advance while the agent was seen");
});

test("leaving the post fails it immediately", () => {
  // Everything else forgives a wander by resetting a timer. Here the thing you
  // were guarding is behind you the moment you step away.
  const { s, agent, contract } = onPost();
  run(s, 10);
  assert.equal(contract.stage, STAGE_WORK);
  agent.x += 256 * 8; agent.y += 256 * 8;
  run(s, 1);
  assert.equal(contract.stage, STAGE_FAILED, "an abandoned post did not fail");
  assert.ok(s.events.some((e) => e.type === "contractFailed" || e.reason === "post_abandoned"));
});

test("holding to the end completes it", () => {
  const { s, contract } = onPost();
  run(s, SPEC.holdTicks + 2);
  assert.equal(contract.stage, STAGE_DONE, "a full hold did not complete");
});

// ── Contested ──────────────────────────────────────────────────────────────

test("a rival on the site PAUSES the hold rather than losing it", () => {
  // A reset would mean any rival wandering past costs the whole hold, which
  // makes the contract a coin-flip rather than a job.
  const { s, site, contract } = onPost();
  run(s, 20);
  const held = contract.stageTicks;
  assert.ok(held > 0);

  placeAgent(s, { agentId: 4, firmId: 1, cellX: site.cellX + 1, cellY: site.cellY });
  run(s, 30);
  assert.equal(contract.stageTicks, held, "the hold advanced while a rival stood on the site");
  assert.equal(contract.stage, STAGE_WORK, "a rival arriving lost the contract outright");
  assert.ok(s.events.some((e) => e.type === "defenceBreached"), "the breach was silent");
});

test("the hold resumes when the rival leaves", () => {
  const { s, site, contract } = onPost();
  const rival = placeAgent(s, { agentId: 4, firmId: 1, cellX: site.cellX, cellY: site.cellY });
  run(s, 20);
  const paused = contract.stageTicks;
  rival.x += 256 * 20; rival.y += 256 * 20;
  run(s, 20);
  assert.ok(contract.stageTicks > paused, "the hold never restarted after the rival left");
});

test("a rival far away is not a breach", () => {
  const { s, site, contract } = onPost();
  placeAgent(s, { agentId: 4, firmId: 1,
    cellX: site.cellX + SPEC.breachRadius + 4, cellY: site.cellY });
  run(s, 25);
  assert.ok(contract.stageTicks >= 20, "a distant rival paused the hold");
});

test("your OWN Firm standing there is never a breach", () => {
  const { s, site, contract } = onPost();
  placeAgent(s, { agentId: 5, firmId: 0, cellX: site.cellX, cellY: site.cellY });
  run(s, 25);
  assert.ok(contract.stageTicks >= 20, "a team-mate counted as an intruder");
});

// ── The scorer must see it ─────────────────────────────────────────────────

test("the AI scorer prices Defend's long hold", () => {
  // 1800 stationary ticks is the entire cost of this contract. A scorer blind
  // to it prices the job as free — exactly the blindness that made surveillance
  // look cheap before the effort pass.
  assert.equal(workTicksFor(SPEC), SPEC.holdTicks * (SPEC.passes ?? 1));
  assert.ok(workTicksFor(SPEC) >= 1000, "defend reads as cheap work to the AI");
});

test("the HUD can draw a progress bar for it", () => {
  const { contract } = onPost();
  assert.equal(stageTargetTicks(contract, RULES.contracts), SPEC.holdTicks,
    "the view cannot tell the client how long the defence is — the bar would be blank");
});

test("the pool actually rolls Defend contracts", () => {
  // A type the generator never produces is dead content, whatever the
  // constants say — and KIND_COUNT is the one place that decides it.
  let pool = 0, defend = 0;
  for (const seed of [4711, 90210, 1548, 1000]) {
    const s = makeWorld({ seed });
    refillPool(s, RULES.contracts, RULES.detection);
    pool += s.contractPool.length;
    defend += s.contractPool.filter((c) => c.kind === KIND_DEFEND).length;
  }
  assert.ok(defend > 0, "the pool never generates a Defend contract");
  assert.ok(defend / pool > 0.08, `only ${((defend / pool) * 100).toFixed(1)}% defend — barely exists`);
});
