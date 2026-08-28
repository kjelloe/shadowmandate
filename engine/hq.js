// engine/hq.js — Field HQ, drop-in and the evac sequence (S05, D7, D21, D28).
//
// The HQ exists only while its Firm is deployed. Evac winches it away with the
// player, so an offline Firm has no footprint and nothing raidable — the
// session's stakes live entirely inside the deployment.
//
// The cache/bank split is the tension arc: everything earned this deployment
// sits in the HQ cache and is LOST if the HQ falls. Only a clean extraction
// banks it.

import {
  AGENT_ABSENT, AGENT_ACTIVE, AGENT_DOWNED, AGENT_HELD,
  FIRM_UNDEPLOYED, FIRM_DEPLOYED, FIRM_EVACUATING,
} from "./state.js";
import { agentCell, districtAt } from "./detection.js";
import { clearCredentials } from "./access.js";
import { recoveryContractFor } from "./contracts.js";
import { cellToWorld, worldToCellFloor } from "../shared/fixedmath.js";
import { isPassable } from "./terrain.js";
import { tileAt } from "./state.js";
import { BUILDING_SAFEHOUSE } from "./citygen.js";

export const EVAC_NONE = 0;
export const EVAC_RUNNING = 1;
export const EVAC_EMERGENCY = 2;

export function createHq(id, firmId, cellX, cellY, buildingId = -1) {
  return {
    id, firmId, cellX, cellY,
    // Playtest 4: the HQ establishes INSIDE a building — the safehouse the
    // drop snapped to. -1 is the tent fallback for worlds without one.
    buildingId,
    condition: 100,
    cacheResources: 0,
    evacActive: EVAC_NONE,
    evacTicks: 0,
    evacPaused: 0,
    alarmTicks: 0,
    lootTicks: 0,
    lootedBy: -1,
  };
}

