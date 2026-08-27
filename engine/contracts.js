// engine/contracts.js — the contract economy and objective machines
// (S06, D18, D19, D29).
//
// THE D18 ECONOMY: the world keeps a pool of 5 contracts per player slot. Each
// deployed Firm is shown 5 offers, and offers are RESERVED — no two concurrent
// boards share a contract. Every player always has real options that are not
// the neighbour's leftovers.

import { AGENT_ACTIVE, AGENT_HELD } from "./state.js";
import { agentCell, convergePatrols } from "./detection.js";
import { hasCredential } from "./access.js";
import { releaseAgent } from "./combat.js";
import { hqOf } from "./hq.js";
import { sfc32Next } from "../shared/prng.js";
import { worldToCellFloor } from "../shared/fixedmath.js";
import { areaObjective, CARRY_AREA_ASSET } from "./areas.js";

export const KIND_COURIER = 0;
export const KIND_SURVEILLANCE = 1;
export const KIND_EXTRACTION = 2;
export const KIND_SABOTAGE = 3;
export const KIND_ACQUISITION = 4;
// S16 8j (D49a). Defend is the sixth type and the one INBOUND job: every other
// contract is "go somewhere, do something, come home". It is also the only one
// where being seen is not automatically failure — you are supposed to be there
// — which is a genuinely different texture in a stealth-first game and a rest
// from the one it has.
export const KIND_DEFEND = 5;
export const KIND_COUNT = 6;

export const KIND_NAMES = [
  "courier", "surveillance", "extraction", "sabotage", "acquisition", "defend",
];

// Objective stages. Every contract walks 0 -> ... -> DONE.
export const STAGE_OFFERED = 0;
export const STAGE_TRAVEL = 1;   // go to the primary site
export const STAGE_WORK = 2;     // hold / plant / crack / pick up
export const STAGE_RETURN = 3;   // carry it home (or leave the blast radius)
export const STAGE_DONE = 4;
export const STAGE_FAILED = 5;

// The world's PRNG advances in-state, so contract generation is part of the
// deterministic stream and replays identically.
function roll(state, lo, hi) {
  const { value, nextState } = sfc32Next(state.rng);
  state.rng = nextState;
  if (hi <= lo) return lo;
  return (lo + (value % ((hi - lo + 1) >>> 0))) | 0;
}

function tierOf(cfg, kind) {
  return cfg.types[KIND_NAMES[kind]]?.tier ?? 1;
}

function rewardFor(state, cfg, detCfg, kind, districtId) {
  const base = cfg.types[KIND_NAMES[kind]]?.reward ?? 50;
  const heat = state.districts[districtId]?.heat ?? 0;
  // Risk premium: a hot district pays more (D20/S06).
  if (heat >= detCfg.heat.extraPatrolsAt && heat < detCfg.heat.checkpointsActiveAt) {
    return (base + Math.trunc((base * detCfg.heat.riskPremiumPct) / 100)) | 0;
  }
  return base;
}

export function poolTarget(state, cfg) {
  return (cfg.poolPerSlot * state.slots) | 0;
}

// Top the pool back up to target. Called on world creation, on completion or
// expiry, and by the dormancy transition (D16).
// D51 / D17's other half. A RECOVERY contract: go to the Holding Site where you
// left somebody, get them out, bring them home.
//
// Generated on demand rather than rolled, and reserved to the Firm that owes
// the debt — this is not work anyone else can take. It reuses the EXTRACTION
// machine wholesale (travel, a secure timer on the objective, carry home)
// because that is exactly the shape of the job, and inventing a seventh kind
// for it would double the contract vocabulary to say the same thing.
export function recoveryContractFor(state, firmId, cfg, agent) {
  const existing = state.contractPool.find((c) =>
    c.recoverAgentId === agent.id && c.stage !== STAGE_DONE && c.stage !== STAGE_FAILED);
  if (existing) {
    // Already owed — but the board was rebuilt while the Firm was away, so put
    // it back in front of them. Returning early without this meant the debt
    // existed in the pool and appeared on nobody's board ever again.
    let b = state.offers.find((o) => o.firmId === firmId);
    if (!b) { b = { firmId, contractIds: [], teaserId: -1 }; state.offers.push(b); }
    if (!b.contractIds.includes(existing.id)) b.contractIds.unshift(existing.id);
    return existing;
  }
  const site = state.holdingSites.find((h) => h.id === agent.holdingSiteId);
  if (!site) return null;
  const spec = cfg.types.extraction ?? {};
  const contract = {
    id: state.nextContractId++,
    kind: KIND_EXTRACTION,
    tier: 1,                       // never gated: you can always go back for them
    districtId: site.districtId,
    siteId: -1,                    // the objective is a Holding Site, not a contract site
    siteIdB: -1,
    // Priced off extraction, because it IS one. No premium: recovering your own
    // operative is its own reward, and paying a bonus for losing them would be
    // a strange incentive to build into the economy.
    reward: spec.reward ?? 69,
    expiresTick: 0,                // a debt does not expire
    reservedBy: firmId,
    contested: 0, contenders: [], contestedBy: [],
    acceptedBy: -1,
    stage: STAGE_OFFERED,
    stageTicks: 0,
    graceTicks: 0,
    burnsTaken: 0,
    legsDone: 0,
    // What makes it a recovery rather than an extraction.
    recoverAgentId: agent.id,
    holdingSiteId: site.id,
  };
  state.contractPool.push(contract);
  // ONTO THE BOARD DIRECTLY. `rebuildOffers` only ever considers contracts with
  // `reservedBy < 0`, so a job pre-reserved to one Firm is invisible to it —
  // the recovery was created, reserved, and then never offered to anybody: 12
  // debts raised across eight world-days and not one of them collectable.
  // Placed FIRST, because the operative you left behind should be the first
  // thing you see when you land.
  let board = state.offers.find((o) => o.firmId === firmId);
  if (!board) { board = { firmId, contractIds: [], teaserId: -1 }; state.offers.push(board); }
  if (!board.contractIds.includes(contract.id)) board.contractIds.unshift(contract.id);
  state.events.push({
    type: "recoveryOffered", contractId: contract.id, firmId,
    agentId: agent.id, holdingSiteId: site.id,
  });
  return contract;
}

