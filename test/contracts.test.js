// test/contracts.test.js — M4 gate: the D18 economy and the objective machines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import {
  CMD_ADVANCE_TICK, CMD_DROP_IN, CMD_ACCEPT_CONTRACT, CMD_ABANDON_CONTRACT,
  CMD_ENTER_AREA,
} from "../engine/commands.js";
import { areaObjective, areaTiles, AT_WALL } from "../engine/areas.js";
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

test("D18: concurrent boards are DISJOINT, except where deliberately contested", () => {
  // This is the assertion the whole D18 economy exists for, NARROWED by S16 8g.
  //
  // D18's purpose is that nobody is handed the neighbour's leftovers — you must
  // not discover, after walking across the city, that the job was never really
  // yours. A CONTESTED contract does not break that promise: it is flagged on
  // the board and it pays a premium precisely because someone else is coming,
  // so taking it is an informed choice rather than a surprise. Everything else
  // stays strictly disjoint, and the test asserts both halves.
  const s = seededWorld(4711, 4);
  const seen = new Map();
  let contestedSeen = 0;
  for (const board of s.offers) {
    for (const id of board.contractIds) {
      const c = s.contractPool.find((x) => x.id === id);
      if (c?.contested) { contestedSeen++; continue; }
      assert.ok(!seen.has(id),
        `UNCONTESTED contract ${id} offered to Firm ${board.firmId} AND Firm ${seen.get(id)}`);
      seen.set(id, board.firmId);
    }
  }
  assert.equal(seen.size + contestedSeen, 4 * RULES.contracts.offersShown,
    "boards are no longer full");
});

