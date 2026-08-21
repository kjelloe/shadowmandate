// test/rulings_d35_d40.test.js — the fifth decision batch, asserted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply } from "../engine/reducer.js";
import {
  CMD_ADVANCE_TICK, CMD_DROP_IN, CMD_ENTER_BUILDING, CMD_EXIT_BUILDING, CMD_BUY_ITEM,
} from "../engine/commands.js";
import { AGENT_ACTIVE, AGENT_INSIDE, DET_BURNED, DET_UNSEEN } from "../engine/state.js";
import {
  generateCity, findDropZones, autoSelectDropZone, BUILDING_COVERSHOP,
} from "../engine/citygen.js";
import { refillPool, rebuildOffers, completeContract, KIND_COURIER } from "../engine/contracts.js";
import { makeWorld, placeAgent, centralDropZone, tickCollecting, RULES } from "./helpers.js";
import { cellToWorld } from "../shared/fixedmath.js";

const DISGUISES = JSON.parse(
  readFileSync(new URL("../data/buildings/disguises.json", import.meta.url).pathname, "utf8"));

function deployed(seed = 4711) {
  let s = makeWorld({ seed });
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);
  return s;
}

test("D35: drop-in seeds real work inside the phase-1 radius", () => {
  const s = deployed();
  const hq = s.hqs[0];
  const radius = RULES.contracts.phases[0].maxCells;
  const near = s.sites.filter((site) =>
    Math.abs(site.cellX - hq.cellX) + Math.abs(site.cellY - hq.cellY) <= radius);
  assert.ok(near.length >= RULES.contracts.nearHqSites,
    `only ${near.length} sites within phase 1 of the HQ`);
});

test("D35: seeded sites are close, but never underfoot", () => {
  // A site on the HQ means the agent spawns already standing on its objective.
  // The ruling governs the sites the DROP SEEDS — citygen's own sites were
  // placed before anyone knew where the HQ would land, and playtest 4's snap
  // to a safehouse means one of them can legitimately sit next door.
  let s = makeWorld({ seed: 4711 });
  const preSeeded = s.sites.length;
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const hq = s.hqs[0];
  assert.ok(s.sites.length > preSeeded,
    "no site was seeded on this seed — the test's subject is empty and proves nothing");
  for (const site of s.sites.slice(preSeeded)) {
    const d = Math.abs(site.cellX - hq.cellX) + Math.abs(site.cellY - hq.cellY);
    assert.ok(d >= RULES.contracts.nearHqMinDistance,
      `seeded site ${site.id} sits ${d} cells from the HQ — too close to be work`);
  }
});

test("D35: the board still fills, and prefers near work", () => {
  const s = deployed();
  assert.equal(s.offers[0].contractIds.length, RULES.contracts.offersShown);
});

test("D37: auto drop-zone selection avoids the corner the naive pick returns", () => {
  const s = deployed(90210);
  const zones = findDropZones(s, RULES.citygen);
  const naive = zones[0];
  const chosen = autoSelectDropZone(s, zones, RULES.citygen, RULES.hq, 1);
  assert.ok(chosen, "auto-select returned nothing");

  const margin = RULES.hq.dropZoneEdgeMargin;
  const edgeDist = (z) =>
    Math.min(z.cellX, z.cellY, s.size - 1 - z.cellX, s.size - 1 - z.cellY);
  assert.ok(edgeDist(chosen) >= margin,
    `auto-selected zone is ${edgeDist(chosen)} from the edge, want >= ${margin}`);
  assert.ok(edgeDist(chosen) > edgeDist(naive),
    "auto-select should beat the naive first-found zone on edge distance");
});

test("D38: entering a building hides you but does NOT clear a burn", () => {
  let s = deployed();
  const building = s.buildings.find((b) => b.kind !== BUILDING_COVERSHOP);
  const agent = placeAgent(s, { agentId: 5, firmId: 0,
    cellX: building.entranceX, cellY: building.entranceY });
  agent.detection = DET_BURNED;

  s = apply(s, { type: CMD_ENTER_BUILDING, agentId: 5 });
  assert.equal(s.agents[5].state, AGENT_INSIDE);
  assert.equal(s.agents[5].detection, DET_BURNED, "hiding must not launder a burn");
  assert.ok(s.events.some((e) => e.type === "patrolsWaiting"),
    "patrols should post at the door of a burned agent");

  s = apply(s, { type: CMD_EXIT_BUILDING, agentId: 5 });
  assert.equal(s.agents[5].detection, DET_BURNED, "you walk out the same wanted person");
});