export function refillPool(state, cfg, detCfg) {
  const target = poolTarget(state, cfg);
  let guard = 0;
  while (state.contractPool.length < target && guard++ < target * 4) {
    const contract = generateContract(state, cfg, detCfg);
    // A failed roll (e.g. a courier whose two sites collided) must not abort
    // the refill — it is one wasted attempt, not the end of the pool.
    if (!contract) continue;
    state.contractPool.push(contract);
  }
}

function generateContract(state, cfg, detCfg) {
  if (!state.sites.length) return null;
  const kind = roll(state, 0, KIND_COUNT - 1);
  const site = state.sites[roll(state, 0, state.sites.length - 1)];
  let siteB = -1;
  // Courier needs a destination; sabotage needs a second charge site (D41);
  // acquisition needs a drop-off that is NOT the way you came in.
  if (kind === KIND_COURIER || kind === KIND_SABOTAGE || kind === KIND_ACQUISITION) {
    const other = state.sites[roll(state, 0, state.sites.length - 1)];
    if (!other || other.id === site.id) return null;
    siteB = other.id;
  }
  const expiry = cfg.types[KIND_NAMES[kind]]?.expiryTicks ?? 0;
  const contested = roll(state, 1, 100) <= (cfg.contested?.percent ?? 0) ? 1 : 0;
  const baseReward = rewardFor(state, cfg, detCfg, kind, site.districtId);
  return {
    id: state.nextContractId++,
    kind,
    tier: tierOf(cfg, kind),
    districtId: site.districtId,
    siteId: site.id,
    siteIdB: siteB,
    // The premium is what makes taking a contested job a decision rather than a
    // trap: better money, and someone else is coming.
    reward: contested
      ? Math.trunc((baseReward * (cfg.contested?.rewardPct ?? 100)) / 100)
      : baseReward,
    expiresTick: expiry > 0 ? (state.tick + expiry) | 0 : 0,
    reservedBy: -1,
    // S16 8g. A contested contract is offered to SEVERAL Firms at once and pays
    // more for it: better money, and someone else is coming. `contenders` are
    // the Firms that took it — the first to finish wins and the rest fail, so
    // both sides are really working it rather than racing to click first.
    // S16 8g. Rolled from the seeded stream like everything else, so a world is
    // reproducible. A MINORITY on purpose: if most work were contested the board
    // would stop being a choice and every sortie would be a race.
    contested,
    contenders: [],
    contestedBy: [],
    acceptedBy: -1,
    stage: STAGE_OFFERED,
    stageTicks: 0,
    graceTicks: 0,      // D40 capture grace
    burnsTaken: 0,      // D39 recognition input
    legsDone: 0,        // D41 multi-stage progress
  };
}

function distanceFromHq(state, firmId, contract) {
  const hq = hqOf(state, firmId);
  const site = state.sites.find((s) => s.id === contract.siteId);
  if (!hq || !site) return 0x7fffffff;
  return Math.abs(hq.cellX - site.cellX) + Math.abs(hq.cellY - site.cellY);
}

// Distance in cells from a Firm's HQ — what gates the radius phases.
function phaseFor(state, cfg, firmId, contract) {
  const hq = hqOf(state, firmId);
  const site = state.sites.find((s) => s.id === contract.siteId);
  if (!hq || !site) return 99;
  const d = Math.abs(hq.cellX - site.cellX) + Math.abs(hq.cellY - site.cellY);
  // Radii are authored against a 64-cell world and scale with the map, so the
  // "mission radius expands" progression means the same thing at 128 (D26).
  const scale = Math.max(1, Math.trunc(state.size / 64));
  for (const phase of cfg.phases) {
    if (d >= phase.minCells * scale && d < phase.maxCells * scale) return phase.tier;
  }
  return cfg.phases[cfg.phases.length - 1].tier;
}

