// test/contracts.test.js — M4 gate: the D18 economy and the objective machines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import {
  CMD_ADVANCE_TICK, CMD_DROP_IN, CMD_ACCEPT_CONTRACT, CMD_ABANDON_CONTRACT,
} from "../engine/commands.js";
import {
  refillPool, rebuildOffers, poolTarget, completeContract,
  KIND_COURIER, KIND_SURVEILLANCE, KIND_EXTRACTION, KIND_ACQUISITION,
  STAGE_TRAVEL, STAGE_WORK, STAGE_RETURN, STAGE_DONE,
} from "../engine/contracts.js";
import { findDropZones } from "../engine/citygen.js";
import { makeWorld, placeAgent, centralDropZone, tickCollecting, RULES } from "./helpers.js";
import { cellToWorld } from "../shared/fixedmath.js";

function seededWorld(seed = 4711, firmCount = 1) {
  let s = makeWorld({ seed });
  const zones = findDropZones(s, RULES.citygen);
  const used = [];
  for (let i = 0; i < firmCount; i++) {
    // Space the Firms out so drop-in proximity rules don't reject them.
    const zone = zones.find((z) => used.every((u) =>
      Math.abs(u.cellX - z.cellX) + Math.abs(u.cellY - z.cellY) > RULES.hq.dropZoneMinClearRadius * 2))
      ?? centralDropZone(s, zones);
    used.push(zone);
    s = apply(s, { type: CMD_DROP_IN, firmId: i, cellX: zone.cellX, cellY: zone.cellY });
  }
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);
  return s;
}

test("D18: the pool holds 5 contracts per player slot", () => {
  const s = seededWorld();
  assert.equal(poolTarget(s, RULES.contracts), 5 * s.slots);
  assert.equal(s.contractPool.length, poolTarget(s, RULES.contracts),
    "pool did not fill to target");
});

test("D18: each deployed Firm is shown exactly 5 offers", () => {
  const s = seededWorld(4711, 3);
  const boards = s.offers.filter((o) => s.firms[o.firmId].state !== 0);
  assert.equal(boards.length, 3, "not every deployed Firm got a board");
  for (const board of boards) {
    assert.equal(board.contractIds.length, RULES.contracts.offersShown,
      `Firm ${board.firmId} was shown ${board.contractIds.length} offers`);
  }
});

test("D18: concurrent boards are DISJOINT — nobody sees the neighbour's leftovers", () => {
  // This is the assertion the whole D18 economy exists for.
  const s = seededWorld(4711, 4);
  const seen = new Map();
  for (const board of s.offers) {
    for (const id of board.contractIds) {
      assert.ok(!seen.has(id),
        `contract ${id} offered to Firm ${board.firmId} AND Firm ${seen.get(id)}`);
      seen.set(id, board.firmId);
    }
  }
  assert.equal(seen.size, 4 * RULES.contracts.offersShown);
});

test("D29: the board carries one greyed next-tier teaser", () => {
  const s = seededWorld();
  const board = s.offers[0];
  const teaser = s.contractPool.find((c) => c.id === board.teaserId);
  if (teaser) {
    assert.equal(teaser.tier, s.firms[0].tierUnlocked + 1, "teaser is not next-tier");
    assert.ok(!board.contractIds.includes(teaser.id), "teaser must not be acceptable");
  }
});

test("D29: an agent may hold at most 2 active contracts", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  const offers = s.offers[0].contractIds.slice();
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: offers[0] });
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: offers[1] });
  assert.equal(s.agents[agent.id].contractIds.length, 2);
  const third = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: offers[2] });
  assert.equal(third.events[0].reason, "too_many_active");
});

test("a contract offered to another Firm cannot be accepted", () => {
  let s = seededWorld(4711, 2);
  const mine = s.agents.find((a) => a.firmId === 0);
  const theirs = s.offers.find((o) => o.firmId === 1).contractIds[0];
  const bad = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: mine.id, contractId: theirs });
  assert.equal(bad.events[0].reason, "not_offered_to_you");
});

test("abandoning a contract returns it to the pool", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  const id = s.offers[0].contractIds[0];
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: id });
  s = apply(s, { type: CMD_ABANDON_CONTRACT, agentId: agent.id, contractId: id });
  const contract = s.contractPool.find((c) => c.id === id);
  assert.equal(contract.acceptedBy, -1);
  assert.equal(s.agents[agent.id].contractIds.length, 0);
});