// Where a drop request actually lands (playtest 4). The requested cell is a
// neighbourhood pointer; the HQ establishes in the nearest SAFEHOUSE whose
// door is free — not claimed by another Firm's HQ, and not inside a rival
// HQ's clear radius. This function is the single home of that rule: the
// reducer lands with it and anything scoring drop zones must read the same
// function, because a landing rule the AI does not know is a rule nobody
// follows (the 8f lesson). Falls back to the requested cell (tent in the
// open) only when no safehouse qualifies.
export function hqLandingFor(state, cellX, cellY, cfg) {
  const claimed = new Set(state.hqs.map((h) => h.buildingId));
  // The district of the ground the player actually asked for. -1 (no district
  // map, or a cell outside every district) disables the constraint rather than
  // refusing to land — a landing rule must never be able to make a drop
  // impossible.
  const districtOf = (x, y) => (state.districtOwner
    ? (state.districtOwner[y * state.size + x] ?? -1) : -1);
  const homeDistrict = districtOf(cellX, cellY);
  // Prefer a door that is ALSO clear of patrols and cameras — findDropZones has
  // always guaranteed that for the request, and the landing must not give it
  // back. Playtest 5 reproduced the failure: the snap landed an agent on a door
  // with a patrol at distance 1 and the operative was BURNED during the drop
  // cinematic, before the player ever had control.
  //
  // THE FALLBACK ORDER CHANGED WITH Q50. It used to be "clear door, else ANY
  // free door in the world", on the reasoning that landing near a patrol beats
  // refusing to land. Once the search is confined to one district that reasoning
  // stops holding, because there is now a third option that is strictly better
  // than a watched door: the TENT, on the requested cell, which findDropZones
  // has already certified clear of patrols and cameras. So an unclear door is
  // the LAST resort, taken only when the requested ground itself is unusable.
  // Being burned before you have control is the thing playtest 5 ruled out; not
  // having a roof is merely a worse deployment.
  for (const requirePatrolClear of [true]) {
    let best = null, bestD = Infinity;
    for (const b of state.buildings) {
      if (b.kind !== BUILDING_SAFEHOUSE || claimed.has(b.id)) continue;
      let clear = true;
      for (const h of state.hqs) {
        if (Math.abs(h.cellX - b.entranceX) + Math.abs(h.cellY - b.entranceY)
          < cfg.dropZoneMinClearRadius) { clear = false; break; }
      }
      if (clear && requirePatrolClear) {
        for (const p of state.patrols) {
          if (Math.abs(p.x - b.entranceX) + Math.abs(p.y - b.entranceY)
            < cfg.dropZoneMinClearRadius) { clear = false; break; }
        }
        // Cameras feed detection just like patrols do (playtest 8: a camera
        // six cells from the door noticed the operative at tick 80, while
        // they stood at spawn reading the intro). A door inside an active
        // camera's range is not a clear door. Chebyshev, matching how camera
        // coverage itself is measured.
        if (clear) {
          for (const c of state.cameras ?? []) {
            if (c.disabled) continue;
            const dist = Math.max(Math.abs(c.cellX - b.entranceX), Math.abs(c.cellY - b.entranceY));
            if (dist <= (c.range | 0)) { clear = false; break; }
          }
        }
      }
      if (!clear) continue;
      // SAME DISTRICT, always (Q50, ruled 2026-08-28). This search used to have
      // no constraint at all, so a district with no free safehouse relocated the
      // Field HQ to wherever the nearest one happened to be — on seed 4711,
      // choosing Industrial in the drop picker deployed you 46 cells away in the
      // RESIDENTIAL district, and 62% of all drops landed somewhere the player
      // had not chosen. The picker technically showed it (it draws the predicted
      // landing), but "you picked Industrial and started in Residential" is the
      // D56 honesty gap the playtest-10 fix closed, reopened from underneath.
      //
      // A DISTANCE BOUND WAS THE WRONG TOOL and the measurements said so: no
      // radius drove the wrong-district rate below about 4%, because a drop near
      // a border legitimately has a nearer safehouse across the line. Matching
      // the district makes it exactly zero by construction rather than
      // statistically — the promise the picker makes is about the district, so
      // that is the thing to check. The radius survives as a secondary comfort
      // bound on how far you walk WITHIN your own district.
      if (homeDistrict >= 0 && districtOf(b.entranceX, b.entranceY) !== homeDistrict) continue;
      const d = Math.abs(b.entranceX - cellX) + Math.abs(b.entranceY - cellY);
      if (d > (cfg.landingSearchRadius ?? 9999)) continue;
      // Strict < resolves ties to the lowest building id — deterministic.
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) return { cellX: best.entranceX, cellY: best.entranceY, buildingId: best.id };
  }
  // No free safehouse in this district: pitch the tent where the player asked.
  // That is honest — they chose this ground — and it is why safehouse density
  // was raised in the same ruling, so the fallback stays uncommon.
  return { cellX, cellY, buildingId: -1 };
}

export function hqOf(state, firmId) {
  return state.hqs.find((h) => h.firmId === firmId) ?? null;
}

export function withinPerimeter(hq, cellX, cellY, cfg) {
  return Math.abs(hq.cellX - cellX) + Math.abs(hq.cellY - cellY) <= cfg.perimeterRadius;
}

