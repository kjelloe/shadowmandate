// engine/agents.js — agent movement and patrol stepping (S02, S03).
//
// Movement is intent-based: the player names a destination, the server paths
// and walks it. No continuous steering (that would need per-tick input and
// would not survive a 10Hz authoritative loop).

import {
  AGENT_ACTIVE, AGENT_DOWNED, STANCE_SNEAK, STANCE_MOVE, STANCE_HURRY,
} from "./state.js";
import { speedMultiplier } from "./terrain.js";
import { tileAt } from "./state.js";
import { findPath } from "./pathfind.js";
import { cellToWorld, worldToCellFloor } from "../shared/fixedmath.js";

export const CARRY_NONE = 0;
export const CARRY_PACKAGE = 1;
export const CARRY_INTEL = 2;
export const CARRY_AGENT = 3;

// Octant facing from a delta: 0=E 1=NE 2=N 3=NW 4=W 5=SW 6=S 7=SE.
export function octantFor(dx, dy) {
  if (dx === 0 && dy === 0) return -1;
  if (dx > 0 && dy === 0) return 0;
  if (dx > 0 && dy < 0) return 1;
  if (dx === 0 && dy < 0) return 2;
  if (dx < 0 && dy < 0) return 3;
  if (dx < 0 && dy === 0) return 4;
  if (dx < 0 && dy > 0) return 5;
  if (dx === 0 && dy > 0) return 6;
  return 7;
}

function stanceKey(stance) {
  return stance === STANCE_SNEAK ? "sneak" : stance === STANCE_HURRY ? "hurry" : "move";
}

// Speed in world units per tick, after stance, terrain and carrying.
export function stepSpeed(cfg, map, agent) {
  const stance = cfg.stances[stanceKey(agent.stance)];
  let speed = Math.trunc((cfg.baseSpeed * stance.speedMul) / 256);
  const cx = worldToCellFloor(agent.x), cy = worldToCellFloor(agent.y);
  speed = Math.trunc((speed * speedMultiplier(tileAt(map, cx, cy))) / 256);
  if (agent.carryKind !== CARRY_NONE) {
    speed = Math.trunc((speed * cfg.carry.speedMul) / 256);
  }
  return Math.max(1, speed);
}

// A downed agent crawls — slowly, and it cannot be redirected.
export function crawlSpeed(cfg) {
  return Math.max(1, cfg.crawlSpeed | 0);
}

// Give an agent a destination. The path is stored as the agent's route; the
// per-tick stepper consumes it.
export function orderMove(state, agent, cellX, cellY) {
  const from = { x: worldToCellFloor(agent.x), y: worldToCellFloor(agent.y) };
  const path = findPath(state.map, from.x, from.y, cellX, cellY);
  agent.route = path;
  agent.routeIdx = 0;
  if (path.length) {
    agent.targetX = cellToWorld(path[path.length - 1].x);
    agent.targetY = cellToWorld(path[path.length - 1].y);
  } else {
    agent.targetX = agent.x;
    agent.targetY = agent.y;
  }
  return path.length;
}

// One movement tick for one agent: walk toward the next route cell.
export function stepAgent(state, cfg, agent) {
  if (agent.state !== AGENT_ACTIVE && agent.state !== AGENT_DOWNED) return;
  if (agent.insideBuildingId >= 0) return;
  const route = agent.route ?? [];
  if (!route.length || (agent.routeIdx ?? 0) >= route.length) {
    agent.moveProgress = 0;
    return;
  }
  let speed = agent.state === AGENT_DOWNED ? crawlSpeed(cfg) : stepSpeed(cfg, state.map, agent);
  if (agent.state !== AGENT_DOWNED && agent.vehicleId >= 0 && state.rules) {
    const spec = vehicleSpeedFor(agent, state, state.rules.vehicles);
    if (spec) {
      // Driving replaces the stance/terrain walk speed outright: a vehicle on
      // a street is not "sneaking faster", it is a different way to travel.
      speed = Math.max(1, Math.trunc((spec.speed * speedMultiplier(
        tileAt(state.map, worldToCellFloor(agent.x), worldToCellFloor(agent.y)))) / 256));
    }
  }
  const next = route[agent.routeIdx];
  const nx = cellToWorld(next.x), ny = cellToWorld(next.y);
  const dx = nx - agent.x, dy = ny - agent.y;
  const dist = Math.abs(dx) + Math.abs(dy);

  if (dist <= speed) {
    agent.x = nx; agent.y = ny;
    agent.routeIdx = (agent.routeIdx + 1) | 0;
    agent.moveProgress = agent.routeIdx >= route.length ? 0 : 1;
    if (agent.routeIdx >= route.length) {
      state.events.push({ type: "agentArrived", agentId: agent.id, cellX: next.x, cellY: next.y });
    }
  } else {
    // Move along the dominant axis first; truncating division keeps westward
    // and northward steps exactly as long as their mirrors.
    if (Math.abs(dx) >= Math.abs(dy)) {
      const step = dx > 0 ? Math.min(speed, dx) : Math.max(-speed, dx);
      agent.x = (agent.x + step) | 0;
    } else {
      const step = dy > 0 ? Math.min(speed, dy) : Math.max(-speed, dy);
      agent.y = (agent.y + step) | 0;
    }
    agent.moveProgress = 1;
  }
  const f = octantFor(Math.sign(dx), Math.sign(dy));
  if (f >= 0) agent.facing = f;
}