test("SCENARIO: a courier run completes when the package reaches its destination", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  // Craft a courier contract between two known sites and hand it over.
  const [siteA, siteB] = s.sites;
  const contract = {
    id: 9000, kind: KIND_COURIER, tier: 1, districtId: siteA.districtId,
    siteId: siteA.id, siteIdB: siteB.id, reward: 80, expiresTick: 0,
    reservedBy: 0, acceptedBy: -1, stage: 0, stageTicks: 0,
  };
  s.contractPool.push(contract);
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: 9000 });
  assert.equal(s.contractPool.find((c) => c.id === 9000).stage, STAGE_TRAVEL);

  // Stand on the pickup: the tick picks the package up.
  s.agents[agent.id].x = cellToWorld(siteA.cellX);
  s.agents[agent.id].y = cellToWorld(siteA.cellY);
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(s.contractPool.find((c) => c.id === 9000).stage, STAGE_RETURN);
  assert.equal(s.agents[agent.id].carryKind, 1, "agent is not carrying the package");

  // Deliver it.
  s.agents[agent.id].x = cellToWorld(siteB.cellX);
  s.agents[agent.id].y = cellToWorld(siteB.cellY);
  const run = tickCollecting(s, apply, 3);
  assert.ok(run.saw("contractCompleted"), "delivery did not complete the contract");
  assert.equal(run.state.agents[agent.id].carryKind, 0, "package not handed over");
  assert.equal(run.state.hqs[0].cacheResources, 80,
    "reward must land in the CACHE, not the bank (D7/D30)");
});

test("SCENARIO: surveillance only counts while the agent is unseen", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  const site = s.sites[0];
  s.contractPool.push({
    id: 9100, kind: KIND_SURVEILLANCE, tier: 1, districtId: site.districtId,
    siteId: site.id, siteIdB: -1, reward: 40, expiresTick: 0,
    reservedBy: 0, acceptedBy: -1, stage: 0, stageTicks: 0,
  });
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: 9100 });
  s.agents[agent.id].x = cellToWorld(site.cellX);
  s.agents[agent.id].y = cellToWorld(site.cellY);
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(s.contractPool.find((c) => c.id === 9100).stage, STAGE_WORK);

  // Being noticed resets the hold — the contract is a stealth test, not a timer.
  s.agents[agent.id].detection = 1;
  s = apply(s, { type: CMD_ADVANCE_TICK });
  s = apply(s, { type: CMD_ADVANCE_TICK });
  assert.equal(s.contractPool.find((c) => c.id === 9100).stageTicks, 0,
    "being seen must reset the surveillance hold");

  s.agents[agent.id].detection = 0;
  const hold = RULES.contracts.types.surveillance.holdTicks;
  const run = tickCollecting(s, apply, hold + 5);
  assert.ok(run.saw("contractCompleted"), "an unseen hold never completed");
});

test("D19: completing enough contracts unlocks the next tier", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  const needed = RULES.contracts.unlockCompletions[0];
  const events = [];
  for (let i = 0; i < needed; i++) {
    const contract = {
      id: 9200 + i, kind: KIND_COURIER, tier: 1, districtId: 0,
      siteId: s.sites[0].id, siteIdB: s.sites[1].id, reward: 50, expiresTick: 0,
      reservedBy: 0, acceptedBy: 0, stage: STAGE_RETURN, stageTicks: 0,
    };
    s.contractPool.push(contract);
    s.agents[agent.id].contractIds.push(contract.id);
    completeContract(s, contract, s.agents[agent.id], RULES.contracts);
    events.push(...s.events);
  }
  assert.equal(s.firms[0].tierUnlocked, 2, "tier did not unlock after the ruled count");
  assert.ok(events.some((e) => e.type === "tierUnlocked"));
});

test("D40: capture starts a grace window; a rescue inside it saves the contract", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  // Pick an offer whose objective is NOT underfoot, so the contract cannot
  // quietly complete itself while we are testing custody.
  const id = s.offers[0].contractIds.find((cid) => {
    const c = s.contractPool.find((x) => x.id === cid);
    const site = s.sites.find((x) => x.id === c.siteId);
    const hq = s.hqs[0];
    return Math.abs(site.cellX - hq.cellX) + Math.abs(site.cellY - hq.cellY) > 6;
  }) ?? s.offers[0].contractIds[0];
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: id });

  // Captured: the contract goes at risk, but does NOT fail yet.
  s.agents[agent.id].state = 3; // AGENT_HELD
  const atRisk = tickCollecting(s, apply, 5);
  assert.ok(atRisk.saw("contractAtRisk"), "capture did not open a grace window");
  assert.ok(!atRisk.saw("contractFailed"), "contract failed instantly — D40 says grace first");

  // Rescued inside the window: the contract survives.
  let saved = atRisk.state;
  saved.agents[agent.id].state = 1; // AGENT_ACTIVE
  const recovered = tickCollecting(saved, apply, 3);
  assert.ok(recovered.saw("contractRecovered"), "rescue did not restore the contract");
  assert.ok(recovered.state.agents[agent.id].contractIds.includes(id));
});

test("D40: a contract left in custody past the grace window does fail", () => {
  let s = seededWorld();
  const agent = s.agents.find((a) => a.firmId === 0);
  const id = s.offers[0].contractIds[0];
  s = apply(s, { type: CMD_ACCEPT_CONTRACT, agentId: agent.id, contractId: id });
  s.agents[agent.id].state = 3; // AGENT_HELD
  const run = tickCollecting(s, apply, RULES.contracts.captureGraceTicks + 5);
  assert.ok(run.saw("contractFailed"), "contract never failed after the grace window");
});

test("the contract economy stays deterministic under replay", () => {
  const run = () => {
    let s = seededWorld(90210, 2);
    const hashes = [];
    for (let i = 0; i < 150; i++) {
      s = apply(s, { type: CMD_ADVANCE_TICK });
      hashes.push(hashState(s));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});
