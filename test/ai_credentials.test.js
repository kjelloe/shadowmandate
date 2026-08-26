// test/ai_credentials.test.js — owner-ruled 4A (2026-08-27): the AI buys its
// way into secured work, and waits for dark when night is close.
//
// The lesson this slice re-learned the hard way: the first errand was fully
// written and UNREACHABLE — a pre-existing "indoors → leave" early rule fired
// before the buy branch could run, producing 536 enter/exit pairs and zero
// purchases. Every step here drives aiDecide against the REAL reducer, so
// reachability is what is being tested, not just intent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import {
  aiDecide, credentialSourceFor, scoreContract, aiLawfulView,
} from "../engine/ai_firms.js";
import { hasCredential } from "../engine/access.js";
import { KIND_EXTRACTION, STAGE_WORK } from "../engine/contracts.js";
import { ticksUntilNight } from "../engine/season.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const DN = RULES.season.dayNight;

// A deployed AI firm with a cache, an active agent, and one accepted
// extraction contract at a SECURED site.
function securedWorld({ cache = 200, tier = 1 } = {}) {
  const s = makeWorld({ seed: 4711 });
  const site = s.sites.find((x) => (x.securityTier | 0) === tier);
  assert.ok(site, `fixture: no tier-${tier} site on this seed`);
  const agent = placeAgent(s, { cellX: 2, cellY: 2 });
  s.firms[0].isAi = 1;
  s.hqs.push({ id: 0, firmId: 0, cellX: 2, cellY: 2, buildingId: -1, condition: 100,
    cacheResources: cache, evacActive: 0, evacTicks: 0, evacPaused: 0,
    alarmTicks: 0, lootTicks: 0, lootedBy: -1 });
  s.firms[0].hqId = 0;
  const contract = {
    id: 9200, kind: KIND_EXTRACTION, tier: 1, districtId: site.districtId,
    siteId: site.id, siteIdB: -1, reward: 400, expiresTick: 0,
    reservedBy: -1, acceptedBy: 0, stage: STAGE_WORK, stageTicks: 0,
    recoverAgentId: -1,
  };
  s.contractPool.push(contract);
  agent.contractIds.push(9200);
  return { s, site, agent, contract };
}

test("the credential source derives from the CONTENT, cheapest first", () => {
  const t1 = credentialSourceFor(RULES.payloads, 1);
  assert.ok(t1, "no tier-1 source found in the content");
  // The informant sells tier 1; its cost is whatever the content says.
  const informant = RULES.payloads.dialogues.find((d) => d.id === "informant");
  const opt = informant.options[t1.idx];
  assert.equal(opt.effect.type, "credential");
  assert.equal(t1.cost, opt.cost);
  assert.equal(t1.buildingKind, 0, "tier 1 comes from the safehouse dialogue");
  const t2 = credentialSourceFor(RULES.payloads, 2);
  assert.ok(t2, "no tier-2 source");
  assert.equal(t2.buildingKind, 1, "tier 2 comes from the market catalog");
  assert.equal(credentialSourceFor(RULES.payloads, 99), null, "an unsellable tier is null");
});

test("the scorer prices the badge instead of declining — and still declines broke", () => {
  const { s, contract } = securedWorld({ cache: 200 });
  const view = aiLawfulView(s, 0);
  const personality = RULES.ai_firms.personalities[0];
  const funded = scoreContract(s, view, contract, personality, RULES, view.agent);
  assert.ok(funded > 0, "an affordable secured contract must score positive");
  // Same contract, no money: the acquisition-0% guard holds.
  s.hqs[0].cacheResources = 10;
  const broke = scoreContract(s, aiLawfulView(s, 0), contract, personality, RULES, view.agent);
  assert.equal(broke, -1, "an unaffordable secured contract must be declined");
  // The badge is not free: an identical unsecured contract scores higher.
  s.hqs[0].cacheResources = 200;
  const openSite = s.sites.find((x) => (x.securityTier | 0) === 0);
  const unsecured = { ...contract, siteId: openSite.id, districtId: openSite.districtId };
  const freeScore = scoreContract(s, aiLawfulView(s, 0), unsecured, personality, RULES, view.agent);
  assert.ok(freeScore > funded * 0.9,
    "the secured contract must carry the credential's price in its score");
});

