// test/access.test.js — credentials and secured facilities (S16, 8e + 8f).
//
// 8f is THE SLICE D42 WAS WAITING FOR: acquisition and extraction stop being
// quiet-street work and start happening inside a facility that is reacting. So
// the tests that matter most are (a) a secured site actually refuses work
// without a pass, and (b) working inside one climbs the alarm on its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import {
  credentialTier, hasCredential, grantCredential, clearCredentials,
  liftCredentialFromGuard, isDisrupted, CRED_NONE,
} from "../engine/access.js";
import { accessBlocked, requiresCredential, STAGE_WORK } from "../engine/contracts.js";
import { stepAlarms, triggersAt, workingAt, alarmStageOf, ALARM_LOCAL } from "../engine/security.js";
import { captureAgent } from "../engine/combat.js";
import { makeWorld, placeAgent, RULES } from "./helpers.js";

const ACFG = RULES.security.access;
const ALARM = RULES.security.alarm;

const securedSite = (s) => s.sites.find((x) => (x.securityTier | 0) > 0);

// ── Credentials ────────────────────────────────────────────────────────────

test("an agent starts with nothing, and credentials are hash-inert until held", () => {
  const s = makeWorld();
  assert.equal(s.credentials.length, 0);
  assert.equal(credentialTier(s, 0), CRED_NONE);
  const before = hashState(s);
  grantCredential(s, 0, 2, "test");
  assert.notEqual(hashState(s), before, "a held credential is not hashed");
});

test("a credential is per-AGENT, not per-Firm", () => {
  // Otherwise a Firm buys one card and walks every operative through the door.
  const s = makeWorld();
  grantCredential(s, 0, 2, "test");
  assert.ok(hasCredential(s, 0, 2));
  assert.ok(!hasCredential(s, 1, 2), "a second agent inherited the first one's pass");
});

test("holding tier 2 satisfies a tier 1 door, but not the reverse", () => {
  const s = makeWorld();
  grantCredential(s, 0, 2, "test");
  assert.ok(hasCredential(s, 0, 1));
  assert.ok(!hasCredential(s, 0, 3));
});

test("granting twice does not stack, and is not an error", () => {
  const s = makeWorld();
  assert.equal(grantCredential(s, 0, 1, "a"), true);
  assert.equal(grantCredential(s, 0, 1, "b"), false);
  assert.equal(s.credentials.length, 1);
});

test("credentials are lost with the agent — they do not survive a sortie", () => {
  // Per-sortie keeps them a thing you plan around rather than a permanent
  // unlock, the same reasoning D50 applies to upgrades one level up.
  const s = makeWorld();
  grantCredential(s, 0, 1, "test");
  grantCredential(s, 0, 2, "test");
  assert.equal(clearCredentials(s, 0), 2);
  assert.equal(credentialTier(s, 0), CRED_NONE);
  assert.ok(s.events.some((e) => e.type === "credentialsLost"));
});

// ── The guard source (the interesting one) ─────────────────────────────────

test("a badge can be lifted off a DISABLED guard, and only a disabled one", () => {
  // This is what turns a patrol from a thing to avoid into a thing you might
  // deliberately seek out.
  const s = makeWorld();
  const patrol = s.patrols[0];
  const agent = placeAgent(s, { cellX: patrol.x, cellY: patrol.y });

  const awake = liftCredentialFromGuard(s, agent, patrol, ACFG);
  assert.equal(awake.ok, false);
  assert.equal(awake.reason, "guard_not_disabled");

  patrol.stunnedUntil = s.tick + 100;
  assert.ok(isDisrupted(patrol, s.tick), "a stunned patrol does not read as disabled");
  const got = liftCredentialFromGuard(s, agent, patrol, ACFG);
  assert.ok(got.ok, `lift refused: ${got.reason}`);
  assert.equal(credentialTier(s, agent.id), ACFG.guardTier);
});

test("a disabled guard is DISTINGUISHABLE from a calm one", () => {
  // The disruptor used to set alertTicks to 0 — exactly what an untroubled
  // patrol looks like — so nothing downstream could tell "I put this guard out"
  // from "this guard was never bothered".
  const s = makeWorld();
  const calm = s.patrols[0];
  assert.equal(isDisrupted(calm, s.tick), false);
  calm.stunnedUntil = s.tick + 50;
  assert.equal(isDisrupted(calm, s.tick), true);
  assert.equal(isDisrupted(calm, s.tick + 50), false, "the stun never wears off");
});

