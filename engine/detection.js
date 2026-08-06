// engine/detection.js — detection states and district heat (S03, D6, D20).
//
// This is the game's antagonist. Being seen is the threat; combat is the
// consequence of failing at it. Lands hash-inert: with no patrols and no
// active agents nothing here writes state.

import { DET_UNSEEN, DET_NOTICED, DET_BURNED, AGENT_ACTIVE, AGENT_DOWNED, STANCE_SNEAK, STANCE_HURRY, tileAt } from "./state.js";
import { coverTier, T_BLOCK, T_WATER } from "./terrain.js";
import { lineCells } from "./pathfind.js";
import { worldToCellFloor } from "../shared/fixedmath.js";
// Acyclic: cameras.js imports only agents.js, which imports no detection code.
import { cameraCoversCell } from "./cameras.js";

export const HEAT_MAX = 5;

export function agentCell(agent) {
  return { x: worldToCellFloor(agent.x), y: worldToCellFloor(agent.y) };
}

// Line of sight: building mass blocks it. Cover does not BLOCK sight, it
// shortens it (handled by the effective radius below) — an agent in an alley
// is harder to make out, not invisible.
export function hasLineOfSight(map, x0, y0, x1, y1) {
  for (const c of lineCells(x0, y0, x1, y1)) {
    if (c.x === x0 && c.y === y0) continue;
    if (c.x === x1 && c.y === y1) continue;
    const t = tileAt(map, c.x, c.y);
    if (t === T_BLOCK || t === T_WATER) return false;
  }
  return true;
}

// The effective distance at which this patrol can make this agent out, given
// the agent's stance and the cover it is standing in.
export function effectiveSightRadius(cfg, map, agent, heat) {
  let radius = cfg.patrolSightRadius;
  if (heat >= cfg.heat.extraPatrolsAt) {
    radius = Math.trunc((radius * cfg.heat.sensorRadiusMulAt2) / 256);
  }
  if (agent.stance === STANCE_SNEAK) radius -= 1;
  if (agent.stance === STANCE_HURRY) radius += 1;
  const cell = agentCell(agent);
  radius -= coverTier(tileAt(map, cell.x, cell.y)) * (cfg.coverSightPenalty | 0);
  return Math.max(0, radius);
}

// Noise is transient: it is computed per tick from what agents are doing and
// consumed by hearing checks in the same tick. Deliberately NOT stored — a
// history of noise would be hashed state that nothing ever reads again.
export function noiseRadiusFor(cfg, agentsCfg, agent, vehicleSpec = null) {
  if (agent.state !== AGENT_ACTIVE) return 0;
  if (agent.moveProgress === 0 && agent.targetX === agent.x) return 0;
  // A moving vehicle is loud whatever the driver intends — you cannot sneak
  // a van. This is the cost that stops vehicles dominating the stealth walk.
  if (vehicleSpec) return vehicleSpec.noiseRadius | 0;
  const stance = agent.stance === STANCE_SNEAK ? "sneak"
    : agent.stance === STANCE_HURRY ? "hurry" : "move";
  return agentsCfg.stances[stance].noiseRadius | 0;
}

