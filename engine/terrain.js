// engine/terrain.js — Shadow Mandate tile set and movement multipliers (S01).
// Harvested from Fireline Command's terrain module; the urban tiles are new.
// Multipliers are fixed-point integers (1.0 = 256). Integer math only.

export const T_OPEN = 0;      // undeveloped ground, outskirts
export const T_STREET = 1;    // main road — fast, but exposed and patrolled
export const T_ALLEY = 2;     // back route — normal speed, good cover
export const T_PLAZA = 3;     // open civic space — fast, very exposed
export const T_BLOCK = 4;     // building mass — impassable
export const T_ENTRANCE = 5;  // building door cell (S09 enterBuilding)
export const T_TRANSIT = 6;   // transit lane — fastest surface route
export const T_CHECKPOINT = 7; // authority post — passable, active at heat >= 4
export const T_YARD = 8;      // industrial yard / lot — slow, strong cover
export const T_ROUGH = 9;     // broken ground, embankments
export const T_WATER = 10;    // canal / dock water — impassable on foot

export const TILE_COUNT = 11;

export const TERRAIN_SPEED = Object.freeze({
  [T_OPEN]: 256,
  [T_STREET]: 358,
  [T_ALLEY]: 256,
  [T_PLAZA]: 332,
  [T_BLOCK]: 0,
  [T_ENTRANCE]: 256,
  [T_TRANSIT]: 384,
  [T_CHECKPOINT]: 256,
  [T_YARD]: 179,
  [T_ROUGH]: 128,
  [T_WATER]: 0,
});

// Cover tiers (S03): how much a tile hides an agent from patrol sight.
// 0 = none (fully exposed), 1 = partial, 2 = strong.
// Sneaking in cover is what lets a Noticed agent decay back to Unseen.
export const TERRAIN_COVER = Object.freeze({
  [T_OPEN]: 0,
  [T_STREET]: 0,
  [T_ALLEY]: 2,
  [T_PLAZA]: 0,
  [T_BLOCK]: 0,
  [T_ENTRANCE]: 1,
  [T_TRANSIT]: 0,
  [T_CHECKPOINT]: 0,
  [T_YARD]: 2,
  [T_ROUGH]: 1,
  [T_WATER]: 0,
});

export function speedMultiplier(terrainId) {
  return TERRAIN_SPEED[terrainId] ?? 256;
}

export function coverTier(terrainId) {
  return TERRAIN_COVER[terrainId] ?? 0;
}

export function isPassable(terrainId) {
  return speedMultiplier(terrainId) > 0;
}
