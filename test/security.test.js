// test/security.test.js — site alarms (S16, M8 slice 8a).
//
// What these tests are actually protecting, in order of how badly each would
// hurt if it broke:
//   1. the alarm ESCALATES rather than failing instantly (D44/D45) — the whole
//      design argument for staged alarms;
//   2. it is hash-INERT while nothing is wrong, so adding opposition to the
//      engine did not silently invalidate every pinned fixture and battery;
//   3. it decays, so a mistake is recoverable and the mechanism is not a
//      one-way trip;
//   4. the client is told only what it can see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import { hashState } from "../engine/snapshot.js";
import { buildView } from "../engine/view.js";
import {
  stepAlarms, raiseAlarm, alarmStageOf, alarmFor, triggersAt,
  ALARM_CLEAR, ALARM_LOCAL, ALARM_LOCKDOWN, ALARM_DISTRICT,
} from "../engine/security.js";
import { readFileSync } from "node:fs";
import { makeWorld, placeAgent, RULES, tickCollecting } from "./helpers.js";

const CFG = RULES.security.alarm;
const DET_BURNED = 2;

// A burned agent standing on a site: the one situation 8a can trigger, since
// this slice deliberately ships no sensors.
function burnedOnSite(state, siteIdx = 0) {
  const site = state.sites[siteIdx];
  const agent = placeAgent(state, { cellX: site.cellX, cellY: site.cellY });
  agent.detection = DET_BURNED;
  return { site, agent };
}

// ── Escalation: the design argument ────────────────────────────────────────

test("a burned agent on a site raises the alarm — but only to LOCAL", () => {
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL,
    "an alarm that starts above local is an instant-fail alarm wearing a stage number");
  assert.ok(s.events.some((e) => e.type === "alarmRaised" && e.siteId === site.id),
    "the alarm was raised silently — a client can only show what it is told");
});

test("staying burned escalates LOCAL -> LOCKDOWN -> DISTRICT, in order and on time", () => {
  // The promise is that a mistake WORSENS while you are still inside it, so
  // both the ordering and the timing are the feature.
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL);

  for (let i = 0; i < CFG.stageTicks[0]; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCKDOWN,
    `stage 2 did not arrive after ${CFG.stageTicks[0]} ticks of continuing to be burned`);

  for (let i = 0; i < CFG.stageTicks[1]; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_DISTRICT);
});

test("escalation is not instant — the player has time to read it and choose", () => {
  // D45: the challenge is spatial and temporal. If stage 2 arrived in a handful
  // of ticks the mechanism would be a tax rather than a puzzle.
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  stepAlarms(s, CFG);
  for (let i = 0; i < 100; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL,
    "the alarm escalated within 10 seconds — too fast to be a decision");
  assert.ok(CFG.stageTicks[0] >= 200, "stage 1->2 is tuned faster than 20 seconds");
});

test("the alarm never climbs past the top stage", () => {
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  for (let i = 0; i < CFG.stageTicks[0] + CFG.stageTicks[1] + 2000; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), CFG.maxStage);
});

test("reaching DISTRICT spikes district heat ONCE, not every tick", () => {
  // A site parked at stage 3 must not pin the whole district at max heat for
  // as long as somebody stands there — that would make one mistake permanent.
  //
  // MEASURE THE HEAT, NOT THE EVENT. The first version of this test counted
  // `alarmEscalated` events, which fire once whatever the heat code does — so
  // it passed happily with the once-only guard removed. It asserted something
  // that could not fail. The heat VALUE is the thing the guard protects.
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  const district = s.districts[site.districtId];
  district.heat = 0;

  for (let i = 0; i < CFG.stageTicks[0] + CFG.stageTicks[1] + 500; i++) stepAlarms(s, CFG);

  assert.equal(alarmStageOf(s, site.id), ALARM_DISTRICT, "never reached the district stage");
  assert.equal(district.heat, CFG.districtHeat,
    `district heat is ${district.heat}, expected exactly one spike of ${CFG.districtHeat} — `
    + "a repeated spike pins the district at max heat for as long as anyone stands there");
  assert.ok(district.heat < RULES.detection.heat.max, "one alarm should not max the district");

  // The once-only property comes from the monotonic stage clamp, so exercise
  // that directly: re-raising an alarm that is already at DISTRICT must not
  // spike again. A future trigger (a camera in 8b) will do exactly this.
  raiseAlarm(s, site, CFG, ALARM_DISTRICT, "again");
  raiseAlarm(s, site, CFG, ALARM_DISTRICT, "again");
  assert.equal(district.heat, CFG.districtHeat,
    "re-raising an already-district alarm spiked the heat a second time");
});

