# S02 — Agent & Movement

*Feeds: M2 (agent), M6 (vehicles) · Depends on: S01 · Status: skeleton, core pinned*

## Purpose

The lead agent entity (D1): grid movement with stances trading speed against
noise/visibility; later the Firm vehicles. Movement mechanics are Fireline's,
re-parameterised.

## Engine contract

- Entity: `agent` in `engine/agents.js` (adapted from `units.js`). Fields:
  `id, firmId, cell, facing (8-dir), stance, hp, condition, carrying,
  downedState, insideBuildingId|0`.
- Commands: `move(agentId, targetCell)` (intent; server pathfinds),
  `setStance(agentId, stance)`, `enterVehicle/exitVehicle` (M6).
- Movement: fixed-point integer, 256 units/cell, cell centres; soft footprint
  reservation/yield (Fireline); no continuous steering.

### Stances (D1) — the core table

| Stance | Speed | Noise radius | Detection profile | Notes |
|---|---|---|---|---|
| Sneak | 0.5× | 0 | −1 tier vs sensors | can pass Noticed back to Unseen while stationary in cover |
| Move | 1.0× | small `⚙` | normal | default |
| Hurry | 1.6× `⚙` | large `⚙` | +1 tier vs sensors | double-tap; leaves noise events (S03) |

Tap = move cautiously (Move), double-tap = Hurry (design doc). Stance also
selectable via persistent selector.

### Carrying

Reuse Fireline tow/carry as `carry`: package (courier), intel item, subdued
NPC (Snatch, V2), downed agent. Carrying caps stance at Move `⚙`.

### Vehicles (M6)

`lightTransport`, `motorbike`, `cargoVan` — Fireline chassis re-statted;
agent boards/exits at adjacent cell; vehicles are loud (noise while moving,
S03) and visible; park anywhere pathable. `armoredCar` deferred to V2.

## Ruleset data (`data/agents.json`, `data/vehicles.json`)

Base speed (units/tick), stance multipliers, noise radii, carry caps,
vehicle stats (speed, noise, cargo, hp).

## Fireline reuse

`pathfind.js`, `route_graph.js`, footprint/reservation, 8-dir facing,
`transport.js` (adapted), `recovery.js` carry-pair logic.

## Gates & fixtures

Headless: agent crosses reference seed A→B in all three stances with expected
tick counts (pinned); carry slows correctly; vehicle board/exit; mirror
equivariance of movement arithmetic (truncating division doctrine).

## AS BUILT (M2, 2026-08-04) — `engine/agents.js`, `engine/pathfind.js`

Implemented: stance movement (Sneak/Move/Hurry), 4-neighbour A* with
index-tie-breaking and a node budget with best-partial fallback, patrol
stepping with alert convergence, carry slowdown.

- Diagonal movement was deliberately excluded: diagonal steps between two
  building corners read as clipping through a wall.
- `route` / `routeIdx` are hashed state (a different route IS a different
  state) and deep-copied in `copyState`.
- Vehicles (M6) are NOT implemented. `data/vehicles.json` exists, unused.

## To pin

`⚙ tune` all speeds/radii vs D11 pacing (15–20 min sortie on 64×64 —
M6 battery is the verdict) · `❑ pin` whether Sneak drains a stamina-like
resource (proposal: no — simplicity first).
