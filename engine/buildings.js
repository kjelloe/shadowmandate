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
import { cellToWorld } from "../shared/fixedmath.js";
import { BUILDING_COVERSHOP } from "./citygen.js";

// Disguise variants. Deliberately comic: the fantasy of a back-room cover shop
// is that you walk out looking like someone your own mother would query, and
// the game is funnier for letting the player see it. The client picks the
// portrait from this id; the engine only tracks which one you are wearing.
export const DISGUISE_NONE = 0;
export const DISGUISE_COUNT = 6;   // see data/buildings/disguises.json

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
    type: "coverBought", agentId: agent.id, buildingId: building.id,
    disguiseId: next, cost,
  });
  return { cost };
}
