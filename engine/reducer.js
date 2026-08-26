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
  CMD_CUT_JUNCTION, CMD_LIFT_CREDENTIAL,
  CMD_ENTER_BUILDING, CMD_EXIT_BUILDING, CMD_BUY_ITEM, CMD_STANDOFF_CHOICE,
  CMD_PAY_BAIL, CMD_DIALOGUE_CHOICE, CMD_DORMANCY_TICK,
  CMD_ENTER_VEHICLE, CMD_EXIT_VEHICLE,
  CMD_ENTER_AREA, CMD_EXIT_AREA, CMD_TAKEDOWN, CMD_HACK_TERMINAL,
} from "./commands.js";
import { AGENT_ACTIVE, AGENT_DOWNED } from "./state.js";
import {
  orderMove, snapMoveTarget, stepAgent, stepPatrol, boardVehicle, exitVehicle, syncVehicles,
} from "./agents.js";
import { stepDetection, stepHeat, agentCell } from "./detection.js";
import { rescueAgent, captureAgent, useItem, stepArrests, payBail } from "./combat.js";
import { dropIn, activateEvac, cancelEvac, extract, stepHqs, hqOf } from "./hq.js";
import {
  enterArea, exitArea, orderAreaMove, takedown, hackTerminal, stepAreas,
} from "./areas.js";
import {
  acceptContract, abandonContract, siteAction, stepContracts, reapContracts,
  refillPool, rebuildOffers, noteBurn, seedSitesNearHq,
} from "./contracts.js";
import {
  enterBuilding, exitBuilding, buyCover, payloadFor, applyEffect,
} from "./buildings.js";
import { stepStandoffs, submitChoice } from "./standoff.js";
import { stepAlarms, cutJunction, alarmStageOf } from "./security.js";
import { stepCivilians } from "./civilians.js";
import { lightPhase } from "./season.js";
import { stepRaids } from "./raids.js";
import { liftCredentialFromGuard } from "./access.js";
import { applyDormancy } from "./dormancy.js";
import { sfc32Next } from "../shared/prng.js";

// One seeded stream, borrowed. The engine has exactly one PRNG in state and it
// must not fork — a second stream would make replays diverge in a way no test
// would notice until a battery disagreed with itself.
function rollFrom(state, lo, hi) {
  if (hi <= lo) return lo;
  return (lo + (sfc32Next(state.rng) % ((hi - lo + 1) >>> 0))) | 0;
}

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

    firms: state.firms.map((f) => ({
      ...f,
      heatIntel: (f.heatIntel ?? []).map((h) => ({ ...h })),
      knownRivalHqs: (f.knownRivalHqs ?? []).slice(),
      upgrades: (f.upgrades ?? []).slice(),
    })),
    agents: state.agents.map((a) => ({
      ...a,
      contractIds: a.contractIds.slice(),
      route: (a.route ?? []).map((c) => ({ x: c.x, y: c.y })),
    })),

    districts: state.districts.map((d) => ({ ...d })),
    sites: state.sites.map((s) => ({ ...s })),
    cameras: (state.cameras ?? []).map((c) => ({ ...c })),
    beams: (state.beams ?? []).map((x) => ({ ...x })),
    junctions: (state.junctions ?? []).map((j) => ({ ...j })),
    buildings: state.buildings.map((b) => ({ ...b })),
    patrols: state.patrols.map((p) => ({ ...p, route: p.route.slice() })),
    civilians: (state.civilians ?? []).map((c) => ({ ...c })),
    holdingSites: state.holdingSites.map((h) => ({ ...h, heldAgentIds: h.heldAgentIds.slice() })),
    hqs: state.hqs.map((h) => ({ ...h })),
    contractPool: state.contractPool.map((c) => ({
      ...c,
      // S16 8g: both are ARRAYS. A spread copies the reference, so without
      // these two lines a contested contract's contenders would be shared
      // between every state in the chain and the reducer would stop being pure.
      contenders: (c.contenders ?? []).slice(),
      contestedBy: (c.contestedBy ?? []).slice(),
    })),
    offers: state.offers.map((o) => ({ ...o, contractIds: o.contractIds.slice() })),
    standoffs: state.standoffs.map((s) => ({ ...s })),
    alarms: (state.alarms ?? []).map((a) => ({ ...a })),
    // S17: guards and terminals are nested mutable arrays — the copyState
    // rule (deep-copy every nested mutable, same commit that introduces it).
    areas: (state.areas ?? []).map((ar) => ({
      ...ar,
      guards: ar.guards.map((g) => ({ ...g })),
      terminals: ar.terminals.map((t) => ({ ...t })),
    })),
    credentials: (state.credentials ?? []).map((c) => ({ ...c })),
    raids: (state.raids ?? []).map((r) => ({ ...r })),
    pacts: state.pacts.map((p) => ({ ...p })),
    vehicles: state.vehicles.map((v) => ({ ...v })),

    nextContractId: state.nextContractId,
    nextStandoffId: state.nextStandoffId,
    nextRaidId: state.nextRaidId ?? 0,

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
  // Inside a mission area, the same MOVE command routes in AREA space (S17):
  // one verb for the player and the AI, two floors for the world.
  if (agent.insideAreaId >= 0) {
    const err = orderAreaMove(next, agent, next.rules.areas, command.cellX, command.cellY);
    if (err) return reject(next, command, err);
    return next;
  }
  // Tapping the cell you stand on is a valid non-order, not a routing failure.
  const here = agentCell(agent);
  if (here.x === command.cellX && here.y === command.cellY) return next;
  const steps = orderMove(next, agent, command.cellX, command.cellY);
  if (steps === 0) {
    // Playtest 6: the tap landed on a building or other unroutable cell — go
    // to the nearest cell a route reaches instead of refusing. The client's
    // destination pin shows where the order actually went.
    const snapped = snapMoveTarget(next, command.cellX, command.cellY);
    if (!snapped || orderMove(next, agent, snapped.x, snapped.y) === 0) {
      return reject(next, command, "no_route");
    }
  }
  return next;
}

