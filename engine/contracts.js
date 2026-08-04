// engine/contracts.js — the contract economy and objective machines
// (S06, D18, D19, D29).
//
// THE D18 ECONOMY: the world keeps a pool of 5 contracts per player slot. Each
// deployed Firm is shown 5 offers, and offers are RESERVED — no two concurrent
// boards share a contract. Every player always has real options that are not
// the neighbour's leftovers.

import { AGENT_ACTIVE, AGENT_HELD } from "./state.js";
import { agentCell } from "./detection.js";
import { hqOf } from "./hq.js";
import { sfc32Next } from "../shared/prng.js";
import { worldToCellFloor } from "../shared/fixedmath.js";

export const KIND_COURIER = 0;
export const KIND_SURVEILLANCE = 1;
export const KIND_EXTRACTION = 2;
export const KIND_SABOTAGE = 3;
export const KIND_ACQUISITION = 4;
export const KIND_COUNT = 5;

export const KIND_NAMES = ["courier", "surveillance", "extraction", "sabotage", "acquisition"];

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
  return {
    id: state.nextContractId++,
    kind,
    tier: tierOf(cfg, kind),
    districtId: site.districtId,
    siteId: site.id,
    siteIdB: siteB,
    reward: rewardFor(state, cfg, detCfg, kind, site.districtId),
    expiresTick: expiry > 0 ? (state.tick + expiry) | 0 : 0,
    reservedBy: -1,
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
    if (c.reservedBy >= 0 && !liveIds.has(c.reservedBy) && c.acceptedBy < 0) {
      c.reservedBy = -1;
    }
  }
  state.offers = state.offers.filter((o) => liveIds.has(o.firmId));

  for (const firm of deployed) {
    let board = state.offers.find((o) => o.firmId === firm.id);
    if (!board) { board = { firmId: firm.id, contractIds: [] }; state.offers.push(board); }

    // Drop entries that are gone, taken, or expired.
    board.contractIds = board.contractIds.filter((id) => {
      const c = state.contractPool.find((x) => x.id === id);
      return c && c.reservedBy === firm.id && c.acceptedBy < 0;
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
        const candidates = state.contractPool.filter((c) =>
          c.reservedBy < 0 && c.acceptedBy < 0
          && c.stage === STAGE_OFFERED
          && c.tier <= firm.tierUnlocked
          && predicate(c));
        if (!candidates.length) return;
        candidates.sort((a, b) => distanceFromHq(state, firm.id, a) - distanceFromHq(state, firm.id, b)
          || a.id - b.id);
        const pick = candidates[0];
        pick.reservedBy = firm.id;
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
  if (contract.acceptedBy >= 0) return "already_taken";
  if (contract.reservedBy !== agent.firmId) return "not_offered_to_you";
  const firm = state.firms[agent.firmId];
  if (contract.tier > firm.tierUnlocked) return "tier_locked";
  if (agent.contractIds.length >= cfg.maxActivePerAgent) return "too_many_active";

  contract.acceptedBy = agent.firmId;
  contract.stage = STAGE_TRAVEL;
  contract.stageTicks = 0;
  agent.contractIds.push(contract.id);
  state.events.push({
    type: "contractAccepted", contractId, firmId: agent.firmId,
    agentId: agent.id, kind: contract.kind,
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

function atSite(state, agent, siteId, radius = 1) {
  const cell = siteCell(state, siteId);
  if (!cell) return false;
  const here = agentCell(agent);
  return Math.abs(here.x - cell.x) + Math.abs(here.y - cell.y) <= radius;
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
      case KIND_SURVEILLANCE: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          contract.stage = STAGE_WORK; contract.stageTicks = 0;
        } else if (contract.stage === STAGE_WORK) {
          // Holding only counts while UNSEEN and while the patrol window is
          // open — that is the whole contract.
          if (!atSite(state, agent, contract.siteId) || agent.detection !== 0
            || !windowOpen(state, contract.siteId, cfg)) {
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
                pass: contract.legsDone, of: spec.passes ?? 1,
              });
            }
          }
        }
        break;
      }
      case KIND_EXTRACTION: {
        if (contract.stage === STAGE_TRAVEL && atSite(state, agent, contract.siteId)) {
          contract.stage = STAGE_RETURN; contract.stageTicks = 0;
          agent.carryKind = 3; agent.carryRef = contract.id;   // CARRY_AGENT
          state.events.push({ type: "contactSecured", contractId: contract.id, agentId: agent.id });
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
            // D41: a second charge, on a different site, under the fuse.
            if (contract.legsDone < (spec.legs ?? 1) && contract.siteIdB >= 0) {
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
          else if (contract.stageTicks >= (spec.crackTicks ?? 200)) {
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
export function completeContract(state, contract, agent, cfg) {
  contract.stage = STAGE_DONE;
  const firm = state.firms[contract.acceptedBy];
  const hq = hqOf(state, contract.acceptedBy);
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
  state.events.push({
    type: "contractCompleted", contractId: contract.id, firmId: contract.acceptedBy,
    kind: contract.kind, reward: contract.reward,
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