test("you must be next to the guard to take anything off them", () => {
  const s = makeWorld();
  const patrol = s.patrols[0];
  patrol.stunnedUntil = s.tick + 100;
  const far = placeAgent(s, { cellX: patrol.x + 5, cellY: patrol.y + 5 });
  assert.equal(liftCredentialFromGuard(s, far, patrol, ACFG).reason, "not_adjacent");
});

test("the guard tier is the LOWEST, so the free source is not the best one", () => {
  // If a lifted badge opened everything, buying one would be pointless and two
  // of the three sources would be dead content.
  assert.equal(ACFG.guardTier, 1);
  const vendorTier = RULES.payloads.shops
    .flatMap((sh) => sh.catalog)
    .find((i) => i.effect?.type === "credential")?.effect.tier;
  assert.ok(vendorTier > ACFG.guardTier,
    "a bought credential is no better than a lifted one — the shop entry is pointless");
});

// ── Secured facilities (8f) ────────────────────────────────────────────────

test("a site is secured exactly when it actually has security on it", () => {
  // A facility that demands a credential while standing wide open, or stands
  // watched while letting anyone walk in, is incoherent to a player.
  for (const seed of [4711, 90210, 1548]) {
    const s = makeWorld({ seed });
    for (const site of s.sites) {
      const watched = s.cameras.some((c) => c.siteId === site.id);
      const beamed = s.beams.some((b) => b.siteId === site.id);
      const expected = watched && beamed ? 2 : (watched || beamed) ? 1 : 0;
      assert.equal(site.securityTier | 0, expected,
        `seed ${seed}: site ${site.id} security tier does not match its fixtures`);
    }
  }
  assert.ok(makeWorld().sites.some((x) => (x.securityTier | 0) > 0),
    "no site in the world is secured — 8f is dead content");
});

test("a secured site refuses work without the pass, and SAYS so", () => {
  // A work stage that silently never advances is indistinguishable from a bug.
  // That is exactly how the acquisition-0% defect hid for 24 world-days.
  const s = makeWorld();
  const site = securedSite(s);
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  // KIND_ACQUISITION: only D42's two types are gated, so a fixture without a
  // kind would short-circuit and prove nothing.
  const contract = { id: 1, kind: 4, siteId: site.id, stage: STAGE_WORK };
  assert.equal(accessBlocked(s, agent, contract, site.id), true);
  assert.ok(s.events.some((e) => e.type === "accessDenied" && e.need === site.securityTier),
    "the refusal was silent");
});

test("the refusal is announced ONCE, not ten times a second", () => {
  const s = makeWorld();
  const site = securedSite(s);
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  const contract = { id: 1, kind: 4, siteId: site.id, stage: STAGE_WORK };
  for (let i = 0; i < 50; i++) accessBlocked(s, agent, contract, site.id);
  assert.equal(s.events.filter((e) => e.type === "accessDenied").length, 1,
    "a refusal repeated every tick is noise, not information");
});

test("with the pass, the same site lets you work", () => {
  const s = makeWorld();
  const site = securedSite(s);
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  grantCredential(s, agent.id, site.securityTier, "test");
  assert.equal(accessBlocked(s, agent, { id: 1, kind: 4, siteId: site.id }, site.id), false);
});

test("an UNSECURED site never asks for anything", () => {
  const s = makeWorld();
  const open = s.sites.find((x) => (x.securityTier | 0) === 0);
  const agent = placeAgent(s, { cellX: open.cellX, cellY: open.cellY });
  assert.equal(accessBlocked(s, agent, { id: 1, kind: 4, siteId: open.id }, open.id), false);
});

// ── THE D42 WIRING ─────────────────────────────────────────────────────────

test("working inside a secured facility climbs the alarm, unseen or not", () => {
  // THIS IS WHAT D42 WAS WAITING FOR. Acquisition's crack timer should elapse
  // inside a facility that is reacting, not in a quiet street — and the alarm
  // must climb WITHOUT the agent being burned, or the difficulty is just the
  // old detection loop again.
  const s = makeWorld();
  const site = securedSite(s);
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  agent.detection = 0;                                  // completely unseen
  const contract = { id: 77, siteId: site.id, stage: STAGE_WORK, acceptedBy: 0 };
  s.contractPool.push(contract);
  agent.contractIds.push(77);

  assert.ok(workingAt(s, agent, site.id), "the agent is not registering as working here");
  assert.equal(triggersAt(s, site, ALARM).length, 1, "secured work is not a trigger");
  stepAlarms(s, ALARM);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL,
    "cracking a secured vault did not wake the facility");
  assert.equal(agent.detection, 0, "the alarm came from being seen, not from the facility");
});