// ── Decay: the mistake has to be recoverable ───────────────────────────────

test("breaking away eases the alarm one stage at a time, never straight to clear", () => {
  // An alarm that clears the instant you break line of sight is free to ignore.
  const s = makeWorld();
  const { site, agent } = burnedOnSite(s);
  stepAlarms(s, CFG);
  for (let i = 0; i < CFG.stageTicks[0]; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCKDOWN);

  agent.detection = 0;                                  // no longer burned
  for (let i = 0; i < CFG.calmTicks; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL,
    "lockdown dropped straight to clear — the stages mean nothing if they are skipped downward");

  for (let i = 0; i < CFG.calmTicks; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_CLEAR);
});

test("a cleared alarm leaves the collection entirely", () => {
  // This is what keeps the hash inert for a world that is not in trouble.
  const s = makeWorld();
  const { site, agent } = burnedOnSite(s);
  stepAlarms(s, CFG);
  assert.ok(s.alarms.length >= 1, "nothing was raised to clear");
  agent.detection = 0;
  for (let i = 0; i < CFG.calmTicks * 2; i++) stepAlarms(s, CFG);
  assert.equal(s.alarms.length, 0, "a cleared alarm stayed in the collection and keeps hashing");
  assert.equal(alarmFor(s, site.id), null);
});

test("escalation restarts its clock, so easing then re-triggering is not instant", () => {
  const s = makeWorld();
  const { site, agent } = burnedOnSite(s);
  stepAlarms(s, CFG);
  for (let i = 0; i < CFG.stageTicks[0] - 5; i++) stepAlarms(s, CFG);   // nearly there
  agent.detection = 0;
  for (let i = 0; i < 10; i++) stepAlarms(s, CFG);                      // brief break
  agent.detection = DET_BURNED;
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL,
    "the escalation clock survived a break, so hiding for a moment counts for nothing");
});

// ── Who counts as a trigger ────────────────────────────────────────────────

test("only a BURNED agent triggers an alarm — being noticed is not enough", () => {
  const s = makeWorld();
  const site = s.sites[0];
  const agent = placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  agent.detection = 1;                                   // noticed
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_CLEAR,
    "a glance sealed the building; noticed is not a reason to shut a facility");
});

test("a downed agent stops being a trigger — or the site never reopens", () => {
  // Arrest (S04) already handles a downed agent. Leaving them as a live trigger
  // would pin the site at lockdown indefinitely with nobody able to act.
  const s = makeWorld();
  const { site, agent } = burnedOnSite(s);
  stepAlarms(s, CFG);
  agent.state = 2;                                       // downed
  assert.equal(triggersAt(s, site, CFG).length, 0);
  for (let i = 0; i < CFG.calmTicks * 4; i++) stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_CLEAR, "the site stayed shut around a downed agent");
});

test("an agent inside a building is off the street and triggers nothing", () => {
  const s = makeWorld();
  const { site, agent } = burnedOnSite(s);
  agent.insideBuildingId = 0;
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_CLEAR);
});

test("distance matters: a burn across the map does not shut a facility", () => {
  const s = makeWorld();
  const site = s.sites[0];
  const far = s.sites.find((x) =>
    Math.abs(x.cellX - site.cellX) > CFG.radius * 3
    && Math.abs(x.cellY - site.cellY) > CFG.radius * 3);
  assert.ok(far, "the fixture has no site far enough away to test with");
  const agent = placeAgent(s, { cellX: far.cellX, cellY: far.cellY });
  agent.detection = DET_BURNED;
  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_CLEAR);
  assert.equal(alarmStageOf(s, far.id), ALARM_LOCAL, "the nearby site did not react either");
});

// ── Hash inertness: the reason alarms are their own collection ─────────────

test("a world with no alarms hashes as though site security did not exist", () => {
  // If this fails, every pinned fixture and every battery baseline just became
  // void — which is exactly why alarms are not fields on every site.
  const s = makeWorld();
  assert.equal(s.alarms.length, 0);
  const before = hashState(s);
  s.alarms = [];
  assert.equal(hashState(s), before);
});