// THE DISJOINT-OFFER RULE (D18). A contract offered to one Firm is reserved to
// it; a second Firm's board can never contain the same contract. Reservations
// are released when the Firm's board is rebuilt or it leaves.
export function rebuildOffers(state, cfg, detCfg) {
  const deployed = state.firms.filter((f) => f.state !== 0);

  // Release reservations held by Firms that are no longer deployed.
  const liveIds = new Set(deployed.map((f) => f.id));
  for (const c of state.contractPool) {
    // A RECOVERY IS A DEBT, NOT AN OFFER (D51). Releasing it when the Firm goes
    // home is what this loop does for ordinary work — correctly, so a departed
    // Firm does not hoard the board — but applied to a recovery it stripped the
    // owner the moment they extracted, and the operative they left behind
    // became an anonymous contract nobody was on the hook for. The debt follows
    // the Firm across deployments; that is the entire point of it.
    if ((c.recoverAgentId ?? -1) >= 0) continue;
    if (c.reservedBy >= 0 && !liveIds.has(c.reservedBy) && c.acceptedBy < 0) {
      c.reservedBy = -1;
    }
  }
  state.offers = state.offers.filter((o) => liveIds.has(o.firmId));

  for (const firm of deployed) {
    let board = state.offers.find((o) => o.firmId === firm.id);
    if (!board) { board = { firmId: firm.id, contractIds: [] }; state.offers.push(board); }

    // Drop entries that are gone, taken, or expired. A CONTESTED contract is
    // the exception to D18's disjoint boards: it is deliberately on more than
    // one, so it survives this filter while nobody has finished it.
    board.contractIds = board.contractIds.filter((id) => {
      const c = state.contractPool.find((x) => x.id === id);
      if (!c) return false;
      if (c.contested) {
        // Still racing? Then it stays on OTHER Firms' boards. But it must leave
        // the board of a Firm that has already taken it — that Firm's copy is
        // now ACTIVE work, not an offer.
        //
        // Without the second clause a taken contested contract sat on its own
        // taker's board forever, filling one of the five slots with something
        // that could only ever answer "already_taken". Completions fell from ~7
        // to ~4 per world-day and extraction stopped entirely, because boards
        // silently ran out of room for real work.
        if (c.stage === STAGE_DONE || c.stage === STAGE_FAILED) return false;
        return !(c.contenders ?? []).includes(firm.id);
      }
      return c.reservedBy === firm.id && c.acceptedBy < 0;
    });

    // Preferred: contracts inside the Firm's unlocked tier AND radius phase.
    // Fallback: tier-appropriate contracts anywhere, nearest first.
    //
    // D18 promises every present Firm five real options. On a sparse map an
    // HQ can have NOTHING inside phase 1 (12 sites on a 64-cell world sit
    // ~18 cells apart, while phase 1 reaches 8), which produced empty boards.
    // The promise outranks the geometry: the radius progression shapes what
    // you are offered FIRST, it does not get to leave a player with no work.
    const fill = (predicate) => {
      while (board.contractIds.length < cfg.offersShown) {
        const candidates = state.contractPool.filter((c) => {
          if (c.stage !== STAGE_OFFERED) return false;
          if (c.tier > firm.tierUnlocked) return false;
          if (!predicate(c)) return false;
          if (c.contested) {
            // Offered to SEVERAL Firms, up to a cap: a job everyone in the city
            // is chasing is a scrum, not a contest.
            const on = (c.contestedBy ?? []).length;
            return !(c.contestedBy ?? []).includes(firm.id)
              && on < (cfg.contested?.maxFirms ?? 2);
          }
          return c.reservedBy < 0 && c.acceptedBy < 0;
        });
        if (!candidates.length) return;
        candidates.sort((a, b) => distanceFromHq(state, firm.id, a) - distanceFromHq(state, firm.id, b)
          || a.id - b.id);
        const pick = candidates[0];
        if (pick.contested) {
          pick.contestedBy = pick.contestedBy ?? [];
          pick.contestedBy.push(firm.id);
        } else {
          pick.reservedBy = firm.id;
        }
        board.contractIds.push(pick.id);
      }
    };
    fill((c) => phaseFor(state, cfg, firm.id, c) <= firm.tierUnlocked);
    fill(() => true);

    // D29: one greyed next-tier teaser, visible but not acceptable.
    board.teaserId = -1;
    if (cfg.teaserRow) {
      const teaser = state.contractPool.find((c) =>
        c.reservedBy < 0 && c.acceptedBy < 0 && c.tier === firm.tierUnlocked + 1);
      if (teaser) board.teaserId = teaser.id;
    }
  }
}

export function acceptContract(state, agent, contractId, cfg) {
  const contract = state.contractPool.find((c) => c.id === contractId);
  if (!contract) return "no_such_contract";
  const contested = !!contract.contested;
  // A contested contract can be taken by more than one Firm; an ordinary one
  // still cannot. Keeping D18's promise for everything else matters — disjoint
  // boards are what stop two players being sent to the same doorway by default.
  if (!contested && contract.acceptedBy >= 0) return "already_taken";
  if (contested && (contract.contenders ?? []).includes(agent.firmId)) return "already_taken";
  if (!contested && contract.reservedBy !== agent.firmId) return "not_offered_to_you";
  if (contested && !(contract.contestedBy ?? []).includes(agent.firmId)) {
    return "not_offered_to_you";
  }
  const firm = state.firms[agent.firmId];
  if (contract.tier > firm.tierUnlocked) return "tier_locked";
  if (agent.contractIds.length >= cfg.maxActivePerAgent) return "too_many_active";

  if (contested) {
    contract.contenders = contract.contenders ?? [];
    contract.contenders.push(agent.firmId);
    // TELEGRAPHED (S16): the moment a second Firm takes the job, everyone
    // already on it is told. A rival team that materialises unannounced reads
    // as unfair; one you can hear coming is a decision — hurry, hide, or set up.
    if (contract.contenders.length > 1) {
      state.events.push({
        type: "contractContested", contractId,
        firmIds: contract.contenders.slice(), siteId: contract.siteId,
      });
    }
  }
  // `acceptedBy` stays the FIRST taker so every existing reader keeps working;
  // `contenders` is the authority for who is racing.
  if (contract.acceptedBy < 0) contract.acceptedBy = agent.firmId;
  contract.stage = STAGE_TRAVEL;
  contract.stageTicks = 0;
  agent.contractIds.push(contract.id);
  state.events.push({
    type: "contractAccepted", contractId, firmId: agent.firmId,
    agentId: agent.id, kind: contract.kind, contested: contested ? 1 : 0,
  });
  return null;
}

