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
import { acceptContract, KIND_NAMES, requiresCredential, objectiveCellOf,
  STAGE_DONE, STAGE_FAILED } from "./contracts.js";
import { hasCredential, isDisrupted } from "./access.js";
import { raidBy, RAID_INBOUND } from "./raids.js";
import { abandonedAgents } from "./hq.js";
import { findDropZones, autoSelectDropZone } from "./citygen.js";
import { findPath } from "./pathfind.js";
import { inStandoff, aiStandoffChoice, CHOICE_NONE } from "./standoff.js";
import { worldToCellFloor } from "../shared/fixedmath.js";
import { sfc32Next } from "../shared/prng.js";
import { ticksUntilNight } from "./season.js";
import { areaGridFor, areaEntryDoors, CARRY_AREA_ASSET, AT_WALL, AT_COVER } from "./areas.js";

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
  // The operative IN THE FIELD, matching `leadAgent` (D51). Picking any
  // non-absent agent meant a Firm that had redeployed after leaving somebody in
  // custody still saw its PRISONER as its agent — so it folded again on the
  // spot, over and over: 20-32 deployments in a world-day, each one ending the
  // moment it began. A prisoner is addressed by id, through bail or the
  // recovery contract, never as the Firm's current operative.
  const agent = state.agents.find((a) =>
    a.firmId === firmId && a.state !== 0 && a.state !== AGENT_HELD) ?? null;
  const board = state.offers.find((o) => o.firmId === firmId);
  const myContracts = agent
    ? state.contractPool.filter((c) => agent.contractIds.includes(c.id)) : [];
  // A Firm's OWN accepted contracts, independent of whether it currently has
  // anyone to work them. `myContracts` hangs off the agent, so a Firm whose
  // operative is in custody could not see its own job list at all — and Q48's
  // redrop decision is exactly "is there unfinished work worth staying for".
  // Reading the pool directly from the decision function would have been
  // unlawful knowledge; this is the lawful accessor saying the same thing.
  const myAccepted = state.contractPool.filter((c) => c.acceptedBy === firmId);
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
  return { firm, hq, agent, offered, myContracts, myAccepted, visibleRivalHqs };
}

