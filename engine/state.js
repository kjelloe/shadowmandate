// engine/state.js — authoritative state schema and initial state.
//
// Doctrine (specs/02): integer-only authoritative state, no floats, no null
// (absent = -1 or 0), no Map/Set, plain objects and arrays only. Entities live
// at cell CENTRES (shared/fixedmath.cellToWorld) — centres mirror onto centres
// exactly, which is what makes mirror-fairness batteries meaningful.
//
// Growth rule: new subsystems arrive as EMPTY collections so they hash to
// nothing (hash-inert) and the pinned fixture does not churn. See S14.

import { T_OPEN } from "./terrain.js";
import { seedSfc32 } from "../shared/prng.js";
import { spawnCivilians } from "./civilians.js";

// ── Agent lifecycle ──────────────────────────────────────────────────────
export const AGENT_ABSENT = 0;   // slot unused
export const AGENT_ACTIVE = 1;   // deployed and in control
export const AGENT_DOWNED = 2;   // crawling, awaiting rescue or capture (S04)
export const AGENT_HELD = 3;     // captured, in a Holding Site (S04)
export const AGENT_INSIDE = 4;   // inside a building overlay (S09)

// ── Movement stances (S02, D1) ───────────────────────────────────────────
export const STANCE_SNEAK = 0;
export const STANCE_MOVE = 1;
export const STANCE_HURRY = 2;

// ── Detection states (S03, D6) ───────────────────────────────────────────
export const DET_UNSEEN = 0;
export const DET_NOTICED = 1;
export const DET_BURNED = 2;

// ── Firm deployment ──────────────────────────────────────────────────────
export const FIRM_UNDEPLOYED = 0;
export const FIRM_DEPLOYED = 1;
export const FIRM_EVACUATING = 2;

export const MAX_FIRMS = 16;      // world slots (D18: pool = 5 x slots)
export const MAX_AGENTS = 64;     // 16 firms x up to 4 agents (V2 headroom)

// The default world size ships at 64 (D26); 128 must stay exercised in tests.
export const DEFAULT_WORLD_SIZE = 64;

export function createAgent(id) {
  return {
    id,
    firmId: -1,
    state: AGENT_ABSENT,
    x: 0, y: 0,               // world units (cell centres)
    targetX: 0, targetY: 0,
    facing: 0,                // 8-direction octant
    stance: STANCE_MOVE,
    moveProgress: 0,
    condition: 100,           // readable bands, not an HP bar (S04)
    detection: DET_UNSEEN,
    detectTimer: 0,           // ticks accumulating toward the next transition
    carryKind: 0,             // 0 none, else CARRY_* (S02)
    carryRef: -1,
    route: [],                // pathfinder output being walked
    routeIdx: 0,
    insideBuildingId: -1,
    // S17 mission areas: which area, and WHERE inside it (cell ints in the
    // area's own local space — deliberately not world fixed-point).
    insideAreaId: -1,
    areaCol: 0, areaRow: 0, areaCool: 0,
    waitUntilDark: 0,         // S09/Q45: parked inside until nightfall
    disguiseId: 0,            // D38 cover-shop appearance
    downTicks: 0,
    holdingSiteId: -1,
    vehicleId: -1,
    contractIds: [],          // accepted contracts (D29: max 2)
  };
}

export function createFirm(id) {
  return {
    id,
    nameId: -1,               // index into data/firms.json curated list
    state: FIRM_UNDEPLOYED,
    hqId: -1,
    reputation: 0,
    recognition: 0,
    tierUnlocked: 1,
    completedThisTier: 0,
    cacheResources: 0,        // at-risk, banked only on clean extraction (D7)
    isAi: 0,
    aiPersonality: 0,
    aiNextDeployTick: 0,
    heatIntel: [],            // S09: bought knowledge, expires
    knownRivalHqs: [],
    upgrades: [],
    graceTicks: 0,            // D31 disconnect grace
  };
}

// A blank map: every cell open ground. M1's citygen replaces this; it exists so
// M0 has a deterministic, hashable world to pin a fixture against.
export function createBlankMap(size) {
  const cells = new Array(size * size);
  for (let i = 0; i < cells.length; i++) cells[i] = T_OPEN;
  return { width: size, height: size, cells };
}

export function tileAt(map, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return -1;
  return map.cells[cy * map.width + cx];
}

export function setTile(map, cx, cy, tile) {
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return;
  map.cells[cy * map.width + cx] = tile;
}

export function createInitialState(options = {}) {
  const size = options.size | 0 || DEFAULT_WORLD_SIZE;
  const worldSeed = options.seed >>> 0 || 1;
  const slots = options.slots | 0 || MAX_FIRMS;

  const agents = [];
  for (let i = 0; i < MAX_AGENTS; i++) agents.push(createAgent(i));
  const firms = [];
  for (let i = 0; i < slots; i++) firms.push(createFirm(i));

  // A city is generated when a ruleset is supplied; without one the world is
  // blank ground, which is what the era-0 fixture pins against.
  const city = options.city ?? null;

  const state = {
    tick: 0,
    worldSeed,
    size,
    slots,
    // The ruleset is constant for a world's lifetime and shared by reference:
    // it is configuration, not state. Only its version participates in the
    // hash — a world that ran under different numbers is a different era.
    rules: options.rules ?? null,
    rng: seedSfc32(worldSeed),
    map: city ? city.map : (options.map ?? createBlankMap(size)),
    districtOwner: city ? city.districtOwner : null,
    reachable: city ? city.reachable : null,

    firms,
    agents,

    districts: city ? city.districts : [],
    sites: city ? city.sites : [],
    cameras: city ? (city.cameras ?? []) : [],   // M8 — S16 8b
    beams: city ? (city.beams ?? []) : [],       // M8 — S16 8c
    junctions: city ? (city.junctions ?? []) : [],  // M8 — S16 8d
    buildings: city ? city.buildings : [],
    patrols: city ? city.patrols : [],
    holdingSites: city ? city.holdingSites : [],
    hqs: [],            // M3 — S05
    contractPool: [],   // M4 — S06
    offers: [],         // M4 — S06 (per-firm disjoint boards)
    standoffs: [],      // M5 — S08
    pacts: [],          // M5 — S08
    // M8 — S16. Kept as its own collection rather than as fields on every site
    // so a world with nothing wrong writes no alarm bytes and hashes exactly as
    // it did before site security existed.
    alarms: [],
    // S17 mission areas — lazy, hash-inert while empty like every collection
    // here: a world where nobody has gone inside writes no area bytes.
    areas: [],
    // M8 — S16 8e. Per-AGENT and per-SORTIE: a Firm cannot buy one card and
    // walk every operative through the same door, and the card does not
    // survive capture or extraction. Hash-inert while empty, like alarms.
    credentials: [],
    raids: [],           // M8 — S16 8i (D49b), hash-inert while quiet
    vehicles: [],       // M6 — S02

    nextContractId: 0,
    nextStandoffId: 0,
    nextRaidId: 0,

    events: [],
  };
  // S17 ambient life: the crowd seats itself from its OWN seeded streams
  // (worldSeed + civilian id), never the shared rng — adding civilians must
  // shift no other system's rolls.
  state.civilians = (city && options.rules?.civilians)
    ? spawnCivilians(state, options.rules.civilians) : [];
  return state;
}