export function abandonContract(state, agent, contractId) {
  const contract = state.contractPool.find((c) => c.id === contractId);
  if (!contract) return "no_such_contract";
  if (!agent.contractIds.includes(contractId)) return "not_yours";
  agent.contractIds = agent.contractIds.filter((id) => id !== contractId);
  contract.acceptedBy = -1;
  contract.reservedBy = -1;
  contract.stage = STAGE_OFFERED;
  contract.stageTicks = 0;
  state.events.push({ type: "contractAbandoned", contractId, firmId: agent.firmId });
  return null;
}

function siteCell(state, siteId) {
  const s = state.sites.find((x) => x.id === siteId);
  return s ? { x: s.cellX, y: s.cellY } : null;
}

// D41: the patrol window. An objective cannot be worked while a patrol is
// within `patrolWindow.radius`, so a contract is a matter of TIMING, not only
// of travel. This is where the minutes are meant to come from: watching a
// route, waiting for the pass, and moving in the gap.
export function windowOpen(state, siteId, cfg) {
  const win = cfg.patrolWindow;
  if (!win || !win.enabled) return true;
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) return true;
  for (const p of state.patrols) {
    if (Math.abs(p.x - site.cellX) + Math.abs(p.y - site.cellY) <= win.radius) return false;
  }
  return true;
}

// WHICH contract kinds a secured facility actually gates. ONE definition, used
// by both the contract machine and the AI scorer — when D41 moved acquisition's
// delivery and only the contract side was told, acquisition completed 0% for 24
// world-days. A rule the actor does not know is a rule nobody follows, so the
// rule lives in one place and both readers import it.
//
// Only D42's two types are gated: those are the ones that are meant to get
// harder as a season progresses. Gating courier or surveillance as well would
// make every contract type uniformly harder, which is the opposite of "some
// contracts harder" and would flatten the mix D19 measures.
export function requiresCredential(kind) {
  return kind === KIND_EXTRACTION || kind === KIND_ACQUISITION;
}

// S16 8f. A secured facility will not let you work without a pass, and says so
// — a work stage that silently never advances is indistinguishable from a bug,
// which is exactly how the acquisition-0% defect hid in M6.
//
// Emitted at most once per contract per stage entry (`accessNoted`), because a
// refusal repeated ten times a second is not information, it is noise.
export function accessBlocked(state, agent, contract, siteId) {
  if (!requiresCredential(contract.kind)) return false;
  const site = state.sites.find((s) => s.id === siteId);
  const need = site?.securityTier | 0;
  if (need <= 0) return false;
  if (hasCredential(state, agent.id, need)) return false;
  if (!contract.accessNoted) {
    contract.accessNoted = 1;
    state.events.push({
      type: "accessDenied", contractId: contract.id, agentId: agent.id,
      siteId, need, held: 0,
    });
  }
  return true;
}

// Where a contract wants the operative standing. A RECOVERY (D51) points at a
// Holding Site rather than a contract site, and this is the ONE place that
// difference lives — every stage check goes through here, so the extraction
// machine needs no branches of its own.
export function objectiveCellOf(state, contract) {
  if ((contract.recoverAgentId ?? -1) >= 0) {
    const pen = state.holdingSites.find((h) => h.id === contract.holdingSiteId);
    return pen ? { x: pen.cellX, y: pen.cellY } : null;
  }
  return siteCell(state, contract.siteId);
}

function atObjective(state, agent, contract, radius = 1) {
  // S17: same rule as atSite — inside the objective site's area counts.
  if ((contract.recoverAgentId ?? -1) < 0
    && insideSiteArea(state, agent, contract.siteId)) return true;
  const cell = objectiveCellOf(state, contract);
  if (!cell) return false;
  const here = agentCell(agent);
  return Math.abs(here.x - cell.x) + Math.abs(here.y - cell.y) <= radius;
}

function atSite(state, agent, siteId, radius = 1) {
  // S17: inside the site's mission area IS at the site — the street position
  // freezes on entry, and an agent who came in off the diagonal (enterArea
  // accepts Chebyshev 1, this check is Manhattan) froze one cell too far and
  // never advanced past TRAVEL, looping in and out of the door forever.
  if (insideSiteArea(state, agent, siteId)) return true;
  const cell = siteCell(state, siteId);
  if (!cell) return false;
  const here = agentCell(agent);
  return Math.abs(here.x - cell.x) + Math.abs(here.y - cell.y) <= radius;
}

function insideSiteArea(state, agent, siteId) {
  const ar = (state.areas ?? []).find((x) => x.siteId === siteId);
  return !!ar && agent.insideAreaId === ar.id;
}

// The player's explicit "do the thing here" action (plant, crack, pick up,
// begin holding). Contextual: what it does depends on the contract stage.
export function siteAction(state, agent, siteId, cfg) {
  const contractId = agent.contractIds.find((id) => {
    const c = state.contractPool.find((x) => x.id === id);
    return c && (c.siteId === siteId || c.siteIdB === siteId);
  });
  if (contractId === undefined) return "no_contract_here";
  const contract = state.contractPool.find((c) => c.id === contractId);
  const spec = cfg.types[KIND_NAMES[contract.kind]];

  if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
    contract.stage = STAGE_WORK;
    contract.stageTicks = 0;
    if (contract.kind === KIND_COURIER) {
      agent.carryKind = 1;                 // CARRY_PACKAGE
      agent.carryRef = contract.id;
      contract.stage = STAGE_RETURN;
      state.events.push({ type: "packagePickedUp", contractId, agentId: agent.id });
    } else {
      state.events.push({ type: "siteWorkStarted", contractId, agentId: agent.id });
    }
    return null;
  }
  return "not_actionable_here";
}

