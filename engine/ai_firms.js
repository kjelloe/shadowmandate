// engine/ai_firms.js — AI rival Firms (S07, D13, D34).
//
// In V1 these ARE the world: they drop in, run real contracts, raise heat,
// raid, and evac. They are also the measurement instrument, so their doctrine
// is developed with the same rigor as rules.
//
// TWO HARD CONSTRAINTS:
//  1. **Lawful knowledge only.** An AI Firm may read what its own agent could
//     plausibly know — its board, its HQ, its own agent, and world geometry.
//     It must never consult a rival's cache, a rival's contracts, or an
//     agent it cannot see. `aiLawfulView` is the only accessor it uses.
//  2. **Same commands as a player.** No AI-only mechanics. If the AI can do
//     it, a player can, and vice versa.

import {
  AGENT_ACTIVE, AGENT_DOWNED, AGENT_HELD, AGENT_INSIDE,
  FIRM_UNDEPLOYED, FIRM_DEPLOYED, FIRM_EVACUATING,
  STANCE_SNEAK, STANCE_MOVE, STANCE_HURRY, DET_BURNED, DET_UNSEEN,
} from "./state.js";
import { agentCell, districtAt } from "./detection.js";
import { orderMove } from "./agents.js";
import { hqOf, dropIn, activateEvac, extract } from "./hq.js";
import { acceptContract, KIND_NAMES, requiresCredential } from "./contracts.js";
import { hasCredential } from "./access.js";
import { findDropZones, autoSelectDropZone } from "./citygen.js";
import { findPath } from "./pathfind.js";
import { inStandoff, aiStandoffChoice, CHOICE_NONE } from "./standoff.js";
import { worldToCellFloor } from "../shared/fixedmath.js";
import { sfc32Next } from "../shared/prng.js";

export const P_CAUTIOUS = 0;
export const P_GREEDY = 1;
export const P_AGGRESSIVE = 2;

// Standoff policies (S08) — consulted by the standoff system.
export const POLICY_WITHDRAW = 0;
export const POLICY_ENGAGE = 1;
export const POLICY_NEGOTIATE = 2;

function roll(state, lo, hi) {
  const { value, nextState } = sfc32Next(state.rng);
  state.rng = nextState;
  if (hi <= lo) return lo;
  return (lo + (value % ((hi - lo + 1) >>> 0))) | 0;
}

// THE LAWFUL VIEW. Everything the AI is allowed to know, and nothing else.
// Written as one function so a violation is a visible import, not a habit.
export function aiLawfulView(state, firmId) {
  const firm = state.firms[firmId];
  const hq = hqOf(state, firmId);
  const agent = state.agents.find((a) => a.firmId === firmId && a.state !== 0) ?? null;
  const board = state.offers.find((o) => o.firmId === firmId);
  const myContracts = agent
    ? state.contractPool.filter((c) => agent.contractIds.includes(c.id)) : [];
  const offered = board
    ? board.contractIds.map((id) => state.contractPool.find((c) => c.id === id)).filter(Boolean)
    : [];
  // Rival HQs are visible only when this Firm's agent could see them; V1 uses
  // a simple proximity rule standing in for the fog projection.
  const visibleRivalHqs = [];
  if (agent && agent.state === AGENT_ACTIVE) {
    const cell = agentCell(agent);
    for (const other of state.hqs) {
      if (other.firmId === firmId) continue;
      if (Math.abs(other.cellX - cell.x) + Math.abs(other.cellY - cell.y) <= 14) {
        visibleRivalHqs.push(other);
      }
    }
  }
  return { firm, hq, agent, offered, myContracts, visibleRivalHqs };
}

export function personalityOf(rules, idx) {
  return rules.ai_firms.personalities[idx % rules.ai_firms.personalities.length];
}