test("a contract on two boards is ALWAYS flagged contested", () => {
  // The half of D18 that must never bend: an unflagged contract on two boards
  // means someone walks across the city for a job that was never theirs, which
  // is the exact experience D18 exists to prevent.
  for (const seed of [4711, 90210, 1548]) {
    const s = seededWorld(seed, 4);
    const seen = new Map();
    for (const board of s.offers) {
      for (const id of board.contractIds) {
        if (seen.has(id)) {
          const c = s.contractPool.find((x) => x.id === id);
          assert.ok(c?.contested,
            `seed ${seed}: contract ${id} is on two boards without being flagged contested`);
        }
        seen.set(id, board.firmId);
      }
    }
  }
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
  // An UNCONTESTED entry on the neighbour's board. Since 8g a contested
  // contract is deliberately on several boards, so picking blindly can land on
  // one that Firm 0 is genuinely entitled to take — the accept then succeeds,
  // correctly, and the test reads it as a broken guard.
  const theirs = s.offers.find((o) => o.firmId === 1).contractIds
    .find((id) => !s.contractPool.find((c) => c.id === id)?.contested);
  assert.ok(theirs !== undefined, "the neighbour's board is entirely contested");
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

  // S17 AR-b: the hold happens INSIDE the mission area, at the vantage.
  s = apply(s, { type: CMD_ENTER_AREA, agentId: agent.id });
  assert.ok(s.agents[agent.id].insideAreaId >= 0, "agent did not enter the area");
  const area = s.areas.find((a) => a.siteId === site.id);
  const cfgA = RULES.areas;
  const vantage = areaObjective(s.worldSeed, site.id, cfgA);
  const tiles = areaTiles(s.worldSeed, site.id, cfgA);
  const w = cfgA.width | 0;
  // Hold a cell SHORT of the objective (standing on it is the theft, not the
  // vantage) — the same spot the AI uses.
  let hold = vantage;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = vantage.x + dx, y = vantage.y + dy;
    if (tiles[y * w + x] !== AT_WALL) { hold = { x, y }; break; }
  }
  s.agents[agent.id].areaCol = hold.x;
  s.agents[agent.id].areaRow = hold.y;

  // A watched vantage does not tick: camp a guard next to the hold.
  const g0 = area.guards[0];
  g0.x = hold.x + (tiles[hold.y * w + hold.x + 1] !== AT_WALL ? 1 : -1);
  g0.y = hold.y;
  for (const g of area.guards.slice(1)) g.downedUntil = 1_000_000;
  let seen = s;
  for (let i = 0; i < 40; i++) seen = apply(seen, { type: CMD_ADVANCE_TICK });
  assert.equal(seen.contractPool.find((c) => c.id === 9100).stageTicks, 0,
    "being seen must reset the surveillance hold");

  // Unseen, the hold ticks. Down every guard so the vantage stays dark.
  for (const g of area.guards) g.downedUntil = 1_000_000;
  s.agents[agent.id].detection = 0;
  // D41: surveillance is several separate passes, not one long stare — so a
  // single completed hold reports a PASS, and the contract keeps going.
  const spec = RULES.contracts.types.surveillance;
  const first = tickCollecting(s, apply, spec.holdTicks + 5);
  assert.ok(first.saw("surveillancePass") || first.saw("contractCompleted"),
    "an unseen hold produced neither a pass nor a completion");
  if (spec.passes > 1) {
    assert.ok(first.saw("surveillancePass"), "a multi-pass contract completed in one hold");
    const rest = tickCollecting(first.state, apply, spec.holdTicks * spec.passes + 20);
    assert.ok(rest.saw("contractCompleted"), "the remaining passes never completed");
  }
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

// V1 acceptance criterion 8, which asks for this explicitly as a HEADLESS
// MULTI-SEAT test: "every present player's board shows 5 offers, disjoint from
// other players' boards". The engine reserves each contract to one Firm
// (`reservedBy`), but nothing tested that two seats could never be shown the
// same job — and D18's whole promise is that your board is YOURS.
test("D18: every deployed Firm gets five offers, disjoint across seats", () => {
  let s = seededWorld(31337, 4);

  const deployed = s.firms.filter((f) => f.state !== 0);
  assert.ok(deployed.length >= 2,
    `need at least two seats for this to prove anything, got ${deployed.length}`);

  const seen = new Map();          // contractId -> firmId that was offered it
  for (const firm of deployed) {
    const board = s.offers.find((o) => o.firmId === firm.id);
    assert.ok(board, `firm ${firm.id} has no board at all`);
    assert.equal(board.contractIds.length, 5,
      `D18 promises five offers; firm ${firm.id} has ${board.contractIds.length}`);
    for (const id of board.contractIds) {
      // Two distinct failures share this check, and they mean different things:
      // the same job on two seats' boards breaks D18's promise, while the same
      // job twice on ONE board is a reservation bug. Say which.
      //
      // S16 8g narrows the first case: a CONTESTED contract is meant to be on
      // several boards. The same job twice on ONE board is still always a bug,
      // contested or not, and that half is checked for everything.
      const c = s.contractPool.find((x) => x.id === id);
      const dupOnOwnBoard = seen.get(id) === firm.id;
      assert.ok(!dupOnOwnBoard, `contract ${id} appears TWICE on firm ${firm.id}'s own board`);
      if (!c?.contested) {
        assert.ok(!seen.has(id),
          `contract ${id} is on BOTH firm ${seen.get(id)}'s and firm ${firm.id}'s board`);
      }
      seen.set(id, firm.id);
    }
  }

  // Disjointness must SURVIVE the world running — a rebuild that re-reserves
  // is where this would actually break, not the first build.
  for (let i = 0; i < 30; i++) {
    s = apply(s, { type: CMD_ADVANCE_TICK });
    rebuildOffers(s, RULES.contracts, RULES.detection);
  }
  const seenAgain = new Map();
  for (const firm of deployed) {
    const board = s.offers.find((o) => o.firmId === firm.id);
    for (const id of board.contractIds) {
      const c = s.contractPool.find((x) => x.id === id);
      if (c?.contested) { seenAgain.set(id, firm.id); continue; }
      assert.ok(!seenAgain.has(id), seenAgain.get(id) === firm.id
        ? `after 30 ticks, contract ${id} appears twice on firm ${firm.id}'s own board`
        : `after 30 ticks, contract ${id} is on two boards (${seenAgain.get(id)} and ${firm.id})`);
      seenAgain.set(id, firm.id);
    }
  }
});
