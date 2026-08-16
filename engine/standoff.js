// engine/standoff.js — the standoff and non-aggression pacts (S08, D22).
//
// This game's front line. Two agents who can each see the other freeze for ten
// seconds, learn who they are dealing with, and choose. In V1 the player gets
// the full choice UI and the AI answers by its temperament's policy; V2 swaps
// in a human without changing the protocol.
//
// THE COUNTERPLAY: an agent who is UNSEEN does not trigger a standoff. Staying
// invisible is how you decline the conversation entirely — which is the whole
// stealth pillar restated at the level of rival contact.

import { AGENT_ACTIVE, DET_UNSEEN } from "./state.js";
import { agentCell, districtAt, raiseHeat } from "./detection.js";
import { damageAgent } from "./combat.js";
import { worldToCellFloor, cellToWorld } from "../shared/fixedmath.js";

export const CHOICE_NONE = -1;
export const CHOICE_ENGAGE = 0;
export const CHOICE_WITHDRAW = 1;
export const CHOICE_NEGOTIATE = 2;

export const CHOICE_NAMES = ["engage", "withdraw", "negotiate"];

export function pactBetween(state, firmA, firmB) {
  return state.pacts.find((p) =>
    (p.firmA === firmA && p.firmB === firmB) || (p.firmA === firmB && p.firmB === firmA)) ?? null;
}

export function inStandoff(state, agentId) {
  return state.standoffs.find((s) => s.agentA === agentId || s.agentB === agentId) ?? null;
}

// Mutual awareness: each must be within the other's sensor reach AND not
// unseen. An agent sneaking in cover is simply not part of the encounter.
function mutuallyAware(state, a, b, cfg) {
  const ca = agentCell(a), cb = agentCell(b);
  const distance = Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
  if (distance > 1) return false;
  if (!cfg.triggerRequiresMutualAwareness) return true;
  return a.detection !== DET_UNSEEN && b.detection !== DET_UNSEEN;
}

export function stepStandoffs(state, cfg, detCfg, agentsCfg) {
  // Expire pacts.
  state.pacts = state.pacts.filter((p) => {
    if (state.tick < p.expiresTick) return true;
    state.events.push({ type: "pactExpired", firmA: p.firmA, firmB: p.firmB });
    return false;
  });

  // Trigger new standoffs.
  for (let i = 0; i < state.agents.length; i++) {
    const a = state.agents[i];
    if (a.state !== AGENT_ACTIVE || a.insideBuildingId >= 0) continue;
    if (inStandoff(state, a.id)) continue;
    for (let j = i + 1; j < state.agents.length; j++) {
      const b = state.agents[j];
      if (b.state !== AGENT_ACTIVE || b.insideBuildingId >= 0) continue;
      if (a.firmId === b.firmId || a.firmId < 0 || b.firmId < 0) continue;
      if (inStandoff(state, b.id)) continue;
      if (pactBetween(state, a.firmId, b.firmId)) continue;   // a pact means no trigger
      if (!mutuallyAware(state, a, b, cfg)) continue;

      state.standoffs.push({
        id: state.nextStandoffId++,
        agentA: a.id, agentB: b.id,
        ticksLeft: cfg.timerTicks,
        choiceA: CHOICE_NONE, choiceB: CHOICE_NONE,
      });
      state.events.push({
        type: "standoffStarted", standoffId: state.nextStandoffId - 1,
        agentA: a.id, agentB: b.id, firmA: a.firmId, firmB: b.firmId,
      });
      break;
    }
  }

  // Run the clocks.
  const finished = [];
  for (const standoff of state.standoffs) {
    const a = state.agents[standoff.agentA];
    const b = state.agents[standoff.agentB];
    // If either party leaves the world mid-standoff, the moment is over.
    if (!a || !b || a.state !== AGENT_ACTIVE || b.state !== AGENT_ACTIVE) {
      finished.push(standoff); continue;
    }
    standoff.ticksLeft -= 1;
    if (standoff.choiceA !== CHOICE_NONE && standoff.choiceB !== CHOICE_NONE) {
      finished.push(standoff); continue;
    }
    if (standoff.ticksLeft <= 0) finished.push(standoff);
  }

  for (const standoff of finished) {
    resolveStandoff(state, standoff, cfg, detCfg, agentsCfg);
    state.standoffs = state.standoffs.filter((s) => s.id !== standoff.id);
  }
}

// No choice submitted in time means Withdraw. A player who freezes backs off;
// they do not accidentally start a fight.
function settled(choice) {
  return choice === CHOICE_NONE ? CHOICE_WITHDRAW : choice;
}

