// test/contested.test.js — contested contracts (S16, M8 slice 8g).
//
// The design promise: a contested contract is a job several Firms are chasing,
// flagged so taking it is an INFORMED choice. That flag is doing the work of
// D18 here — D18 exists so nobody walks across the city for a job that was
// never theirs, and a contested contract keeps that promise by saying so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { buildView } from "../engine/view.js";
import { hashState } from "../engine/snapshot.js";
import {
  refillPool, rebuildOffers, acceptContract, completeContract,
} from "../engine/contracts.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const CFG = RULES.contracts;

function world(seed = 4711, firms = 2) {
  const s = makeWorld({ seed });
  for (let i = 0; i < firms; i++) {
    s.firms[i].state = 1;
    s.firms[i].tierUnlocked = 3;
    s.hqs.push({ id: i, firmId: i, cellX: 10 + i * 4, cellY: 10, cacheResources: 0, evacActive: 0 });
    placeAgent(s, { agentId: i, firmId: i, cellX: 10 + i * 4, cellY: 10 });
  }
  refillPool(s, CFG, RULES.detection);
  rebuildOffers(s, CFG, RULES.detection);
  return s;
}

const contestedIn = (s) => s.contractPool.find((c) => c.contested && c.stage === 0);

// ── Generation ─────────────────────────────────────────────────────────────

test("contested contracts are a MINORITY of the board", () => {
  // If most work were contested the board would stop being a choice and every
  // sortie would be a race.
  const s = world();
  const n = s.contractPool.length;
  const c = s.contractPool.filter((x) => x.contested).length;
  assert.ok(c > 0, "no contested contracts at all — 8g is dead content");
  assert.ok(c / n < 0.35, `${((c / n) * 100).toFixed(0)}% contested — the board is a scrum`);
});

test("a contested contract PAYS for the trouble", () => {
  // Better money, and someone else is coming. Without the premium it is a trap
  // rather than a decision.
  const s = world();
  assert.ok(CFG.contested.rewardPct > 100, "a contested job pays no more than a quiet one");
  const pairs = new Map();
  for (const c of s.contractPool) {
    const key = `${c.kind}:${c.districtId}`;
    if (!pairs.has(key)) pairs.set(key, { yes: [], no: [] });
    pairs.get(key)[c.contested ? "yes" : "no"].push(c.reward);
  }
  let compared = 0;
  for (const { yes, no } of pairs.values()) {
    if (!yes.length || !no.length) continue;
    assert.ok(Math.max(...yes) > Math.min(...no),
      "a contested contract paid no more than an identical quiet one");
    compared++;
  }
  assert.ok(compared > 0, "no comparable pair found — the test proved nothing");
});

test("contested generation is deterministic for a seed", () => {
  const a = world(4711).contractPool.filter((c) => c.contested).map((c) => c.id);
  const b = world(4711).contractPool.filter((c) => c.contested).map((c) => c.id);
  assert.deepEqual(a, b);
});

// ── Offering ───────────────────────────────────────────────────────────────

test("a contested contract reaches more than one board, capped", () => {
  // FOUR Firms against a cap of two, deliberately. With only two deployed the
  // cap can never be exceeded, so the assertion would hold with the check
  // deleted — a mutation proved exactly that. The world has to be able to break
  // the rule before a test can claim the rule is enforced.
  assert.ok(CFG.contested.maxFirms < 4, "this test needs more Firms than the cap allows");
  const s = world(4711, 4);
  const shared = s.contractPool.filter((c) => (c.contestedBy ?? []).length > 1);
  assert.ok(shared.length > 0, "no contract was ever offered to two Firms — 8g does nothing");
  for (const c of s.contractPool) {
    assert.ok((c.contestedBy ?? []).length <= CFG.contested.maxFirms,
      `contract ${c.id} is offered to ${(c.contestedBy ?? []).length} Firms `
      + `against a cap of ${CFG.contested.maxFirms} — that is a scrum, not a contest`);
  }
});

test("an UNCONTESTED contract still never reaches two boards", () => {
  // The half of D18 that must not bend.
  const s = world(31337, 4);
  const seen = new Map();
  for (const board of s.offers) {
    for (const id of board.contractIds) {
      const c = s.contractPool.find((x) => x.id === id);
      if (c.contested) continue;
      assert.ok(!seen.has(id), `uncontested ${id} on two boards`);
      seen.set(id, board.firmId);
    }
  }
});

// ── The race ───────────────────────────────────────────────────────────────

test("two Firms can hold the same contested contract", () => {
  const s = world();
  const c = contestedIn(s);
  assert.ok(c, "no contested contract to test with");
  c.contestedBy = [0, 1];
  assert.equal(acceptContract(s, s.agents[0], c.id, CFG), null);
  assert.equal(acceptContract(s, s.agents[1], c.id, CFG), null);
  assert.deepEqual(c.contenders, [0, 1]);
});

