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
import { CMD_DROP_IN } from "../engine/commands.js";
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
