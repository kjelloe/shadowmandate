// test/custody.test.js — custody and recovery (D51, D17's other half).
//
// THE RULE: an operative left in custody is ABANDONED, not lost. The Firm may
// fold and go home; on a later deployment a recovery contract is waiting.
//
// What these protect, in order of how badly each hurt when it was missing:
//   1. a Firm is NEVER permanently stuck by a capture (3 of 8 battery seeds
//      ended in a dead loop before this);
//   2. a redeploy never picks the prisoner as its lead (18 extractions in one
//      world-day when it did);
//   3. the debt is actually collectable — the contract exists AND completes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { CMD_DROP_IN, CMD_ADVANCE_TICK } from "../engine/commands.js";
import {
  leadAgent, abandonedAgents, offerRecoveries, dropIn,
} from "../engine/hq.js";
import { recoveryContractFor, objectiveCellOf, STAGE_OFFERED } from "../engine/contracts.js";
import { captureAgent } from "../engine/combat.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const AGENT_HELD = 3;

// A world where firm 0 has an operative in custody.
function withPrisoner() {
  const s = makeWorld();
  const agent = placeAgent(s, { agentId: 0, firmId: 0, cellX: 20, cellY: 20 });
  agent.state = 2;                                   // downed, capturable
  const err = captureAgent(s, agent, 1, RULES.detection, RULES.agents);
  assert.ok(!err, `capture failed: ${err}`);
  assert.equal(agent.state, AGENT_HELD);
  return { s, prisoner: agent };
}

// ── The Firm is never stuck ────────────────────────────────────────────────

test("a prisoner is NOT the Firm's lead agent", () => {
  // The bug this prevents: the Firm redeploys, `leadAgent` hands back the agent
  // sitting in a Holding Site, the AI sees "agent_held" and folds — forever.
  const { s, prisoner } = withPrisoner();
  assert.equal(leadAgent(s, 0), null, "a Firm whose only operative is in custody still has a lead");
  const fresh = placeAgent(s, { agentId: 4, firmId: 0, cellX: 10, cellY: 10 });
  assert.equal(leadAgent(s, 0)?.id, fresh.id, "the prisoner was chosen over an operative in the field");
  assert.deepEqual(abandonedAgents(s, 0).map((a) => a.id), [prisoner.id]);
});

test("a fresh deployment lands a DIFFERENT operative", () => {
  // D51's whole point: capture is a debt, not the end of the Firm.
  const { s, prisoner } = withPrisoner();
  s.firms[0].state = 0;
  const next = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: 12, cellY: 12 });
  const lead = leadAgent(next, 0);
  assert.ok(lead, "the Firm could not redeploy at all");
  assert.notEqual(lead.id, prisoner.id, "the Firm redeployed onto its own prisoner");
  assert.equal(next.agents[prisoner.id].state, AGENT_HELD, "the prisoner was quietly freed by redeploying");

  // ...and the debt is waiting when they land. Asserted through the REAL
  // drop-in command, not by calling offerRecoveries by hand: a mutation
  // deleting the dropIn hook left every direct-call test green.
  const debt = next.contractPool.find((x) => x.recoverAgentId === prisoner.id);
  assert.ok(debt, "the Firm redeployed and nothing was waiting for the operative it left behind");
  assert.equal(debt.reservedBy, 0);
  assert.ok(next.events.some((e) => e.type === "recoveryOffered"),
    "the recovery was created silently — the player is never told the job exists");
});

// ── The debt is offered ────────────────────────────────────────────────────

test("a recovery contract is offered on the next deployment", () => {
  const { s, prisoner } = withPrisoner();
  const made = offerRecoveries(s, 0, RULES.contracts);
  assert.equal(made, 1, "no recovery contract was created for an abandoned operative");
  const c = s.contractPool.find((x) => x.recoverAgentId === prisoner.id);
  assert.ok(c, "the recovery contract is not in the pool");
  assert.equal(c.reservedBy, 0, "the debt is not reserved to the Firm that owes it");
  assert.equal(c.stage, STAGE_OFFERED);
  assert.ok(s.events.some((e) => e.type === "recoveryOffered"));
});

