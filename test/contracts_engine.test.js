// test/contracts_engine.test.js — contracts the rest of the suite assumes but
// never actually checked: the ruleset loader, the tick ORDER, purity of apply
// across every command, and copyState's coverage of the newer collections.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadRuleset } from "../server/ruleset.js";
import { apply, copyState } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import * as CMD from "../engine/commands.js";
import { validate } from "../engine/commands.js";
import { makeWorld, placeAgent, quietCell, centralDropZone, RULES } from "./helpers.js";
import { findDropZones } from "../engine/citygen.js";

test("the ruleset loader produces every key the engine reads", () => {
  const rules = loadRuleset();
  // The engine indexes these by name in the reducer; a rename in data/ that
  // the loader silently tolerates would surface as a runtime crash mid-tick.
  for (const key of ["agents", "detection", "combat", "hq", "contracts",
    "citygen", "ai_firms", "standoff", "vehicles", "firms", "season", "terrain"]) {
    assert.ok(rules[key], `ruleset is missing '${key}'`);
  }
  assert.ok(rules.version, "ruleset must carry its era version");
  assert.equal(rules.detection.arrest.burnedAtHeat, 3, "D27 value drifted");
  assert.equal(rules.hq.evacHoldTicks, 300, "D-spec 30s hold at 10Hz drifted");
});

test("every data file named by the manifest actually parses as JSON", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../data/ruleset.json", import.meta.url).pathname, "utf8"));
  for (const file of manifest.files) {
    const path = new URL(`../data/${file}`, import.meta.url).pathname;
    assert.doesNotThrow(() => JSON.parse(readFileSync(path, "utf8")), file);
  }
});

test("the tick order is the documented contract", () => {
  // applyAdvanceTick promises: move -> perceive -> heat -> arrests -> HQs ->
  // contracts. Reordering changes outcomes and therefore the hash.
  //
  // This is asserted STRUCTURALLY, on the source, because a behavioural probe
  // for it is not honest: any scenario I can arrange (agent standing on a
  // patrol, say) is detected under either order, so the test would pass
  // whatever the reducer did. Checking the call sequence is brittle in a
  // different way, but it is brittle about the thing it actually claims.
  const src = readFileSync(new URL("../engine/reducer.js", import.meta.url).pathname, "utf8");
  const body = src.slice(src.indexOf("function applyAdvanceTick"));
  const order = ["stepAgent", "stepPatrol", "stepDetection", "stepHeat",
    "stepArrests", "stepHqs", "stepContracts"];
  let cursor = -1;
  for (const fn of order) {
    const at = body.indexOf(`${fn}(`);
    assert.ok(at >= 0, `${fn} is no longer called from applyAdvanceTick`);
    assert.ok(at > cursor,
      `tick order changed: ${fn} now runs earlier than the documented contract ` +
      "(move -> perceive -> heat -> arrests -> HQs -> contracts). If this was " +
      "deliberate, update CLAUDE.md, this test, and re-pin the fixture.");
    cursor = at;
  }
});

test("apply is pure for every command in the vocabulary", () => {
  // Not just advanceTick: every handler must leave the input state untouched.
  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD.CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  const spot = quietCell(s);

  const commands = [
    { type: CMD.CMD_ADVANCE_TICK },
    { type: CMD.CMD_SET_STANCE, agentId: 0, stance: 0 },
    { type: CMD.CMD_MOVE, agentId: 0, cellX: spot.x, cellY: spot.y },
    { type: CMD.CMD_USE_ITEM, agentId: 0, slot: 2, cellX: spot.x, cellY: spot.y },
    { type: CMD.CMD_RESCUE, agentId: 0, targetAgentId: 1 },
    { type: CMD.CMD_CAPTURE, agentId: 0, targetAgentId: 1 },
    { type: CMD.CMD_ACTIVATE_EVAC, firmId: 0 },
    { type: CMD.CMD_CANCEL_EVAC, firmId: 0 },
    { type: CMD.CMD_EXTRACT, firmId: 0 },
    { type: CMD.CMD_ACCEPT_CONTRACT, agentId: 0, contractId: 0 },
    { type: CMD.CMD_ABANDON_CONTRACT, agentId: 0, contractId: 0 },
    { type: CMD.CMD_SITE_ACTION, agentId: 0, siteId: 0 },
    { type: CMD.CMD_ENTER_BUILDING, agentId: 0 },
    { type: CMD.CMD_STANDOFF_CHOICE, agentId: 0, standoffId: 0, choice: 1 },
    { type: CMD.CMD_DORMANCY_TICK, elapsedMs: 60000 },
  ];
  for (const command of commands) {
    assert.ok(validate(command), `test command is malformed: ${JSON.stringify(command)}`);
    const before = hashState(s);
    apply(s, command);
    assert.equal(hashState(s), before,
      `apply mutated the input state for ${CMD.COMMAND_NAMES[command.type]}`);
  }
});