// How many ticks the CURRENT work stage needs. The client cannot compute this
// — the timers live in the ruleset, which never crosses the wire — so the view
// carries it and the HUD can draw a real progress bar. Without it a player
// stands still for 90 seconds with nothing on screen moving, which reads as a
// hung game rather than a contract in progress.
export function stageTargetTicks(contract, cfg) {
  const spec = cfg?.types?.[KIND_NAMES[contract.kind]];
  if (!spec || contract.stage !== STAGE_WORK) return 0;
  switch (contract.kind) {
    case KIND_SURVEILLANCE: return spec.holdTicks ?? 300;
    case KIND_SABOTAGE: return spec.plantTicks ?? 100;
    case KIND_ACQUISITION: return spec.crackTicks ?? 600;
    case KIND_EXTRACTION: return spec.secureTicks ?? 900;
    // Without this the defence HUD bar is blank for 3 minutes, which reads as a
    // hung game rather than as a contract in progress — the exact reason this
    // function exists.
    case KIND_DEFEND: return spec.holdTicks ?? 1800;
    default: return 0;
  }
}

// Per-tick progress for every accepted contract.
export function stepContracts(state, cfg, detCfg) {
  for (const contract of state.contractPool) {
    if (contract.expiresTick > 0 && contract.acceptedBy < 0
      && state.tick >= contract.expiresTick) {
      contract.stage = STAGE_FAILED;
      state.events.push({ type: "contractExpired", contractId: contract.id });
      continue;
    }
    if (contract.acceptedBy < 0) continue;
    if (contract.stage === STAGE_DONE || contract.stage === STAGE_FAILED) continue;

    const agent = state.agents.find((a) =>
      a.firmId === contract.acceptedBy && a.contractIds.includes(contract.id));
    if (!agent) continue;

    // D40: capture starts a GRACE WINDOW, it does not fail the contract on
    // the spot. A rescue or a paid bail inside the window restores it — which
    // is what makes going back for a captured colleague worth doing.
    if (agent.state === AGENT_HELD) {
      contract.graceTicks = (contract.graceTicks | 0) + 1;
      if (contract.graceTicks === 1) {
        state.events.push({
          type: "contractAtRisk", contractId: contract.id, firmId: contract.acceptedBy,
          agentId: agent.id, graceTicks: cfg.captureGraceTicks,
        });
      }
      if (contract.graceTicks >= cfg.captureGraceTicks) {
        failContract(state, contract, agent, "agent_held");
      }
      continue;
    }
    if (agent.state !== AGENT_ACTIVE) continue;
    // Back on their feet inside the window: the contract survives.
    if ((contract.graceTicks | 0) > 0) {
      contract.graceTicks = 0;
      state.events.push({
        type: "contractRecovered", contractId: contract.id, firmId: contract.acceptedBy,
      });
    }

    contract.stageTicks = (contract.stageTicks + 1) | 0;
    const spec = cfg.types[KIND_NAMES[contract.kind]];

    switch (contract.kind) {
      case KIND_COURIER: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          agent.carryKind = 1; agent.carryRef = contract.id;
          contract.stage = STAGE_RETURN; contract.stageTicks = 0;
          state.events.push({ type: "packagePickedUp", contractId: contract.id, agentId: agent.id });
        } else if (contract.stage === STAGE_RETURN && atSite(state, agent, contract.siteIdB)) {
          agent.carryKind = 0; agent.carryRef = -1;
          completeContract(state, contract, agent, cfg);
        }
        break;
      }
      // S16 8j (D49a). THE INBOUND CONTRACT. You hold a site while somebody
      // tries to take it, so the whole texture is inverted:
      //
      //   - being SEEN is not failure. You are supposed to be there. This is
      //     the only contract with no stealth clause at all, and that is the
      //     point of adding it — a rest from the one texture the game has.
      //   - leaving IS failure, immediately. Everything else forgives a wander
      //     by resetting a timer; here the thing you were guarding is behind
      //     you the moment you step away.
      //   - a rival reaching the site does not end it either. You are meant to
      //     be contested; the standoff machine (S08) resolves who is standing
      //     there afterwards, and the hold simply pauses while an intruder is
      //     on it. Holding under pressure is the job.
      case KIND_DEFEND: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          contract.stage = STAGE_WORK; contract.stageTicks = 0;
          state.events.push({ type: "defenceBegan", contractId: contract.id, agentId: agent.id });
        } else if (contract.stage === STAGE_WORK) {
          if (!atSite(state, agent, contract.siteId, 1)) {
            // Abandoning the post is the one way to lose this.
            failContract(state, contract, agent, "post_abandoned");
            break;
          }
          const site = state.sites.find((x) => x.id === contract.siteId);
          const breached = site ? state.agents.some((other) =>
            other.state === AGENT_ACTIVE
            && other.firmId !== agent.firmId
            && other.insideBuildingId < 0
            && Math.abs(worldToCellFloor(other.x) - site.cellX)
              + Math.abs(worldToCellFloor(other.y) - site.cellY) <= (spec.breachRadius ?? 3))
            : false;
          if (breached) {
            // The clock STOPS while a rival is on you; it does not reset. A
            // reset would mean any rival wandering past costs you the whole
            // hold, which makes the contract a coin-flip rather than a job.
            //
            // `stageTicks` was already advanced once above the switch, for
            // every contract kind, so pausing means giving that tick back —
            // not skipping an increment that never happened here.
            contract.stageTicks = (contract.stageTicks - 1) | 0;
            if (!contract.breachNoted) {
              contract.breachNoted = 1;
              state.events.push({
                type: "defenceBreached", contractId: contract.id, agentId: agent.id,
                siteId: contract.siteId,
              });
            }
          } else {
            contract.breachNoted = 0;
            // A DEFENCE DRAWS THE AUTHORITIES. Sitting on a site for 1800 ticks
            // is conspicuous, and this is what makes the contract a contract
            // rather than a paid wait: the rival-assault path (8l) needs a
            // spare Firm and almost never gets one, so a defence was contested
            // 2 times in 6 world-days and completed nearly always. Patrols are
            // always available and converging on a held position is exactly
            // what they already do for a burn — same helper, not a second one.
            const every = spec.patrolDrawTicks ?? 300;
            if (every > 0 && contract.stageTicks > 0 && contract.stageTicks % every === 0) {
              const site2 = state.sites.find((x) => x.id === contract.siteId);
              if (site2) {
                const drawn = convergePatrols(state, site2.cellX, site2.cellY, detCfg);
                if (drawn > 0) {
                  state.events.push({
                    type: "defenceNoticed", contractId: contract.id,
                    siteId: contract.siteId, patrols: drawn,
                  });
                }
              }
            }
            if (contract.stageTicks >= (spec.holdTicks ?? 1800)) {
              completeContract(state, contract, agent, cfg);
            }
          }
        }
        break;
      }
      case KIND_SURVEILLANCE: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          contract.stage = STAGE_WORK; contract.stageTicks = 0;
        } else if (contract.stage === STAGE_WORK) {
          // S17 AR-b: the hold happens INSIDE the mission area, at the
          // vantage, and it ticks ONLY while unseen — hiding IS the gameplay
          // (D63c). Stepping off the vantage, being seen, or leaving the
          // area resets the current pass, exactly like the old street hold.
          const sArea = state.areas.find((x) => x.siteId === contract.siteId);
          const vantage = sArea
            ? areaObjective(state.worldSeed, contract.siteId, state.rules.areas) : null;
          const atVantage = sArea && agent.insideAreaId === sArea.id
            && Math.max(Math.abs(agent.areaCol - vantage.x),
              Math.abs(agent.areaRow - vantage.y)) <= 1;
          if (!atVantage || agent.detection !== 0) {
            contract.stageTicks = 0;
          } else if (contract.stageTicks >= (spec.holdTicks ?? 300)) {
            // D41: several separate observation passes, not one long stare.
            // Breaking contact and returning is a decision each time.
            contract.legsDone = (contract.legsDone | 0) + 1;
            contract.stageTicks = 0;
            if (contract.legsDone >= (spec.passes ?? 1)) {
              completeContract(state, contract, agent, cfg);
            } else {
              state.events.push({
                type: "surveillancePass", contractId: contract.id,
                firmId: contract.acceptedBy,
                pass: contract.legsDone, of: spec.passes ?? 1,
              });
            }
          }
        }
        break;
      }
      case KIND_EXTRACTION: {
        // D41/Q37: extraction was the ONE type with no work stage — step on the
        // cell and the contact was yours. That made it both the least
        // interesting contract to play and, because the AI scores reward over
        // (distance + work), the one with a tiny denominator and therefore wild
        // score variance. Selection takes the MAX of five offers, so extraction
        // won the draw ~50% of the time no matter how its reward was tuned;
        // equalising averages cannot fix an argmax. The contact now has to be
        // talked out of the building, which costs time on site with the meter
        // running.
        if (contract.stage === STAGE_TRAVEL && atObjective(state, agent, contract)) {
          contract.stage = STAGE_WORK; contract.stageTicks = 0;
          state.events.push({ type: "siteWorkStarted", contractId: contract.id, agentId: agent.id });
        } else if (contract.stage === STAGE_WORK
          && (contract.recoverAgentId ?? -1) < 0) {
          // S17 AR-a: the work IS the mission area — go in, take the asset,
          // walk it out. The street sees only the outcome: an agent stepping
          // out of the compound carrying the goods flips the contract to its
          // return leg. Recoveries (D51) below keep the persuasion flow —
          // their objective is a Holding Site, which has no compound.
          if (agent.insideAreaId < 0
            && agent.carryKind === CARRY_AREA_ASSET
            && agent.carryRef === contract.siteId) {
            contract.stage = STAGE_RETURN;
            contract.stageTicks = 0;
            state.events.push({ type: "assetExtracted", contractId: contract.id, agentId: agent.id });
          }
        } else if (contract.stage === STAGE_WORK) {
          // Leaving the contact mid-persuasion loses the progress; being seen
          // does not, because a grab is a risk you take, not a stealth reset.
          if (!atObjective(state, agent, contract)) {
            contract.stageTicks = 0;
          } else if (accessBlocked(state, agent, contract, contract.siteId)) {
            // S16 8f: the contact is BEHIND access control, so a grab at a
            // secured facility needs the pass before the persuasion can start.
            contract.stageTicks = 0;
          } else if (contract.stageTicks >= (spec.secureTicks ?? 900)) {
            contract.stage = STAGE_RETURN; contract.stageTicks = 0;
            agent.carryKind = 3; agent.carryRef = contract.id;   // CARRY_AGENT
            // D51: on a recovery the "contact" is your own operative, and this
            // is the moment they walk out of the Holding Site.
            if ((contract.recoverAgentId ?? -1) >= 0) {
              const freed = state.agents[contract.recoverAgentId];
              const here = agentCell(agent);
              if (freed) releaseAgent(state, freed, state.rules.agents, here.x, here.y);
              state.events.push({
                type: "agentRecovered", contractId: contract.id,
                agentId: contract.recoverAgentId, byAgentId: agent.id,
              });
            } else {
              state.events.push({ type: "contactSecured", contractId: contract.id, agentId: agent.id });
            }
          }
        } else if (contract.stage === STAGE_RETURN) {
          const hq = hqOf(state, agent.firmId);
          const here = agentCell(agent);
          if (hq && Math.abs(hq.cellX - here.x) + Math.abs(hq.cellY - here.y) <= 2) {
            agent.carryKind = 0; agent.carryRef = -1;
            completeContract(state, contract, agent, cfg);
          }
        }
        break;
      }
      case KIND_SABOTAGE: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          contract.stage = STAGE_WORK; contract.stageTicks = 0;
        } else if (contract.stage === STAGE_WORK) {
          if (!windowOpen(state, contract.siteId, cfg)) break;   // wait for the pass
          if (contract.stageTicks >= (spec.plantTicks ?? 100)) {
            contract.legsDone = (contract.legsDone | 0) + 1;
            contract.stageTicks = 0;
            state.events.push({
              type: "chargePlanted", contractId: contract.id, agentId: agent.id,
              leg: contract.legsDone, of: spec.legs ?? 1,
            });
            // D41: a second charge, on a DIFFERENT site, under the fuse. The
            // sites swap so leg 2 is a journey rather than standing still.
            if (contract.legsDone < (spec.legs ?? 1) && contract.siteIdB >= 0) {
              const first = contract.siteId;
              contract.siteId = contract.siteIdB;
              contract.siteIdB = first;
              contract.stage = STAGE_TRAVEL;
            } else {
              contract.stage = STAGE_RETURN;
            }
          }
        } else if (contract.stage === STAGE_RETURN) {
          if (contract.stageTicks >= (spec.fuseTicks ?? 300)) {
            // Blast: the site goes offline and the district gets very hot.
            const site = state.sites.find((s) => s.id === contract.siteId);
            if (site) site.status = 1;
            const here = agentCell(agent);
            const blast = siteCell(state, contract.siteId);
            const clear = blast
              ? Math.abs(here.x - blast.x) + Math.abs(here.y - blast.y) > 3 : true;
            if (clear) completeContract(state, contract, agent, cfg);
            else failContract(state, contract, agent, "caught_in_blast");
          }
        }
        break;
      }
      case KIND_ACQUISITION: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          contract.stage = STAGE_WORK; contract.stageTicks = 0;
        } else if (contract.stage === STAGE_WORK) {
          if (!atSite(state, agent, contract.siteId)) contract.stageTicks = 0;
          else if (accessBlocked(state, agent, contract, contract.siteId)) {
            contract.stageTicks = 0;      // the door does not open; the clock does not run
          } else if (contract.stageTicks >= (spec.crackTicks ?? 200)) {
            agent.carryKind = 2; agent.carryRef = contract.id;   // CARRY_INTEL
            contract.stage = STAGE_RETURN; contract.stageTicks = 0;
            state.events.push({ type: "vaultCracked", contractId: contract.id, agentId: agent.id });
          }
        } else if (contract.stage === STAGE_RETURN) {
          // D41: the vault alarms behind you, so the goods go to a separate
          // drop-off rather than back the way you came.
          const useDrop = (spec.dropOff === true) && contract.siteIdB >= 0;
          const done = useDrop
            ? atSite(state, agent, contract.siteIdB, 1)
            : (() => {
              const hq = hqOf(state, agent.firmId);
              const here = agentCell(agent);
              return hq && Math.abs(hq.cellX - here.x) + Math.abs(hq.cellY - here.y) <= 2;
            })();
          if (done) {
            agent.carryKind = 0; agent.carryRef = -1;
            completeContract(state, contract, agent, cfg);
          }
        }
        break;
      }
    }
  }
}