test("the recovery points at the Holding Site, not a contract site", () => {
  const { s, prisoner } = withPrisoner();
  offerRecoveries(s, 0, RULES.contracts);
  const c = s.contractPool.find((x) => x.recoverAgentId === prisoner.id);
  const pen = s.holdingSites.find((h) => h.id === prisoner.holdingSiteId);
  assert.deepEqual(objectiveCellOf(s, c), { x: pen.cellX, y: pen.cellY });
});

test("the debt is NOT tier-gated and does NOT expire", () => {
  // You can always go back for your own people, however new you are, and the
  // obligation does not quietly lapse while you are busy.
  const { s, prisoner } = withPrisoner();
  offerRecoveries(s, 0, RULES.contracts);
  const c = s.contractPool.find((x) => x.recoverAgentId === prisoner.id);
  assert.equal(c.tier, 1, "a Firm could be locked out of recovering its own operative");
  assert.equal(c.expiresTick, 0, "the debt expires — the operative would be stranded forever");
});

test("offering twice does not stack duplicate debts", () => {
  const { s, prisoner } = withPrisoner();
  offerRecoveries(s, 0, RULES.contracts);
  offerRecoveries(s, 0, RULES.contracts);
  offerRecoveries(s, 0, RULES.contracts);
  const all = s.contractPool.filter((x) => x.recoverAgentId === prisoner.id);
  assert.equal(all.length, 1, "every deployment adds another copy of the same debt");
});

test("a Firm with nobody in custody is offered nothing", () => {
  const s = makeWorld();
  placeAgent(s, { agentId: 0, firmId: 0, cellX: 20, cellY: 20 });
  assert.equal(offerRecoveries(s, 0, RULES.contracts), 0);
});

test("only the Firm that lost them is offered the job", () => {
  const { s, prisoner } = withPrisoner();
  offerRecoveries(s, 0, RULES.contracts);
  const c = s.contractPool.find((x) => x.recoverAgentId === prisoner.id);
  assert.notEqual(c.reservedBy, 1, "a rival Firm was offered somebody else's debt");
});

// ── The debt is collectable ────────────────────────────────────────────────

test("working the recovery FREES the operative", () => {
  // The promise made checkable. A contract you can accept and walk to but never
  // finish would be worse than not offering it.
  const { s, prisoner } = withPrisoner();
  offerRecoveries(s, 0, RULES.contracts);
  const c = s.contractPool.find((x) => x.recoverAgentId === prisoner.id);

  const pen = s.holdingSites.find((h) => h.id === prisoner.holdingSiteId);
  const rescuer = placeAgent(s, { agentId: 4, firmId: 0, cellX: pen.cellX, cellY: pen.cellY });
  c.acceptedBy = 0;
  c.stage = 1;                                       // TRAVEL
  rescuer.contractIds.push(c.id);

  let st = s;
  for (let i = 0; i < (RULES.contracts.types.extraction.secureTicks ?? 900) + 20; i++) {
    st = apply(st, { type: CMD_ADVANCE_TICK });
  }
  assert.notEqual(st.agents[prisoner.id].state, AGENT_HELD,
    "the operative is still in custody after a completed recovery");
  assert.ok(!st.holdingSites.some((h) => h.heldAgentIds.includes(prisoner.id)),
    "the Holding Site still lists a released operative");
});

test("a recovery survives the reducer's deep copy", () => {
  const { s, prisoner } = withPrisoner();
  offerRecoveries(s, 0, RULES.contracts);
  const next = apply(s, { type: CMD_ADVANCE_TICK });
  const c = next.contractPool.find((x) => x.recoverAgentId === prisoner.id);
  assert.ok(c, "the recovery contract did not survive copyState");
  assert.equal(c.holdingSiteId, prisoner.holdingSiteId);
});