// Seat AI Firms into a fresh world. They start UNDEPLOYED; the scheduler drops
// them in on its own rhythm, so a world fills up the way it would with people.
export function spawnAiFirms(state, rules, count, { swap = false } = {}) {
  const personalities = rules.ai_firms.personalities;
  const seated = [];
  for (let i = 0; i < count && i < state.firms.length; i++) {
    const firm = state.firms[i];
    firm.isAi = 1;
    // FIRMSWAP: personalities trade seats, so a battery can separate
    // "this personality is strong" from "this seat is lucky" (S14).
    const pidx = swap ? (personalities.length - 1 - (i % personalities.length))
      : (i % personalities.length);
    firm.aiPersonality = pidx;
    firm.nameId = i;
    firm.aiNextDeployTick = roll(state, 0, rules.ai_firms.deployment.minGapTicks);
    seated.push(firm.id);
  }
  return seated;
}

// The work a contract demands beyond walking: holds, plants, cracks and the
// fuse you must outrun. Measured in ticks so it can be priced against distance.
export function workTicksFor(spec) {
  if (!spec) return 0;
  const legs = spec.legs ?? 1;
  return ((spec.holdTicks ?? 0) * (spec.passes ?? 1))
    + ((spec.plantTicks ?? 0) * legs)
    + (spec.crackTicks ?? 0)
    + (spec.secureTicks ?? 0)
    + (spec.fuseTicks ?? 0);
}

// Score a contract the way a Firm with this temperament would: payoff against
// distance and danger. riskWeight is the temperament — a cautious Firm prices
// heat heavily, an aggressive one barely notices it.
//
// The score MUST see time-on-objective. The first version priced only distance
// and heat, so surveillance's 3x1200 ticks of standing still in the open cost
// the AI nothing it could perceive, and a second leg was free. That made the
// AI a liar about its own preferences — and since we verdict human pacing (D11)
// from AI runs, a blind scorer produces confident, wrong balance numbers. Work
// ticks are converted to cell-equivalents at the Move rate so the two costs are
// in the same currency.
export function scoreContract(state, view, contract, personality, rules, agent = null) {
  const site = state.sites.find((s) => s.id === contract.siteId);
  if (!site || !view.hq) return -1;
  // S16 8f — A RULE THE ACTOR MUST KNOW. Secured facilities need a credential,
  // and an AI that cannot get one must not take the job: it would walk there,
  // stand at a door that never opens, and the contract would sit at 0% forever.
  // That is precisely the acquisition-0% defect of M6, and it reappeared the
  // moment 8f landed — the M5 gate went red with "the world is not alive".
  //
  // The AI has no way to BUY a pass yet (it never enters buildings) and no
  // doctrine for disabling a guard to lift one, so for now it simply declines
  // secured work. Tracked as an 8f follow-up in S16: until then, secured
  // contracts are player-only, and the honest consequence is that the AI's
  // supply of easy extraction and acquisition work is reduced rather than made
  // dangerous — which is a real D42 effect, just a smaller one than intended.
  if (requiresCredential(contract.kind)
    && (site.securityTier | 0) > 0
    && !(agent && hasCredential(state, agent.id, site.securityTier | 0))) {
    return -1;
  }
  let distance = Math.abs(view.hq.cellX - site.cellX) + Math.abs(view.hq.cellY - site.cellY);
  // A second site is a second journey, not a free stop on the way.
  const siteB = state.sites.find((s) => s.id === contract.siteIdB);
  if (siteB) distance += Math.abs(siteB.cellX - site.cellX) + Math.abs(siteB.cellY - site.cellY);
  const spec = rules?.contracts?.types?.[KIND_NAMES[contract.kind]] ?? null;
  // Derived, not guessed: 256 world units make a cell and Move stance walks
  // baseSpeed units per tick.
  const ticksPerCell = Math.max(1, Math.trunc(256 / Math.max(1, rules?.agents?.baseSpeed ?? 9)));
  const workCells = Math.trunc(workTicksFor(spec) / ticksPerCell);
  const heat = state.districts[contract.districtId]?.heat ?? 0;
  const risk = 1 + distance + workCells + (heat * personality.riskWeight) / 32;
  return Math.trunc((contract.reward * 256) / Math.max(1, risk));
}