export function resolveStandoff(state, standoff, cfg, detCfg, agentsCfg) {
  const a = state.agents[standoff.agentA];
  const b = state.agents[standoff.agentB];
  if (!a || !b) return;
  const choiceA = settled(standoff.choiceA);
  const choiceB = settled(standoff.choiceB);

  const disengage = (agent, from) => {
    // Step back along the axis of separation, as far as the ruleset says.
    const here = agentCell(agent), there = agentCell(from);
    const dx = Math.sign(here.x - there.x) || 1;
    const dy = Math.sign(here.y - there.y);
    const nx = Math.max(1, Math.min(state.size - 2, here.x + dx * cfg.disengageCells));
    const ny = Math.max(1, Math.min(state.size - 2, here.y + dy * cfg.disengageCells));
    agent.x = cellToWorld(nx); agent.y = cellToWorld(ny);
    agent.route = []; agent.routeIdx = 0;
  };

  const bothEngage = choiceA === CHOICE_ENGAGE && choiceB === CHOICE_ENGAGE;
  const someoneEngaged = choiceA === CHOICE_ENGAGE || choiceB === CHOICE_ENGAGE;

  if (bothEngage) {
    combat(state, a, b, detCfg, agentsCfg);
  } else if (someoneEngaged) {
    const aggressor = choiceA === CHOICE_ENGAGE ? a : b;
    const other = aggressor === a ? b : a;
    const otherChoice = aggressor === a ? choiceB : choiceA;
    if (otherChoice === CHOICE_NEGOTIATE) {
      // Caught mid-handshake: the negotiator takes the hit but gets the first
      // step away — an ambush should hurt without being an execution (D6).
      combat(state, aggressor, other, detCfg, agentsCfg, { oneSided: true });
      disengage(other, aggressor);
      state.events.push({
        type: "standoffBetrayed", standoffId: standoff.id,
        byFirmId: aggressor.firmId, againstFirmId: other.firmId,
      });
    } else {
      disengage(other, aggressor);
      state.events.push({
        type: "standoffWithdrawn", standoffId: standoff.id, agentId: other.id,
      });
    }
  } else if (choiceA === CHOICE_NEGOTIATE && choiceB === CHOICE_NEGOTIATE) {
    state.pacts.push({
      firmA: a.firmId, firmB: b.firmId, expiresTick: (state.tick + cfg.pactTicks) | 0,
    });
    state.events.push({
      type: "pactAgreed", standoffId: standoff.id,
      firmA: a.firmId, firmB: b.firmId, expiresTick: (state.tick + cfg.pactTicks) | 0,
    });
  } else {
    disengage(a, b);
    disengage(b, a);
    state.events.push({ type: "standoffEnded", standoffId: standoff.id });
  }
}

function combat(state, x, y, detCfg, agentsCfg, { oneSided = false } = {}) {
  const cell = agentCell(x);
  const districtId = districtAt(state, cell.x, cell.y);
  state.events.push({
    type: "standoffCombat", firmA: x.firmId, firmB: y.firmId, oneSided: oneSided ? 1 : 0,
  });
  const damage = detCfg.standoffDamage ?? 55;
  damageAgent(state, y, damage, agentsCfg, detCfg);
  if (!oneSided) damageAgent(state, x, damage, agentsCfg, detCfg);
  if (districtId >= 0) raiseHeat(state, districtId, detCfg.heat.sources.standoffCombat, detCfg);
}

export function submitChoice(state, standoffId, agentId, choice) {
  const standoff = state.standoffs.find((s) => s.id === standoffId);
  if (!standoff) return "no_such_standoff";
  if (standoff.agentA === agentId) {
    if (standoff.choiceA !== CHOICE_NONE) return "already_chosen";
    standoff.choiceA = choice;
  } else if (standoff.agentB === agentId) {
    if (standoff.choiceB !== CHOICE_NONE) return "already_chosen";
    standoff.choiceB = choice;
  } else {
    return "not_in_this_standoff";
  }
  state.events.push({ type: "standoffChoice", standoffId, agentId, choice });
  return null;
}

// D22: the AI answers by its temperament's declared policy. Aggressive Firms
// still back off when they are clearly the weaker party — a temperament is a
// disposition, not a death wish.
export function aiStandoffChoice(state, standoff, agentId, personality, agentsCfg) {
  const me = state.agents[agentId];
  const themId = standoff.agentA === agentId ? standoff.agentB : standoff.agentA;
  const them = state.agents[themId];
  const policy = personality.standoffPolicy;
  if (policy === "engage") {
    if (!me || !them) return CHOICE_WITHDRAW;
    const advantage = me.condition - them.condition;
    return advantage >= -(agentsCfg.conditionMax / 4) ? CHOICE_ENGAGE : CHOICE_WITHDRAW;
  }
  if (policy === "negotiate") return CHOICE_NEGOTIATE;
  return CHOICE_WITHDRAW;
}
