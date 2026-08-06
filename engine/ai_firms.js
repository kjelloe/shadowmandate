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
import { hasCredential, isDisrupted } from "./access.js";
import { raidBy, RAID_INBOUND } from "./raids.js";
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
    // Cannot afford bail. The Firm is stuck until someone rescues the agent —
    // see Q42: folding up and writing the operative off SHOULD be allowed, but
    // doing it naively made the Firm redeploy onto its own held agent
    // (`leadAgent` matches any state except absent) and churn 100-275 times a
    // world-day. The right fix needs D17's custody/ownership half designed.
    debug("agent_held_broke");
    return { command: null, telemetry };
  }
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
  const wantsPass = !hasCredential(state, agent.id, 1)
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
