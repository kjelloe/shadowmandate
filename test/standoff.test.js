// test/standoff.test.js — M5 slice 5d: the standoff (S08, D22).
//
// Every cell of the resolution matrix, plus the counterplay that matters most:
// an UNSEEN agent is not part of the encounter at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { CMD_ADVANCE_TICK, CMD_STANDOFF_CHOICE } from "../engine/commands.js";
import { AGENT_ACTIVE, AGENT_DOWNED, DET_UNSEEN, DET_NOTICED } from "../engine/state.js";
import {
  CHOICE_ENGAGE, CHOICE_WITHDRAW, CHOICE_NEGOTIATE, CHOICE_NONE,
  pactBetween, inStandoff, aiStandoffChoice,
} from "../engine/standoff.js";
import { makeWorld, placeAgent, quietCell, tickCollecting, RULES } from "./helpers.js";
import { worldToCellFloor } from "../shared/fixedmath.js";

// Two rivals standing next to each other, both visible to one another.
function facingOff({ detection = DET_NOTICED } = {}) {
  const s = makeWorld();
  const spot = quietCell(s);
  const a = placeAgent(s, { agentId: 0, firmId: 0, cellX: spot.x, cellY: spot.y });
  const b = placeAgent(s, { agentId: 1, firmId: 1, cellX: spot.x + 1, cellY: spot.y });
  a.detection = detection;
  b.detection = detection;
  return s;
}

function startStandoff(s) {
  const stepped = apply(s, { type: CMD_ADVANCE_TICK });
  const standoff = stepped.standoffs[0];
  assert.ok(standoff, "no standoff was triggered between adjacent visible rivals");
  return { state: stepped, standoff };
}

test("adjacent rivals who can see each other trigger a standoff", () => {
  const { state, standoff } = startStandoff(facingOff());
  assert.equal(standoff.ticksLeft, RULES.standoff.timerTicks - 1);
  assert.ok(state.events.some((e) => e.type === "standoffStarted"));
});

test("THE COUNTERPLAY: an unseen agent is not part of the encounter", () => {
  // Staying invisible is how you decline the conversation. If this ever stops
  // being true, the stealth pillar stops paying off at the moment it matters.
  const s = facingOff({ detection: DET_UNSEEN });
  const stepped = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(stepped.standoffs.length, 0,
    "an unseen agent was dragged into a standoff");
});

test("MATRIX engage/engage: both take damage and the district heats up", () => {
  const { state, standoff } = startStandoff(facingOff());
  let s = state;
  const heatBefore = Math.max(...s.districts.map((d) => d.heat));
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 0, standoffId: standoff.id, choice: CHOICE_ENGAGE });
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 1, standoffId: standoff.id, choice: CHOICE_ENGAGE });
  const run = tickCollecting(s, apply, 3);
  assert.ok(run.saw("standoffCombat"), "mutual engage did not resolve to combat");
  assert.ok(run.state.agents[0].condition < RULES.agents.conditionMax, "A took no damage");
  assert.ok(run.state.agents[1].condition < RULES.agents.conditionMax, "B took no damage");
  assert.ok(Math.max(...run.state.districts.map((d) => d.heat)) > heatBefore,
    "a firefight did not raise heat");
});

test("MATRIX engage/withdraw: the withdrawer disengages and takes no damage", () => {
  const { state, standoff } = startStandoff(facingOff());
  let s = state;
  const bBefore = s.agents[1].condition;
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 0, standoffId: standoff.id, choice: CHOICE_ENGAGE });
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 1, standoffId: standoff.id, choice: CHOICE_WITHDRAW });
  const run = tickCollecting(s, apply, 3);
  assert.ok(run.saw("standoffWithdrawn"), "withdrawal did not resolve");
  assert.equal(run.state.agents[1].condition, bBefore, "a withdrawer was damaged");
});

