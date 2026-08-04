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
  AGENT_ACTIVE, AGENT_DOWNED, AGENT_HELD,
  FIRM_UNDEPLOYED, FIRM_DEPLOYED, FIRM_EVACUATING,
} from "./state.js";
import { agentCell, districtAt } from "./detection.js";
import { cellToWorld, worldToCellFloor } from "../shared/fixedmath.js";
import { isPassable } from "./terrain.js";
import { tileAt } from "./state.js";

export const EVAC_NONE = 0;
export const EVAC_RUNNING = 1;
export const EVAC_EMERGENCY = 2;

export function createHq(id, firmId, cellX, cellY) {
  return {
    id, firmId, cellX, cellY,
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

export function hqOf(state, firmId) {
  return state.hqs.find((h) => h.firmId === firmId) ?? null;
}

export function withinPerimeter(hq, cellX, cellY, cfg) {
  return Math.abs(hq.cellX - cellX) + Math.abs(hq.cellY - cellY) <= cfg.perimeterRadius;
}

// Drop-in: place the HQ and the Firm's lead agent. The dropship animation is
// presentation only — the engine registers the placement and moves on.
export function dropIn(state, firmId, cellX, cellY, cfg, agentsCfg, ledger = null) {
  const firm = state.firms[firmId];
  if (!firm) return "no_such_firm";
  if (firm.state !== FIRM_UNDEPLOYED) return "already_deployed";
  const t = tileAt(state.map, cellX, cellY);
  if (t < 0 || !isPassable(t)) return "unlandable";
  for (const h of state.hqs) {
    if (Math.abs(h.cellX - cellX) + Math.abs(h.cellY - cellY) < cfg.dropZoneMinClearRadius) {
      return "too_close_to_rival_hq";
    }
  }

  const hq = createHq(state.hqs.length, firmId, cellX, cellY);
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
    agent.x = cellToWorld(cellX);
    agent.y = cellToWorld(cellY);
    agent.targetX = agent.x;
    agent.targetY = agent.y;
    agent.condition = agentsCfg.conditionMax;
    agent.route = [];
    agent.routeIdx = 0;
  }
  state.events.push({
    type: "firmDeployed", firmId, hqId: hq.id, cellX, cellY,
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

export function leadAgent(state, firmId) {
  return state.agents.find((a) => a.firmId === firmId && a.state !== 0) ?? null;
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

  // A downed or captured operative cannot be extracted.
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