function applyEnterVehicle(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.state !== AGENT_ACTIVE) return reject(next, command, "agent_not_active");
  const err = boardVehicle(next, agent, next.rules.vehicles);
  if (err) return reject(next, command, err);
  return next;
}

function applyExitVehicle(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  const err = exitVehicle(next, agent);
  if (err) return reject(next, command, err);
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

// Buying, at a shop or a cover shop. The bank balance lives in the server
// ledger (D30 bank-only), so it arrives on the command — the reducer stays
// pure and never reads storage.
function applyBuyItem(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.insideBuildingId < 0) return reject(next, command, "not_inside");
  const building = next.buildings.find((b) => b.id === agent.insideBuildingId);
  if (!building) return reject(next, command, "no_building");
  const payloads = next.rules.payloads;
  if (!payloads) return reject(next, command, "no_content");

  const heat = next.districts[building.districtId]?.heat ?? 0;
  const payload = payloadFor(building, payloads, heat);
  if (!payload || payload.kind !== "shop") return reject(next, command, "not_a_shop");
  const item = payload.catalog[command.itemIdx];
  if (!item) return reject(next, command, "no_such_item");
  if ((command.bank ?? 0) < item.cost) return reject(next, command, "cannot_afford");

  if (item.effect.type === "cover") {
    const result = buyCover(next, agent, next.rules.combat, command.bank ?? 0);
    if (result.error) return reject(next, command, result.error);
    return next;
  }
  const firm = next.firms[agent.firmId];
  const err = applyEffect(next, agent, firm, item.effect, {
    districtId: building.districtId, conditionMax: next.rules.agents.conditionMax,
  });
  if (err) return reject(next, command, err);
  next.events.push({
    type: "itemBought", agentId: agent.id, firmId: firm.id,
    itemKey: item.key, cost: item.cost,
  });
  return next;
}