// S16 8f follow-up (2026-08-27, owner-ruled): the cheapest PURCHASABLE
// credential source that covers the needed tier, DERIVED from the payload
// content — restating costs or tiers here is how an instrument measures the
// wrong game. kind: which building sells it (0 safehouse dialogue, 1 market
// shop); cmd/idx: the exact command a player would issue.
export function credentialSourceFor(payloads, need) {
  const out = [];
  const d = payloads?.dialogues?.find((x) => x.id === "informant");
  (d?.options ?? []).forEach((o, idx) => {
    if (o.effect?.type === "credential" && (o.effect.tier | 0) >= need) {
      out.push({ buildingKind: 0, cmd: 36, idx, cost: o.cost ?? 0,
        quietAtHeat: d.quietAtHeat ?? 99 });
    }
  });
  const v = payloads?.shops?.find((x) => x.id === "vendor");
  (v?.catalog ?? []).forEach((o, idx) => {
    if (o.effect?.type === "credential" && (o.effect.tier | 0) >= need) {
      out.push({ buildingKind: 1, cmd: 37, idx, cost: o.cost ?? 0, quietAtHeat: 99 });
    }
  });
  return out.sort((a, b) => a.cost - b.cost)[0] ?? null;
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
  // Defend's whole cost is its hold, and it is a LONG one — the scorer must see
  // that or it prices 1800 stationary ticks as free, which is exactly the
  // blindness that made surveillance look cheap before the effort pass.
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
  // D51 recovery: the objective is a Holding Site, so there is no contract
  // site to look up and the old lookup returned -1 — the AI was offered 13
  // recoveries across eight world-days and completed none of them, because it
  // scored every one as unscorable. Third time this session that a rule the
  // actor did not know made a feature silently never fire; `objectiveCellOf`
  // is the single definition and everything reads it.
  const objective = objectiveCellOf(state, contract);
  if (!objective || !view.hq) return -1;
  const site = { cellX: objective.x, cellY: objective.y, districtId: contract.districtId };
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
  // 2026-08-27 (owner-ruled 4A): the AI can BUY a pass now — the payBail
  // cache route reached dialogue/shop purchases, which was the whole reason
  // the vendor path was rejected in 8k. A secured contract is no longer
  // declined outright: if the cheapest purchasable source covering the tier
  // is affordable from the HQ cache, its price simply comes off the reward,
  // and the errand happens on the way (aiDecide). Unaffordable or
  // unpurchasable still declines — a job you cannot open the door on is the
  // acquisition-0% defect waiting to happen again.
  // THE TIER COMES FROM THE REAL SITE. `site` above is a synthetic
  // {cellX, cellY, districtId} built from objectiveCellOf (D51), and reading
  // securityTier off it always gave 0 — the 8f decline had been DEAD since
  // that refactor, silently accepting secured work the AI could not finish.
  // Found by the 4A test the moment it asserted the broke case.
  const realSite = state.sites.find((x) => x.id === contract.siteId);
  const needTier = realSite ? (realSite.securityTier | 0) : 0;
  let credentialCost = 0;
  if (requiresCredential(contract.kind) && needTier > 0
    && !(agent && hasCredential(state, agent.id, needTier))) {
    const source = credentialSourceFor(rules?.payloads, needTier);
    const cache = view.hq?.cacheResources | 0;
    if (!source || (source.cost | 0) > cache) return -1;
    credentialCost = source.cost | 0;
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
  // The badge's price comes straight off the payout: a 120 pass on a 150
  // contract makes it nearly worthless, which is the truth.
  const netReward = Math.max(0, contract.reward - credentialCost);
  const score = Math.trunc((netReward * 256) / Math.max(1, risk));
  // D51: GOING BACK FOR YOUR OWN OPERATIVE OUTRANKS ORDINARY WORK. Priced on
  // extraction's reward, a recovery scored below a courier run and the AI never
  // took one — 13 debts raised across eight world-days, none collected. That is
  // a value judgement the scorer cannot derive from a payout, because the
  // payout is not why you go: the reward for a recovery is getting your person
  // back. The multiplier says so explicitly rather than by inflating the money,
  // which would distort the economy to express a preference.
  if ((contract.recoverAgentId ?? -1) >= 0) {
    return score * (rules?.ai_firms?.recoveryPriority ?? 4);
  }
  return score;
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
  if (!agent) {
    // D51: NO OPERATIVE IN THE FIELD. If the Firm has somebody in custody, that
    // is why — and it must fold rather than sit there. Left alone this was a
    // SILENT dead loop: 977 ticks of `no_agent` on one seed with the Firm still
    // marked deployed, which is worse than the loud version it replaced,
    // because nothing in the telemetry looked wrong.
    //
    // Folding sends the HQ home, the prisoner stays in the Holding Site, and
    // the next drop-in offers the recovery contract that gets them back.
    if (abandonedAgents(state, firmId).length > 0 && view.hq) {
      if (view.hq.evacActive === 0) {
        // Q48: THE AI GETS THE REDROP TOO. "No AI-only mechanics — if the AI can
        // do it, a player can, and vice versa" cuts both ways, and a player-only
        // option would quietly make every AI Firm fold where a human would
        // fight on. It is also the measurement problem: these runs are how D11
        // and D19 get verdicted, so an AI that cannot take an action the player
        // takes constantly is reporting on a different game.
        //
        // The decision is the same one a player faces, and the incentive runs
        // the opposite way to the obvious guess: folding EXTRACTS, which BANKS
        // the cache — so a fat cache is a reason to go home, not to stay. You
        // redrop to keep EARNING, which means the question is whether there is
        // unfinished work worth finishing.
        //
        // The first version gated on `reputation - cost >= floor` and was
        // completely unreachable: AI Firms start at reputation 0 and only earn
        // it by extracting cleanly, so nothing could ever pay 8 up front. Zero
        // redrops across four seeds and 18 captures — the dead-8f-gate shape
        // exactly, caught by counting the event instead of trusting the branch.
        const cost = rules.combat?.bail?.redropReputationHit ?? 0;
        const unfinished = view.myAccepted.filter(
          (c) => c.stage !== STAGE_DONE && c.stage !== STAGE_FAILED).length;
        // Reputation is SPENT, not required: it already goes negative elsewhere
        // (a lost HQ is -6). A Firm deep in the red stops buying its way back.
        // The floor is a ruleset integer — the first cut divided by riskWeight
        // and tripped the no-floats guard, which is right: this file is engine
        // code and integer maths is the doctrine, not a preference.
        const debtFloor = rules.ai_firms?.redropDebtFloor ?? 0;
        if (cost > 0 && unfinished > 0 && (firm.reputation | 0) - cost >= debtFloor) {
          debug("redrop_agent_lost");
          return { command: { type: 14, firmId }, telemetry };     // CMD_REDROP
        }
        debug("folding_agent_lost");
        return { command: { type: 11, firmId }, telemetry };      // ACTIVATE_EVAC
      }
      if ((view.hq.evacTicks | 0) <= 0) {
        return { command: { type: 13, firmId }, telemetry };      // EXTRACT
      }
      return { command: null, telemetry };                        // beacon running
    }
    debug("no_agent");
    return { command: null, telemetry };
  }

  // ── Out of action ──
  if (agent.state === AGENT_HELD) {
    // BAIL OUT, or the Firm is finished. A captured agent cannot act, and
    // `stepEvac` cancels the beacon when the lead is held — so the Firm can
    // neither work nor leave. On seed 1411 that produced 724 consecutive ticks
    // of "agent_held" and a Firm that never extracted again: capture was a
    // permanent death sentence rather than the recoverable setback D40 designs
    // (a grace window, then rescue or bail restores the contract).
    //
    // Funded from the HQ cache, which is the only money an AI has in-engine.
    if (view.hq && (view.hq.cacheResources | 0) > 0) {
      debug("paying_bail", { agentId: agent.id, cache: view.hq.cacheResources });
      return { command: { type: 33, firmId, agentId: agent.id }, telemetry };
    }
    // Cannot afford bail: FOLD UP (D51). The operative stays in custody and
    // becomes a recovery contract on the next deployment. This churned badly
    // when first attempted — the Firm redeployed onto its own prisoner, 18
    // extractions in a world-day — because `leadAgent` then matched any state
    // except absent. It excludes held agents now, so the redeploy lands a fresh
    // operative and the fold is safe.
    if (view.hq && view.hq.evacActive === 0) {
      debug("folding_agent_lost");
      return { command: { type: 11, firmId }, telemetry };        // ACTIVATE_EVAC
    }
    if (view.hq && (view.hq.evacTicks | 0) <= 0) {
      return { command: { type: 13, firmId }, telemetry };        // EXTRACT
    }
    debug("agent_held_broke");
    return { command: null, telemetry };
  }
  if (agent.state === AGENT_DOWNED) { debug("agent_downed"); return { command: null, telemetry }; }
  if (agent.state === AGENT_INSIDE) {
    // Inside ON PURPOSE? The credential errand buys here — this early rule
    // ("indoors → leave") predates any reason for an AI to be indoors, and
    // it fired before the errand's own buy branch could ever run: 536
    // enter/exit pairs and zero purchases on the first probe. The buy lives
    // AT the rule now, because this is the one place an indoor decide is
    // guaranteed to pass through.
    const contract = view.myContracts[0];
    if (contract) {
      const cSite = state.sites.find((x) => x.id === contract.siteId);
      const need = cSite ? cSite.securityTier | 0 : 0;
      if (requiresCredential(contract.kind) && need > 0
        && !hasCredential(state, agent.id, need)) {
        const source = credentialSourceFor(rules?.payloads, need);
        const b = state.buildings.find((x) => x.id === agent.insideBuildingId);
        if (source && b && b.kind === source.buildingKind) {
          // Affordability is re-checked at the COUNTER, not just at accept:
          // the cache resets on extraction and drains on bail, and the first
          // live run had a firm sitting in the safehouse spamming a buy it
          // could no longer pay for, for ten thousand ticks.
          if ((view.hq?.cacheResources | 0) >= (source.cost | 0)) {
            debug("buying_credential", { tier: need, cost: source.cost });
            return { command: source.cmd === 36
              ? { type: 36, agentId: agent.id, optionIdx: source.idx }
              : { type: 37, agentId: agent.id, itemIdx: source.idx }, telemetry };
          }
          debug("credential_unaffordable", { tier: need, cost: source.cost,
            cache: view.hq?.cacheResources | 0 });
          return { command: { type: 41, agentId: agent.id, contractId: contract.id }, telemetry };
        }
      }
    }
    return { command: { type: 35, agentId: agent.id }, telemetry };  // EXIT_BUILDING
  }

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
    // AT the HQ but still walking somewhere: STOP. Returning null here let an
    // in-progress route carry the agent straight back out of the perimeter,
    // which pauses the beacon (S05) and strands the evacuation indefinitely.
    // It never mattered before 8k, because evac was only ever raised from the
    // go-home branch and the agent was standing still by then; the moment the
    // AI could be mid-errand when the beacon went up, the hold broke.
    // Guarded exactly like every other move: never re-order a move to the cell
    // you are already standing on. That is the documented source of 1324
    // `move:no_route` rejections, and it reappeared here the moment this branch
    // was added. If the agent IS on the tent, it is inside the perimeter and the
    // beacon is running anyway — the `!atHq` branch above catches it the moment
    // its stale route carries it back out.
    const onTent = cell.x === hq.cellX && cell.y === hq.cellY;
    if (!onTent && (agent.route ?? []).length && (agent.routeIdx ?? 0) < agent.route.length
      && reachable(state, cell, { x: hq.cellX, y: hq.cellY })) {
      debug("holding_for_evac");
      return { command: { type: 20, agentId: agent.id, cellX: hq.cellX, cellY: hq.cellY }, telemetry };
    }
    return { command: null, telemetry };
  }

  // ── S17: inside a mission area, the work IS the area ──
  // A rule the actor does not know is a rule nobody follows: surveillance
  // and extraction complete INSIDE now, so the AI walks the compound with
  // the same commands a player uses. Deliberately naive (straight to the
  // objective, straight out) — the guards are its difficulty, as they are
  // the player's.
  if (agent.insideAreaId >= 0) {
    const contract = view.myContracts[0];
    const areaWork = contract
      && (contract.kind === 1 || contract.kind === 2)
      && (contract.recoverAgentId ?? -1) < 0 && contract.stage === 2;
    const area = state.areas.find((a) => a.id === agent.insideAreaId);
    const cfgA = rules.areas;
    const routeDone = (agent.route ?? []).length === 0
      || (agent.routeIdx ?? 0) >= (agent.route ?? []).length;
    const goTo = (x, y) =>
      ({ command: { type: 20, agentId: agent.id, cellX: x, cellY: y }, telemetry });
    if (!area) return { command: { type: 46, agentId: agent.id }, telemetry };
    const doors = areaEntryDoors(areaGridFor(state, area.siteId, cfgA).tiles,
      cfgA.width | 0, cfgA.height | 0);
    const door = doors[0] ?? { x: 1, y: (cfgA.height | 0) - 1 };
    const atDoor = Math.max(Math.abs(agent.areaCol - door.x),
      Math.abs(agent.areaRow - door.y)) <= 1;
    const carrying = agent.carryKind === CARRY_AREA_ASSET;
    const leaving = !areaWork || (contract.kind === 2 && carrying);
    if (leaving) {
      if (atDoor) return { command: { type: 46, agentId: agent.id }, telemetry };  // EXIT
      if (routeDone) return goTo(door.x, door.y);
      return { command: null, telemetry };
    }
    const obj = areaGridFor(state, area.siteId, cfgA).objective;
    // Surveillance holds a cell SHORT of the objective: stepping onto it
    // takes the asset (that is theft, a deliberate act, not a vantage), and
    // the vantage check in contracts.js accepts Chebyshev 1.
    const surv = contract.kind === 1;
    if (surv && agent.detection !== 0) {
      // Seen: the hold cannot tick and a camped guard never loses you if you
      // stand still. Noticed → wait it out at the door; BURNED → leave, cool
      // on the street, come back. Standing still while burned and watched is
      // a deadlock: the watcher never blinks.
      if (atDoor) {
        if (agent.detection === DET_BURNED) return { command: { type: 46, agentId: agent.id }, telemetry };
        return { command: null, telemetry };
      }
      if (routeDone) return goTo(door.x, door.y);
      return { command: null, telemetry };
    }
    // Sneak from the first step inside: the entry strip's gap is sized for a
    // sneaking silhouette (guard sight − 1), and upright is what it punishes.
    if (agent.stance !== STANCE_SNEAK) {
      return { command: { type: 21, agentId: agent.id, stance: STANCE_SNEAK }, telemetry };
    }
    const atObj = Math.max(Math.abs(agent.areaCol - obj.x),
      Math.abs(agent.areaRow - obj.y)) <= (surv ? 1 : 0);
    if (atObj && !(surv && agent.areaCol === obj.x && agent.areaRow === obj.y)) {
      // Hold (surveillance ticks only while unseen).
      return { command: null, telemetry };
    }
    let goal = obj;
    if (surv) {
      const tiles = areaGridFor(state, area.siteId, cfgA).tiles;
      const w = cfgA.width | 0, h = cfgA.height | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = obj.x + dx, y = obj.y + dy;
        if (x >= 0 && y >= 0 && x < w && y < h
          && tiles[y * w + x] !== AT_WALL) { goal = { x, y }; break; }
      }
    }
    // The one stealth instinct the AI gets: STAGE, then cross when the ring
    // is clear. Guard positions are lawful here — an agent inside sees what
    // a player inside sees. Beelining into the patrol at whatever phase it
    // arrived on left three of the five pinned seeds without a single
    // completion; freezing whenever a guard was "near" was worse — near the
    // door a ring guard is always near, and everyone froze forever. So: wait
    // in the south strip (outside sneak sight of the ring), commit when no
    // guard is close to the crossing, and never stop mid-run.
    const w2 = cfgA.width | 0, h2 = cfgA.height | 0;
    const stagingY = h2 - 2;
    // STAGE ONLY IF THE RING IS ACTUALLY IN THE WAY. The guard ring runs rows 8
    // to h-6, and this whole manoeuvre exists to time a crossing of it. The old
    // single floor plan always put the objective north of the ring, so "am I
    // inside" and "must I cross" were the same question and nobody had to ask
    // the second one.
    //
    // Per-type templates (playtest 13, finding 6) broke that: the office plan
    // puts its objective room in the SOUTHERN half, on the same side of the ring
    // as the door. The AI stood in the entry strip waiting for a crossing it did
    // not need to make, on a floor it could have walked straight across — one of
    // the two seeds where the M5 gate went red with "the world is not alive".
    const mustCrossRing = goal.y < h2 - 6;
    if (mustCrossRing && agent.areaRow >= stagingY - 1 && agent.areaRow < h2
      && !(agent.areaCol === goal.x && agent.areaRow === goal.y)) {
      const tiles2 = areaGridFor(state, area.siteId, cfgA).tiles;
      let sx = Math.min(Math.max(goal.x, 1), w2 - 2);
      while (sx < w2 - 1 && tiles2[stagingY * w2 + sx] === AT_WALL) sx++;
      // WHAT COUNTS AS "CLEAR" IS A PERCEPTION QUESTION, and it must be able to
      // become true. This used to add +2 to the guard's sight radius, which was
      // survivable only because the old objective happened to sit away from the
      // ring's legs. Per-type templates (playtest 13, finding 6) moved the
      // objective, the staging column landed under the ring's east leg, and a
      // guard was within the padded radius FOREVER — every AI Firm froze in the
      // south strip and the M5 gate went red with "the world is not alive".
      //
      // This file's own comment already warned that freezing on "near" made
      // everyone freeze forever. The padding is gone: the question is whether a
      // guard can actually SEE the crossing, on the same radius the guard's own
      // perception uses.
      const sight = cfgA.guardSightRadius | 0;
      const watched = area.guards.some((g) => (g.downedUntil | 0) <= state.tick
        && Math.max(Math.abs(g.x - sx), Math.abs(g.y - stagingY)) <= sight);
      // ...and a backstop, because a compound is allowed to be genuinely hard.
      // If a plan never offers a gap at this column the AI must still act rather
      // than stand in the doorway for the rest of the season: a periodic commit
      // window, derived from the tick so it stays pure and needs no new state
      // (and therefore no four-places entry).
      const forced = (state.tick % 200) < 80;
      const ringClear = !watched || forced;
      if (!ringClear) {
        const atStaging = agent.areaRow === stagingY
          && Math.abs(agent.areaCol - sx) <= 1;
        if (atStaging) {
          if (!routeDone) return goTo(agent.areaCol, agent.areaRow);   // stop
          return { command: null, telemetry };
        }
        if (routeDone) return goTo(sx, stagingY);
        return { command: null, telemetry };
      }
    }
    if (routeDone) return goTo(goal.x, goal.y);
    return { command: null, telemetry };
  }

  // ── S16 8k: get a pass, so secured work is not permanently off limits ──
  //
  // WHY THIS EXISTS. 8f gated acquisition and extraction behind a credential
  // and the AI had no way to get one, so it declined a third of the contract
  // space. The 8h battery then measured a world where acquisition read 0.08x —
  // which looks like "nobody wants this job" and actually meant "the only actor
  // being measured cannot take it". No balance number could be read.
  //
  // OPPORTUNISTIC, not planned. The AI does not set out to acquire a badge; it
  // takes one when a guard is conveniently placed and it is not already busy.
  // A full "go and get a credential" errand would need goal planning the AI
  // does not have, and would be a much bigger behavioural change than the
  // measurement problem justifies.
  //
  // The guard route rather than the vendor: buying needs the BANK, which lives
  // in the server ledger and never enters the engine (D30), so a vendor purchase
  // would mean plumbing the ledger through the AI seam. Lifting is entirely
  // in-engine, and it is the source S16 calls the interesting one anyway — it
  // turns a patrol from a thing to avoid into a thing worth seeking out.
  //
  // The unseen check guards STARTING the job, not finishing it. It gated the
  // whole block at first — and the disruptor makes noise, so the agent was
  // noticed by its own action and then refused to walk the three cells to the
  // guard it had just put down. 15 disruptions, zero lifts. Breaking stealth is
  // the price of the badge; refusing to collect it afterwards is just waste.
  //
  // PURPOSEFUL, not idle. The first version went guard-hunting whenever it had
  // nothing else on, and the two settings traded directly against each other:
  // a 20-cell seek radius produced credentials but cut completions from 7.5 to
  // 4.0 and clean extractions to zero, while a 10-cell radius kept throughput
  // and produced ONE credential across six world-days. Wandering off to mug
  // somebody on the off-chance is simply not worth an operative's time.
  //
  // So the errand now needs a REASON: a job on this Firm's own board that the
  // credential would actually unlock. That makes it rare and targeted instead
  // of frequent and speculative, which is the same shape as every other piece
  // of AI doctrine here.
  //
  // OFF BY DEFAULT, AND MEASURED OFF (2026-08-07). Over 24 world-days the errand
  // cost burns 13.0 -> 21.5, captures 3 -> 6, failures 2 -> 4 and deployment
  // length 12.5 -> 8.1 min — which was the ENTIRE survivability regression and
  // the reason acceptance criterion 10's deployment number failed. Over 8
  // world-days it returned **zero** credentials and **zero** secured-site
  // contracts. Pure cost.
  //
  // Sneaking the approach was tried and did not help (burns 23.0, no better):
  // walking up to a patrol is dangerous at any stance, and sneaking just makes
  // you slow near them for longer.
  //
  // The mechanism stays — it is fully reachable for a PLAYER, which is where
  // mugging a guard for their badge was always the interesting move — but the
  // AI does not spend its sorties on it. The honest consequence is recorded in
  // S16: an AI Firm declines secured extraction and acquisition, so a battery
  // measures a world where a third of the contract space is player-only.
  const wantsPass = (rules?.security?.access?.aiSeeksCredentials | 0) === 1
    && !hasCredential(state, agent.id, 1)
    && (view.offered ?? []).some((c) => {
      if (!requiresCredential(c.kind)) return false;
      const site = state.sites.find((x) => x.id === c.siteId);
      return (site?.securityTier | 0) > 0;
    });
  if (wantsPass) {
    const itemCfg = rules.combat.items.disruptor;
    const here = agentCell(agent);
    const near = (p, r) => Math.abs(p.x - here.x) + Math.abs(p.y - here.y) <= r;

    // Already down and within reach? Take the badge.
    const downed = state.patrols.find((p) => isDisrupted(p, state.tick) && near(p, 1));
    if (downed) {
      debug("lifting_credential", { patrolId: downed.id });
      return {
        command: { type: 44, agentId: agent.id, patrolId: downed.id },
        telemetry,
      };
    }
    // Down but not yet within reach: WALK OVER. Without this step the AI
    // disrupted guards from three cells away and then never closed — 13
    // disruptions, zero lifts, across a world-day. Stunning a guard you never
    // reach is worse than doing nothing: it costs the item and the noise and
    // buys nothing at all.
    const walkTo = state.patrols.find((p) =>
      isDisrupted(p, state.tick) && near(p, (rules.security.access.approachCells | 0) || 8));
    if (walkTo && ((agent.route ?? []).length === 0 || (agent.routeIdx ?? 0) >= agent.route.length)) {
      if (reachable(state, here, { x: walkTo.x, y: walkTo.y })) {
        debug("closing_on_guard", { patrolId: walkTo.id });
        return {
          command: { type: 20, agentId: agent.id, cellX: walkTo.x, cellY: walkTo.y },
          telemetry,
        };
      }
    }
    if (walkTo) return { command: null, telemetry };   // already walking there

    // NOTHING DOWN YET, AND IDLE: go and find a guard.
    //
    // The purely opportunistic version — act only if a patrol happens to be
    // within three cells — produced 15 disruptions and zero credentials across
    // four world-days, because that situation almost never arises while the AI
    // is free to act on it. A badge the AI can only get by coincidence is not a
    // route to secured work; it is a rounding error.
    //
    // Gated on being between jobs, so seeking a guard never competes with a
    // contract in progress. Throughput is checked in the world-day sweep.
    if ((agent.contractIds ?? []).length === 0 && agent.detection === 0
      && ((agent.route ?? []).length === 0 || (agent.routeIdx ?? 0) >= agent.route.length)) {
      let best = null, bestD = (rules.security.access.seekCells | 0) || 20;
      for (const p of state.patrols) {
        const d = Math.abs(p.x - here.x) + Math.abs(p.y - here.y);
        if (d < bestD && reachable(state, here, { x: p.x, y: p.y })) { best = p; bestD = d; }
      }
      if (best && bestD > itemCfg.range) {
        debug("seeking_guard", { patrolId: best.id, distance: bestD });
        return {
          command: { type: 20, agentId: agent.id, cellX: best.x, cellY: best.y },
          telemetry,
        };
      }
    }
    // Standing next to a guard that is still up? Put them out first.
    // Once in range, TAKE THE SHOT whatever your detection state.
    //
    // Requiring unseen here looked prudent and was the third thing to kill this
    // behaviour outright. A trace of the approach tells the story: the agent
    // closes from 18 cells to 1, and is noticed at 8 and burned at 2 — by the
    // guard it is walking up to. Refusing to act at that point means it walked
    // the whole way, broke its own stealth, and went home empty. Being seen is
    // the PRICE of the badge; the disruptor clears the guard's alert anyway,
    // and the existing abort-when-hot rule pulls the Firm out if the district
    // turns dangerous.
    const target = state.patrols.find((p) =>
      !isDisrupted(p, state.tick) && near(p, itemCfg.range));
    if (target && (agent.contractIds ?? []).length === 0) {
      debug("disrupting_guard", { patrolId: target.id });
      return {
        command: { type: 30, agentId: agent.id, slot: 1, cellX: target.x, cellY: target.y },
        telemetry,
      };
    }
  }

  // ── S16 8i: an ORDERED raid outranks CONTRACT WORK ──
  //
  // The scheduler (engine/raids.js) picks the target and telegraphs it; this is
  // the half that makes the raider actually turn up. It sits above the contract
  // logic because an ordered raid is a commitment, not a mood — it must not be
  // abandoned because a job looked interesting. It sits BELOW standoff and evac
  // for the same reason: those are commitments too. Placed above evac at first,
  // it produced an AI that never extracted, because a Firm mid-evacuation kept
  // being sent off to raid. Precedence here is: forced choice, then getting
  // out, then orders, then work.
  //
  // It reads the raid straight off state rather than through the lawful view,
  // and that is correct: this is the AI's OWN order, not knowledge about a
  // rival. Its target HQ is knowledge it was given with the order.
  // Own cell, computed here: the shared `cell` binding is declared further
  // down, after the evac and abort branches this block now sits above.
  const raidCell = agentCell(agent);
  const order = raidBy(state, firmId);
  // ONLY BETWEEN JOBS. A Firm does not abandon a paying contract to go and
  // turn over a rival's tent, and letting it made raids cost ~40% of world
  // throughput: completions fell from 4-9 to 1-5 per world-day and clean
  // extractions all but stopped. That is not a difficulty effect, it is the
  // economy being quietly rewritten by a side feature. The raid window is
  // generous enough that a Firm finishing its current job still usually gets
  // there; if it does not, the raid expires, which is a fine outcome.
  const freeToRaid = (agent.contractIds ?? []).length === 0;
  if (order && order.state === RAID_INBOUND && freeToRaid) {
    // An HQ raid loots the tent; a SITE assault just has to stand on the
    // objective, which is what pauses the defender's hold (8j).
    const site = order.targetSiteId >= 0
      ? state.sites.find((x) => x.id === order.targetSiteId) : null;
    const targetHq = site ?? state.hqs.find((h) => h.firmId === order.targetFirmId);
    if (targetHq) {
      const goal = { x: targetHq.cellX, y: targetHq.cellY };
      // EXACT cell, not `arrivedAt`. `arrivedAt` tolerates a cell of slop —
      // rightly, because demanding an exact match everywhere once produced 1324
      // `move:no_route` rejections — but looting in hq.js requires standing ON
      // the tent (`cell.x === hq.cellX && cell.y === hq.cellY`). With the slop
      // the raider parked one cell short, called itself arrived, and waited
      // forever: 6 raids dispatched, 5 perimeter alarms, ZERO loots, across
      // every seed. The two systems have to agree on what "there" means.
      const onTent = raidCell.x === goal.x && raidCell.y === goal.y;
      if (!onTent) {
        if ((agent.route ?? []).length && (agent.routeIdx ?? 0) < agent.route.length) {
          return { command: null, telemetry };
        }
        if (reachable(state, raidCell, goal)) {
          debug("raid_ordered", { targetFirmId: order.targetFirmId });
          return { command: { type: 20, agentId: agent.id, cellX: goal.x, cellY: goal.y }, telemetry };
        }
        debug("raid_unreachable", { targetFirmId: order.targetFirmId });
      } else if (site) {
        // Standing on a contested objective: HOLD. Every tick here is a tick
        // the defender's clock is not running.
        debug("assault_holding", { siteId: site.id });
        return { command: null, telemetry };
      } else if ((targetHq.cacheResources | 0) > 0) {
        // Standing on it with something to take: hold, and hq.js does the
        // looting from here.
        debug("raid_arrived", { targetFirmId: order.targetFirmId });
        return { command: null, telemetry };
      } else {
        // ARRIVED TO AN EMPTY TENT. Holding position here froze the raider for
        // the whole raid window — 70 idle ticks on one seed, and the Firm never
        // got back to work or extracted at all. There is nothing to steal, so
        // the order is spent: fall through and behave normally.
        debug("raid_empty", { targetFirmId: order.targetFirmId });
      }
    }
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

    // ── The credential errand (owner-ruled 4A, 2026-08-27) ──
    // A secured contract accepted without the badge detours through the
    // cheapest source the CONTENT sells — same buildings, same commands,
    // same prices as a player; the cache route in the reducer is the purse.
    // The scorer already netted the cost, so being here means it was worth it.
    const cSite = state.sites.find((x) => x.id === contract.siteId);
    const need = cSite ? (cSite.securityTier | 0) : 0;
    if (requiresCredential(contract.kind) && need > 0
      && !hasCredential(state, agent.id, need)) {
      const source = credentialSourceFor(rules?.payloads, need);
      if (!source || (view.hq?.cacheResources | 0) < (source.cost | 0)) {
        // Unpurchasable — or no longer affordable (see the counter re-check):
        // hand the job back rather than walking to a counter you cannot pay.
        return { command: { type: 41, agentId: agent.id, contractId: contract.id }, telemetry };
      }
      // (The BUY itself happens at the AGENT_INSIDE early rule above — an
      // indoor decide never reaches this section.)
      // Walk to the nearest source building whose seller is actually open —
      // an informant in a locked-down district offers NOTHING, and standing
      // in front of a quiet one forever is the acquisition-0% shape again.
      const here0 = agentCell(agent);
      const shop = state.buildings
        .filter((b) => b.kind === source.buildingKind
          && (state.districts[b.districtId]?.heat ?? 0) < source.quietAtHeat)
        .sort((a, b) =>
          (Math.abs(a.entranceX - here0.x) + Math.abs(a.entranceY - here0.y))
          - (Math.abs(b.entranceX - here0.x) + Math.abs(b.entranceY - here0.y)))[0];
      if (!shop) {
        return { command: { type: 41, agentId: agent.id, contractId: contract.id }, telemetry };
      }
      if (here0.x === shop.entranceX && here0.y === shop.entranceY) {
        return { command: { type: 34, agentId: agent.id }, telemetry };   // ENTER_BUILDING
      }
      if ((agent.route ?? []).length === 0 || (agent.routeIdx ?? 0) >= (agent.route ?? []).length) {
        return { command: { type: 20, agentId: agent.id,
          cellX: shop.entranceX, cellY: shop.entranceY }, telemetry };
      }
      return { command: null, telemetry };
    }
    const target = targetCellFor(state, contract, view, rules);
    if (target) {
      const here = agentCell(agent);
      if (!reachable(state, here, target)) {
        debug("contract_unreachable", { contractId: contract.id });
        return { command: { type: 41, agentId: agent.id, contractId: contract.id }, telemetry }; // ABANDON
      }
      if (arrivedAt(here, target)) {
        // S17: surveillance and extraction work INSIDE — at the site, the
        // next move is through the door. Surveillance waits out a burn on the
        // street first: the hold only ticks while unseen, so walking back in
        // burned re-runs the chase and never the contract.
        if ((contract.kind === 1 || contract.kind === 2)
          && (contract.recoverAgentId ?? -1) < 0 && contract.stage === 2) {
          if (contract.kind === 1 && agent.detection !== DET_UNSEEN) {
            return { command: null, telemetry };
          }
          // ── Wait for dark (owner-ruled 4A) ── Night cuts every watcher's
          // sight to the ruled 70%, indoors included. With night close, a
          // short hold at the door prices cheaper than a lit approach; a
          // LONG wait is never taken — contract clocks keep running.
          const dn = rules.season?.dayNight;
          if (dn) {
            const until = ticksUntilNight(state.tick, dn);
            if (until > 0 && until <= (rules.ai_firms.waitForNightTicks ?? 0)) {
              debug("waiting_for_dark", { until });
              if (agent.stance !== STANCE_SNEAK) {
                return { command: { type: 21, agentId: agent.id, stance: STANCE_SNEAK }, telemetry };
              }
              return { command: null, telemetry };
            }
          }
          return { command: { type: 45, agentId: agent.id }, telemetry };   // ENTER_AREA
        }
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
    const from = agentCell(agent);
    for (const contract of view.offered) {
      // DO NOT TAKE WHAT YOU CANNOT REACH. The working branch abandons a
      // contract whose objective is unreachable — and `rebuildOffers` then put
      // it straight back on the board, where it scored well and was taken
      // again. Two contracts on seed 1411 were accepted 133 times each, with
      // 268 abandons in one world-day: a live-lock that burned the whole
      // sortie and, worse, inflated the ACCEPTED share that D19's preference
      // ratio is computed from. The balance table was reading a loop.
      //
      // Checking reachability here rather than remembering past abandons keeps
      // it stateless and symmetric with the abandon rule: the same question,
      // asked before committing instead of after walking.
      const target = targetCellFor(state, contract, view, rules);
      if (target && !reachable(state, from, target)) continue;
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
  // D51 recovery: the objective is a Holding Site, not a contract site. Told
  // here because `objectiveCellOf` is the single definition and the AI must
  // read the SAME one — when D41 moved acquisition's delivery and this function
  // was not updated, acquisition completed 0% for 24 world-days.
  if ((contract.recoverAgentId ?? -1) >= 0 && contract.stage !== 3) {
    return objectiveCellOf(state, contract);
  }
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
