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
  const speed = agent.state === AGENT_DOWNED ? crawlSpeed(cfg) : stepSpeed(cfg, state.map, agent);
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

function passableFor(state, x, y) {
  const t = tileAt(state.map, x, y);
  return t >= 0 && speedMultiplier(t) > 0;
}