// Kept local rather than importing agents.js: detection must not depend on the
// movement module (acyclic imports, specs/02).
function vehicleSpecFor(state, agent) {
  const vehicle = state.vehicles.find((v) => v.id === agent.vehicleId);
  if (!vehicle) return null;
  const kinds = ["lightTransport", "motorbike", "cargoVan"];
  return state.rules.vehicles[kinds[vehicle.kind]] ?? null;
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Does any patrol currently perceive this agent?
export function perceivedBy(state, cfg, agentsCfg, agent, heat) {
  const cell = agentCell(agent);
  const sight = effectiveSightRadius(cfg, state.map, agent, heat);
  const vehicleSpec = (agent.vehicleId >= 0 && state.rules)
    ? vehicleSpecFor(state, agent) : null;
  const noise = noiseRadiusFor(cfg, agentsCfg, agent, vehicleSpec);
  for (const p of state.patrols) {
    const d = manhattan(p.x, p.y, cell.x, cell.y);
    if (d <= sight && hasLineOfSight(state.map, p.x, p.y, cell.x, cell.y)) return p;
    if (noise > 0 && d <= Math.min(cfg.patrolHearRadius, noise)) return p;
  }
  // S16 8b: a camera feeds the SAME detection currency as a patrol rather than
  // a second one, so being caught on camera makes you noticed and then burned
  // through the machine that already exists. A camera cannot HEAR — noise is a
  // patrol affordance, and a microphone would be a different mechanism with a
  // different counter-play.
  //
  // Cameras are checked last so a patrol is still reported in preference when
  // both can see you: "who saw me" drives the converge-on-last-known-position
  // behaviour, and a camera has nowhere to converge from.
  for (const cam of state.cameras ?? []) {
    if (!cameraCoversCell(cam, cell.x, cell.y, state.tick)) continue;
    if (hasLineOfSight(state.map, cam.cellX, cam.cellY, cell.x, cell.y)) return cam;
  }
  return null;
}

export function districtAt(state, cellX, cellY) {
  if (!state.districtOwner) return -1;
  return state.districtOwner[cellY * state.size + cellX] ?? -1;
}

export function raiseHeat(state, districtId, amount, cfg) {
  const d = state.districts[districtId];
  if (!d) return;
  const before = d.heat;
  d.heat = Math.min(cfg.heat.max, d.heat + amount);
  d.heatTimer = 0;
  if (d.heat !== before) {
    state.events.push({ type: "heatChanged", districtId, heat: d.heat, delta: d.heat - before });
  }
}

// One tick of the detection machine for every deployed agent.
export function stepDetection(state, cfg, agentsCfg) {
  for (const agent of state.agents) {
    if (agent.state !== AGENT_ACTIVE && agent.state !== AGENT_DOWNED) continue;
    if (agent.insideBuildingId >= 0) {
      // Inside a building an agent is off the street and cannot be perceived.
      agent.detectTimer = 0;
      continue;
    }
    const cell = agentCell(agent);
    const districtId = districtAt(state, cell.x, cell.y);
    const heat = state.districts[districtId]?.heat ?? 0;
    const seen = perceivedBy(state, cfg, agentsCfg, agent, heat);

    if (seen) {
      agent.detectTimer = (agent.detectTimer + 1) | 0;
      if (agent.detection === DET_UNSEEN) {
        agent.detection = DET_NOTICED;
        agent.detectTimer = 0;
        // A camera and a patrol have separate id spaces, so the observer is
        // tagged rather than crammed into one `patrolId` field. Camera 3 and
        // patrol 3 are different things, and a consumer that guessed would
        // converge patrols on a camera's position.
        const byCamera = seen.siteId !== undefined;
        state.events.push({
          type: "agentNoticed", agentId: agent.id,
          patrolId: byCamera ? -1 : seen.id,
          cameraId: byCamera ? seen.id : -1,
          siteId: byCamera ? seen.siteId : -1,
        });
      } else if (agent.detection === DET_NOTICED && agent.detectTimer >= cfg.burnTicks) {
        burnAgent(state, agent, cfg, districtId);
      }
    } else {
      agent.detectTimer = (agent.detectTimer + 1) | 0;
      if (agent.detection === DET_NOTICED && agent.detectTimer >= cfg.noticedDecayTicks) {
        agent.detection = DET_UNSEEN;
        agent.detectTimer = 0;
        state.events.push({ type: "agentUnseen", agentId: agent.id });
      } else if (agent.detection === DET_BURNED
        && agent.detectTimer >= cfg.burnCooldownTicks
        && heat < cfg.heat.checkpointsActiveAt) {
        agent.detection = DET_NOTICED;
        agent.detectTimer = 0;
        state.events.push({ type: "agentCooled", agentId: agent.id });
      }
    }
  }
}

export function burnAgent(state, agent, cfg, districtId) {
  if (agent.detection === DET_BURNED) return;
  agent.detection = DET_BURNED;
  agent.detectTimer = 0;
  state.events.push({ type: "agentBurned", agentId: agent.id, firmId: agent.firmId });
  if (districtId >= 0) raiseHeat(state, districtId, cfg.heat.sources.burn, cfg);
  // Patrols converge on the last known position.
  const cell = agentCell(agent);
  convergePatrols(state, cell.x, cell.y, cfg);
}

// Draw the authorities toward a cell. Extracted from burnAgent so a defence in
// progress (S16 8j) can use the SAME converge behaviour a burn does, rather
// than a second one that could drift away from it.
export function convergePatrols(state, cellX, cellY, cfg) {
  let drawn = 0;
  for (const p of state.patrols) {
    if (manhattan(p.x, p.y, cellX, cellY) > cfg.convergeRadius) continue;
    p.targetX = cellX; p.targetY = cellY;
    p.alertTicks = cfg.burnCooldownTicks;
    drawn++;
  }
  return drawn;
}

// Heat decays with live world time. The dormancy transition (S10/D16) applies
// the elapsed-time equivalent in one deterministic step.
export function stepHeat(state, cfg) {
  for (const d of state.districts) {
    if (d.heat <= 0) { d.heatTimer = 0; continue; }
    d.heatTimer = (d.heatTimer + 1) | 0;
    if (d.heatTimer >= cfg.heat.decayTicks) {
      d.heat -= 1;
      d.heatTimer = 0;
      state.events.push({ type: "heatChanged", districtId: d.id, heat: d.heat, delta: -1 });
    }
  }
}

// D20: what a Firm may see of a district's heat. Exact only with intel.
export function heatBandFor(heat, cfg) {
  const [tense, lockdown] = cfg.heat.fuzzBands;
  if (heat >= lockdown) return 2;   // lockdown
  if (heat >= tense) return 1;      // tense
  return 0;                         // calm
}
