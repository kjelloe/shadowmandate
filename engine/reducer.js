// engine/reducer.js — the authoritative pure reducer: apply(state, command).
//
// Never mutates the input state. Integer math only. No I/O, no clocks, no
// hidden state. Events describe what a command did; a rejected action emits a
// "rejected" event and changes nothing else.
//
// THE COPYSTATE RULE (earned in the sibling projects, three separate aliasing
// bugs): every nested mutable array/object must be deep-copied here. A shared
// nested reference lets a backward replay scrub read the future. New nested
// state gets its deep copy in the SAME commit that introduces it.

import {
  validate, COMMAND_NAMES,
  CMD_ADVANCE_TICK, CMD_SET_STANCE, CMD_MOVE, CMD_USE_ITEM,
  CMD_RESCUE, CMD_CAPTURE, CMD_DROP_IN, CMD_ACTIVATE_EVAC, CMD_CANCEL_EVAC,
  CMD_EXTRACT, CMD_ACCEPT_CONTRACT, CMD_ABANDON_CONTRACT, CMD_SITE_ACTION,
  CMD_ENTER_BUILDING, CMD_EXIT_BUILDING, CMD_BUY_ITEM,
} from "./commands.js";
import { AGENT_ACTIVE, AGENT_DOWNED } from "./state.js";
import { orderMove, stepAgent, stepPatrol } from "./agents.js";
import { stepDetection, stepHeat } from "./detection.js";
import { rescueAgent, captureAgent, useItem, stepArrests } from "./combat.js";
import { dropIn, activateEvac, cancelEvac, extract, stepHqs } from "./hq.js";
import {
  acceptContract, abandonContract, siteAction, stepContracts, reapContracts,
  refillPool, rebuildOffers, noteBurn, seedSitesNearHq,
} from "./contracts.js";
import { enterBuilding, exitBuilding, buyCover } from "./buildings.js";

export function copyState(state) {
  return {
    tick: state.tick,
    worldSeed: state.worldSeed,
    size: state.size,
    slots: state.slots,
    rng: { a: state.rng.a, b: state.rng.b, c: state.rng.c, d: state.rng.d },
    // The map and district ownership are immutable after generation (the
    // static world reconstructs from the seed); shared by reference
    // deliberately, never written in place.
    map: state.map,
    districtOwner: state.districtOwner,
    reachable: state.reachable,
    rules: state.rules,

    firms: state.firms.map((f) => ({ ...f })),
    agents: state.agents.map((a) => ({
      ...a,
      contractIds: a.contractIds.slice(),
      route: (a.route ?? []).map((c) => ({ x: c.x, y: c.y })),
    })),

    districts: state.districts.map((d) => ({ ...d })),
    sites: state.sites.map((s) => ({ ...s })),
    buildings: state.buildings.map((b) => ({ ...b })),
    patrols: state.patrols.map((p) => ({ ...p, route: p.route.slice() })),
    holdingSites: state.holdingSites.map((h) => ({ ...h, heldAgentIds: h.heldAgentIds.slice() })),
    hqs: state.hqs.map((h) => ({ ...h })),
    contractPool: state.contractPool.map((c) => ({ ...c })),
    offers: state.offers.map((o) => ({ ...o, contractIds: o.contractIds.slice() })),
    standoffs: state.standoffs.map((s) => ({ ...s })),
    pacts: state.pacts.map((p) => ({ ...p })),
    vehicles: state.vehicles.map((v) => ({ ...v })),

    nextContractId: state.nextContractId,
    nextStandoffId: state.nextStandoffId,

    events: [],
  };
}

function reject(next, command, reason) {
  next.events.push({
    type: "rejected",
    command: COMMAND_NAMES[command.type] ?? command.type,
    reason,
  });
  return next;
}

function applySetStance(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  if (agent.stance === command.stance) return next;
  agent.stance = command.stance;
  next.events.push({ type: "stanceChanged", agentId: agent.id, stance: agent.stance });
  return next;
}

function applyMove(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  if (agent.insideBuildingId >= 0) return reject(next, command, "agent_inside_building");
  const steps = orderMove(next, agent, command.cellX, command.cellY);
  if (steps === 0) return reject(next, command, "no_route");
  return next;
}

function applyUseItem(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  const r = next.rules;
  if (!r) return reject(next, command, "no_ruleset");
  const err = useItem(next, agent, command.slot, command.cellX, command.cellY,
    r.combat, r.detection, r.agents);
  if (err) return reject(next, command, err);
  return next;
}

