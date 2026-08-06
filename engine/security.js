// engine/security.js — site alarms (S16, D44/D45; M8 slice 8a).
//
// THE FIRST PIECE OF OPPOSITION. D42 ruled that extraction and acquisition are
// under-opposed rather than mispriced, and this is where that difficulty starts:
// a facility that NOTICES you, and keeps noticing harder while you stay.
//
// WHY STAGED, not instant-fail. An alarm that ends the contract makes the
// correct play "reload", and there is no reload in a persistent shared world.
// Staged alarms turn a mistake into a worsening situation the player is still
// inside — which is the tension the game is for, and which is also what fills
// the D11 sortie minutes that D41 says must come from content rather than from
// slower walking.
//
// WHY NO SENSORS YET. This slice deliberately ships the escalation with no new
// way to trigger it: alarms are raised from the burn events detection ALREADY
// emits. That makes the state machine testable before anything can raise it,
// and means 8b/8c (cameras, sensor lines) add a trigger to a machine that is
// already proven rather than both at once.
//
// HASH-INERT BY CONSTRUCTION. Alarms live in their own collection rather than
// as fields on every site, so a world with no alarms writes no alarm bytes and
// hashes exactly as it did before this file existed — no fixture re-pin, and no
// era bump. `test/fixture_populated.test.js` is what stops that from becoming a
// blind spot: a hash-inert collection is only covered while it is non-empty.
//
// ACYCLIC. This module reads events detection already emitted and calls
// raiseHeat; detection does not know it exists. Same shape as the burn->contract
// attribution in the reducer (specs/02).

import { agentCell, districtAt, raiseHeat } from "./detection.js";
import { beamLiveAt, beamCoversCell } from "./sensors.js";

export const ALARM_CLEAR = 0;
export const ALARM_LOCAL = 1;      // nearby guards would converge (8b+)
export const ALARM_LOCKDOWN = 2;   // doors seal; the work timer keeps running
export const ALARM_DISTRICT = 3;   // checkpoints, and a heat spike

export const AGENT_ACTIVE = 1;
const DET_BURNED = 2;

// Chebyshev distance in cells: movement is 8-connected, so a radius measured
// this way is the ring the player can actually walk, not a circle that lies
// about the corners.
function withinCells(ax, ay, bx, by, radius) {
  return Math.abs(ax - bx) <= radius && Math.abs(ay - by) <= radius;
}

export function alarmFor(state, siteId) {
  return state.alarms.find((a) => a.siteId === siteId) ?? null;
}

export function alarmStageOf(state, siteId) {
  return alarmFor(state, siteId)?.stage ?? ALARM_CLEAR;
}

// Anyone burned and standing near the site is a live trigger. Deliberately
// simple and deliberately EXPLICIT about who counts:
//   - burned only. A noticed agent has not given the site a reason to shut.
//   - active only. A downed agent is already handled by arrest (S04), and
//     leaving them as a trigger would pin a site at lockdown forever.
//   - not inside a building: off the street is out of sight (S03 does the same).
export function triggersAt(state, site, cfg) {
  const radius = cfg.radius | 0;
  const out = [];
  for (const agent of state.agents) {
    if (agent.state !== AGENT_ACTIVE) continue;
    if (agent.detection !== DET_BURNED) continue;
    if (agent.insideBuildingId >= 0) continue;
    const cell = agentCell(agent);
    if (withinCells(cell.x, cell.y, site.cellX, site.cellY, radius)) out.push(agent);
  }
  return out;
}

function ensureAlarm(state, site) {
  let alarm = alarmFor(state, site.id);
  if (!alarm) {
    alarm = { siteId: site.id, stage: ALARM_CLEAR, ticks: 0, calm: 0 };
    state.alarms.push(alarm);
  }
  return alarm;
}

// Escalation is a step, and every step is an EVENT. The client can only show
// what it is told, and an alarm that climbs silently is exactly the kind of
// invisible difficulty D45 forbids.
function setStage(state, alarm, stage, cfg, reason) {
  const before = alarm.stage;
  if (stage === before) return;
  alarm.stage = stage;
  alarm.ticks = 0;
  alarm.calm = 0;
  if (stage > before) {
    state.events.push({
      type: before === ALARM_CLEAR ? "alarmRaised" : "alarmEscalated",
      siteId: alarm.siteId, stage, from: before, reason,
    });
  } else {
    state.events.push({
      type: stage === ALARM_CLEAR ? "alarmCleared" : "alarmEased",
      siteId: alarm.siteId, stage, from: before,
    });
  }
}

