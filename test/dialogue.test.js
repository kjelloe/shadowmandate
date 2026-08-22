// test/dialogue.test.js — M5 slice 5f / M6 slice 6c: informant and vendor.
//
// The framework's promise: content is DATA. Every assertion here should hold
// for content an author adds later without touching engine code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply } from "../engine/reducer.js";
import {
  CMD_DROP_IN, CMD_ENTER_BUILDING, CMD_EXIT_BUILDING, CMD_DIALOGUE_CHOICE, CMD_BUY_ITEM,
  CMD_ADVANCE_TICK,
} from "../engine/commands.js";
import { AGENT_ACTIVE } from "../engine/state.js";
import { findDropZones, BUILDING_SAFEHOUSE, BUILDING_MARKET } from "../engine/citygen.js";
import { payloadFor, hasHeatIntel } from "../engine/buildings.js";
import { makeWorld, placeAgent, centralDropZone, RULES } from "./helpers.js";

const EN = JSON.parse(
  readFileSync(new URL("../client/i18n/en.json", import.meta.url).pathname, "utf8"));

function atBuilding(kind, { agentId = 5, firmId = 0 } = {}) {
  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const building = s.buildings.find((b) => b.kind === kind);
  assert.ok(building, `no building of kind ${kind} was generated`);
  placeAgent(s, { agentId, firmId, cellX: building.entranceX, cellY: building.entranceY });
  s = apply(s, { type: CMD_ENTER_BUILDING, agentId });
  return { state: s, building, agentId };
}

test("all dialogue and shop text is i18n keys, never literals", () => {
  // Content that ships a literal string ships something untranslatable.
  const payloads = RULES.payloads;
  const keys = [];
  for (const d of payloads.dialogues) {
    keys.push(d.greetKey, d.quietKey);
    for (const o of d.options) keys.push(o.key);
  }
  for (const shop of payloads.shops) {
    keys.push(shop.greetKey);
    for (const item of shop.catalog) keys.push(item.key);
  }
  for (const key of keys.filter(Boolean)) {
    assert.ok(/^[a-z]+\.[A-Za-z.]+$/.test(key), `'${key}' does not look like an i18n key`);
    assert.ok(EN[key], `content references '${key}' but en.json has no such string`);
  }
});

test("the informant sells a rival HQ location", () => {
  const { state, agentId } = atBuilding(BUILDING_SAFEHOUSE);
  let s = state;
  // A rival must exist to be revealed.
  s.hqs.push({ id: 99, firmId: 1, cellX: 20, cellY: 20, condition: 100,
    cacheResources: 0, evacActive: 0, evacTicks: 0, evacPaused: 0,
    alarmTicks: 0, lootTicks: 0, lootedBy: -1 });

  const before = (s.firms[0].knownRivalHqs ?? []).length;
  s = apply(s, { type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: 0, bank: 500 });
  assert.ok(s.events.some((e) => e.type === "rivalHqRevealed"), "no rival HQ revealed");
  assert.equal(s.firms[0].knownRivalHqs.length, before + 1);
});

test("the informant sells exact district heat (D20), and it expires", () => {
  const { state, building, agentId } = atBuilding(BUILDING_SAFEHOUSE);
  let s = state;
  assert.ok(!hasHeatIntel(s, s.firms[0], building.districtId), "intel before buying");
  s = apply(s, { type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: 1, bank: 500 });
  assert.ok(s.events.some((e) => e.type === "heatIntelBought"));
  assert.ok(hasHeatIntel(s, s.firms[0], building.districtId), "intel not granted");

  // D20's promise is that exact heat is temporary knowledge, not a permanent
  // upgrade — otherwise one purchase makes the fuzz band meaningless forever.
  const ticks = RULES.payloads.dialogues[0].options[1].effect.ticks;
  s.tick += ticks + 1;
  assert.ok(!hasHeatIntel(s, s.firms[0], building.districtId), "heat intel never expires");
});

