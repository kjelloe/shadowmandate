// engine/buildings.js — building entry and the Cover Shop (S09, D9, D38).
//
// Exteriors only: entering parks the agent hidden at the entrance and the
// CLIENT opens an overlay. The world sim only ever knows "inside building N".
//
// D38 — buildings do not launder a burn. Ducking into a shop hides you, but
// the moment you step out you are still the person Authority is looking for,
// and patrols converge on the door and wait. The one exception is a COVER
// SHOP: pay, change your face, and leave by the other door. That is the GTA2
// re-spray applied to people, and it is the only way to clear a burn without
// waiting it out.

import { AGENT_ACTIVE, AGENT_INSIDE, DET_UNSEEN, DET_BURNED } from "./state.js";
import { agentCell } from "./detection.js";
import { grantCredential } from "./access.js";
import { cellToWorld } from "../shared/fixedmath.js";
import { BUILDING_COVERSHOP, BUILDING_CUBBY } from "./citygen.js";
import { lightPhase } from "./season.js";

// Disguise variants. Deliberately comic: the fantasy of a back-room cover shop
// is that you walk out looking like someone your own mother would query, and
// the game is funnier for letting the player see it. The client picks the
// portrait from this id; the engine only tracks which one you are wearing.
export const DISGUISE_NONE = 0;
export const DISGUISE_COUNT = 6;   // see data/buildings/disguises.json

// ── Dialogue and shops (S09) ──────────────────────────────────────────────
//
// Content is DATA. `data/buildings/payloads.json` declares options, costs and
// effects; this module applies them. A content author adds an informant line
// or a shop item without touching engine code, and every string is an i18n key
// so nothing ships untranslatable.

export const EFFECT_REVEAL_RIVAL_HQ = "revealRivalHq";
export const EFFECT_HEAT_INTEL = "heatIntel";
export const EFFECT_CREDENTIAL = "credential";   // S16 8e
export const EFFECT_UPGRADE = "upgrade";
export const EFFECT_HEAL = "heal";
export const EFFECT_COVER = "cover";
export const EFFECT_WAIT_DARK = "waitForDark";   // S09/Q45 — park until nightfall

// What a Firm currently knows that it had to buy. Kept on the Firm because it
// survives the agent (intel outlives the operative who paid for it).
export function grantHeatIntel(state, firm, districtId, ticks) {
  firm.heatIntel = firm.heatIntel ?? [];
  const existing = firm.heatIntel.find((h) => h.districtId === districtId);
  const expires = (state.tick + ticks) | 0;
  if (existing) existing.expiresTick = Math.max(existing.expiresTick, expires);
  else firm.heatIntel.push({ districtId, expiresTick: expires });
}

export function hasHeatIntel(state, firm, districtId) {
  return (firm.heatIntel ?? []).some((h) =>
    h.districtId === districtId && state.tick < h.expiresTick);
}

// The payload a building is currently offering, given world conditions.
// An informant goes quiet in a locked-down district (D20/S03) — the content
// declares the threshold, the engine enforces it.
export function payloadFor(building, payloads, districtHeat) {
  if (building.kind === BUILDING_COVERSHOP) {
    return payloads.shops.find((s) => s.id === "covershop") ?? null;
  }
  // S09/Q45: a cubby is a recess, not a person — one paid option, no heat
  // gate (a lockdown is exactly when you want a hole to hide in).
  if (building.kind === BUILDING_CUBBY) {
    return payloads.dialogues.find((d) => d.id === "cubby") ?? null;
  }
  if (building.kind === 1) return payloads.shops.find((s) => s.id === "vendor") ?? null;
  const dialogue = payloads.dialogues.find((d) => d.id === "informant") ?? null;
  // A quiet informant offers NOTHING — the overlay's Leave button is the way
  // out (playtest 5: the dialogue's own leave row duplicated it and was cut).
  if (dialogue && districtHeat >= (dialogue.quietAtHeat ?? 99)) {
    // WD-2: the informant stops TALKING under lockdown, but the safehouse
    // does not stop being a safehouse — the wait-for-dark option survives.
    // Its own rule (the cubby's) says a lockdown is exactly when you need
    // somewhere to lie low, and the two must not contradict each other.
    return { ...dialogue, quiet: true,
      options: dialogue.options.filter((o) => o.effect?.type === "waitForDark") };
  }
  return dialogue;
}

