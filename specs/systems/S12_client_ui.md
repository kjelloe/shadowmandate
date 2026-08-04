# S12 — Client & UI

*Feeds: M3–M7 · Depends on: all systems · Status: skeleton, screens pinned*

## Purpose

No-build vanilla ES-module client; three.js 2.5D diorama; model/view split
with pure tested model modules; mobile is the same client gated on
`(pointer: coarse)`.

## Screen inventory (V1 — pinned)

| Screen | Content | Spec source |
|---|---|---|
| Splash terminal | SHADOW MANDATE boot sequence (D8 strings), world status, DROP IN | 01 §Splash |
| Briefing | Firm, callsign, district, ledger + world news on return visits | S05, S10 |
| Drop zone select | fog-filtered top-down, zone markers, 15s auto-pick | S05 |
| **HUD (in-world)** | diorama canvas; stance selector (Sneak/Move/Hurry); detection indicator (own state); district heat fuzz (3-step, D20); active contract tracker; cache readout; alarm toasts | S02, S03, S06 |
| Mission board (at HQ) | 5 offers (D18), tier stars, heat column, timers; loadout button; evac button | S06 |
| Loadout | Primary + Tool slots (vehicle from M6) | S04 |
| Building overlay | portrait + dialogue options / shop catalog | S09 |
| Standoff panel | rival identity, 10s radial, Engage/Withdraw/Negotiate | S08 |
| Evac overlay | 30s countdown, HOLD THE HQ, interruption states | S05 |
| Debrief | extraction summary, FIRM REPUTATION bar, ledger delta | S05 |

## Touch model (pinned from design doc)

Tap terrain = move (Move stance) · double-tap = Hurry · tap site/NPC in range
= contextual action menu · tap own HQ = board/loadout/evac · persistent
stance selector · pinch zoom. Buttons ≥ 44px on coarse pointers.

## Model modules (pure, unit-tested; thin DOM/canvas views)

`board_model.js`, `heat_model.js`, `detection_model.js`, `standoff_model.js`,
`evac_model.js`, `debrief_model.js`, `overlay_model.js` (S09),
`briefing_model.js`. Session seam: `session.js` / `session-remote.js` —
every module reads `session.state`, calls `session.apply()`.

## Renderer

Fireline three.js diorama reused: tilted orthographic, constrained zoom, no
rotation, Centre-on-Agent action; interpolates 10Hz snapshots; strictly
non-authoritative; WebGL1-fallback pinned three version (old GPUs);
SwiftShader-verified headless. 64×64 default; render path must handle 128
(D26 perf check at M7).

## Dropship choreography

Client-side scripted paths for `dropshipInbound/Outbound` per the pinned 5s
timelines (S05); presentation only.

## i18n

Every string through `en`/`no` catalogs (S13); key-parity enforced by test;
zero literal "Syndicate" (D8) — suite greps the client tree.

## Gates & fixtures

`client_smoke.mjs` (page errors, join, ticks) + `ui_acceptance.mjs` (buttons
DO things — elementFromPoint hit-testing, manual event dispatch under
SwiftShader) per milestone; parse/import check on every client file.

## To pin

`❑` HUD layout wireframe (M3 slice, with screenshot gallery) · `⚙` zoom
bounds, camera tilt copied from Fireline then adjusted.