test("MATRIX negotiate/negotiate: a pact forms and suppresses re-triggering", () => {
  const { state, standoff } = startStandoff(facingOff());
  let s = state;
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 0, standoffId: standoff.id, choice: CHOICE_NEGOTIATE });
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 1, standoffId: standoff.id, choice: CHOICE_NEGOTIATE });
  const run = tickCollecting(s, apply, 3);
  assert.ok(run.saw("pactAgreed"), "mutual negotiation produced no pact");
  const pact = pactBetween(run.state, 0, 1);
  assert.ok(pact, "no pact recorded");

  // Still adjacent and visible — but a pact means no new standoff.
  const after = tickCollecting(run.state, apply, 5);
  assert.equal(after.state.standoffs.length, 0,
    "a standoff re-triggered between Firms under a pact");
});

test("MATRIX engage/negotiate: the negotiator is hit but gets away", () => {
  const { state, standoff } = startStandoff(facingOff());
  let s = state;
  const bBefore = s.agents[1].condition;
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 0, standoffId: standoff.id, choice: CHOICE_ENGAGE });
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 1, standoffId: standoff.id, choice: CHOICE_NEGOTIATE });
  const run = tickCollecting(s, apply, 3);
  assert.ok(run.saw("standoffBetrayed"), "betrayal did not resolve as such");
  assert.ok(run.state.agents[1].condition < bBefore, "the betrayed party took no damage");
  assert.equal(run.state.agents[0].condition, RULES.agents.conditionMax,
    "a one-sided ambush should not hurt the ambusher");
});

test("no answer within the window counts as Withdraw", () => {
  // A player who freezes backs off; they do not accidentally start a fight.
  const { state } = startStandoff(facingOff());
  const run = tickCollecting(state, apply, RULES.standoff.timerTicks + 3);
  assert.ok(run.saw("standoffEnded") || run.saw("standoffWithdrawn"),
    "an unanswered standoff never resolved");
  assert.equal(run.state.agents[0].condition, RULES.agents.conditionMax,
    "silence resolved into damage");
});

test("a pact expires on schedule", () => {
  const { state, standoff } = startStandoff(facingOff());
  let s = state;
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 0, standoffId: standoff.id, choice: CHOICE_NEGOTIATE });
  s = apply(s, { type: CMD_STANDOFF_CHOICE, agentId: 1, standoffId: standoff.id, choice: CHOICE_NEGOTIATE });
  s = tickCollecting(s, apply, 3).state;
  assert.ok(pactBetween(s, 0, 1), "precondition: pact exists");
  const run = tickCollecting(s, apply, RULES.standoff.pactTicks + 5);
  assert.ok(run.saw("pactExpired"), "the pact never expired");
  assert.equal(pactBetween(run.state, 0, 1), null);
});

test("a standoff ends if either party leaves the fight", () => {
  const { state, standoff } = startStandoff(facingOff());
  let s = state;
  s.agents[1].state = AGENT_DOWNED;
  const run = tickCollecting(s, apply, 3);
  assert.equal(run.state.standoffs.length, 0,
    "a standoff continued after one side went down");
});

test("D22: AI policies differ, and aggression still knows when to back off", () => {
  const s = facingOff();
  const stepped = apply(s, { type: CMD_ADVANCE_TICK });
  const standoff = stepped.standoffs[0];
  const [cautious, greedy, aggressive] = RULES.ai_firms.personalities;

  assert.equal(aiStandoffChoice(stepped, standoff, 0, cautious, RULES.agents), CHOICE_WITHDRAW);
  assert.equal(aiStandoffChoice(stepped, standoff, 0, greedy, RULES.agents), CHOICE_NEGOTIATE);
  assert.equal(aiStandoffChoice(stepped, standoff, 0, aggressive, RULES.agents), CHOICE_ENGAGE);

  // A temperament is a disposition, not a death wish: badly hurt, it withdraws.
  const hurt = { ...stepped, agents: stepped.agents.map((a) => ({ ...a })) };
  hurt.agents[0].condition = 5;
  assert.equal(aiStandoffChoice(hurt, standoff, 0, aggressive, RULES.agents), CHOICE_WITHDRAW,
    "an aggressive Firm charged in at 5% condition");
});

