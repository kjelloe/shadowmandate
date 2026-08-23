// test/server.test.js — M7: hosted worlds, identity, and the view privacy
// contract (S10, S11, D10, D18, D20, D31, D32).
//
// The privacy assertions are the important ones. "Views cross the wire, state
// does not" is only true if something checks — and a leak is invisible until
// somebody exploits it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { World } from "../server/world.js";
import { LedgerStore } from "../server/ledger.js";
import {
  issueIdentity, claimWithCode, resolveToken, looksLikeCode, normaliseCode,
  generateRecoveryCode, CODE_WORDS,
} from "../server/identity.js";
import { buildView, FORBIDDEN_IN_VIEW } from "../engine/view.js";
import { CMD_DROP_IN, CMD_EXTRACT } from "../engine/commands.js";
import { AGENT_ACTIVE, AGENT_HELD } from "../engine/state.js";
import { findDropZones } from "../engine/citygen.js";
import { RULES, centralDropZone } from "./helpers.js";

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "sm-id-"));
  return { store: new LedgerStore(join(dir, "ledger.json")), dir };
}

function hostedWorld({ seed = 4711, ai = 2 } = {}) {
  let clock = 1_000_000;
  const world = new World({
    id: "test-world", seed, size: 64, rules: RULES, ledger: null,
    aiCount: ai, now: () => clock,
  });
  return { world, advance: (ms) => { clock += ms; } };
}

// ── Identity (D10, D32) ───────────────────────────────────────────────────

test("a recovery code is four words and survives sloppy typing", () => {
  const code = generateRecoveryCode();
  assert.equal(code.split("-").length, CODE_WORDS);
  assert.ok(looksLikeCode(code));
  // People type codes with capitals, spaces and a trailing stop.
  assert.ok(looksLikeCode(code.toUpperCase().replace(/-/g, " ") + "."),
    "a sloppily typed but correct code was rejected");
  assert.equal(normaliseCode("  Amber_Anchor  atlas-BEACON. "), "amber-anchor-atlas-beacon");
});