// Talking to someone. Content declares the options; the engine applies them.
function applyDialogueChoice(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  if (agent.insideBuildingId < 0) return reject(next, command, "not_inside");
  const building = next.buildings.find((b) => b.id === agent.insideBuildingId);
  if (!building) return reject(next, command, "no_building");
  const payloads = next.rules.payloads;
  if (!payloads) return reject(next, command, "no_content");

  const heat = next.districts[building.districtId]?.heat ?? 0;
  const payload = payloadFor(building, payloads, heat);
  if (!payload || payload.kind !== "dialogue") return reject(next, command, "not_a_dialogue");
  const option = payload.options[command.optionIdx];
  if (!option) return reject(next, command, "no_such_option");

  // Leaving is CMD_EXIT_BUILDING, always — dialogue exit options were cut in
  // playtest 5 (they duplicated the overlay's Leave button), and a mechanism
  // no content can express is a feature that silently does nothing.
  if ((option.cost ?? 0) > (command.bank ?? 0)) return reject(next, command, "cannot_afford");

  const firm = next.firms[agent.firmId];
  const err = applyEffect(next, agent, firm, option.effect, {
    districtId: building.districtId, conditionMax: next.rules.agents.conditionMax,
  });
  if (err) return reject(next, command, err);
  next.events.push({
    type: "dialogueChosen", agentId: agent.id, firmId: firm.id,
    optionKey: option.key, cost: option.cost ?? 0,
  });
  return next;
}

function applyPayBail(next, command) {
  const firm = next.firms[command.firmId];
  const agent = next.agents[command.agentId];
  if (!firm || !agent) return reject(next, command, "no_such_agent");
  const hq = hqOf(next, command.firmId);

  // TWO FUNDING ROUTES, and they are genuinely different money.
  //
  // A player pays from the BANK, which lives in the server ledger and reaches
  // the engine only as `command.bank`; the server deducts it there. An AI has
  // no ledger — `stepAiFirms` runs inside the engine — so it pays from the HQ
  // CACHE, the at-risk field resources it is carrying. Buying an operative out
  // of custody with what you have on hand is exactly what that money is for,
  // and it does not touch D30, which governs VENDOR purchases.
  //
  // The cache route must DEDUCT, and that is the part worth watching: payBail
  // computes a cost and never subtracts anything, because on the player path
  // the server does it. An AI paying from the cache with no deduction would
  // bail out for free, forever.
  const fromCache = (command.bank ?? 0) <= 0 && hq;
  const bank = fromCache ? (hq.cacheResources | 0) : (command.bank ?? 0);
  const result = payBail(next, firm, agent, next.rules.combat, next.rules.agents, bank, hq);
  if (result.error) return reject(next, command, result.error);
  if (fromCache) hq.cacheResources = Math.max(0, (hq.cacheResources | 0) - (result.cost | 0));
  return next;
}

// D16. The ONLY command that carries wall-clock time, and it carries it as an
// ordinary field so replays reproduce the sleep exactly.
function applyDormancyTick(next, command) {
  if (!next.rules) return reject(next, command, "no_ruleset");
  const deployed = next.firms.some((f) => f.state !== 0);
  if (deployed) return reject(next, command, "world_not_empty");
  applyDormancy(next, command.elapsedMs, next.rules.detection, next.rules.contracts);
  return next;
}