// Raise a site's alarm to at least `stage`. Exported so a future trigger (a
// camera in 8b, a crossed sensor line in 8c) raises alarms through the same
// door rather than reaching into the collection itself.
export function raiseAlarm(state, site, cfg, stage = ALARM_LOCAL, reason = "seen") {
  if (!site) return null;
  const alarm = ensureAlarm(state, site);
  const target = Math.min(cfg.maxStage | 0, Math.max(alarm.stage, stage | 0));
  if (target > alarm.stage) applyStage(state, alarm, site, target, cfg, reason);
  return alarm;
}

// Reaching DISTRICT spikes the district's heat — the local problem becoming a
// global one. Done here rather than by detection.
//
// It fires ONCE because `applyStage` is only ever reached on a stage INCREASE
// (see the `target > alarm.stage` clamp in raiseAlarm, and the `stage < maxStage`
// check in stepAlarms). That single monotonic guard is what stops a site parked
// at stage 3 from pinning the whole district at max heat for as long as an agent
// stands there. An earlier version also carried a `!wasDistrict` check here; it
// was unreachable, and a mutation test proved it — removed rather than left as
// defensive-looking code that no test can hold to account.
function applyStage(state, alarm, site, stage, cfg, reason) {
  setStage(state, alarm, stage, cfg, reason);
  if (stage >= ALARM_DISTRICT) {
    const districtId = site.districtId >= 0
      ? site.districtId : districtAt(state, site.cellX, site.cellY);
    if (districtId >= 0) {
      raiseHeat(state, districtId, cfg.districtHeat | 0, state.rules.detection);
    }
  }
}

// One tick of every live alarm, plus a raise for any site that has a burned
// agent standing on it.
export function stepAlarms(state, cfg) {
  if (!cfg) return;

  // Raise first, so a site that gained a trigger this tick starts its clock now
  // rather than a tick late — the escalation windows are tuned in whole
  // seconds and an off-by-one-per-stage would drift them visibly.
  const siteById = new Map(state.sites.map((s) => [s.id, s]));
  for (const site of state.sites) {
    if (triggersAt(state, site, cfg).length > 0) {
      raiseAlarm(state, site, cfg, ALARM_LOCAL, "burned");
    }
  }

  // 8b: a camera that saw someone raises ITS OWN site's alarm, whatever the
  // agent's detection state. This is the difference between a facility and a
  // street — a patrol seeing you is a person noticing; a camera seeing you is
  // the building noticing, and the building acts on it immediately. Read from
  // the events detection just emitted rather than by importing the camera
  // module, keeping the module graph acyclic.
  for (const e of state.events) {
    if (e.type !== "agentNoticed" || (e.cameraId ?? -1) < 0) continue;
    const site = siteById.get(e.siteId);
    if (site) raiseAlarm(state, site, cfg, ALARM_LOCAL, "camera");
  }

  // 8c: a LIVE beam that an active agent is standing in trips the facility.
  //
  // A beam knows only that something crossed it, so it raises the alarm and
  // deliberately does NOT touch the agent's detection state: you can trip a
  // beam and still be unseen. That is the decision the mechanism exists to
  // create — trip it and hurry, or wait for the gap.
  for (const beam of state.beams ?? []) {
    if (!beamLiveAt(beam, state.tick)) continue;
    const site = siteById.get(beam.siteId);
    if (!site) continue;
    for (const agent of state.agents) {
      if (agent.state !== AGENT_ACTIVE || agent.insideBuildingId >= 0) continue;
      const cell = agentCell(agent);
      if (!beamCoversCell(beam, cell.x, cell.y)) continue;
      raiseAlarm(state, site, cfg, ALARM_LOCAL, "beam");
      // Announced, because a tripped beam the player cannot perceive is an
      // unfair mechanism: the client needs something to show and to sound.
      state.events.push({
        type: "beamTripped", beamId: beam.id, siteId: site.id, agentId: agent.id,
      });
      break;     // one trip per beam per tick; the alarm is already raised
    }
  }

  for (const alarm of state.alarms) {
    const site = siteById.get(alarm.siteId);
    if (!site) continue;
    const live = triggersAt(state, site, cfg).length > 0;

    if (live) {
      alarm.calm = 0;
      alarm.ticks = (alarm.ticks + 1) | 0;
      // stageTicks is indexed by the stage being LEFT: [1->2, 2->3]. A stage
      // with no entry (the top one) simply never escalates.
      const need = cfg.stageTicks[alarm.stage - 1];
      if (alarm.stage < (cfg.maxStage | 0) && need !== undefined && alarm.ticks >= need) {
        applyStage(state, alarm, site, alarm.stage + 1, cfg, "sustained");
      }
    } else {
      alarm.ticks = 0;
      alarm.calm = (alarm.calm + 1) | 0;
      if (alarm.calm >= (cfg.calmTicks | 0)) {
        // Step DOWN one stage rather than clearing outright. A site that goes
        // from district lockdown to unlocked the instant you break line of
        // sight would make the whole mechanism free to ignore.
        setStage(state, alarm, alarm.stage - 1, cfg, "calm");
      }
    }
  }

  // Cleared alarms leave the collection, which is what keeps the hash inert for
  // a world that is not currently in trouble.
  for (let i = state.alarms.length - 1; i >= 0; i--) {
    if (state.alarms[i].stage <= ALARM_CLEAR) state.alarms.splice(i, 1);
  }
}