test("a malformed or unknown code is refused, and distinguishably so", () => {
  const { store, dir } = tempStore();
  try {
    assert.equal(claimWithCode(store, "not a real code").error, "malformed_code");
    assert.equal(claimWithCode(store, "amber-anchor-atlas-beacon").error, "unknown_code");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D10: a token identifies a Firm, and a recovery code restores it", () => {
  const { store, dir } = tempStore();
  try {
    const id = issueIdentity(store, 3);
    assert.equal(resolveToken(store, id.token), 3);
    assert.equal(resolveToken(store, "not-a-token"), null);

    // A new browser claims the same Firm with the code.
    const claimed = claimWithCode(store, id.recoveryCode);
    assert.equal(claimed.firmId, 3);
    assert.notEqual(claimed.token, id.token, "claiming should mint a fresh token");
    // ...and the original device keeps working: reinstalling a browser should
    // not log you out of the phone you still have open.
    assert.equal(resolveToken(store, id.token), 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the recovery code is never stored in the clear", () => {
  const { store, dir } = tempStore();
  try {
    const id = issueIdentity(store, 0);
    const serialised = JSON.stringify(store.data);
    assert.ok(!serialised.includes(id.recoveryCode),
      "the ledger file contains a usable recovery code in plain text");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── View privacy (the contract that makes cheating structural nonsense) ────

test("a view carries no field that would leak the world", () => {
  const { world } = hostedWorld();
  const view = world.viewFor(0);
  for (const forbidden of FORBIDDEN_IN_VIEW) {
    assert.ok(!(forbidden in view), `the view exposes '${forbidden}'`);
  }
  const serialised = JSON.stringify(view);
  assert.ok(!serialised.includes('"rng"'), "PRNG state reached the wire");
});

test("D18: a Firm sees its own five offers and nothing of the pool", () => {
  const { world } = hostedWorld();
  const view = world.viewFor(0);
  assert.ok(view.board.contracts.length <= RULES.contracts.offersShown);
  const poolSize = world.state.contractPool.length;
  assert.ok(poolSize > view.board.contracts.length + 2,
    "precondition: the pool is much larger than one board");
  // Every contract in the view must be one offered to THIS Firm.
  const offers = world.state.offers.find((o) => o.firmId === 0);
  for (const c of view.board.contracts) {
    assert.ok(offers.contractIds.includes(c.id),
      `contract ${c.id} appeared in Firm 0's view without being offered to it`);
  }
});

test("D20: exact heat is absent from the view until it is bought", () => {
  const { world } = hostedWorld();
  world.state.districts[0].heat = 4;
  let view = world.viewFor(0);
  assert.equal(view.districts[0].heat, -1, "exact heat leaked without intel");
  assert.ok(view.districts[0].heatBand >= 0, "the fuzzy band should always show");

  // Buy the intel, and the exact number appears.
  world.state.firms[0].heatIntel = [{ districtId: 0, expiresTick: world.state.tick + 1000 }];
  view = world.viewFor(0);
  assert.equal(view.districts[0].heat, 4, "bought intel did not reveal exact heat");
});

test("fog: a rival on the far side of the map is not in your view", () => {
  const { world } = hostedWorld();
  const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
  world.submit({ type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  world.drain();

  // Put a rival agent as far away as the map allows.
  const rival = world.state.agents.find((a) => a.state === 0);
  rival.state = 1; rival.firmId = 1;
  rival.x = (world.state.size - 2) * 256 + 128;
  rival.y = (world.state.size - 2) * 256 + 128;

  const view = world.viewFor(0);
  assert.equal(view.rivals.length, 0, "a rival across the map was visible");

  // Standing on top of your agent, they are.
  const mine = world.state.agents.find((a) => a.firmId === 0 && a.state === 1);
  rival.x = mine.x; rival.y = mine.y;
  assert.equal(world.viewFor(0).rivals.length, 1, "an adjacent rival was invisible");
});

test("an agent inside a building is not reported to rivals at all", () => {
  const { world } = hostedWorld();
  const a = world.state.agents[0];
  const b = world.state.agents[1];
  a.state = 1; a.firmId = 0; a.x = 20 * 256; a.y = 20 * 256;
  b.state = 1; b.firmId = 1; b.x = 20 * 256; b.y = 20 * 256;
  assert.equal(world.viewFor(0).rivals.length, 1, "precondition: visible on the street");
  b.insideBuildingId = 0;
  b.state = 4;  // AGENT_INSIDE
  assert.equal(world.viewFor(0).rivals.length, 0, "a rival indoors was still reported");
});

// ── Hosted world lifecycle ────────────────────────────────────────────────

test("a world ticks, seats a player, and unseats them", () => {
  const { world } = hostedWorld();
  const sent = [];
  world.seat(0, (msg) => sent.push(msg));
  world.tick();
  assert.ok(sent.length > 0, "a seated player received nothing");
  assert.equal(sent[0].type, "view");
  assert.ok(sent[0].view, "the broadcast carried no view");
  world.unseat(0);
  assert.equal(world.seats.size, 0);
  world.stop();
});

test("D31: unseating sets the reconnect grace rather than pausing the world", () => {
  const { world } = hostedWorld();
  world.seat(0, () => {});
  const tickBefore = world.state.tick;
  world.unseat(0);
  assert.equal(world.state.firms[0].graceTicks, RULES.season.reconnectGraceTicks);
  world.start(); world.tick(); world.stop();
  assert.ok(world.state.tick > tickBefore, "the world paused when a player left");
});

test("a world sleeps when the last player leaves, and wakes with one dormancy command", () => {
  const { world, advance } = hostedWorld({ ai: 0 });
  world.state.districts[0].heat = 4;

  // A newly created world is ALREADY asleep — nobody has ever been in it —
  // so sleepIfEmpty reports the TRANSITION, not the state. Seat a player to
  // wake it, then leave, which is the lifecycle that actually happens.
  assert.ok(world.sleepingSince !== null, "a fresh world should start asleep");
  world.seat(0, () => {});
  assert.equal(world.sleepingSince, null, "seating did not wake the world");
  world.unseat(0);
  assert.ok(world.sleepingSince !== null, "the world stayed awake with nobody in it");

  advance(3 * 60 * 60 * 1000);   // three hours
  const elapsed = world.wake();
  assert.ok(elapsed > 0, "waking reported no elapsed time");
  const dormancy = world.commandLog.filter((c) => c.type === 60);
  assert.equal(dormancy.length, 1, "waking should issue exactly one dormancy command");
  assert.ok(world.state.districts[0].heat < 4, "the world did not cool while asleep");
  world.stop();
});

test("the briefing carries the ledger and the world's news", () => {
  const { store, dir } = tempStore();
  try {
    const { world } = hostedWorld();
    world.ledger = store;
    store.applyDebrief("test-world", {
      firmId: 0, banked: 400, reputationDelta: 4, recognition: 90,
      tierUnlocked: 2, contractsCompleted: 3,
    }, 500);
    const briefing = world.briefingFor(0);
    assert.equal(briefing.ledger.bank, 400);
    assert.equal(briefing.ledger.tierUnlocked, 2);
    assert.ok(Array.isArray(briefing.news) && briefing.news.length > 0);
    assert.ok(briefing.contracts > 0, "the briefing should say how much work is going");
    world.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLAYTEST 1: a rejected command reaches the player who caused it", () => {
  // Rejections carry no firmId, so the router dropped them: the player pressed
  // a button, nothing happened, and nothing said why. Silence is the worst
  // possible feedback because it is indistinguishable from a frozen game.
  const { world } = hostedWorld();
  const seen = [];
  world.seat(0, (m) => seen.push(...(m.events ?? [])));
  world.submit({ type: 10, firmId: 0, cellX: -1, cellY: -1 });   // unlandable
  world.tick();
  const rejected = seen.find((e) => e.type === "rejected");
  assert.ok(rejected, "the player was never told their command failed");
  assert.equal(rejected.reason, "unlandable");
  world.stop();
});

test("the drop-zone endpoint offers real, landable zones and an auto pick", () => {
  const { world } = hostedWorld();
  const zones = world.dropZones();
  assert.ok(zones.length > 20, `only ${zones.length} drop zones offered`);
  const auto = world.autoDropZone(0);
  assert.ok(auto, "no auto-selected zone");
  // D37: the auto pick must clear the map edge — a corner is safe and awful.
  const margin = RULES.hq.dropZoneEdgeMargin;
  const edge = Math.min(auto.cellX, auto.cellY,
    world.state.size - 1 - auto.cellX, world.state.size - 1 - auto.cellY);
  assert.ok(edge >= margin, `auto zone sits ${edge} from the edge, want >= ${margin}`);
  world.stop();
});

test("extraction delivers a debrief to the extracting seat", () => {
  // The payoff beat. It is delivered directly rather than through the normal
  // broadcast because by the time it exists the Firm has no agent and no HQ,
  // so nothing else would carry it.
  const dir = mkdtempSync(join(tmpdir(), "sm-debrief-"));
  try {
    const { world } = hostedWorld();
    world.ledger = new LedgerStore(join(dir, "ledger.json"));
    const got = [];
    world.seat(0, (m) => got.push(m));

    const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
    world.submit({ type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
    world.tick();
    world.state.hqs[0].cacheResources = 480;

    // Run the beacon out, then extract.
    world.submit({ type: 11, firmId: 0 });
    for (let i = 0; i <= RULES.hq.evacHoldTicks + 2; i++) world.tick();
    world.submit({ type: 13, firmId: 0 });
    world.tick();

    const debrief = got.find((m) => m.type === "debrief");
    assert.ok(debrief, "extraction sent no debrief — the loop has no ending");
    assert.equal(debrief.debrief.banked, 480, "the debrief did not report the banked cache");
    assert.equal(debrief.debrief.emergency, 0);
    assert.ok(debrief.ledger, "the debrief carried no ledger");
    assert.equal(debrief.ledger.bank, 480, "the ledger was not credited");
    world.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the view tells the client when it is standing on a door, and inside one", () => {
  // The client cannot offer "go inside" without knowing there is an inside.
  const { world } = hostedWorld();
  const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
  world.submit({ type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  world.tick();
  const agent = world.state.agents.find((a) => a.firmId === 0 && a.state === 1);
  const building = world.state.buildings.find((b) => b.kind === 0);

  // Playtest 4: the drop lands ON the HQ safehouse door, and the client
  // should know immediately that home has an inside.
  const hq = world.state.hqs.find((h) => h.firmId === 0);
  const atHome = world.viewFor(0).atDoor;
  assert.ok(atHome && atHome.id === hq.buildingId,
    "the drop lands on the HQ's own door and the view must say so");

  // Step off the door and the report clears.
  let off = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const x = hq.cellX + dx, y = hq.cellY + dy;
    if (!world.state.buildings.some((b) => b.entranceX === x && b.entranceY === y)) {
      off = { x, y }; break;
    }
  }
  assert.ok(off, "no doorless cell beside the HQ");
  agent.x = off.x * 256 + 128;
  agent.y = off.y * 256 + 128;
  assert.equal(world.viewFor(0).atDoor, null, "off the door but still reported on one");

  // Stand on the safe house door (walking there is a real 100 seconds at the
  // D41 pace, which is a pacing fact, not something to assert in a unit test).
  agent.x = building.entranceX * 256 + 128;
  agent.y = building.entranceY * 256 + 128;
  const atDoor = world.viewFor(0).atDoor;
  assert.ok(atDoor, "standing on a door was not reported");
  assert.equal(atDoor.kind, 0);

  world.submit({ type: 34, agentId: agent.id });   // enterBuilding
  world.drain();
  const inside = world.viewFor(0).inside;
  assert.ok(inside, "being inside was not reported");
  assert.equal(inside.id, building.id);
  assert.equal(world.viewFor(0).atDoor, null, "you are not at the door once inside");
  world.stop();
});

test("events are routed to the Firm they concern, not broadcast to everyone", () => {
  const { world } = hostedWorld();
  const a = [], b = [];
  world.seat(0, (m) => a.push(m));
  world.seat(1, (m) => b.push(m));
  const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
  world.submit({ type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
  world.tick();
  const aSaw = a.flatMap((m) => m.events).some((e) => e.type === "firmDeployed");
  const bSaw = b.flatMap((m) => m.events).some((e) => e.type === "firmDeployed");
  assert.ok(aSaw, "the deploying Firm was not told it deployed");
  assert.ok(!bSaw, "a rival was told about someone else's deployment");
  world.stop();
});

// ── The dropship must actually land (playtest 3, finding 5) ────────────────
//
// The engine emits `evacReady` at ETA 0 and then waits for CMD_EXTRACT. The AI
// issues its own; NO CLIENT CODE EVER SENT ONE, so a human player's beacon hung
// at "DROPSHIP ETA: 0 SECONDS" forever. The older debrief test above never saw
// it because it submits type 13 itself — an instrument playing the part of a
// client that did not exist. These two drive the loop with the only input a
// player actually has: the evac button.

test("the dropship lands by itself: ETA 0 extracts a seated Firm with no client command", () => {
  const { world } = hostedWorld();
  const got = [];
  world.seat(2, (m) => got.push(m));   // firms 0-1 are the AI seats in hostedWorld
  const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
  world.submit({ type: CMD_DROP_IN, firmId: 2, cellX: zone.cellX, cellY: zone.cellY });
  world.tick();
  world.state.hqs.find((h) => h.firmId === 2).cacheResources = 120;

  world.submit({ type: 11, firmId: 2 });   // activateEvac — the ONLY input sent
  for (let i = 0; i <= RULES.hq.evacHoldTicks + 6
       && !got.some((m) => m.type === "debrief"); i++) world.tick();

  const debrief = got.find((m) => m.type === "debrief");
  assert.ok(debrief, "ETA hit 0 and nothing happened — the dropship never landed");
  assert.equal(debrief.debrief.banked, 120, "the fold did not bank the cache");
  const extracts = world.commandLog.filter((c) => c.type === CMD_EXTRACT);
  assert.equal(extracts.length, 1,
    "evacReady re-fires every tick at 0 — the server must enqueue exactly one extract");
  assert.ok(extracts.every((c) => c.firmId === 2),
    "the server must never extract for an AI Firm — they issue their own");
  world.stop();
});

test("D51: folding with the only operative in custody COMPLETES, and the debt survives", () => {
  // The exact playtest sequence: burned, captured, evac — the countdown must
  // end in a debrief, not a hung banner, and the prisoner stays on the books.
  const { world } = hostedWorld();
  const got = [];
  world.seat(2, (m) => got.push(m));   // firms 0-1 are the AI seats in hostedWorld
  const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
  world.submit({ type: CMD_DROP_IN, firmId: 2, cellX: zone.cellX, cellY: zone.cellY });
  world.tick();
  const agent = world.state.agents.find((a) => a.firmId === 2 && a.state === AGENT_ACTIVE);
  agent.state = AGENT_HELD;

  world.submit({ type: 11, firmId: 2 });   // activateEvac, abandoning branch
  for (let i = 0; i <= RULES.hq.evacHoldTicks + 6
       && !got.some((m) => m.type === "debrief"); i++) world.tick();

  const debrief = got.find((m) => m.type === "debrief");
  assert.ok(debrief, "folding with everyone in custody hung at ETA 0");
  assert.equal(
    world.state.agents.filter((a) => a.firmId === 2 && a.state === AGENT_HELD).length, 1,
    "the abandoned operative must remain HELD under this Firm — that debt is the recovery contract");
  world.stop();
});

test("purchases and bail actually debit the ledger, and the view shows the bank (playtest 5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-bankdebit-"));
  try {
    const store = new LedgerStore(join(dir, "ledger.json"),
      { startingBank: RULES.hq.startingBank });
    let clock = 1_000_000;
    const world = new World({
      id: "test-world", seed: 4711, size: 64, rules: RULES, ledger: store,
      aiCount: 0, now: () => clock,
    });
    const start = RULES.hq.startingBank;
    assert.equal(world.viewFor(0).bank, start,
      "the view must carry the bank — an invisible balance reads as a broken game");

    const zone = centralDropZone(world.state, findDropZones(world.state, RULES.citygen));
    world.submit({ type: CMD_DROP_IN, firmId: 0, cellX: zone.cellX, cellY: zone.cellY });
    world.tick();
    // The drop lands on the HQ safehouse door: walk in and buy the cheapest
    // informant option. The bank rides on the command the way index.js
    // injects it at the socket layer.
    const agent = world.state.agents.find((a) => a.firmId === 0 && a.state === 1);
    world.submit({ type: 34, agentId: agent.id });                       // enter
    world.tick();
    // Heat intel always succeeds; askRival would be refused with no rival
    // deployed, and a refused buy must NOT debit.
    const option = RULES.payloads.dialogues[0].options.find((o) => o.effect?.type === "heatIntel");
    const idx = RULES.payloads.dialogues[0].options.indexOf(option);
    world.submit({ type: 36, agentId: agent.id, optionIdx: idx, bank: start });
    world.tick();
    assert.equal(store.get("test-world", 0).bank, start - option.cost,
      "the purchase was free — the reducer checks the bank but the server never debited it");
    assert.equal(world.viewFor(0).bank, start - option.cost,
      "the view's bank must follow the debit");

    // A REFUSED buy must not debit: askRival fails with no rival deployed.
    const rivalIdx = RULES.payloads.dialogues[0].options.findIndex(
      (o) => o.effect?.type === "revealRivalHq");
    world.submit({ type: 36, agentId: agent.id, optionIdx: rivalIdx, bank: start - option.cost });
    world.tick();
    assert.equal(store.get("test-world", 0).bank, start - option.cost,
      "a refused purchase took the money anyway");
    world.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("zone picks predict the REAL landing with the engine's own rule (playtest 10)", () => {
  const { world } = hostedWorld();
  const picks = world.zonePicks();
  assert.ok(picks.length >= 2, "a multi-district world should offer several picks");
  const zones = findDropZones(world.state, RULES.citygen);
  for (const p of picks) {
    assert.ok(zones.some((z) => z.cellX === p.cellX && z.cellY === p.cellY
      && z.districtId === p.districtId),
      `pick for district ${p.districtId} is not a real drop zone`);
    // The shown landing must be a safehouse DOOR — the same cell dropIn will
    // choose, since both run hqLandingFor against the same state.
    const door = world.state.buildings.find((b) => b.kind === 0
      && b.entranceX === p.landingX && b.entranceY === p.landingY);
    assert.ok(door, `pick for district ${p.districtId} predicts a landing off any safehouse door`);
    // And it IS the promise: submitting the pick lands exactly there.
    const predicted = world.predictLanding(p.cellX, p.cellY);
    assert.equal(predicted.cellX, p.landingX);
    assert.equal(predicted.cellY, p.landingY);
  }
});
