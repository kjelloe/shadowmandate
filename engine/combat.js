// engine/combat.js — disable-only combat, downed state and capture (S04, D6).
//
// THE DOCTRINE: nothing is ever deleted. Agents are downed, they crawl, and
// they are rescued or captured. NPCs are subdued and wake later. There is no
// kill, no corpse, no removal — and test/guards.test.js enforces that no such
// event can be introduced.

import {
  AGENT_ACTIVE, AGENT_DOWNED, AGENT_HELD, DET_BURNED, DET_UNSEEN,
} from "./state.js";
import { agentCell, burnAgent, districtAt, raiseHeat } from "./detection.js";
import { worldToCellFloor, cellToWorld } from "../shared/fixedmath.js";

export const ITEM_SUPPRESSOR = 0;
export const ITEM_DISRUPTOR = 1;
export const ITEM_SIDEARM = 2;

function manhattanCells(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Damage lands as condition loss. When condition reaches zero the agent goes
// down — it does not die, and the distinction is the whole game's tone.
export function damageAgent(state, target, amount, cfg, detCfg) {
  if (target.state !== AGENT_ACTIVE) return;
  target.condition = Math.max(0, target.condition - amount);
  state.events.push({ type: "agentHurt", agentId: target.id, condition: target.condition });
  if (target.condition === 0) downAgent(state, target, detCfg);
}

export function downAgent(state, target, detCfg) {
  if (target.state !== AGENT_ACTIVE) return;
  target.state = AGENT_DOWNED;
  target.downTicks = 0;
  target.route = [];
  target.routeIdx = 0;
  // A downed agent drops whatever it was carrying, where it falls.
  if (target.carryKind !== 0) {
    state.events.push({
      type: "carryDropped", agentId: target.id, kind: target.carryKind,
      cellX: worldToCellFloor(target.x), cellY: worldToCellFloor(target.y),
    });
    target.carryKind = 0;
    target.carryRef = -1;
  }
  state.events.push({ type: "agentDowned", agentId: target.id, firmId: target.firmId });
}

// Rescue: a friendly agent brings a downed one back to its feet.
export function rescueAgent(state, rescuer, target, cfg) {
  if (target.state !== AGENT_DOWNED) return "not_downed";
  if (rescuer.firmId !== target.firmId) return "not_friendly";
  if (manhattanCells(agentCell(rescuer), agentCell(target)) > 1) return "not_adjacent";
  target.state = AGENT_ACTIVE;
  target.condition = Math.max(1, Math.trunc(cfg.conditionMax / 3));
  target.downTicks = 0;
  state.events.push({ type: "agentRescued", agentId: target.id, byAgentId: rescuer.id });
  return null;
}

// Capture: any rival agent (or an Authority patrol, D27) can take a downed
// agent to a Holding Site. Being held is a state, not an ending.
export function captureAgent(state, target, byFirmId, detCfg, cfg) {
  if (target.state !== AGENT_DOWNED) return "not_downed";
  const cell = agentCell(target);
  const districtId = districtAt(state, cell.x, cell.y);
  let site = state.holdingSites.find((h) => h.districtId === districtId);
  if (!site) site = state.holdingSites[0];
  if (!site) return "no_holding_site";
  target.state = AGENT_HELD;
  target.holdingSiteId = site.id;
  target.x = cellToWorld(site.cellX);
  target.y = cellToWorld(site.cellY);
  target.detection = DET_UNSEEN;
  target.condition = Math.trunc(cfg.conditionMax / 4);
  if (!site.heldAgentIds.includes(target.id)) site.heldAgentIds.push(target.id);
  state.events.push({
    type: "agentCaptured", agentId: target.id, firmId: target.firmId,
    byFirmId, holdingSiteId: site.id,
  });
  return null;
}

// Free a held agent — the Extraction contract's payoff, and what bail buys.
export function releaseAgent(state, agent, cfg, atCellX, atCellY) {
  if (agent.state !== AGENT_HELD) return "not_held";
  const site = state.holdingSites.find((h) => h.id === agent.holdingSiteId);
  if (site) site.heldAgentIds = site.heldAgentIds.filter((id) => id !== agent.id);
  agent.holdingSiteId = -1;
  agent.state = AGENT_ACTIVE;
  agent.condition = Math.trunc(cfg.conditionMax / 2);
  if (atCellX >= 0) { agent.x = cellToWorld(atCellX); agent.y = cellToWorld(atCellY); }
  state.events.push({ type: "agentReleased", agentId: agent.id, firmId: agent.firmId });
  return null;
}

// Using a primary. The suppressor is the stealth tool — silent, but it fails
// loudly if the target can see it coming (D6/S04).
export function useItem(state, actor, slot, targetCellX, targetCellY, combatCfg, detCfg, agentsCfg) {
  const here = agentCell(actor);
  const target = { x: targetCellX, y: targetCellY };
  const dist = manhattanCells(here, target);
  const districtId = districtAt(state, here.x, here.y);

  if (slot === ITEM_SUPPRESSOR) {
    const spec = combatCfg.items.suppressor;
    if (dist > spec.range) return "out_of_range";
    const victim = agentAtCell(state, targetCellX, targetCellY, actor.id);
    if (!victim) return "no_target";
    if (spec.requiresUnobserved && actor.detection === DET_BURNED) {
      // Seen coming: the attempt fails and gives you away completely.
      burnAgent(state, actor, detCfg, districtId);
      state.events.push({ type: "subdueFailed", agentId: actor.id, targetAgentId: victim.id });
      return null;
    }
    downAgent(state, victim, detCfg);
    state.events.push({ type: "agentSubdued", agentId: victim.id, byAgentId: actor.id });
    return null;
  }

  if (slot === ITEM_DISRUPTOR) {
    const spec = combatCfg.items.disruptor;
    if (dist > spec.range) return "out_of_range";
    // Disables patrol perception locally: the patrol loses its alert and
    // stands down for a while. Cheap, quiet, and buys a window.
    for (const p of state.patrols) {
      if (Math.abs(p.x - targetCellX) + Math.abs(p.y - targetCellY) <= 1) {
        p.alertTicks = 0; p.targetX = -1; p.targetY = -1;
        state.events.push({ type: "sensorDisrupted", patrolId: p.id });
      }
    }
    return null;
  }

  if (slot === ITEM_SIDEARM) {
    const spec = combatCfg.items.sidearm;
    if (dist > spec.range) return "out_of_range";
    const victim = agentAtCell(state, targetCellX, targetCellY, actor.id);
    // Loud, always: firing is the loudest thing an agent can do.
    burnAgent(state, actor, detCfg, districtId);
    if (districtId >= 0) raiseHeat(state, districtId, detCfg.heat.sources.standoffCombat, detCfg);
    if (!victim) {
      state.events.push({ type: "shotFired", agentId: actor.id, hit: 0 });
      return null;
    }
    state.events.push({ type: "shotFired", agentId: actor.id, hit: 1 });
    damageAgent(state, victim, spec.damage, agentsCfg, detCfg);
    return null;
  }
  return "unknown_item";
}

export function agentAtCell(state, cellX, cellY, exceptId = -1) {
  for (const a of state.agents) {
    if (a.id === exceptId) continue;
    if (a.state !== AGENT_ACTIVE && a.state !== AGENT_DOWNED) continue;
    if (worldToCellFloor(a.x) === cellX && worldToCellFloor(a.y) === cellY) return a;
  }
  return null;
}

// D17 + D40: bail. Paid from the BANK (D30), scaled by the Firm's tier, and
// it restores the agent to its HQ — which, inside D40's grace window, also
// saves whatever contracts it was running.
//
// The bank balance lives in the server ledger, so it arrives on the command:
// the reducer must not read storage.
export function bailCost(firm, cfg) {
  const pct = (cfg.bail.pctOfBankTier1 ?? 15)
    + (cfg.bail.pctPerTier ?? 10) * Math.max(0, (firm.tierUnlocked | 0) - 1);
  return pct;
}

export function payBail(state, firm, agent, combatCfg, agentsCfg, bank, hq) {
  if (agent.state !== AGENT_HELD) return { error: "agent_not_held" };
  if (agent.firmId !== firm.id) return { error: "not_your_agent" };
  const pct = bailCost(firm, combatCfg);
  const cost = Math.trunc(((bank | 0) * pct) / 100);
  if ((bank | 0) <= 0 || cost <= 0) return { error: "cannot_afford" };

  const err = releaseAgent(state, agent, agentsCfg,
    hq ? hq.cellX : -1, hq ? hq.cellY : -1);
  if (err) return { error: err };
  state.events.push({
    type: "bailPaid", firmId: firm.id, agentId: agent.id, cost, pct,
  });
  return { cost };
}

// Authority arrests (D27): patrols take downed agents always, and burned
// agents they reach once the district is at heat 3 or above.
export function stepArrests(state, detCfg, combatCfg, agentsCfg) {
  if (!detCfg.arrest) return;
  for (const agent of state.agents) {
    if (agent.state !== AGENT_ACTIVE && agent.state !== AGENT_DOWNED) continue;
    if (agent.insideBuildingId >= 0) continue;
    const cell = agentCell(agent);
    const districtId = districtAt(state, cell.x, cell.y);
    const heat = state.districts[districtId]?.heat ?? 0;
    const arrestable = agent.state === AGENT_DOWNED
      ? detCfg.arrest.downedAlways
      : (agent.detection === DET_BURNED && heat >= detCfg.arrest.burnedAtHeat);
    if (!arrestable) continue;
    for (const p of state.patrols) {
      if (Math.abs(p.x - cell.x) + Math.abs(p.y - cell.y) > 1) continue;
      if (agent.state === AGENT_ACTIVE) downAgent(state, agent, detCfg);
      captureAgent(state, agent, -1, detCfg, agentsCfg);   // -1 = Authority
      state.events.push({ type: "agentArrested", agentId: agent.id, patrolId: p.id });
      break;
    }
  }
}
