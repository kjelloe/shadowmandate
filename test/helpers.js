// test/helpers.js — shared world construction for tests and probes.

import { readFileSync } from "node:fs";
import { createInitialState, AGENT_ACTIVE, FIRM_DEPLOYED } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { findPath } from "../engine/pathfind.js";
import { cellToWorld } from "../shared/fixedmath.js";

const DATA = new URL("../data/", import.meta.url).pathname;
const read = (f) => JSON.parse(readFileSync(DATA + f, "utf8"));

export function testRuleset() {
  const manifest = read("ruleset.json");
  const rules = { version: manifest.version };
  for (const file of manifest.files) rules[file.replace(/\.json$/, "")] = read(file);
  rules.payloads = read("buildings/payloads.json");
  rules.disguises = read("buildings/disguises.json");
  return rules;
}

export const RULES = testRuleset();
export const REFERENCE_SEEDS = [4711, 90210];

export function makeWorld({ seed = 4711, size = 64 } = {}) {
  return createInitialState({
    seed, size, rules: RULES, city: generateCity(seed, size, RULES.citygen),
  });
}

// Put an agent on the map, active, at a given cell. Returns the agent.
export function placeAgent(state, { agentId = 0, firmId = 0, cellX, cellY, stance = 1 } = {}) {
  const agent = state.agents[agentId];
  agent.state = AGENT_ACTIVE;
  agent.firmId = firmId;
  agent.x = cellToWorld(cellX);
  agent.y = cellToWorld(cellY);
  agent.targetX = agent.x;
  agent.targetY = agent.y;
  agent.stance = stance;
  agent.condition = RULES.agents.conditionMax;
  state.firms[firmId].state = FIRM_DEPLOYED;
  return agent;
}

// Find a walkable cell far from every patrol — a quiet place to start.
export function quietCell(state, minDistance = 14) {
  const size = state.size;
  for (let y = 2; y < size - 2; y++) {
    for (let x = 2; x < size - 2; x++) {
      const t = state.map.cells[y * size + x];
      if (t === 4 || t === 10) continue; // block / water
      let ok = true;
      for (const p of state.patrols) {
        if (Math.abs(p.x - x) + Math.abs(p.y - y) < minDistance) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

// A drop zone with room around it. findDropZones scans from the top-left, so
// its first result is always a map-edge cell — fine for the engine, useless
// for a test that needs to step outside a perimeter.
export function centralDropZone(state, zones) {
  const mid = state.size >> 1;
  let best = zones[0], bestD = 0x7fffffff;
  for (const z of zones) {
    const d = Math.abs(z.cellX - mid) + Math.abs(z.cellY - mid);
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}

// A walkable cell at least `distance` away from (cx, cy), toward map centre.
export function cellAwayFrom(state, cx, cy, distance) {
  const mid = state.size >> 1;
  const dirX = cx <= mid ? 1 : -1;
  const dirY = cy <= mid ? 1 : -1;
  for (let d = distance; d < distance + 20; d++) {
    for (const [x, y] of [[cx + dirX * d, cy], [cx, cy + dirY * d],
      [cx + dirX * d, cy + dirY * d]]) {
      if (x < 1 || y < 1 || x >= state.size - 1 || y >= state.size - 1) continue;
      const t = state.map.cells[y * state.size + x];
      if (t === 4 || t === 10) continue;
      if (Math.abs(x - cx) + Math.abs(y - cy) >= distance) return { x, y };
    }
  }
  return null;
}

// Find a cell with real cover (alley/yard) at a given distance band from a
// patrol — where the stealth fantasy is supposed to work.
export function coveredCellNearPatrol(state, patrolIdx = 0, minD = 4, maxD = 7) {
  const p = state.patrols[patrolIdx];
  for (let y = 1; y < state.size - 1; y++) {
    for (let x = 1; x < state.size - 1; x++) {
      const t = state.map.cells[y * state.size + x];
      if (t !== 2 && t !== 8) continue;               // alley or yard = cover 2
      const d = Math.abs(p.x - x) + Math.abs(p.y - y);
      if (d >= minD && d <= maxD) return { x, y, d };
    }
  }
  return null;
}

// Find a walkable cell adjacent to a patrol's current position.
export function cellNearPatrol(state, patrolIdx = 0, offset = 1) {
  const p = state.patrols[patrolIdx];
  for (const [dx, dy] of [[offset, 0], [-offset, 0], [0, offset], [0, -offset]]) {
    const x = p.x + dx, y = p.y + dy;
    const t = state.map.cells[y * state.size + x];
    if (t !== undefined && t !== 4 && t !== 10) return { x, y };
  }
  return { x: p.x, y: p.y };
}

// A destination that is genuinely reachable from `from`: walk the path toward
// a far district core and take the Nth step. Picking "x + 3" lands in building
// mass more often than not, which fails the test rather than the engine.
export function reachableDestination(state, from, steps = 6) {
  const target = state.districts[state.districts.length - 1];
  const path = findPath(state.map, from.x, from.y, target.coreX, target.coreY);
  if (!path.length) return null;
  return path[Math.min(steps, path.length) - 1];
}

export function runTicks(state, apply, n, CMD_ADVANCE_TICK = 1) {
  let s = state;
  for (let i = 0; i < n; i++) s = apply(s, { type: CMD_ADVANCE_TICK });
  return s;
}

// Run N ticks and ACCUMULATE every event emitted along the way.
//
// state.events holds only the events of the LAST applied command — each
// copyState starts a fresh list. A test that runs a loop and then inspects
// state.events sees only the final tick, and silently misses the event it was
// looking for. Use this whenever the thing you assert on happens "sometime
// during" a run.
export function tickCollecting(state, apply, n, CMD_ADVANCE_TICK = 1) {
  let s = state;
  const events = [];
  for (let i = 0; i < n; i++) {
    s = apply(s, { type: CMD_ADVANCE_TICK });
    for (const e of s.events) events.push({ ...e, tick: s.tick });
  }
  return { state: s, events, saw: (type) => events.some((e) => e.type === type) };
}

// Collect every event of a type across a run.
export function eventsOfType(states, type) {
  const out = [];
  for (const s of states) for (const e of s.events) if (e.type === type) out.push(e);
  return out;
}
