# Spec Map — the structure between design and code

*Created 2026-08-03. Defines the system-spec set required to implement
`plan-version1.md`. Review of the existing structure, the gap, and the fill.*

## Review: what exists and what's missing

| Layer | Documents | Status |
|---|---|---|
| Design of record | `01_design_of_record.md` (D1–D26), terminology contract | **Complete** |
| Technical foundation | `02_technical_foundation.md` — stack, fork plan, module disposition | **Complete** |
| Operational plans | `../plan-version1.md`, `../plan-version2.md` (+ HTML) | **Complete** |
| Records | `design_update_2026-08-03…`, `starter_design_document.md`, `06_open_questions.md` (archive), `dev-prompts.md` | **Complete** |
| **System specs (implementation contracts)** | `systems/S01…S17` | Pinned skeletons, kept AS-BUILT since |

The design docs say what the game is; the plans say when features land. What
code needs is the layer firepower called the *technical workthrough*: per-system
contracts — state shapes, command names, event names, ruleset keys, behaviour
tables, and test hooks — precise enough that a slice can start from the spec
and end at its gate. Here that layer is split into one file per system
(fits the slice workflow better than one monolith).

## The system spec set (`specs/systems/`)

| Spec | System | Feeds | Depends on |
|---|---|---|---|
| `S01_world_mapgen.md` | Urban world generation, districts, sites, probes | M1 | — |
| `S02_agent_movement.md` | Agent entity, stances, vehicles | M2, M6 | S01 |
| `S03_detection_heat.md` | Detection states, noise, district heat | M2 | S01, S02 |
| `S04_combat_capture.md` | Disable-only combat, downed, capture, holding | M2 | S02, S03 |
| `S05_hq_session_loop.md` | Drop-in, Field HQ, evac, debrief | M3 | S01 |
| `S06_contracts_economy.md` | D18 economy, contract types, tiers, rewards | M4, M6 | S01, S05 |
| `S07_ai_rival_firms.md` | AI Firm doctrine, raids, telemetry | M5 | S03–S06 |
| `S08_standoff_encounters.md` | Proximity, standoff UI, pacts | M5 | S04, S07 |
| `S09_buildings_dialogue_shop.md` | D9 entry overlay, dialogue data, vendor | M5 (informant), M6 (vendor) | S01 |
| `S10_persistence_ledger_identity.md` | World saves, dormancy, ledger, seat tokens, seasons | M3, M6, M7 | S05 |
| `S11_server_protocol.md` | Commands over the wire, views, join, ops | M3–M7 | S05, S10 |
| `S12_client_ui.md` | Screens, HUD, touch model, model modules | M3–M7 | all |
| `S13_data_rulesets_i18n.md` | Ruleset JSON layout, catalogs, keys registry | M0 | — |
| `S14_testing_validation.md` | Fixtures, sim harness, probes, batteries, metrics | M0, every gate | — |
| `S15_art_assets.md` | Asset list, pipeline, palettes, splash | M7 | — |
| `S16_opposition_security.md` | Contested contracts, rival teams, alarms/sensors/cameras/lockdowns | **M8 — 8a–8k AS BUILT** | D42–D45, D49 |
| `S17_mission_areas.md` | The playable INSIDE: compounds, guards, takedowns, terminals; ambient city life | **AR-a/AR-b + city life AS BUILT** (2026-08-24) | D45 (revised), D63c, D64 |

## Milestone → spec matrix

| Milestone | Specs that must be **pinned** before the slice starts |
|---|---|
| M0 Fork & Strip | S13 (ruleset layout), S14 (fixture strategy) |
| M1 Urban World | S01 |
| M2 The Agent | S02, S03, S04 |
| M3 HQ & The Loop | S05, S10 (ledger part), S12 (screen list) |
| M4 Tier 1 Contracts | S06 (tier 1 part), S12 (board) |
| M5 AI Rival Firms | S07, S08, S09 (informant dialogue) |
| M6 Depth & Tier 2–3 | S06 (tier 2–3), S09 (vendor), S10 (dormancy) |
| M7 Presentation & Ship | S15, S11 (ops part), S12 (polish), S10 (seasons) |
| M8 Opposition & Site Security | S16, S03 (detection currency), S06 (secured contracts) |

## Authoring rules

1. **Just-in-time pinning.** Each spec ships now as a skeleton with everything
   derivable from D1–D26 already pinned. Numbers marked `⚙ tune` are initial
   values that live in `data/*.json` and get verdicts from batteries — changing
   them is tuning, not spec drift. Items marked `❑ pin` must be decided (by
   ruling or by slice) before the consuming milestone starts.
2. **Every spec names its contracts**: state fields, command names, event
   names, ruleset keys. Those names are the review surface — a slice that
   invents a name not in the spec updates the spec in the same commit.
3. **Determinism boilerplate applies to every spec**: new positional state
   touches the four places (mirror transform, copyState, both hash functions,
   view projection); new subsystems land hash-inert where possible; no new
   events inside the pinned fixture's steps.
4. **Terminology contract (D8)** governs all identifiers in specs and code.
5. Specs are living: sim findings update them via slices, dev-log records why.