test("the same Firm cannot take it twice", () => {
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  acceptContract(s, s.agents[0], c.id, CFG);
  assert.equal(acceptContract(s, s.agents[0], c.id, CFG), "already_taken");
});

test("a Firm it was never offered to cannot take it", () => {
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0];
  assert.equal(acceptContract(s, s.agents[1], c.id, CFG), "not_offered_to_you");
});

test("the arrival is TELEGRAPHED the moment a second Firm takes it", () => {
  // A rival team that materialises unannounced reads as unfair; one you can
  // hear coming is a decision — hurry, hide, or set up (S16).
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  acceptContract(s, s.agents[0], c.id, CFG);
  s.events = [];
  acceptContract(s, s.agents[1], c.id, CFG);
  const e = s.events.find((x) => x.type === "contractContested");
  assert.ok(e, "the second Firm arrived silently");
  assert.deepEqual(e.firmIds, [0, 1]);
});

test("the FINISHER is paid, not the first taker", () => {
  // Paying the first taker for someone else's work is the quietest possible way
  // to make the whole race pointless.
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  acceptContract(s, s.agents[0], c.id, CFG);
  acceptContract(s, s.agents[1], c.id, CFG);
  assert.equal(c.acceptedBy, 0, "the first taker should still be recorded");

  const before = s.firms[1].cacheResources + (s.hqs[1]?.cacheResources ?? 0);
  completeContract(s, c, s.agents[1], CFG);
  const won = s.events.find((e) => e.type === "contractCompleted");
  assert.equal(won.firmId, 1, "the wrong Firm was credited with the completion");
  const after = s.firms[1].cacheResources + (s.hqs[1]?.cacheResources ?? 0);
  assert.ok(after > before, "the winner was not actually paid");
});

test("the losers are TOLD, and released", () => {
  // An objective that silently stops being completable reads as a broken game
  // rather than as a loss.
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  acceptContract(s, s.agents[0], c.id, CFG);
  acceptContract(s, s.agents[1], c.id, CFG);
  s.events = [];
  completeContract(s, c, s.agents[1], CFG);

  const lost = s.events.find((e) => e.type === "contractLost" && e.firmId === 0);
  assert.ok(lost, "the losing Firm was never told");
  assert.equal(lost.toFirmId, 1);
  assert.ok(!s.agents[0].contractIds.includes(c.id),
    "the loser is still carrying a contract that can never complete");
});

// ── The view ───────────────────────────────────────────────────────────────

test("the board FLAGS a contested contract", () => {
  // The flag is what makes taking it an informed choice instead of a surprise.
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  const board = s.offers.find((o) => o.firmId === 0);
  if (!board.contractIds.includes(c.id)) board.contractIds.push(c.id);
  const view = buildView(s, 0, RULES.detection);
  const row = view.board.contracts.find((x) => x.id === c.id);
  assert.ok(row, "the contested contract is not on the board at all");
  assert.equal(row.contested, 1, "the contract is contested and the board does not say so");
});

test("the view reports a rival COUNT, never who", () => {
  // Knowing which Firm is racing you would leak the rival board across the fog.
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  acceptContract(s, s.agents[0], c.id, CFG);
  acceptContract(s, s.agents[1], c.id, CFG);
  const board = s.offers.find((o) => o.firmId === 0);
  if (!board.contractIds.includes(c.id)) board.contractIds.push(c.id);
  const row = buildView(s, 0, RULES.detection).board.contracts.find((x) => x.id === c.id);
  assert.equal(row.rivals, 1);
  assert.equal(row.contenders, undefined, "the view leaks WHICH Firms are racing");
  assert.equal(row.contestedBy, undefined, "the view leaks the rival board");
});

// ── Doctrine ───────────────────────────────────────────────────────────────

test("contender lists are copied, not shared, through the reducer", () => {
  // Both are ARRAYS: a spread copies the reference, and a shared array would
  // make the reducer impure in a way no ordinary test would notice.
  const s = world();
  const c = contestedIn(s);
  c.contestedBy = [0, 1];
  acceptContract(s, s.agents[0], c.id, CFG);
  const next = apply(s, { type: CMD_ADVANCE_TICK });
  const there = next.contractPool.find((x) => x.id === c.id);
  there.contenders.push(99);
  assert.ok(!c.contenders.includes(99), "the contender list is shared between states");
});

test("contested state is hashed", () => {
  // A plain world: `world()` hand-builds HQs for the offer tests and those are
  // not complete HQ records, which the hasher rightly refuses. Hash the real
  // thing instead of teaching the hasher to tolerate a half-built fixture.
  const s = makeWorld();
  refillPool(s, CFG, RULES.detection);
  const c = s.contractPool.find((x) => x.contested);
  assert.ok(c, "no contested contract in the pool");
  const before = hashState(s);
  c.contenders = [0, 1];
  assert.notEqual(hashState(s), before, "who is racing is not part of the world state");
  const mid = hashState(s);
  c.contested = 0;
  assert.notEqual(hashState(s), mid, "the contested flag itself is not hashed");
});