// Patrols walk their fixed circuit, unless they have been alerted to a
// position — then they converge on it, and go back to the circuit after.
export function stepPatrol(state, cfg, patrol) {
  if (patrol.alertTicks > 0) {
    patrol.alertTicks -= 1;
    if (patrol.targetX >= 0) {
      const dx = Math.sign(patrol.targetX - patrol.x);
      const dy = Math.sign(patrol.targetY - patrol.y);
      // Converge one axis per tick; patrols are deliberately not fast.
      if (state.tick % 2 === 0) {
        if (dx !== 0 && passableFor(state, patrol.x + dx, patrol.y)) patrol.x += dx;
        else if (dy !== 0 && passableFor(state, patrol.x, patrol.y + dy)) patrol.y += dy;
      }
      if (patrol.x === patrol.targetX && patrol.y === patrol.targetY) {
        patrol.targetX = -1; patrol.targetY = -1;
      }
    }
    return;
  }
  if (!patrol.route.length) return;
  if (state.tick % 3 !== 0) return; // patrol cadence: one cell every 3 ticks
  patrol.routeIdx = (patrol.routeIdx + 1) % patrol.route.length;
  const step = patrol.route[patrol.routeIdx];
  patrol.x = step.x; patrol.y = step.y;
}

// ── Vehicles (S02, D34) ───────────────────────────────────────────────────
//
// A vehicle is speed bought with noise. It covers ground the stealth loadout
// cannot, and it announces you the whole way — which is the trade the design
// wants, not an upgrade that strictly dominates walking.

export const VEHICLE_KINDS = ["lightTransport", "motorbike", "cargoVan"];

export function vehicleAt(state, cellX, cellY) {
  for (const v of state.vehicles) {
    if (worldToCellFloor(v.x) === cellX && worldToCellFloor(v.y) === cellY
      && v.riderAgentId < 0) return v;
  }
  return null;
}

export function boardVehicle(state, agent, vehiclesCfg) {
  if (agent.vehicleId >= 0) return "already_driving";
  const cell = { x: worldToCellFloor(agent.x), y: worldToCellFloor(agent.y) };
  const vehicle = vehicleAt(state, cell.x, cell.y);
  if (!vehicle) return "no_vehicle_here";
  const spec = vehiclesCfg[VEHICLE_KINDS[vehicle.kind]];
  if (!spec || spec.v1 !== true) return "not_available";
  // A motorbike carries nothing — you cannot ride off with the package.
  if (agent.carryKind !== CARRY_NONE && (spec.cargo | 0) === 0) return "no_cargo_space";

  vehicle.riderAgentId = agent.id;
  agent.vehicleId = vehicle.id;
  state.events.push({ type: "boardedVehicle", agentId: agent.id, vehicleId: vehicle.id });
  return null;
}

export function exitVehicle(state, agent) {
  if (agent.vehicleId < 0) return "not_driving";
  const vehicle = state.vehicles.find((v) => v.id === agent.vehicleId);
  if (vehicle) {
    vehicle.riderAgentId = -1;
    agent.x = vehicle.x;
    agent.y = vehicle.y;
  }
  agent.vehicleId = -1;
  state.events.push({ type: "exitedVehicle", agentId: agent.id });
  return null;
}

// A ridden vehicle moves with its agent; the agent's position IS the vehicle's.
export function syncVehicles(state) {
  for (const v of state.vehicles) {
    if (v.riderAgentId < 0) continue;
    const agent = state.agents[v.riderAgentId];
    if (!agent || agent.vehicleId !== v.id) { v.riderAgentId = -1; continue; }
    v.x = agent.x; v.y = agent.y; v.facing = agent.facing;
  }
}

export function vehicleSpeedFor(agent, state, vehiclesCfg) {
  if (agent.vehicleId < 0) return null;
  const vehicle = state.vehicles.find((v) => v.id === agent.vehicleId);
  if (!vehicle) return null;
  return vehiclesCfg[VEHICLE_KINDS[vehicle.kind]] ?? null;
}

function passableFor(state, x, y) {
  const t = tileAt(state.map, x, y);
  return t >= 0 && speedMultiplier(t) > 0;
}