test("standoffs stay deterministic under replay", () => {
  const run = () => {
    let s = facingOff();
    const hashes = [];
    for (let i = 0; i < 150; i++) {
      s = apply(s, { type: CMD_ADVANCE_TICK });
      hashes.push(hashState(s));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});

// ── D17 + D40: bail ───────────────────────────────────────────────────────

test("D17: bail frees a held agent, priced as a share of the bank", async () => {
  const { bailCost } = await import("../engine/combat.js");
  const { CMD_PAY_BAIL } = await import("../engine/commands.js");
  const { AGENT_HELD } = await import("../engine/state.js");
  const { findDropZones } = await import("../engine/citygen.js");
  const { centralDropZone } = await import("./helpers.js");

  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: 10, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const agent = s.agents.find((a) => a.firmId === 0);
  agent.state = AGENT_HELD;
  agent.holdingSiteId = s.holdingSites[0].id;
  s.holdingSites[0].heldAgentIds.push(agent.id);

  const paid = apply(s, { type: CMD_PAY_BAIL, firmId: 0, agentId: agent.id, bank: 1000 });
  assert.ok(paid.events.some((e) => e.type === "bailPaid"), "bail did not go through");
  assert.equal(paid.agents[agent.id].state, AGENT_ACTIVE, "the agent is still in custody");
  assert.ok(!paid.holdingSites[0].heldAgentIds.includes(agent.id),
    "the holding site still lists the released agent");
  const bail = paid.events.find((e) => e.type === "bailPaid");
  assert.equal(bail.pct, bailCost(paid.firms[0], RULES.combat));
  assert.equal(bail.cost, Math.trunc((1000 * bail.pct) / 100));
});

test("D17/D30: bail is bank-only — an empty bank cannot buy freedom", async () => {
  const { CMD_PAY_BAIL } = await import("../engine/commands.js");
  const { AGENT_HELD } = await import("../engine/state.js");
  const { findDropZones } = await import("../engine/citygen.js");
  const { centralDropZone } = await import("./helpers.js");

  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: 10, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const agent = s.agents.find((a) => a.firmId === 0);
  agent.state = AGENT_HELD;
  agent.holdingSiteId = s.holdingSites[0].id;

  const broke = apply(s, { type: CMD_PAY_BAIL, firmId: 0, agentId: agent.id, bank: 0 });
  assert.equal(broke.events[0].reason, "cannot_afford");
  assert.equal(broke.agents[agent.id].state, AGENT_HELD, "freed without paying");
});

test("D40 + D17: bail inside the grace window saves the running contract", async () => {
  // This is the whole point of pairing the two rulings: getting your operative
  // back promptly means the job survives.
  const { CMD_PAY_BAIL, CMD_ACCEPT_CONTRACT } = await import("../engine/commands.js");
  const { AGENT_HELD } = await import("../engine/state.js");
  const { findDropZones } = await import("../engine/citygen.js");
  const { refillPool, rebuildOffers } = await import("../engine/contracts.js");
  const { centralDropZone } = await import("./helpers.js");

  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: 10, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);

  const agent = s.agents.find((a) => a.firmId === 0);
  const id = s.offers[0].contractIds[0];
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: id });

  s.agents[agent.id].state = AGENT_HELD;
  s.agents[agent.id].holdingSiteId = s.holdingSites[0].id;
  const held = tickCollecting(s, apply, 10);
  assert.ok(held.saw("contractAtRisk"), "no grace window opened");

  const freed = apply(held.state, {
    type: CMD_PAY_BAIL, firmId: 0, agentId: agent.id, bank: 2000,
  });
  const after = tickCollecting(freed, apply, 3);
  assert.ok(after.saw("contractRecovered"), "bail did not rescue the contract");
  assert.ok(after.state.agents[agent.id].contractIds.includes(id));
});