test("copyState isolates every collection, including the newer ones", () => {
  let s = makeWorld();
  const zone = centralDropZone(s, findDropZones(s, RULES.citygen));
  s = apply(s, { type: CMD.CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  s.contractPool.push({ id: 1, kind: 0, tier: 1, districtId: 0, siteId: 0, siteIdB: 1,
    reward: 10, expiresTick: 0, reservedBy: -1, acceptedBy: -1, stage: 0, stageTicks: 0 });
  s.standoffs.push({ id: 0, agentA: 0, agentB: 1, ticksLeft: 10, choiceA: -1, choiceB: -1 });
  s.pacts.push({ firmA: 0, firmB: 1, expiresTick: 100 });
  s.vehicles.push({ id: 0, kind: 0, firmId: 0, x: 0, y: 0, riderAgentId: -1,
    facing: 0, moveProgress: 0 });

  const c = copyState(s);
  c.hqs[0].cacheResources = 999;
  c.contractPool[0].reward = 999;
  c.standoffs[0].ticksLeft = 999;
  c.pacts[0].expiresTick = 999;
  c.vehicles[0].x = 999;
  c.agents[0].route.push({ x: 1, y: 1 });

  assert.notEqual(s.hqs[0].cacheResources, 999, "hqs aliased");
  assert.notEqual(s.contractPool[0].reward, 999, "contractPool aliased");
  assert.notEqual(s.standoffs[0].ticksLeft, 999, "standoffs aliased");
  assert.notEqual(s.pacts[0].expiresTick, 999, "pacts aliased");
  assert.notEqual(s.vehicles[0].x, 999, "vehicles aliased");
  assert.equal(s.agents[0].route.length, 0, "agent route aliased");
});

test("every command in the vocabulary is implemented", () => {
  // This test used to list the commands still stubbed out and assert they said
  // so explicitly. As of M6 the list is EMPTY — every declared command has a
  // handler. Inverted so it keeps earning its place: if someone adds a command
  // to the vocabulary without a handler, this fails instead of quietly
  // rejecting at runtime.
  const s = makeWorld();
  const unimplemented = [];
  const probe = {
    [CMD.CMD_ADVANCE_TICK]: {},
    [CMD.CMD_DROP_IN]: { firmId: 0, cellX: 5, cellY: 5 },
    [CMD.CMD_ACTIVATE_EVAC]: { firmId: 0 },
    [CMD.CMD_CANCEL_EVAC]: { firmId: 0 },
    [CMD.CMD_EXTRACT]: { firmId: 0 },
    [CMD.CMD_MOVE]: { agentId: 0, cellX: 5, cellY: 5 },
    [CMD.CMD_SET_STANCE]: { agentId: 0, stance: 1 },
    [CMD.CMD_ENTER_VEHICLE]: { agentId: 0 },
    [CMD.CMD_EXIT_VEHICLE]: { agentId: 0 },
    [CMD.CMD_USE_ITEM]: { agentId: 0, slot: 0, cellX: 5, cellY: 5 },
    [CMD.CMD_RESCUE]: { agentId: 0, targetAgentId: 1 },
    [CMD.CMD_CAPTURE]: { agentId: 0, targetAgentId: 1 },
    [CMD.CMD_PAY_BAIL]: { firmId: 0, agentId: 0 },
    [CMD.CMD_ENTER_BUILDING]: { agentId: 0 },
    [CMD.CMD_EXIT_BUILDING]: { agentId: 0 },
    [CMD.CMD_DIALOGUE_CHOICE]: { agentId: 0, optionIdx: 0 },
    [CMD.CMD_BUY_ITEM]: { agentId: 0, itemIdx: 0 },
    [CMD.CMD_ACCEPT_CONTRACT]: { agentId: 0, contractId: 0 },
    [CMD.CMD_ABANDON_CONTRACT]: { agentId: 0, contractId: 0 },
    [CMD.CMD_SITE_ACTION]: { agentId: 0, siteId: 0 },
    [CMD.CMD_STANDOFF_CHOICE]: { agentId: 0, standoffId: 0, choice: 1 },
    [CMD.CMD_DORMANCY_TICK]: { elapsedMs: 1000 },
  };
  for (const [typeStr, fields] of Object.entries(probe)) {
    const type = Number(typeStr);
    const next = apply(s, { type, ...fields });
    const rejected = next.events.find((e) => e.type === "rejected");
    if (rejected?.reason === "not_implemented") {
      unimplemented.push(CMD.COMMAND_NAMES[type]);
    }
  }
  assert.deepEqual(unimplemented, [],
    `declared but unimplemented: ${unimplemented.join(", ")}`);

  // And the probe must cover the whole vocabulary, or it proves less than it
  // claims the day a command is added.
  const declared = Object.keys(CMD.COMMAND_NAMES).map(Number).sort((a, b) => a - b);
  const covered = Object.keys(probe).map(Number).sort((a, b) => a - b);
  assert.deepEqual(covered, declared, "the probe does not cover every command");
});

test("the command validator rejects malformed frames", () => {
  const bad = [
    null, undefined, {}, { type: "move" }, { type: 9999 },
    { type: CMD.CMD_MOVE, agentId: "0", cellX: 1, cellY: 1 },
    { type: CMD.CMD_MOVE, agentId: 0, cellX: 1.5, cellY: 1 },
    { type: CMD.CMD_SET_STANCE, agentId: 0, stance: 7 },
    { type: CMD.CMD_DORMANCY_TICK, elapsedMs: -1 },
  ];
  for (const frame of bad) assert.equal(validate(frame), false, JSON.stringify(frame));
});

test("every engine module imports cleanly (no cycles, no missing exports)", async () => {
  const dir = new URL("../engine/", import.meta.url).pathname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    await assert.doesNotReject(() => import(`../engine/${file}`), `${file} failed to import`);
  }
});