// Drop-in: place the HQ and the Firm's lead agent. The dropship animation is
// presentation only — the engine registers the placement and moves on.
// The requested cell is validated as the player's INTENT (a garbage request
// must still be refused loudly), then the landing snaps to a safehouse via
// hqLandingFor — the Field HQ lives in a building now (playtest 4).
export function dropIn(state, firmId, cellX, cellY, cfg, agentsCfg, ledger = null) {
  const firm = state.firms[firmId];
  if (!firm) return "no_such_firm";
  if (firm.state !== FIRM_UNDEPLOYED) return "already_deployed";
  const t = tileAt(state.map, cellX, cellY);
  if (t < 0 || !isPassable(t)) return "unlandable";
  const landing = hqLandingFor(state, cellX, cellY, cfg);
  // The proximity check re-runs on the landing: hqLandingFor already filters
  // safehouses, so this only ever fires on the tent fallback — but the
  // fallback is exactly where the old failure lives.
  for (const h of state.hqs) {
    if (Math.abs(h.cellX - landing.cellX) + Math.abs(h.cellY - landing.cellY)
      < cfg.dropZoneMinClearRadius) {
      return "too_close_to_rival_hq";
    }
  }

  const hq = createHq(state.hqs.length, firmId, landing.cellX, landing.cellY, landing.buildingId);
  state.hqs.push(hq);
  firm.hqId = hq.id;
  firm.state = FIRM_DEPLOYED;
  firm.cacheResources = 0;

  // The ledger (D3/D7) is the only thing that survived the last extraction.
  if (ledger) {
    firm.reputation = ledger.reputation | 0;
    firm.recognition = ledger.recognition | 0;
    firm.tierUnlocked = Math.max(1, ledger.tierUnlocked | 0);
  }

  // The lead agent lands with the HQ.
  const agent = state.agents.find((a) => a.state === 0);
  if (agent) {
    agent.state = AGENT_ACTIVE;
    agent.firmId = firmId;
    agent.x = cellToWorld(landing.cellX);
    agent.y = cellToWorld(landing.cellY);
    agent.targetX = agent.x;
    agent.targetY = agent.y;
    agent.condition = agentsCfg.conditionMax;
    agent.route = [];
    agent.routeIdx = 0;
  }
  // D51: anyone this Firm left in custody becomes a job waiting on arrival.
  offerRecoveries(state, firmId, state.rules?.contracts);
  state.events.push({
    type: "firmDeployed", firmId, hqId: hq.id,
    cellX: landing.cellX, cellY: landing.cellY, buildingId: landing.buildingId,
    agentId: agent ? agent.id : -1,
  });
  return null;
}

// D28: activation is ALWAYS allowed, even with a rival inside the perimeter.
// The hold is the fight.
export function activateEvac(state, firmId, cfg) {
  const hq = hqOf(state, firmId);
  if (!hq) return "no_hq";
  if (hq.evacActive !== EVAC_NONE) return "already_evacuating";
  const firm = state.firms[firmId];
  const lead = leadAgent(state, firmId);

  // D51: FOLDING WITH NOBODY LEFT. If every operative this Firm has is in
  // custody there is no one to stand in the perimeter, and both guards below
  // would refuse — which is exactly how a captured Firm became permanently
  // stuck: it could not work and could not leave. Folding up is allowed, the
  // prisoner stays in the Holding Site, and a recovery contract is waiting on
  // the next drop-in. This is safe only because `leadAgent` excludes prisoners:
  // the redeploy lands a FRESH operative rather than the one still in custody.
  if (!lead && abandonedAgents(state, firmId).length > 0) {
    hq.evacActive = EVAC_RUNNING;
    hq.evacTicks = cfg.evacHoldTicks;
    hq.evacPaused = 0;
    firm.state = FIRM_EVACUATING;
    state.events.push({ type: "evacStarted", firmId, ticks: hq.evacTicks, abandoning: 1 });
    return null;
  }
  if (!lead) return "no_agent";
  if (lead.state !== AGENT_ACTIVE) return "agent_not_active";
  const cell = agentCell(lead);
  if (!withinPerimeter(hq, cell.x, cell.y, cfg)) return "not_at_hq";

  hq.evacActive = EVAC_RUNNING;
  hq.evacTicks = cfg.evacHoldTicks;
  hq.evacPaused = 0;
  firm.state = FIRM_EVACUATING;
  state.events.push({ type: "evacStarted", firmId, ticks: hq.evacTicks });
  return null;
}

export function cancelEvac(state, firmId) {
  const hq = hqOf(state, firmId);
  if (!hq || hq.evacActive === EVAC_NONE) return "not_evacuating";
  hq.evacActive = EVAC_NONE;
  hq.evacTicks = 0;
  hq.evacPaused = 0;
  state.firms[firmId].state = FIRM_DEPLOYED;
  state.events.push({ type: "evacCancelled", firmId });
  return null;
}

// The Firm's operative IN THE FIELD. A held agent is deliberately excluded
// (D51): they are in a Holding Site, they cannot act, and treating them as the
// lead made a Firm redeploy onto its own prisoner and fold again immediately —
// 18 extractions in one world-day before this rule was written down. Bail and
// the recovery contract address a held agent by id, never through this.
export function leadAgent(state, firmId) {
  return state.agents.find((a) =>
    a.firmId === firmId && a.state !== AGENT_ABSENT && a.state !== AGENT_HELD) ?? null;
}

