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

**STATUS: neither exists yet.** Playwright is the house tool (both siblings
depend on it and its browsers are already installed on this machine), so this
is a port, not a research task. Until it lands, every client claim rests on a
human loading the page.

## AS BUILT (M7, 2026-08-05)

Session seam, i18n, HUD, mission board, standoff panel, evac overlay,
tap-to-move, drop-zone picker — and, from playtest 3, the **2.5D diorama**:
three.js from `node_modules` via `/vendor` + importmap (the Fireline pattern),
one vertex-coloured ground mesh, instanced building mass, a 52° orthographic
camera with **no rotation** and clamping to the map.

The former full-screen 2D canvas is now the **minimap**, terrain baked once.

Relief in the terrain mesh is decoration only — it must never imply geometry
the simulation does not model.

**Also shipped (playtest 5):** the RUNNING section — the board shows OFFERS
only, and `rebuildOffers` removes a contract the instant it is accepted, so the
view carries `active` separately and the HUD points at the current objective.
Without it, accepting a contract looked like nothing happening.

**Client rules earned in playtesting, all guarded by test:**
- Interactive DOM re-renders only when its content changes. A 10Hz rebuild
  destroys buttons between mousedown and mouseup; clicks never land.
- Failures surface on the page (`fatal()`), never only in the console.
- Nothing may fog or clip the scene out of existence — depth constants derive
  from `CAMERA_DISTANCE`, not from guesses.

**Also shipped (2026-08-05):** the drop-zone picker names each district with
its trait and how many of your offers sit inside it; the evac overlay has its
countdown; and the active-contract rows carry a **work-stage progress bar**.
That last one is a client consequence of a balance change — every contract type
now has time-on-objective, so a player can stand still for 90 seconds, and a
HUD that shows nothing moving during that reads as a hung game. The bar is
built ONCE per row and only its width is mutated per tick: putting progress
into the row signature would rebuild the list at 10Hz, which is the exact
defect that made the contract button unclickable in playtest 5.

**NOT implemented:** art assets (everything is primitives), a mobile pass beyond
the 44px touch targets and responsive minimap, and — noted here because the
spec claimed otherwise for a while — the `client_smoke.mjs` / `ui_acceptance.mjs`
browser gates below. `test/headless/` is an empty directory. Both sibling
projects have these (`../firepower/tools/`), and their absence is the plainest
explanation for why five playtests each found a defect that a green suite could
not see. Highest-value client work available.

## To pin

`❑` HUD layout wireframe (M3 slice, with screenshot gallery) · `⚙` zoom
bounds, camera tilt copied from Fireline then adjusted.