// Rewards land in the HQ CACHE, never the bank. Only extraction banks (D7/D30).
// Everyone who was racing and did not win. Their copy of the job is over: the
// contact left with the other Firm, the vault is already empty. Told explicitly,
// because an objective that silently stops being completable is the failure mode
// that reads as a broken game rather than as a loss.
function releaseLosers(state, contract, winnerFirmId) {
  if (!contract.contested) return;
  for (const firmId of contract.contenders ?? []) {
    if (firmId === winnerFirmId) continue;
    for (const a of state.agents) {
      if (a.firmId !== firmId) continue;
      a.contractIds = a.contractIds.filter((id) => id !== contract.id);
    }
    state.events.push({
      type: "contractLost", contractId: contract.id, firmId,
      toFirmId: winnerFirmId, kind: contract.kind,
    });
  }
}

export function completeContract(state, contract, agent, cfg) {
  contract.stage = STAGE_DONE;
  // S16 8g: on a contested contract the winner is whoever FINISHED it, which is
  // not necessarily `acceptedBy` (the first taker). Paying the first taker for
  // someone else's work would be the quietest possible way to make the whole
  // race pointless, so the completing agent's Firm is credited.
  const winnerId = contract.contested ? agent.firmId : contract.acceptedBy;
  const firm = state.firms[winnerId];
  const hq = hqOf(state, winnerId);
  if (hq) hq.cacheResources += contract.reward;
  else if (firm) firm.cacheResources += contract.reward;
  if (firm) {
    // D39: Recognition rewards CRAFT, not payout — tier, plus a bonus for
    // finishing unseen, minus the burns taken while running it. The lifetime
    // honor score should say how well you work, not how long you worked.
    const rec = cfg.recognition ?? { perTier: 20, unseenBonus: 15, perBurn: -10 };
    let earned = rec.perTier * contract.tier;
    if ((contract.burnsTaken | 0) === 0) earned += rec.unseenBonus;
    earned += rec.perBurn * (contract.burnsTaken | 0);
    firm.recognition = Math.max(0, firm.recognition + earned) | 0;
    state.events.push({
      type: "recognitionEarned", firmId: firm.id, amount: earned,
      tier: contract.tier, burns: contract.burnsTaken | 0,
    });
    firm.completedThisTier = (firm.completedThisTier | 0) + 1;
    const needed = cfg.unlockCompletions[firm.tierUnlocked - 1] ?? 99;
    if (firm.completedThisTier >= needed && firm.tierUnlocked < cfg.phases.length) {
      firm.tierUnlocked += 1;
      firm.completedThisTier = 0;
      state.events.push({ type: "tierUnlocked", firmId: firm.id, tier: firm.tierUnlocked });
    }
  }
  agent.contractIds = agent.contractIds.filter((id) => id !== contract.id);
  releaseLosers(state, contract, winnerId);
  state.events.push({
    type: "contractCompleted", contractId: contract.id, firmId: winnerId,
    kind: contract.kind, reward: contract.reward,
    contested: contract.contested ? 1 : 0,
  });
}