test("but an alarm DOES change the hash — inert must not mean invisible", () => {
  // The counterpart to the test above: hash-inert while empty, hashed while not.
  //
  // HOLD THE WORLD CONSTANT. The first version hashed before placing the agent
  // and after raising the alarm, so the hashes differed because the AGENT had
  // moved — it passed with the alarm writer deleted entirely. The only
  // difference between the two states here is the alarm itself.
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  const withoutAlarm = hashState(s);

  stepAlarms(s, CFG);
  assert.equal(alarmStageOf(s, site.id), ALARM_LOCAL);
  assert.notEqual(hashState(s), withoutAlarm, "an alarm is not being hashed at all");

  // And the STAGE must be part of it, not merely the alarm's existence.
  // Two states differing in nothing else: setting the field by hand rather than
  // escalating, because escalating also resets `ticks`, which would change the
  // hash on its own and let a missing stage-write pass unnoticed.
  const local = makeWorld();
  local.alarms.push({ siteId: 3, stage: ALARM_LOCAL, ticks: 7, calm: 0 });
  const lockdown = makeWorld();
  lockdown.alarms.push({ siteId: 3, stage: ALARM_LOCKDOWN, ticks: 7, calm: 0 });
  assert.notEqual(hashState(local), hashState(lockdown),
    "two alarms differing only in STAGE hash identically — the stage is not written");
});

test("alarm state survives a state copy through the reducer", () => {
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  const stepped = tickCollecting(s, apply, 3).state;
  assert.equal(alarmStageOf(stepped, site.id), ALARM_LOCAL,
    "the alarm did not survive copyState — it is missing from the deep copy");
});

// ── The view seam ──────────────────────────────────────────────────────────

test("a Firm is told the alarm only for sites it can SEE", () => {
  // S16: the stealth layer is a fog problem before it is a data problem.
  // Knowing every alarm in the world would hand the player a free map of where
  // every rival Firm is currently working.
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  stepAlarms(s, CFG);

  const far = s.sites.find((x) =>
    Math.abs(x.cellX - site.cellX) > 40 || Math.abs(x.cellY - site.cellY) > 40);
  assert.ok(far, "no distant site to check fog against");
  raiseAlarm(s, far, CFG, ALARM_DISTRICT, "test");

  const view = buildView(s, 0, RULES.detection);
  const seen = view.sites.find((x) => x.id === site.id);
  const unseen = view.sites.find((x) => x.id === far.id);
  assert.equal(seen.alarmStage, ALARM_LOCAL, "the alarm under the agent's nose was not reported");
  assert.equal(unseen.alarmStage, 0,
    "a distant site's alarm crossed the wire — the stealth layer is readable from the socket");
});

test("the view never leaks the escalation clock", () => {
  // Sending ticks-until-lockdown would turn a tense situation into a countdown
  // widget, and hand a scripted client perfect play.
  const s = makeWorld();
  const { site } = burnedOnSite(s);
  stepAlarms(s, CFG);
  const view = buildView(s, 0, RULES.detection);
  const row = view.sites.find((x) => x.id === site.id);
  assert.equal(row.ticks, undefined, "the view carries the alarm's internal tick counter");
  assert.equal(row.calm, undefined, "the view carries the alarm's calm counter");
});

// ── Doctrine ───────────────────────────────────────────────────────────────

test("D6: no alarm event deletes anything", () => {
  const s = makeWorld();
  burnedOnSite(s);
  const { events } = tickCollecting(s, apply, 30);
  const banned = /removed|destroyed|deleted|killed/i;
  for (const e of events) {
    assert.ok(!banned.test(e.type), `alarm path emitted a deletion event: ${e.type}`);
  }
});

test("the alarm radius stays inside citygen's site spacing", () => {
  // FOUND BY A FAILING TEST, and it is a legibility bug rather than a tuning
  // one. At radius 6 against a minSpacing of 5, one burn woke every
  // neighbouring facility at once — so the player could not tell which building
  // had reacted to them, and the alarm read as weather rather than consequence.
  // Asserted here so a future citygen spacing change cannot quietly undo it.
  assert.ok(CFG.radius < RULES.citygen.sites.minSpacing,
    `alarm radius ${CFG.radius} >= site minSpacing ${RULES.citygen.sites.minSpacing}: `
    + "one burn will wake several facilities and nobody can tell which one saw them");
});

test("alarms run in the reducer between perceive and heat", () => {
  // Structural, like the tick-order contract itself: a behavioural probe cannot
  // distinguish the orderings, but running alarms after stepHeat would delay
  // every district spike by a tick and let the same tick's decay cancel it.
  const src = readFileSync(new URL("../engine/reducer.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function applyAdvanceTick"));
  const det = body.indexOf("stepDetection(");
  const alarms = body.indexOf("stepAlarms(");
  const heat = body.indexOf("stepHeat(");
  assert.ok(alarms > det, "alarms run before perception, so they react to last tick's world");
  assert.ok(alarms < heat, "alarms run after heat, so a district spike lands a tick late");
});