test("the FULL errand, through the real reducer: walk, enter, buy, leave, work", () => {
  let { s, site, agent } = securedWorld({ cache: 200 });
  const source = credentialSourceFor(RULES.payloads, 1);

  // 1. The decide targets the credential shop, not the contract site.
  let d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 20, "first move should be a WALK (to the shop)");
  const shop = s.buildings.find((b) =>
    b.kind === source.buildingKind
    && b.entranceX === d.command.cellX && b.entranceY === d.command.cellY);
  assert.ok(shop, "the walk target must be a credential-source entrance");

  // 2. Standing on the entrance: ENTER.
  agent.x = shop.entranceX * 256 + 128; agent.y = shop.entranceY * 256 + 128;
  agent.route = []; agent.routeIdx = 0;
  d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 34, "at the door, the decide must ENTER");
  s = apply(s, d.command);
  assert.ok(s.agents[agent.id].insideBuildingId >= 0, "enter must land");

  // 3. Inside: BUY — through the reducer, cache route and all.
  d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, source.cmd, "inside the shop, the decide must BUY");
  s = apply(s, d.command);
  assert.ok(hasCredential(s, agent.id, 1), "the badge must actually be granted");
  assert.equal(s.hqs[0].cacheResources, 200 - source.cost,
    "the cache must pay the content's price");

  // 4. Badge in hand: LEAVE, then head for the contract.
  d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 35, "with the badge bought, leave the shop");
  s = apply(s, d.command);
  d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 20, "back outside, walk to the WORK");
  assert.equal(Math.abs(d.command.cellX - site.cellX) <= 1
    && Math.abs(d.command.cellY - site.cellY) <= 1, true,
  "the walk target must now be the contract site");
});

test("broke mid-errand: hand the job back, never spam the counter", () => {
  const { s } = securedWorld({ cache: 50 });   // scorer would decline; accept happened richer
  const d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 41,
    "an unaffordable errand must ABANDON — the first live run sat inside spamming a buy for 10k ticks");
});

test("night close: hold at the door; night fallen: go in (owner-ruled wait-for-dark)", () => {
  const { s, site, agent } = securedWorld({ cache: 200 });
  // Badge in hand so the enter decision is what is under test.
  const { grantCredential } = { grantCredential: null };
  void grantCredential;
  s.credentials.push({ agentId: agent.id, tier: 1, source: "test" });
  agent.x = site.cellX * 256 + 128; agent.y = site.cellY * 256 + 128;
  agent.route = []; agent.routeIdx = 0;
  agent.stance = 0;   // already sneaking, so the hold is a null command

  // Dusk minus a moment: within the wait window — hold, do not enter.
  s.tick = DN.dayTicks - 100;
  assert.ok(ticksUntilNight(s.tick, DN) <= RULES.ai_firms.waitForNightTicks,
    "fixture: this tick must be inside the wait window");
  let d = aiDecide(s, 0, RULES);
  assert.notEqual(d.command?.type, 45, "entering in the last light is what the wait exists to avoid");

  // Midday: the wait would be LONG — go in now, clocks are running.
  s.tick = 100;
  d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 45, "a long wait is never taken");

  // Night: straight in.
  s.tick = DN.dayTicks + 50;
  d = aiDecide(s, 0, RULES);
  assert.equal(d.command?.type, 45, "after dark there is nothing to wait for");
});

test("D30 holds: a broke PLAYER never pays from the cache", () => {
  let { s } = securedWorld({ cache: 200 });
  s.firms[0].isAi = 0;   // a human seat
  const b = s.buildings.find((x) => x.kind === 0);
  const agent = s.agents[0];
  agent.x = b.entranceX * 256 + 128; agent.y = b.entranceY * 256 + 128;
  s = apply(s, { type: 34, agentId: 0 });
  const idx = RULES.payloads.dialogues.find((d) => d.id === "informant")
    .options.findIndex((o) => o.effect?.type === "credential");
  s = apply(s, { type: 36, agentId: 0, optionIdx: idx, bank: 0 });
  assert.ok(s.events.some((e) => e.type === "rejected" && e.reason === "cannot_afford"),
    "a player with no bank must be refused, not quietly billed to the at-risk cache");
  assert.equal(s.hqs[0].cacheResources, 200, "the cache must be untouched");
});
