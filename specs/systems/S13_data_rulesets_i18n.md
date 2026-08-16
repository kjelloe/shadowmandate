# S13 — Data, Rulesets & i18n

*Feeds: M0, then every milestone · Depends on: — · Status: pinned*

## Purpose

Numbers live in data, never in engine code (stack rule). This spec pins the
`data/` layout, versioning, and the i18n regime, so M0 can strip and re-seed
the firepower data tree correctly.

## `data/` layout (pinned)

| File | Owns | Spec |
|---|---|---|
| `data/citygen.json` | world sizes, districts, sites, drop zones | S01 |
| `data/terrain.json` | tile movement/cover modifiers | S01/S02 |
| `data/agents.json`, `data/vehicles.json` | speeds, stances, noise, cargo | S02 |
| `data/detection.json` | radii, windows, heat table | S03 |
| `data/combat.json` | items, conditions, capture, bail | S04 |
| `data/hq.json` | perimeter, evac timers, beacon radius | S05 |
| `data/contracts.json` | D18 economy, types, tiers, rewards | S06 |
| `data/ai_firms.json` | personalities, thresholds | S07 |
| `data/standoff.json` | timer, distances, pact | S08 |
| `data/buildings/*.json` | dialogue trees, shop catalogs | S09 |
| `data/firms.json` | curated Firm names, palettes, doctrines (names only in V1) | 01 |
| `data/season.json` | season length, slots, world defaults | S10 |

- Ruleset is **versioned**: `data/ruleset.json` manifests the set with a
  version string + content hash; server and replays name the ruleset version
  (firepower doctrine — era discipline).
- Loading: `engine/state.js` receives the parsed ruleset as an argument; the
  engine never reads files.
- All numbers marked `⚙ tune` across S-specs live here — tuning commits touch
  only `data/` and re-pin battery baselines, never engine code.

## i18n (pinned)

- `client/i18n/en.json`, `client/i18n/no.json` — key-identical, enforced by
  test (missing key in one locale = red suite).
- Key namespaces: `ui.*`, `dialog.*` (S09), `contract.*`, `debrief.*`,
  `splash.*`. Dialogue/data files reference keys, never literals.
- D8 guard: suite greps all catalogs, data, client, engine for `syndicat`
  (case-insensitive) — zero hits allowed outside `specs/` history docs.

## Gates

M0: layout exists with firepower-derived seed values where reused; ruleset
manifest hash test; i18n parity test; D8 grep test. Every later slice adds
its keys here first.
