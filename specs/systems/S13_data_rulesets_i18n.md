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

## Era 2 (2026-08-28) and the keys added since

`data/ruleset.json` is **`sm-era-2`**. The bump is a WORLDGEN change (Q50:
safehouse density and HQ placement), so every `sm-era-1` baseline is void — at
zero cost, because the era-1 batteries were queued and had not run. The queued
pacing-300 and patrol-3/4 runs now define era 2.

New tuned numbers, each with its note in the data file:

| File | Key | Why |
|---|---|---|
| `citygen.json` | `buildings.safeHousesPerDistrict` 1 → 8 | Q50. One per district is four per CITY; with four rivals deployed 51% of drops got no building at all. Also multiplies informant doors — intel is more CONVENIENT to reach, not cheaper |
| `hq.json` | `landingSearchRadius` | Secondary comfort bound; ships permissive because the district rule does the honesty work |
| `ai_firms.json` | `redropDebtFloor` | How far into reputation debt an AI will go rather than fold. Integer by doctrine — the first version scaled it by `riskWeight` and tripped the no-floats guard |
| `areas.json` | (unchanged) | Compound DIMENSIONS deliberately not touched: playtest 13's apparent-size complaint was the camera, and changing a tuned number would have voided baselines for no measured reason |

**i18n**: the catalogs grew from 227 to 348 key-identical pairs across playtest
13 and City Info. Two guards matter beyond parity:

- The **legend labels are built at runtime** from token names, so the standing
  `t("...")` source scan would never see them — `test/client.test.js` asserts
  every legend key exists in BOTH catalogs, derived from `tokens.marks`.
- **A rendered string is not a data structure.** The City Info standing row is an
  interpolated entry, and `t()` fills a missing arg with an EMPTY STRING — so a
  dropped interpolation leaves a hole, not a visible `{0}`. The `ui` gate reads
  that row and asserts it keeps its numbers; a unit test that formats rows with
  its own helper stayed green under mutation, because it was not reading the
  renderer.