function applyStandoffChoice(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_such_agent");
  const err = submitChoice(next, command.standoffId, command.agentId, command.choice);
  if (err) return reject(next, command, err);
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
  // S09/Q45: agents parked "until dark" step back onto the street the tick
  // the phase crosses into night. The flag clears inside exitBuilding — the
  // one home shared with the change-your-mind manual exit.
  {
    const dn = r.season?.dayNight;
    if (dn && lightPhase(next.tick, dn).night) {
      for (const agent of next.agents) {
        if (agent.waitUntilDark && agent.insideBuildingId >= 0) {
          exitBuilding(next, agent, false);
          next.events.push({ type: "waitedForDark", agentId: agent.id });
        }
      }
    }
  }
  syncVehicles(next);
  for (const patrol of next.patrols) stepPatrol(next, r.detection, patrol);
  // S17 ambient life. The alarm half of "trouble" is computed HERE — the
  // reducer already knows the security layer, and civilians.js importing it
  // would close a cycle back into state.js. Pure decoration in gameplay
  // terms: civilians watch nothing and block nothing.
  if (r.civilians && next.civilians?.length) {
    const alarmed = [];
    for (const s of next.sites) {
      if (alarmStageOf(next, s.id) > 0) alarmed.push({ x: s.cellX, y: s.cellY });
    }
    stepCivilians(next, r.civilians, alarmed);
  }
  // S17: the indoor layer steps after street movement and before street
  // perception — occupants move, guards see, alarms breathe; the street
  // systems below all SKIP agents who are inside an area.
  stepAreas(next, r.areas, r.detection);
  stepDetection(next, r.detection, r.agents);
  // D39: attribute burns to the contracts they happened during. Done here,
  // from the events detection just emitted, rather than by having detection
  // import contracts — the module graph stays acyclic (specs/02).
  for (const e of next.events) if (e.type === "agentBurned") noteBurn(next, e.agentId);
  // Site alarms sit between perceive and heat because that is exactly what they
  // are: a consequence of being seen, and a source of heat. Running them after
  // stepHeat would delay a district spike by a full tick and — worse — let the
  // same tick's decay cancel a spike that had just been earned.
  stepAlarms(next, r.security?.alarm);
  stepHeat(next, r.detection);
  stepArrests(next, r.detection, r.combat, r.agents);
  stepHqs(next, r.hq);
  // S16 8i. After HQs, because a raid is a thing that happens TO an HQ and the
  // perimeter must have been stepped first; the roll is handed the state's own
  // seeded stream so the engine keeps exactly one.
  stepRaids(next, r.security?.raids, (lo, hi) => rollFrom(next, lo, hi));
  stepStandoffs(next, r.standoff, r.detection, r.agents);
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

// S16 8d. Rejections carry a REASON, because a control that silently does
// nothing is the defect playtest 1 shipped and the AI rejection log is how this
// project finds AI bugs.
function applyCutJunction(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_agent");
  const r = cutJunction(next, agent, command.junctionId,
    next.rules.security.junction, next.rules.detection);
  if (!r.ok) return reject(next, command, r.reason);
  return next;
}

// S16 8k. Reasons, like every other refusal: the AI rejection log is how this
// project finds AI bugs, and a silent no-op is how a control looks broken.
function applyLiftCredential(next, command) {
  const agent = next.agents[command.agentId];
  if (!agent) return reject(next, command, "no_agent");
  const patrol = next.patrols.find((p) => p.id === command.patrolId);
  const r = liftCredentialFromGuard(next, agent, patrol, next.rules.security.access);
  if (!r.ok) return reject(next, command, r.reason);
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
    case CMD_CUT_JUNCTION:
      return applyCutJunction(next, command);
    case CMD_LIFT_CREDENTIAL:
      return applyLiftCredential(next, command);
    case CMD_ENTER_AREA: {
      const err = enterArea(next, next.agents[command.agentId], next.rules.areas);
      return err ? reject(next, command, err) : next;
    }
    case CMD_EXIT_AREA: {
      const err = exitArea(next, next.agents[command.agentId], next.rules.areas);
      return err ? reject(next, command, err) : next;
    }
    case CMD_TAKEDOWN: {
      const err = takedown(next, next.agents[command.agentId], next.rules.areas, next.rules.combat);
      return err ? reject(next, command, err) : next;
    }
    case CMD_HACK_TERMINAL: {
      const err = hackTerminal(next, next.agents[command.agentId], next.rules.areas);
      return err ? reject(next, command, err) : next;
    }
    case CMD_SITE_ACTION:
      return applySiteAction(next, command);
    case CMD_ENTER_BUILDING:
      return applyEnterBuilding(next, command);
    case CMD_EXIT_BUILDING:
      return applyExitBuilding(next, command);
    case CMD_BUY_ITEM:
      return applyBuyItem(next, command);
    case CMD_STANDOFF_CHOICE:
      return applyStandoffChoice(next, command);
    case CMD_PAY_BAIL:
      return applyPayBail(next, command);
    case CMD_DIALOGUE_CHOICE:
      return applyDialogueChoice(next, command);
    case CMD_DORMANCY_TICK:
      return applyDormancyTick(next, command);
    case CMD_ENTER_VEHICLE:
      return applyEnterVehicle(next, command);
    case CMD_EXIT_VEHICLE:
      return applyExitVehicle(next, command);
    default:
      // A validated command whose milestone has not landed yet. Explicit, so a
      // premature call is visible in the event stream rather than silent.
      return reject(next, command, "not_implemented");
  }
}