test("a purchase is refused when the bank cannot cover it (D30)", () => {
  const { state, agentId } = atBuilding(BUILDING_SAFEHOUSE);
  const broke = apply(state, { type: CMD_DIALOGUE_CHOICE, agentId, optionIdx: 1, bank: 0 });
  assert.equal(broke.events[0].reason, "cannot_afford");
});

test("the informant goes quiet in a locked-down district (S03)", () => {
  const { state, building } = atBuilding(BUILDING_SAFEHOUSE);
  const payloads = RULES.payloads;
  const quietAt = payloads.dialogues[0].quietAtHeat;

  const calm = payloadFor(building, payloads, 0);
  assert.ok(calm.options.length > 1, "a calm informant should have things to sell");

  const hot = payloadFor(building, payloads, quietAt);
  assert.ok(hot.quiet, "the informant kept talking through a lockdown");
  assert.equal(hot.options.length, 0,
    "a quiet informant offers nothing — leaving is the overlay button, not a row (playtest 5)");
});

test("the vendor sells upgrades, and will not sell the same one twice", () => {
  const { state, agentId } = atBuilding(BUILDING_MARKET);
  let s = apply(state, { type: CMD_BUY_ITEM, agentId, itemIdx: 0, bank: 1000 });
  assert.ok(s.events.some((e) => e.type === "upgradeBought"), "nothing was sold");
  assert.ok(s.firms[0].upgrades.includes("sneak"));

  const again = apply(s, { type: CMD_BUY_ITEM, agentId, itemIdx: 0, bank: 1000 });
  assert.equal(again.events[0].reason, "already_owned");
});

test("the medkit restores condition", () => {
  const { state, agentId } = atBuilding(BUILDING_MARKET);
  const s = { ...state, agents: state.agents.map((a) => ({ ...a })) };
  s.agents[agentId].condition = 20;
  const healed = apply(s, { type: CMD_BUY_ITEM, agentId, itemIdx: 3, bank: 1000 });
  assert.equal(healed.agents[agentId].condition, RULES.agents.conditionMax);
  assert.ok(healed.events.some((e) => e.type === "agentTreated"));
});

test("leaving is the exit command, and no dialogue smuggles a leave row (playtest 5)", () => {
  // Content guard: the dialogue leave row duplicated the overlay's Leave
  // button and was cut. If a content author adds one back, the client now
  // renders it as a normal talk row that does nothing sensible — fail here
  // instead.
  for (const d of RULES.payloads.dialogues) {
    for (const o of d.options) {
      assert.ok(!o.exit, `dialogue ${d.id} option ${o.key} is an exit row — leaving is CMD_EXIT_BUILDING`);
    }
  }
  const { state, agentId } = atBuilding(BUILDING_SAFEHOUSE);
  const s = apply(state, { type: CMD_EXIT_BUILDING, agentId });
  assert.equal(s.agents[agentId].state, AGENT_ACTIVE);
  assert.equal(s.agents[agentId].insideBuildingId, -1);
});

test("dialogue and shop commands are refused outside a building", () => {
  let s = makeWorld();
  placeAgent(s, { agentId: 5, firmId: 0, cellX: 10, cellY: 10 });
  const talk = apply(s, { type: CMD_DIALOGUE_CHOICE, agentId: 5, optionIdx: 0, bank: 500 });
  assert.equal(talk.events[0].reason, "not_inside");
  const buy = apply(s, { type: CMD_BUY_ITEM, agentId: 5, itemIdx: 0, bank: 500 });
  assert.equal(buy.events[0].reason, "not_inside");
});

test("you cannot shop at an informant, or negotiate with a vendor", () => {
  const shop = atBuilding(BUILDING_SAFEHOUSE);
  const wrongBuy = apply(shop.state, {
    type: CMD_BUY_ITEM, agentId: shop.agentId, itemIdx: 0, bank: 500 });
  assert.equal(wrongBuy.events[0].reason, "not_a_shop");

  const market = atBuilding(BUILDING_MARKET);
  const wrongTalk = apply(market.state, {
    type: CMD_DIALOGUE_CHOICE, agentId: market.agentId, optionIdx: 0, bank: 500 });
  assert.equal(wrongTalk.events[0].reason, "not_a_dialogue");
});