// One decision pass for one AI Firm. Returns a command to enqueue, or null.
// Deliberately at most ONE command per Firm per pass: the AI plays at human
// cadence, not at tick speed.
// Returns { command, telemetry }. The telemetry is RETURNED rather than pushed
// into state.events, because the very next apply() starts a fresh event list
// and would erase it — the telemetry built to record failure recorded nothing
// at all until this was found (census showed zero aiDebug rows in a world-day
// full of decisions). Telemetry that can be silently dropped is worse than no
// telemetry: it reads as "nothing went wrong".
export function aiDecide(state, firmId, rules) {
  const view = aiLawfulView(state, firmId);
  const firm = view.firm;
  const personality = personalityOf(rules, firm.aiPersonality);
  const telemetry = [];
  const debug = (reason, extra = {}) => {
    telemetry.push({ type: "aiDebug", firmId, reason, ...extra });
  };

  // ── Undeployed: is it time to go to work? ──
  if (firm.state === FIRM_UNDEPLOYED) {
    if (state.tick < (firm.aiNextDeployTick | 0)) return { command: null, telemetry };
    const zones = findDropZones(state, rules.citygen);
    if (!zones.length) { debug("no_drop_zone"); return { command: null, telemetry }; }
    const zone = autoSelectDropZone(state, zones, rules.citygen, rules.hq, firm.tierUnlocked);
    return { command: { type: 10, firmId, cellX: zone.cellX, cellY: zone.cellY }, telemetry };  // CMD_DROP_IN
  }

  const agent = view.agent;
  if (!agent) { debug("no_agent"); return { command: null, telemetry }; }

  // ── Out of action ──
  if (agent.state === AGENT_HELD) { debug("agent_held"); return { command: null, telemetry }; }
  if (agent.state === AGENT_DOWNED) { debug("agent_downed"); return { command: null, telemetry }; }
  if (agent.state === AGENT_INSIDE) return { command: { type: 35, agentId: agent.id }, telemetry };  // EXIT_BUILDING

  // ── In a standoff: answer it. Nothing else matters for these ten seconds. ──
  const standoff = inStandoff(state, agent.id);
  if (standoff) {
    const mine = standoff.agentA === agent.id ? standoff.choiceA : standoff.choiceB;
    if (mine === CHOICE_NONE) {
      const choice = aiStandoffChoice(state, standoff, agent.id, personality, rules.agents);
      debug("standoff_choice", { standoffId: standoff.id, choice });
      return {
        command: { type: 50, agentId: agent.id, standoffId: standoff.id, choice },
        telemetry,
      };
    }
    return { command: null, telemetry };
  }

  // ── Evacuating: hold and get out ──
  if (firm.state === FIRM_EVACUATING) {
    const hq = view.hq;
    if (!hq) return { command: null, telemetry };
    const cell = agentCell(agent);
    const atHq = Math.abs(hq.cellX - cell.x) + Math.abs(hq.cellY - cell.y) <= rules.hq.perimeterRadius;
    if (!atHq) {
      if ((agent.route ?? []).length && (agent.routeIdx ?? 0) < agent.route.length) return { command: null, telemetry };
      // Guarded like every other move. An HQ that cannot be pathed to is a
      // situation to report once, not to re-attempt every cadence tick.
      if (!reachable(state, cell, { x: hq.cellX, y: hq.cellY })) {
        debug("hq_unreachable", { stage: "evacuating" });
        return { command: null, telemetry };
      }
      return { command: { type: 20, agentId: agent.id, cellX: hq.cellX, cellY: hq.cellY }, telemetry }; // MOVE
    }
    if (hq.evacTicks <= 0) return { command: { type: 13, firmId }, telemetry };  // EXTRACT
    return { command: null, telemetry };
  }

  // ── Burned and the district is hot: break off ──
  const cell = agentCell(agent);
  const heatHere = state.districts[districtAt(state, cell.x, cell.y)]?.heat ?? 0;
  if (agent.detection === DET_BURNED && heatHere >= personality.abortAtHeat) {
    if (view.hq) {
      const home = { x: view.hq.cellX, y: view.hq.cellY };
      // Already walking home: let it walk. This path had NO in-progress check,
      // so a burned agent in a hot district re-ordered the same move on every
      // cadence tick. It was invisible until 8b's cameras made burns common —
      // 213 `move:no_route` rejections in one seed, from a bug that predates
      // cameras entirely. The rejection log is what found it, again.
      if ((agent.route ?? []).length && (agent.routeIdx ?? 0) < agent.route.length) {
        return { command: null, telemetry };
      }
      if (!arrivedAt(cell, home) && reachable(state, cell, home)) {
        debug("aborting_hot", { heat: heatHere });
        return { command: { type: 20, agentId: agent.id, cellX: home.x, cellY: home.y }, telemetry };
      }
      debug("aborting_hot_stuck", { heat: heatHere });
    }
  }

  // ── Enough banked, or nothing left to do: go home and evac ──
  const cacheTarget = rules.ai_firms.cacheEvacTarget ?? 260;
  const cache = view.hq ? view.hq.cacheResources : 0;
  if (cache >= cacheTarget && view.myContracts.length === 0 && view.hq) {
    // Go home FIRST. The beacon can only be raised from the HQ (S05), and
    // calling it from the field just produced `not_at_hq` on repeat.
    const home = { x: view.hq.cellX, y: view.hq.cellY };
    if (!arrivedAt(cell, home)) {
      if ((agent.route ?? []).length === 0 || (agent.routeIdx ?? 0) >= (agent.route ?? []).length) {
        if (!reachable(state, cell, home)) {
          debug("hq_unreachable", { stage: "heading_home" });
          return { command: null, telemetry };
        }
        debug("heading_home_to_evac", { cache });
        return { command: { type: 20, agentId: agent.id, cellX: home.x, cellY: home.y }, telemetry };
      }
      return { command: null, telemetry };
    }
    debug("calling_evac", { cache });
    return { command: { type: 11, firmId }, telemetry };   // ACTIVATE_EVAC
  }

  // ── Working a contract: walk to whatever it wants next ──
  if (view.myContracts.length) {
    const contract = view.myContracts[0];
    const target = targetCellFor(state, contract, view, rules);
    if (target) {
      const here = agentCell(agent);
      if (!reachable(state, here, target)) {
        debug("contract_unreachable", { contractId: contract.id });
        return { command: { type: 41, agentId: agent.id, contractId: contract.id }, telemetry }; // ABANDON
      }
      if (arrivedAt(here, target)) {
        // Standing on it — the per-tick machine advances the stage. Sneak
        // while working: being seen is what fails a job.
        if (agent.stance !== STANCE_SNEAK) {
          return { command: { type: 21, agentId: agent.id, stance: STANCE_SNEAK }, telemetry };
        }
        return { command: null, telemetry };
      }
      if ((agent.route ?? []).length === 0 || (agent.routeIdx ?? 0) >= (agent.route ?? []).length) {
        return { command: { type: 20, agentId: agent.id, cellX: target.x, cellY: target.y }, telemetry };
      }
      // In transit: pick a gait. Close to the objective, slow down.
      const distance = Math.abs(here.x - target.x) + Math.abs(here.y - target.y);
      const wanted = distance <= 6 ? STANCE_SNEAK
        : (agent.detection === DET_UNSEEN ? STANCE_MOVE : STANCE_SNEAK);
      if (agent.stance !== wanted) return { command: { type: 21, agentId: agent.id, stance: wanted }, telemetry };
      return { command: null, telemetry };
    }
  }

  // ── Idle: take the best thing on the board ──
  if (view.offered.length && view.myContracts.length < rules.contracts.maxActivePerAgent) {
    let best = null, bestScore = -1;
    for (const contract of view.offered) {
      const score = scoreContract(state, view, contract, personality, rules, agent);
      if (score > bestScore) { bestScore = score; best = contract; }
    }
    if (best) return { command: { type: 40, agentId: agent.id, contractId: best.id }, telemetry }; // ACCEPT_CONTRACT
    debug("board_unscorable");
  }

  // ── Aggressive temperaments raid a visible rival HQ when work is thin ──
  if (personality.raidThreshold > 0 && view.visibleRivalHqs.length) {
    const target = view.visibleRivalHqs[0];
    const goal = { x: target.cellX, y: target.cellY };
    if (!arrivedAt(cell, goal) && reachable(state, cell, goal)
      && ((agent.route ?? []).length === 0 || (agent.routeIdx ?? 0) >= agent.route.length)) {
      debug("raiding", { targetFirmId: target.firmId });
      return { command: { type: 20, agentId: agent.id, cellX: goal.x, cellY: goal.y }, telemetry };
    }
  }

  debug("idle");
  return { command: null, telemetry };
}