// Everyone this Firm has left behind (D51). A debt, not a loss.
export function abandonedAgents(state, firmId) {
  return state.agents.filter((a) => a.firmId === firmId && a.state === AGENT_HELD);
}

// Emergency evac (S05): the HQ is gone; reach a safe zone before the clock runs
// out. The cache is already lost — what is left to save is the operative.
function startEmergencyEvac(state, hq, cfg) {
  hq.evacActive = EVAC_EMERGENCY;
  hq.evacTicks = cfg.emergencyReachTicks;
  state.firms[hq.firmId].state = FIRM_EVACUATING;
  state.events.push({ type: "emergencyEvac", firmId: hq.firmId, ticks: hq.evacTicks });
}

// One tick of every HQ: perimeter alarms, raid looting, and the evac clock.
export function stepHqs(state, cfg) {
  for (const hq of state.hqs) {
    stepPerimeter(state, hq, cfg);
    stepEvac(state, hq, cfg);
  }
}

function stepPerimeter(state, hq, cfg) {
  let intruder = null;
  let ownerPresent = false;
  for (const agent of state.agents) {
    if (agent.state !== AGENT_ACTIVE && agent.state !== AGENT_DOWNED) continue;
    if (agent.insideBuildingId >= 0) continue;
    const cell = agentCell(agent);
    if (!withinPerimeter(hq, cell.x, cell.y, cfg)) continue;
    if (agent.firmId === hq.firmId) ownerPresent = true;
    else if (agent.state === AGENT_ACTIVE) intruder = agent;
  }

  if (intruder) {
    if (hq.alarmTicks === 0) {
      // D21: the alarm reaches the owner wherever they are on the map — the
      // countdown is what makes the race home winnable.
      state.events.push({
        type: "perimeterAlarm", firmId: hq.firmId, hqId: hq.id,
        byFirmId: intruder.firmId,
      });
    }
    hq.alarmTicks = (hq.alarmTicks + 1) | 0;

    const cell = agentCell(intruder);
    const atTent = cell.x === hq.cellX && cell.y === hq.cellY;
    if (atTent) {
      hq.lootTicks = (hq.lootTicks + 1) | 0;
      if (hq.lootTicks >= cfg.lootTicks && hq.cacheResources > 0) {
        const taken = hq.cacheResources;
        hq.cacheResources = 0;
        hq.lootedBy = intruder.firmId;
        // Reset the dwell. Without this the timer stays past its threshold and
        // the tent is emptied on EVERY subsequent tick the owner has anything
        // in it — invisible while raids were rare accidents, pathological once
        // 8i started parking a raider on the tent for a scheduled window.
        hq.lootTicks = 0;
        const raider = state.firms[intruder.firmId];
        const raiderHq = hqOf(state, intruder.firmId);
        if (raiderHq) raiderHq.cacheResources += taken;
        else if (raider) raider.cacheResources += taken;
        state.events.push({
          type: "cacheLooted", firmId: hq.firmId, byFirmId: intruder.firmId, amount: taken,
        });
      }
    } else {
      hq.lootTicks = 0;
    }
  } else {
    hq.alarmTicks = 0;
    hq.lootTicks = 0;
  }
}