export function failContract(state, contract, agent, reason) {
  contract.stage = STAGE_FAILED;
  if (agent) agent.contractIds = agent.contractIds.filter((id) => id !== contract.id);
  state.events.push({
    type: "contractFailed", contractId: contract.id,
    firmId: contract.acceptedBy, reason,
  });
}

// D39: a burn while running a contract is recorded against it, so Recognition
// can price cleanliness. Called from the detection system's burn path.
export function noteBurn(state, agentId) {
  const agent = state.agents[agentId];
  if (!agent) return;
  for (const id of agent.contractIds) {
    const contract = state.contractPool.find((c) => c.id === id);
    if (contract) contract.burnsTaken = (contract.burnsTaken | 0) + 1;
  }
}

// D35: drop-in seeds extra Contract Sites near a new HQ, so "work starts
// close" is true by construction rather than by luck of the seed. Without
// this the phase-1 radius is frequently empty on a sparse map and the
// expanding-radius progression never gets to mean anything.
export function seedSitesNearHq(state, hq, cfg, citygenCfg) {
  const want = cfg.nearHqSites ?? 3;
  const radius = cfg.phases[0].maxCells;
  // Seeded work must still be work: a site placed on (or beside) the HQ means
  // the agent spawns already standing on its objective and the contract
  // auto-advances before the player has done anything. "Close" is not "here".
  const minFromHq = cfg.nearHqMinDistance ?? 4;
  const near = state.sites.filter((s) =>
    Math.abs(s.cellX - hq.cellX) + Math.abs(s.cellY - hq.cellY) <= radius);
  if (near.length >= want) return 0;

  const { isPassableForSite } = siteHelpers(state);
  let added = 0;
  for (let attempt = 0; attempt < 300 && near.length + added < want; attempt++) {
    const dx = roll(state, -radius, radius);
    const dy = roll(state, -radius, radius);
    const x = hq.cellX + dx, y = hq.cellY + dy;
    if (x < 1 || y < 1 || x >= state.size - 1 || y >= state.size - 1) continue;
    const fromHq = Math.abs(dx) + Math.abs(dy);
    if (fromHq > radius || fromHq < minFromHq) continue;
    if (!isPassableForSite(x, y)) continue;
    const spacing = citygenCfg?.sites?.minSpacing ?? 5;
    let clash = false;
    for (const s of state.sites) {
      if (Math.abs(s.cellX - x) + Math.abs(s.cellY - y) < spacing) { clash = true; break; }
    }
    if (clash) continue;
    state.sites.push({
      id: state.sites.length,
      type: roll(state, 0, 5),
      districtId: state.districtOwner ? state.districtOwner[y * state.size + x] : 0,
      cellX: x, cellY: y, status: 0,
    });
    added++;
  }
  if (added) state.events.push({ type: "sitesSeeded", hqId: hq.id, count: added });
  return added;
}

function siteHelpers(state) {
  return {
    isPassableForSite(x, y) {
      // Connected, not merely passable. A seeded site in an enclosed courtyard
      // is an objective nobody can walk to — the same stranding class of bug
      // that put an agent inside a sealed plaza (see findDropZones).
      if (state.reachable && !state.reachable[y * state.size + x]) return false;
      const t = state.map.cells[y * state.size + x];
      // open, plaza, yard, rough or alley — never street (too exposed for a
      // contract anchor) and never block/water.
      return t === 0 || t === 2 || t === 3 || t === 8 || t === 9;
    },
  };
}

// Retire finished contracts so the pool can regenerate (S06).
export function reapContracts(state) {
  const before = state.contractPool.length;
  state.contractPool = state.contractPool.filter(
    (c) => c.stage !== STAGE_DONE && c.stage !== STAGE_FAILED);
  return before - state.contractPool.length;
}