// Apply one declarative effect. Returns an error string or null.
export function applyEffect(state, agent, firm, effect, ctx) {
  switch (effect.type) {
    case EFFECT_REVEAL_RIVAL_HQ: {
      const rival = state.hqs.find((h) => h.firmId !== firm.id);
      if (!rival) return "nothing_to_reveal";
      firm.knownRivalHqs = firm.knownRivalHqs ?? [];
      if (!firm.knownRivalHqs.includes(rival.id)) firm.knownRivalHqs.push(rival.id);
      state.events.push({
        type: "rivalHqRevealed", firmId: firm.id, hqId: rival.id,
        cellX: rival.cellX, cellY: rival.cellY,
      });
      return null;
    }
    case EFFECT_HEAT_INTEL: {
      grantHeatIntel(state, firm, ctx.districtId, effect.ticks | 0);
      state.events.push({
        type: "heatIntelBought", firmId: firm.id, districtId: ctx.districtId,
      });
      return null;
    }
    case EFFECT_CREDENTIAL: {
      // S16 8e. Two of the three ways to get a credential are bought (S09), and
      // both land here so the engine never needs to know WHICH source; the
      // third is lifted off a disabled guard (engine/access.js).
      if (!grantCredential(state, agent.id, effect.tier | 0, "bought")) {
        return "already_held";
      }
      return null;
    }
    case EFFECT_HEAL: {
      agent.condition = ctx.conditionMax;
      state.events.push({ type: "agentTreated", agentId: agent.id });
      return null;
    }
    case EFFECT_WAIT_DARK: {
      // S09/Q45. The world cannot skip time — the agent is parked inside
      // until the phase crosses into night (the reducer pops them out). The
      // gate lives HERE, the one place both the player and any future AI
      // path go through: by night the option is pointless and refused.
      const phase = lightPhase(state.tick, state.rules?.season?.dayNight);
      if (phase.night) return "already_dark";
      if (agent.waitUntilDark) return "already_waiting";
      agent.waitUntilDark = 1;
      state.events.push({ type: "waitingForDark", agentId: agent.id });
      return null;
    }
    case EFFECT_UPGRADE: {
      firm.upgrades = firm.upgrades ?? [];
      if (firm.upgrades.includes(effect.slot)) return "already_owned";
      firm.upgrades.push(effect.slot);
      state.events.push({ type: "upgradeBought", firmId: firm.id, slot: effect.slot });
      return null;
    }
    case EFFECT_COVER:
      return "use_buy_cover";   // handled by buyCover (D38)
    default:
      return "unknown_effect";
  }
}

export function buildingAt(state, cellX, cellY) {
  return state.buildings.find((b) => b.entranceX === cellX && b.entranceY === cellY)
    ?? state.buildings.find((b) => b.exitX === cellX && b.exitY === cellY)
    ?? null;
}

export function enterBuilding(state, agent) {
  if (agent.state !== AGENT_ACTIVE) return "agent_not_active";
  if (agent.insideBuildingId >= 0) return "already_inside";
  const cell = agentCell(agent);
  const building = buildingAt(state, cell.x, cell.y);
  if (!building) return "no_building_here";

  agent.insideBuildingId = building.id;
  agent.state = AGENT_INSIDE;
  agent.route = [];
  agent.routeIdx = 0;

  // D38: patrols that were converging do not give up — they post at the door.
  // Hiding is not escaping.
  if (agent.detection === DET_BURNED) {
    for (const p of state.patrols) {
      if (Math.abs(p.x - cell.x) + Math.abs(p.y - cell.y) <= 12) {
        p.targetX = cell.x; p.targetY = cell.y;
      }
    }
    state.events.push({ type: "patrolsWaiting", buildingId: building.id, agentId: agent.id });
  }
  state.events.push({
    type: "enteredBuilding", agentId: agent.id, buildingId: building.id,
    kind: building.kind,
  });
  return null;
}

export function exitBuilding(state, agent, viaExit = false) {
  if (agent.insideBuildingId < 0) return "not_inside";
  const building = state.buildings.find((b) => b.id === agent.insideBuildingId);
  agent.insideBuildingId = -1;
  agent.waitUntilDark = 0;   // stepping out is changing your mind — one home, both exits
  agent.state = AGENT_ACTIVE;
  if (building && viaExit && building.exitX >= 0) {
    agent.x = cellToWorld(building.exitX);
    agent.y = cellToWorld(building.exitY);
  }
  state.events.push({
    type: "exitedBuilding", agentId: agent.id,
    buildingId: building ? building.id : -1, viaExit: viaExit ? 1 : 0,
  });
  return null;
}

// D38: the appearance change. Bank-only (D30) — so it is a reason to extract
// and bank rather than a free panic button, and a burned agent with an empty
// bank has to solve the problem the hard way.
export function buyCover(state, agent, cfg, ledgerBank) {
  if (agent.insideBuildingId < 0) return { error: "not_inside" };
  const building = state.buildings.find((b) => b.id === agent.insideBuildingId);
  if (!building || building.kind !== BUILDING_COVERSHOP) return { error: "not_a_cover_shop" };
  const cost = cfg.coverShop?.cost ?? 150;
  if ((ledgerBank | 0) < cost) return { error: "cannot_afford" };

  // A new face, and never the same one twice in a row.
  const previous = agent.disguiseId | 0;
  let next = (previous % (DISGUISE_COUNT - 1)) + 1;
  if (next === previous) next = (next % (DISGUISE_COUNT - 1)) + 1;
  agent.disguiseId = next;

  agent.detection = DET_UNSEEN;
  agent.detectTimer = 0;

  // Patrols lose the thread — they were waiting for a face that just left by
  // the other door.
  for (const p of state.patrols) {
    if (p.targetX === building.entranceX && p.targetY === building.entranceY) {
      p.targetX = -1; p.targetY = -1; p.alertTicks = 0;
    }
  }

  exitBuilding(state, agent, true);
  state.events.push({
    type: "coverBought", agentId: agent.id, firmId: agent.firmId,
    buildingId: building.id, disguiseId: next, cost,
  });
  return { cost };
}