test("working at an UNSECURED site does not climb an alarm", () => {
  // Otherwise every contract everywhere becomes an alarm, and D42's "make SOME
  // contracts harder" turns into "make all of them harder uniformly".
  const s = makeWorld();
  const open = s.sites.find((x) => (x.securityTier | 0) === 0);
  const agent = placeAgent(s, { cellX: open.cellX, cellY: open.cellY });
  agent.detection = 0;
  s.contractPool.push({ id: 78, siteId: open.id, stage: STAGE_WORK, acceptedBy: 0 });
  agent.contractIds.push(78);
  stepAlarms(s, ALARM);
  assert.equal(alarmStageOf(s, open.id), 0);
});

test("secured work reaches alarm STAGE 3 — unreachable before 8f", () => {
  // 8a shipped a three-stage alarm whose top stage no measurement could reach,
  // and the dev-log recorded that as correct-for-now: stage 3 is built for the
  // scenario 8f creates. This is that scenario, so it must now be reachable.
  const s = makeWorld();
  const site = securedSite(s);
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  agent.detection = 0;
  s.contractPool.push({ id: 79, siteId: site.id, stage: STAGE_WORK, acceptedBy: 0 });
  agent.contractIds.push(79);

  const need = ALARM.stageTicks[0] + ALARM.stageTicks[1] + 10;
  for (let i = 0; i < need; i++) stepAlarms(s, ALARM);
  assert.equal(alarmStageOf(s, site.id), 3,
    "a full crack inside a secured facility still cannot reach the district alarm");
});

test("the whole thing survives the reducer", () => {
  const s = makeWorld();
  grantCredential(s, 0, 2, "test");
  const next = apply(s, { type: 1 });
  assert.equal(credentialTier(next, 0), 2, "credentials did not survive copyState");
});

test("capture takes the badge — a credential does not survive arrest", () => {
  // Otherwise losing an agent costs only time, and the pass you walked across
  // the map for is free to replace.
  const s = makeWorld();
  const agent = placeAgent(s, { cellX: 20, cellY: 20 });
  grantCredential(s, agent.id, 2, "test");
  agent.state = 2;                                   // downed, capturable
  const err = captureAgent(s, agent, 1, RULES.detection, RULES.agents);
  assert.ok(!err, `capture failed: ${err}`);
  assert.equal(credentialTier(s, agent.id), CRED_NONE, "the badge survived arrest");
});

test("only D42's two types are gated — not every contract at a secured site", () => {
  // Gating courier or surveillance too would make every type uniformly harder,
  // which is the opposite of D42's "some contracts harder" and would flatten
  // the very mix D19 measures.
  const s = makeWorld();
  const site = securedSite(s);
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  assert.equal(requiresCredential(2), true, "extraction must be gated");
  assert.equal(requiresCredential(4), true, "acquisition must be gated");
  for (const kind of [0, 1, 3]) {
    assert.equal(requiresCredential(kind), false);
    assert.equal(accessBlocked(s, agent, { id: kind, kind, siteId: site.id }, site.id), false,
      `kind ${kind} was blocked by access control it should not be subject to`);
  }
});

test("secured sites are SOME of the world, not most of it", () => {
  // MEASURED. Camera and beam placement roll independently, so their shares
  // compound: 35% + 25% produced 56-80% of sites secured — "most contracts
  // harder" rather than D42's "some". This is the number that decides whether
  // opposition is a texture or a wall, so it is pinned rather than trusted.
  let sites = 0, secured = 0;
  for (const seed of [4711, 90210, 1548, 1000, 1685]) {
    const s = makeWorld({ seed });
    sites += s.sites.length;
    secured += s.sites.filter((x) => (x.securityTier | 0) > 0).length;
  }
  const share = secured / sites;
  assert.ok(share > 0.15, `only ${(share * 100).toFixed(0)}% of sites are secured — 8f barely exists`);
  assert.ok(share < 0.45,
    `${(share * 100).toFixed(0)}% of sites are secured — that is "most contracts harder", not "some"`);
});
