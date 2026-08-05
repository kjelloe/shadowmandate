// engine/view.js — fog-filtered per-Firm views (S11).
//
// **VIEWS CROSS THE WIRE, STATE DOES NOT.** This is the inherited invariant
// that makes cheating structural nonsense rather than a validation chore: a
// client cannot reveal what was never sent to it. Every field here is one a
// player is entitled to know.
//
// Three privacy rules this enforces, each of which is a ruling:
//  - D20: exact district heat only with intel; otherwise the 3-step band.
//  - D18: a Firm sees ITS OWN five offers, never the pool or a rival's board.
//  - Fog: rival agents and HQs only within your own sensor reach.

import { AGENT_ACTIVE, AGENT_DOWNED, AGENT_INSIDE, AGENT_HELD } from "./state.js";
import { heatBandFor, agentCell } from "./detection.js";
import { hasHeatIntel } from "./buildings.js";
import { worldToCellFloor } from "../shared/fixedmath.js";

const SIGHT = 10;          // what your own agent can make out, in cells

function within(ax, ay, bx, by, r) {
  return Math.abs(ax - bx) + Math.abs(ay - by) <= r;
}

export function buildView(state, firmId, detCfg) {
  const firm = state.firms[firmId];
  if (!firm) return null;
  const own = state.agents.filter((a) => a.firmId === firmId && a.state !== 0);
  const eyes = own.filter((a) => a.state === AGENT_ACTIVE).map(agentCell);
  const hq = state.hqs.find((h) => h.firmId === firmId) ?? null;
  if (hq) eyes.push({ x: hq.cellX, y: hq.cellY });

  const visible = (cx, cy) => eyes.some((e) => within(e.x, e.y, cx, cy, SIGHT));

  return {
    tick: state.tick,
    worldSeed: state.worldSeed,
    size: state.size,

    firm: {
      id: firm.id, nameId: firm.nameId, state: firm.state,
      reputation: firm.reputation, recognition: firm.recognition,
      tierUnlocked: firm.tierUnlocked, upgrades: (firm.upgrades ?? []).slice(),
    },

    // Your own agents in full — you know your own operatives.
    agents: own.map((a) => ({
      id: a.id, state: a.state, x: a.x, y: a.y, facing: a.facing,
      stance: a.stance, condition: a.condition, detection: a.detection,
      carryKind: a.carryKind, insideBuildingId: a.insideBuildingId,
      disguiseId: a.disguiseId, vehicleId: a.vehicleId,
      contractIds: a.contractIds.slice(),
    })),

    // Rivals: position only, and only what you can actually see. An agent
    // inside a building is not on the street and is not reported at all.
    rivals: state.agents
      .filter((a) => a.firmId >= 0 && a.firmId !== firmId
        && (a.state === AGENT_ACTIVE || a.state === AGENT_DOWNED)
        && a.insideBuildingId < 0
        && visible(worldToCellFloor(a.x), worldToCellFloor(a.y)))
      .map((a) => ({
        id: a.id, firmId: a.firmId, x: a.x, y: a.y, facing: a.facing,
        state: a.state, detection: a.detection,
      })),

    hq: hq ? {
      cellX: hq.cellX, cellY: hq.cellY, condition: hq.condition,
      cacheResources: hq.cacheResources, evacActive: hq.evacActive,
      evacTicks: hq.evacTicks, evacPaused: hq.evacPaused,
      alarmTicks: hq.alarmTicks,
    } : null,

    // Rival HQs: seen, or bought from an informant.
    rivalHqs: state.hqs
      .filter((h) => h.firmId !== firmId
        && (visible(h.cellX, h.cellY) || (firm.knownRivalHqs ?? []).includes(h.id)))
      .map((h) => ({ id: h.id, firmId: h.firmId, cellX: h.cellX, cellY: h.cellY })),

    patrols: state.patrols
      .filter((p) => visible(p.x, p.y))
      .map((p) => ({ id: p.id, x: p.x, y: p.y, alerted: p.alertTicks > 0 ? 1 : 0 })),

    // D20: the band always; the exact number only with intel.
    districts: state.districts.map((d) => {
      const exact = hasHeatIntel(state, firm, d.id);
      return {
        id: d.id, trait: d.trait, coreX: d.coreX, coreY: d.coreY,
        heatBand: heatBandFor(d.heat, detCfg),
        heat: exact ? d.heat : -1,
      };
    }),

    sites: state.sites.map((s) => ({
      id: s.id, type: s.type, districtId: s.districtId,
      cellX: s.cellX, cellY: s.cellY, status: s.status,
    })),
    buildings: state.buildings.map((b) => ({
      id: b.id, kind: b.kind, cellX: b.entranceX, cellY: b.entranceY,
    })),
    holdingSites: state.holdingSites.map((h) => ({
      id: h.id, cellX: h.cellX, cellY: h.cellY,
      // You know your OWN people are in there; not who else is.
      heldOwn: h.heldAgentIds.filter((id) => state.agents[id]?.firmId === firmId),
    })),

    // The contracts this Firm is actually RUNNING. The board only ever shows
    // OFFERS — `rebuildOffers` drops a contract the moment it is accepted and
    // replaces it — so without this the player accepts a job, watches it
    // disappear, and has no way to see what they are carrying.
    active: (() => {
      const ids = new Set(own.flatMap((a) => a.contractIds));
      return state.contractPool.filter((c) => ids.has(c.id)).map((c) => ({
        id: c.id, kind: c.kind, tier: c.tier, districtId: c.districtId,
        siteId: c.siteId, siteIdB: c.siteIdB, reward: c.reward,
        stage: c.stage, stageTicks: c.stageTicks,
        legsDone: c.legsDone ?? 0, graceTicks: c.graceTicks ?? 0,
      }));
    })(),

    // D18: your five offers, and nothing else about the pool.
    board: (() => {
      const offers = state.offers.find((o) => o.firmId === firmId);
      if (!offers) return { contracts: [], teaser: null };
      const pick = (id) => {
        const c = state.contractPool.find((x) => x.id === id);
        if (!c) return null;
        return {
          id: c.id, kind: c.kind, tier: c.tier, districtId: c.districtId,
          siteId: c.siteId, siteIdB: c.siteIdB, reward: c.reward,
          expiresTick: c.expiresTick, stage: c.stage, legsDone: c.legsDone ?? 0,
          acceptedByMe: c.acceptedBy === firmId ? 1 : 0,
        };
      };
      const teaser = pick(offers.teaserId ?? -1);
      return {
        contracts: offers.contractIds.map(pick).filter(Boolean),
        teaser: teaser ? { ...teaser, locked: 1 } : null,
      };
    })(),

    standoff: (() => {
      const mine = state.standoffs.find((s) =>
        own.some((a) => a.id === s.agentA || a.id === s.agentB));
      if (!mine) return null;
      const meIsA = own.some((a) => a.id === mine.agentA);
      const themId = meIsA ? mine.agentB : mine.agentA;
      const them = state.agents[themId];
      return {
        id: mine.id, ticksLeft: mine.ticksLeft,
        myChoice: meIsA ? mine.choiceA : mine.choiceB,
        rivalFirmId: them?.firmId ?? -1,
        rivalReputation: state.firms[them?.firmId]?.reputation ?? 0,
      };
    })(),

    pacts: state.pacts
      .filter((p) => p.firmA === firmId || p.firmB === firmId)
      .map((p) => ({ withFirmId: p.firmA === firmId ? p.firmB : p.firmA, expiresTick: p.expiresTick })),
  };
}

// The audit used by the server tests: a view must never carry a field that
// leaks. Listed explicitly so a new field has to be considered, not inherited.
export const FORBIDDEN_IN_VIEW = [
  "contractPool",   // the whole pool would expose rivals' work (D18)
  "rng",            // the PRNG state would make the world predictable
  "rules",          // config, not state
  "districtOwner",
  "reachable",
];