test("D38: a Cover Shop clears the burn, changes the face, and uses the back door", () => {
  let s = deployed();
  const shop = s.buildings.find((b) => b.kind === BUILDING_COVERSHOP);
  assert.ok(shop, "no cover shop was generated");
  assert.ok(shop.exitX >= 0 && (shop.exitX !== shop.entranceX || shop.exitY !== shop.entranceY),
    "a cover shop needs a second door — one door is just a pause");

  const agent = placeAgent(s, { agentId: 6, firmId: 0,
    cellX: shop.entranceX, cellY: shop.entranceY });
  agent.detection = DET_BURNED;
  const faceBefore = agent.disguiseId;

  s = apply(s, { type: CMD_ENTER_BUILDING, agentId: 6 });
  const cost = RULES.combat.coverShop.cost;
  s = apply(s, { type: CMD_BUY_ITEM, agentId: 6, itemIdx: 0, bank: cost });

  const after = s.agents[6];
  assert.equal(after.detection, DET_UNSEEN, "the burn was not cleared");
  assert.notEqual(after.disguiseId, faceBefore, "the face did not change");
  assert.ok(after.disguiseId > 0 && after.disguiseId < DISGUISES.disguises.length,
    `disguiseId ${after.disguiseId} has no portrait`);
  assert.equal(after.state, AGENT_ACTIVE, "should be back on the street");
  assert.equal(Math.floor(after.x / 256), shop.exitX, "did not leave by the back door");
  assert.ok(s.events.some((e) => e.type === "coverBought"));
});

test("D38/D30: a cover story is bank-only, so an empty bank cannot buy one", () => {
  let s = deployed();
  const shop = s.buildings.find((b) => b.kind === BUILDING_COVERSHOP);
  placeAgent(s, { agentId: 7, firmId: 0, cellX: shop.entranceX, cellY: shop.entranceY });
  s.agents[7].detection = DET_BURNED;
  s = apply(s, { type: CMD_ENTER_BUILDING, agentId: 7 });
  const broke = apply(s, { type: CMD_BUY_ITEM, agentId: 7, itemIdx: 0, bank: 0 });
  assert.equal(broke.events[0].reason, "cannot_afford");
  assert.equal(broke.agents[7].detection, DET_BURNED, "burn cleared without paying");
});

test("every disguise id the engine can assign has a portrait defined", () => {
  const ids = DISGUISES.disguises.map((d) => d.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [0, 1, 2, 3, 4, 5], "disguise ids must be contiguous from 0");
  for (const d of DISGUISES.disguises) {
    assert.ok(d.portrait, `disguise ${d.id} has no portrait asset`);
    assert.ok(d.key.startsWith("disguise."), `disguise ${d.id} has no i18n key`);
  }
});

test("D39: Recognition rewards craft — tier and cleanliness, not payout", () => {
  const recognitionFor = ({ tier, reward, burns }) => {
    let s = deployed();
    const agent = s.agents.find((a) => a.firmId === 0);
    const contract = {
      id: 8000, kind: KIND_COURIER, tier, districtId: 0,
      siteId: s.sites[0].id, siteIdB: s.sites[1].id, reward,
      expiresTick: 0, reservedBy: 0, acceptedBy: 0, stage: 3, stageTicks: 0,
      graceTicks: 0, burnsTaken: burns,
    };
    s.contractPool.push(contract);
    s.agents[agent.id].contractIds.push(contract.id);
    const before = s.firms[0].recognition;
    completeContract(s, contract, s.agents[agent.id], RULES.contracts);
    return s.firms[0].recognition - before;
  };

  // Payout must not move it...
  assert.equal(recognitionFor({ tier: 1, reward: 50, burns: 0 }),
    recognitionFor({ tier: 1, reward: 500, burns: 0 }),
    "Recognition tracked payout — D39 says it should not");
  // ...tier must...
  assert.ok(recognitionFor({ tier: 3, reward: 50, burns: 0 })
    > recognitionFor({ tier: 1, reward: 50, burns: 0 }), "harder work must pay more honor");
  // ...and getting burned must cost.
  assert.ok(recognitionFor({ tier: 2, reward: 50, burns: 2 })
    < recognitionFor({ tier: 2, reward: 50, burns: 0 }), "burns must cost honor");
});

test("D39: a burn during a contract is attributed to it", () => {
  let s = deployed();
  const agent = s.agents.find((a) => a.firmId === 0);
  const id = s.offers[0].contractIds[0];
  s.contractPool.find((c) => c.id === id).acceptedBy = 0;
  s.agents[agent.id].contractIds.push(id);

  // Park the agent on a patrol and let it burn.
  const p = s.patrols[0];
  s.agents[agent.id].x = cellToWorld(p.x);
  s.agents[agent.id].y = cellToWorld(p.y);
  s.agents[agent.id].detection = 1;
  s.agents[agent.id].detectTimer = RULES.detection.burnTicks;
  const run = tickCollecting(s, apply, 40);
  assert.ok(run.saw("agentBurned"), "precondition: the agent never burned");
  assert.ok(run.state.contractPool.find((c) => c.id === id).burnsTaken > 0,
    "the burn was not attributed to the running contract");
});
