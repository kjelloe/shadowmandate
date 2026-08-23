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
import { stageTargetTicks } from "./contracts.js";
import { alarmStageOf } from "./security.js";
import { cameraFacingAt, isDisabled } from "./cameras.js";
import { beamLiveAt } from "./sensors.js";
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
      // Where this agent is heading (playtest 6): the client's destination
      // pin. OWN agents only — a rival's destination would leak intent.
      targetX: a.targetX, targetY: a.targetY,
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
      // Playtest 12: the client offers EVAC only where the reducer would
      // accept it, so it needs the perimeter the reducer checks.
      perimeterRadius: state.rules?.hq?.perimeterRadius ?? 4,
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
      .map((p) => ({
        id: p.id, x: p.x, y: p.y, alerted: p.alertTicks > 0 ? 1 : 0,
        // S16 8k. Without this the client cannot tell a guard you put down from
        // one merely standing still, so the badge is unreachable for a player
        // even though the command exists.
        disabled: (p.stunnedUntil | 0) > state.tick ? 1 : 0,
      })),

    // D20: the band always; the exact number only with intel.
    districts: state.districts.map((d) => {
      const exact = hasHeatIntel(state, firm, d.id);
      return {
        id: d.id, trait: d.trait, coreX: d.coreX, coreY: d.coreY,
        heatBand: heatBandFor(d.heat, detCfg),
        heat: exact ? d.heat : -1,
      };
    }),

    // S16: an alarm is only reported for a site the Firm can currently SEE.
    // A siren is a local fact — knowing that a facility three districts away
    // just went into lockdown would hand the player a free map of where every
    // rival is working, and the stealth layer is a fog problem before it is a
    // data problem. Out of sight reports stage 0, which is also what an
    // un-alarmed site reports: the view deliberately cannot distinguish
    // "clear" from "I cannot tell".
    sites: state.sites.map((s) => ({
      id: s.id, type: s.type, districtId: s.districtId,
      cellX: s.cellX, cellY: s.cellY, status: s.status,
      alarmStage: visible(s.cellX, s.cellY) ? alarmStageOf(state, s.id) : 0,
    })),
    // S16 8b. A camera is sent only when the Firm can SEE it, and only ever as
    // where it is and where it is looking RIGHT NOW. The sweep definition —
    // span, dwell, phase — never crosses the wire: with it a client could
    // compute every future safe window and play the stealth layer perfectly
    // without looking. Learning the pattern by watching is the mechanic (D45);
    // being handed it is the mechanic deleted.
    cameras: (state.cameras ?? [])
      .filter((c) => visible(c.cellX, c.cellY))
      .map((c) => ({
        id: c.id, siteId: c.siteId, cellX: c.cellX, cellY: c.cellY,
        facing: cameraFacingAt(c, state.tick),
        arc: c.arc, range: c.range,
        disabled: isDisabled(c, state.tick) ? 1 : 0,
      })),
    // S16 8c. A beam is sent with its endpoints and whether it is LIVE RIGHT
    // NOW — never its cycle. onTicks/offTicks/phase would let a client compute
    // every future gap and cross perfectly without watching, which deletes the
    // one mechanic whose counter-play is pure timing.
    beams: (state.beams ?? [])
      .filter((x) => visible(x.cellX, x.cellY) || visible(x.toX, x.toY))
      .map((x) => ({
        id: x.id, siteId: x.siteId,
        cellX: x.cellX, cellY: x.cellY, toX: x.toX, toY: x.toY,
        live: beamLiveAt(x, state.tick) ? 1 : 0,
      })),
    // S16 8d. A junction is a thing you walk to, so it is shown when visible,
    // with whether it is currently down. No timer: "when does it come back" is
    // tension the player should feel rather than read off a counter.
    junctions: (state.junctions ?? [])
      .filter((j) => visible(j.cellX, j.cellY))
      .map((j) => ({
        id: j.id, siteId: j.siteId, cellX: j.cellX, cellY: j.cellY,
        cut: (j.cutUntil | 0) > state.tick ? 1 : 0,
      })),
    buildings: state.buildings.map((b) => ({
      id: b.id, kind: b.kind, cellX: b.entranceX, cellY: b.entranceY,
      exitX: b.exitX ?? -1, exitY: b.exitY ?? -1,
    })),

    // The door the operative is standing on, if any — the client cannot offer
    // "go inside" without knowing there is an inside to go into.
    atDoor: (() => {
      const lead = own.find((a) => a.state === AGENT_ACTIVE);
      if (!lead) return null;
      const cell = agentCell(lead);
      const b = state.buildings.find((x) =>
        (x.entranceX === cell.x && x.entranceY === cell.y)
        || (x.exitX === cell.x && x.exitY === cell.y));
      return b ? { id: b.id, kind: b.kind, districtId: b.districtId } : null;
    })(),

    // Which building the operative is INSIDE, so the overlay knows to open.
    inside: (() => {
      const lead = own.find((a) => a.insideBuildingId >= 0);
      if (!lead) return null;
      const b = state.buildings.find((x) => x.id === lead.insideBuildingId);
      return b ? { id: b.id, kind: b.kind, districtId: b.districtId, agentId: lead.id } : null;
    })(),
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
        stageTarget: stageTargetTicks(c, state.rules?.contracts ?? null),
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
          acceptedByMe: (c.contested
            ? (c.contenders ?? []).includes(firmId)
            : c.acceptedBy === firmId) ? 1 : 0,
          // S16 8g. The flag is the informed-choice half of D18: better pay,
          // someone else is coming. WITHOUT it a contested contract is just a
          // job that mysteriously vanishes, which is exactly the experience
          // disjoint boards exist to prevent. `rivals` is a COUNT, never
          // identities — knowing which Firm is racing you would leak the rival
          // board across the fog.
          contested: c.contested ? 1 : 0,
          rivals: c.contested
            ? Math.max(0, (c.contenders ?? []).filter((f) => f !== firmId).length) : 0,
        };
      };
      const teaser = pick(offers.teaserId ?? -1);
      return {
        contracts: offers.contractIds.map(pick).filter(Boolean),
        teaser: teaser ? { ...teaser, locked: 1 } : null,
      };
    })(),

    // S16 8i. The warning window is the whole fairness of the raid, and a
    // warning the client cannot see is not a warning. Sent as "how long until
    // they are dispatched", not a raw tick, because the client should not have
    // to know the world's clock to draw a countdown.
    raid: (() => {
      const r = (state.raids ?? []).find((x) => x.targetFirmId === firmId && x.state !== 2);
      if (!r) return null;
      return {
        id: r.id, state: r.state,
        ticksToDispatch: Math.max(0, r.dispatchTick - state.tick),
        ticksLeft: Math.max(0, r.expiresTick - state.tick),
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