// ── Junction boxes (8d) — the counter-play ─────────────────────────────────
//
// D45 in one mechanism: the answer to a camera is not a lock-picking widget, it
// is walking to the junction box and cutting it, in the world, in time.
//
// THE TRADE is the whole design. Cutting power is FREE in stealth terms — it
// makes no noise, it does not burn you — but the blackout itself is noticed, so
// it raises district heat. You swap a local problem for a global one, which is
// a real decision rather than a free win. Without that cost the correct play
// would always be "cut everything first", and the stealth layer would collapse
// into an errand.

export function junctionAt(state, junctionId) {
  return (state.junctions ?? []).find((j) => j.id === junctionId) ?? null;
}

// Cut a junction: blacks out every camera and beam belonging to the same site.
// Returns a reason string on refusal so the client can say WHY — a control that
// silently does nothing is the defect playtest 1 shipped.
export function cutJunction(state, agent, junctionId, cfg, detCfg) {
  const junction = junctionAt(state, junctionId);
  if (!junction) return { ok: false, reason: "no_junction" };
  if (!agent || agent.state !== AGENT_ACTIVE) return { ok: false, reason: "not_active" };
  const cell = agentCell(agent);
  // You must be AT it. Cutting power from across the street would remove the
  // "reach it unseen" half of the puzzle, which is the half that is interesting.
  if (Math.abs(cell.x - junction.cellX) + Math.abs(cell.y - junction.cellY) > 1) {
    return { ok: false, reason: "not_adjacent" };
  }
  if ((junction.cutUntil | 0) > state.tick) return { ok: false, reason: "already_cut" };

  const until = (state.tick + (cfg.blackoutTicks | 0)) | 0;
  junction.cutUntil = until;
  let blacked = 0;
  for (const cam of state.cameras ?? []) {
    if (cam.siteId !== junction.siteId) continue;
    cam.disabledUntil = Math.max(cam.disabledUntil | 0, until);
    blacked++;
  }
  for (const beam of state.beams ?? []) {
    if (beam.siteId !== junction.siteId) continue;
    beam.disabledUntil = Math.max(beam.disabledUntil | 0, until);
    blacked++;
  }
  // The cost: somebody notices the lights go out.
  const districtId = junction.districtId >= 0
    ? junction.districtId : districtAt(state, junction.cellX, junction.cellY);
  if (districtId >= 0 && detCfg) {
    raiseHeat(state, districtId, cfg.districtHeat | 0, detCfg);
  }
  state.events.push({
    type: "junctionCut", junctionId, siteId: junction.siteId,
    agentId: agent.id, until, blacked,
  });
  return { ok: true, until, blacked };
}

// Placement: one box per guarded site, set apart from both the site and its
// fixtures so reaching it is its own small problem.
export function placeJunctions(sites, guardedSiteIds, rng, cfg, roll, size = 0) {
  const junctions = [];
  if (!cfg || (cfg.offset | 0) <= 0) return junctions;
  const offset = cfg.offset | 0;
  for (const site of sites) {
    if (!guardedSiteIds.has(site.id)) continue;   // nothing to switch off
    const dir = roll(rng, 0, 3);
    const dx = dir === 0 ? offset : dir === 1 ? -offset : 0;
    const dy = dir === 2 ? offset : dir === 3 ? -offset : 0;
    const cellX = site.cellX + dx, cellY = site.cellY + dy;
    if (size > 0 && (cellX < 0 || cellY < 0 || cellX >= size || cellY >= size)) continue;
    junctions.push({
      id: junctions.length, siteId: site.id, districtId: site.districtId,
      cellX, cellY, cutUntil: 0,
    });
  }
  return junctions;
}