// "Arrived" must tolerate a cell of slop. Demanding an exact match made the AI
// re-order a move to the square it was already standing on, every cadence tick
// — 1324 `move:no_route` rejections in a single 12k-tick world-day. The
// rejection log is what found it; the game looked fine from the outside.
function arrivedAt(here, target) {
  return Math.abs(here.x - target.x) + Math.abs(here.y - target.y) <= 1;
}

// Can this agent actually get there? An unreachable objective is a contract
// the AI should give up, not one it should walk at forever.
function reachable(state, here, target) {
  if (arrivedAt(here, target)) return true;
  return findPath(state.map, here.x, here.y, target.x, target.y).length > 0;
}

// Where a contract currently wants the operative. This MUST agree with
// engine/contracts.js — when D41 gave acquisition a separate drop-off and this
// function was not told, the AI walked home while the contract waited at the
// drop, and acquisition completed 0% of the time across 24 world-days. A rule
// the actor does not know is a rule nobody follows.
function targetCellFor(state, contract, view, rules) {
  const site = state.sites.find((s) => s.id === contract.siteId);
  const siteB = state.sites.find((s) => s.id === contract.siteIdB);
  const spec = rules?.contracts?.types?.[KIND_NAMES[contract.kind]] ?? null;
  // stage: 1 TRAVEL, 2 WORK, 3 RETURN
  if (contract.stage === 3) {
    const deliversToSiteB = contract.kind === 0 || spec?.dropOff === true;
    if (deliversToSiteB && siteB) return { x: siteB.cellX, y: siteB.cellY };
    if (view.hq) return { x: view.hq.cellX, y: view.hq.cellY };
  }
  return site ? { x: site.cellX, y: site.cellY } : null;
}

// The scheduler: staggered so the AI never costs a whole tick at once, and so
// two Firms never move in lockstep.
//
// RETURNS THE EVENTS IT CAUSED. Each apply() starts a fresh event list, so a
// caller that only reads the state afterwards sees the LAST command's events
// and silently loses the rest. The first harness run reported `accepted: 0`
// beside completed contracts and rising tiers for exactly this reason — the
// game was fine, the instrument was under-reporting. Anything driving the AI
// must consume these.
export function stepAiFirms(state, rules, applyFn) {
  let next = state;
  const events = [];
  const cadence = rules.ai_firms.decisionCadence ?? 10;
  for (const firm of state.firms) {
    if (!firm.isAi) continue;
    if ((next.tick + firm.id) % cadence !== 0) continue;
    const { command, telemetry } = aiDecide(next, firm.id, rules);
    for (const t of telemetry) events.push(t);
    if (!command) continue;
    next = applyFn(next, command);
    for (const e of next.events) events.push(e);
  }
  return { state: next, events };
}