function applyRescue(next, command) {
  const actor = next.agents[command.agentId];
  const target = next.agents[command.targetAgentId];
  if (!actor || !target) return reject(next, command, "no_such_agent");
  if (actor.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  const err = rescueAgent(next, actor, target, next.rules.agents);
  if (err) return reject(next, command, err);
  return next;
}

function applyCapture(next, command) {
  const actor = next.agents[command.agentId];
  const target = next.agents[command.targetAgentId];
  if (!actor || !target) return reject(next, command, "no_such_agent");
  if (actor.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  if (actor.firmId === target.firmId) return reject(next, command, "not_a_rival");
  const err = captureAgent(next, target, actor.firmId, next.rules.detection, next.rules.agents);
  if (err) return reject(next, command, err);
  return next;
}

function applyDropIn(next, command) {
  if (!next.rules) return reject(next, command, "no_ruleset");
  const err = dropIn(next, command.firmId, command.cellX, command.cellY,
    next.rules.hq, next.rules.agents, command.ledger ?? null);
  if (err) return reject(next, command, err);
  // D35: make sure there is genuinely close work, so phase 1 means something.
  const hq = next.hqs[next.hqs.length - 1];
  if (hq) seedSitesNearHq(next, hq, next.rules.contracts, next.rules.citygen);
  return next;
}

function applyActivateEvac(next, command) {
  if (!next.rules) return reject(next, command, "no_ruleset");
  const err = activateEvac(next, command.firmId, next.rules.hq);
  if (err) return reject(next, command, err);
  return next;
}

function applyCancelEvac(next, command) {
  const err = cancelEvac(next, command.firmId);
  if (err) return reject(next, command, err);
  return next;
}

function applyExtract(next, command) {
  if (!next.rules) return reject(next, command, "no_ruleset");
  const result = extract(next, command.firmId, next.rules.hq);
  if (result.error) return reject(next, command, result.error);
  return next;
}

function applyEnterBuilding(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  const err = enterBuilding(next, agent);
  if (err) return reject(next, command, err);
  return next;
}

function applyExitBuilding(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  const err = exitBuilding(next, agent, false);
  if (err) return reject(next, command, err);
  return next;
}

// D38. The bank balance lives in the server ledger (D30 bank-only), so it is
// supplied on the command — the reducer stays pure and never reads storage.
function applyBuyItem(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (command.itemIdx !== 0) return reject(next, command, "not_implemented");
  const result = buyCover(next, agent, next.rules.combat, command.bank ?? 0);
  if (result.error) return reject(next, command, result.error);
  return next;
}

function applyAcceptContract(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  const err = acceptContract(next, agent, command.contractId, next.rules.contracts);
  if (err) return reject(next, command, err);
  return next;
}

function applyAbandonContract(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  const err = abandonContract(next, agent, command.contractId);
  if (err) return reject(next, command, err);
  return next;
}

function applySiteAction(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  const err = siteAction(next, agent, command.siteId, next.rules.contracts);
  if (err) return reject(next, command, err);
  return next;
}

// The world tick. Subsystems hook in here in milestone order; each is a no-op
// while its collection is empty, which is what keeps new systems hash-inert.
//
// ORDER MATTERS and is part of the contract: move, then perceive what moved,
// then let heat decay, then let Authority act on what it now knows. Reordering
// these changes outcomes and therefore the hash.
function applyAdvanceTick(next) {
  next.tick = (next.tick + 1) | 0;
  const r = next.rules;
  if (!r) return next;   // era-0 blank world: nothing to step

  for (const agent of next.agents) {
    if (agent.state === AGENT_ACTIVE || agent.state === AGENT_DOWNED) {
      stepAgent(next, r.agents, agent);
    }
  }
  for (const patrol of next.patrols) stepPatrol(next, r.detection, patrol);
  stepDetection(next, r.detection, r.agents);
  // D39: attribute burns to the contracts they happened during. Done here,
  // from the events detection just emitted, rather than by having detection
  // import contracts — the module graph stays acyclic (specs/02).
  for (const e of next.events) if (e.type === "agentBurned") noteBurn(next, e.agentId);
  stepHeat(next, r.detection);
  stepArrests(next, r.detection, r.combat, r.agents);
  stepHqs(next, r.hq);
  stepContracts(next, r.contracts, r.detection);
  if (reapContracts(next) > 0) refillPool(next, r.contracts, r.detection);
  rebuildOffers(next, r.contracts, r.detection);

  // Downed agents accumulate time; the number is what rescue and capture
  // windows are measured against.
  for (const agent of next.agents) {
    if (agent.state === AGENT_DOWNED) agent.downTicks = (agent.downTicks + 1) | 0;
  }
  return next;
}

export function apply(state, command) {
  const next = copyState(state);
  if (!validate(command)) return reject(next, command ?? { type: -1 }, "invalid_command");

  switch (command.type) {
    case CMD_ADVANCE_TICK:
      return applyAdvanceTick(next);
    case CMD_SET_STANCE:
      return applySetStance(next, command);
    case CMD_MOVE:
      return applyMove(next, command);
    case CMD_USE_ITEM:
      return applyUseItem(next, command);
    case CMD_RESCUE:
      return applyRescue(next, command);
    case CMD_CAPTURE:
      return applyCapture(next, command);
    case CMD_DROP_IN:
      return applyDropIn(next, command);
    case CMD_ACTIVATE_EVAC:
      return applyActivateEvac(next, command);
    case CMD_CANCEL_EVAC:
      return applyCancelEvac(next, command);
    case CMD_EXTRACT:
      return applyExtract(next, command);
    case CMD_ACCEPT_CONTRACT:
      return applyAcceptContract(next, command);
    case CMD_ABANDON_CONTRACT:
      return applyAbandonContract(next, command);
    case CMD_SITE_ACTION:
      return applySiteAction(next, command);
    case CMD_ENTER_BUILDING:
      return applyEnterBuilding(next, command);
    case CMD_EXIT_BUILDING:
      return applyExitBuilding(next, command);
    case CMD_BUY_ITEM:
      return applyBuyItem(next, command);
    default:
      // A validated command whose milestone has not landed yet. Explicit, so a
      // premature call is visible in the event stream rather than silent.
      return reject(next, command, "not_implemented");
  }
}