function stepEvac(state, hq, cfg) {
  if (hq.evacActive === EVAC_NONE) return;
  const firm = state.firms[hq.firmId];
  const lead = leadAgent(state, hq.firmId);

  if (hq.evacActive === EVAC_EMERGENCY) {
    hq.evacTicks -= 1;
    if (hq.evacTicks <= 0) {
      state.events.push({ type: "evacTimedOut", firmId: hq.firmId });
      hq.evacActive = EVAC_NONE;
      firm.state = FIRM_DEPLOYED;
    }
    return;
  }

  // D51: FOLDING WITH EVERYONE IN CUSTODY. Nobody can hold the perimeter, so
  // the clock simply runs and the Firm goes home without them. Checked before
  // the cancel below — that cancel is for a Firm that loses its operative
  // mid-evac and should stand down to go and get them, which is a different
  // situation from having nobody left to get.
  if (!lead && abandonedAgents(state, hq.firmId).length > 0) {
    hq.evacPaused = 0;
    hq.evacTicks -= 1;
    if (hq.evacTicks <= 0) state.events.push({ type: "evacReady", firmId: hq.firmId });
    return;
  }

  // A downed operative cannot be extracted — they are in the street and can
  // still be rescued, so the beacon stands down and you go and get them.
  if (!lead || lead.state === AGENT_DOWNED || lead.state === AGENT_HELD) {
    hq.evacActive = EVAC_NONE;
    hq.evacTicks = 0;
    firm.state = FIRM_DEPLOYED;
    state.events.push({ type: "evacCancelled", firmId: hq.firmId, reason: "agent_down" });
    return;
  }

  const cell = agentCell(lead);
  const inside = withinPerimeter(hq, cell.x, cell.y, cfg);
  if (!inside) {
    if (!hq.evacPaused) {
      hq.evacPaused = 1;
      state.events.push({ type: "evacPaused", firmId: hq.firmId });
    }
    return;
  }
  if (hq.evacPaused) {
    hq.evacPaused = 0;
    state.events.push({ type: "evacResumed", firmId: hq.firmId });
  }

  hq.evacTicks -= 1;
  if (hq.evacTicks <= 0) {
    state.events.push({ type: "evacReady", firmId: hq.firmId });
  }
}

// Extraction: the dropship lands, the HQ folds up, the cache banks.
// This is the ONLY path by which resources become permanent (D7/D30).
// D51: the debt follows you to the next deployment. Called from dropIn so a
// Firm that left somebody behind finds the job waiting the moment it lands.
export function offerRecoveries(state, firmId, contractsCfg) {
  if (!contractsCfg) return 0;
  let made = 0;
  for (const held of abandonedAgents(state, firmId)) {
    if (recoveryContractFor(state, firmId, contractsCfg, held)) made++;
  }
  return made;
}

export function extract(state, firmId, cfg) {
  const hq = hqOf(state, firmId);
  const firm = state.firms[firmId];
  if (!hq || !firm) return { error: "no_hq" };
  const emergency = hq.evacActive === EVAC_EMERGENCY;
  if (hq.evacActive === EVAC_NONE) return { error: "not_evacuating" };
  if (!emergency && hq.evacTicks > 0) return { error: "evac_not_ready" };

  const banked = emergency ? 0 : hq.cacheResources;
  const lead = leadAgent(state, firmId);

  const debrief = {
    firmId,
    banked,
    recognition: firm.recognition,
    reputationDelta: emergency ? cfg.reputation.emergencyEvac : cfg.reputation.cleanExtract,
    hqIntact: emergency ? 0 : 1,
    tierUnlocked: firm.tierUnlocked,
  };
  firm.reputation = (firm.reputation + debrief.reputationDelta) | 0;

  // The agent and the HQ both leave the world.
  if (lead) {
    // S16 8e: credentials are per-SORTIE. They leave with the agent, so next
    // time you want the tier-2 door you go and get another pass — which keeps
    // them a thing you plan around rather than a permanent unlock.
    clearCredentials(state, lead.id);
    lead.state = 0;
    lead.firmId = -1;
    lead.route = [];
    lead.routeIdx = 0;
    lead.contractIds = [];
    lead.carryKind = 0;
    lead.carryRef = -1;
  }
  state.hqs = state.hqs.filter((h) => h.id !== hq.id);
  firm.state = FIRM_UNDEPLOYED;
  firm.hqId = -1;
  firm.cacheResources = 0;

  state.events.push({ type: "firmExtracted", firmId, banked, emergency: emergency ? 1 : 0 });
  return { debrief };
}

// The HQ is destroyed (raid or Firm War). The owner must run for a safe zone.
export function destroyHq(state, hq, cfg) {
  hq.condition = 0;
  hq.cacheResources = 0;
  state.events.push({ type: "hqDestroyed", firmId: hq.firmId, hqId: hq.id });
  startEmergencyEvac(state, hq, cfg);
}

// A safe zone for emergency extraction: any map edge, or a neutral site.
export function atSafeZone(state, agent) {
  const cell = agentCell(agent);
  return cell.x <= 1 || cell.y <= 1 || cell.x >= state.size - 2 || cell.y >= state.size - 2;
}
