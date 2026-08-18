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

**STATUS: both shipped 2026-08-05 (slice 7h).** `npm run smoke` / `npm run ui`,
Playwright, ~25s each, each starting its own server. `HEADED=1` to watch.

They run the world at `TICK_MS=250` rather than 10Hz. Headless software
rendering cannot draw the diorama and service automation simultaneously, so at
10Hz every interaction queues behind a frame and the gate takes minutes; at
250ms it takes 25 seconds. This changes no simulation outcome — the reducer
counts ticks and never reads a clock — and still reproduces the defects the
gates exist for, since a list that rebuilds per view update rebuilds at any
pacing.

Both were verified by reintroducing the historical defect they guard:

- removing the `[hidden] { display: none !important }` rule stacks every screen
  and `smoke` fails naming the stacked screens;
- breaking the importmap path makes `smoke` fail on the 404 and the missing
  world screen;
- removing the `boardSignature` early return makes `ui` fail with "the row was
  replaced mid-interaction — the list is rebuilding per tick".

The client gained `window.__smDebug`, a read-only derived snapshot (tick, own
agent, current screen, open overlays, board/active counts). The gates need to
assert on what the client RECEIVED, not only what it painted — "the world
ticked" and "the stance the server agrees I have" are not readable from the
DOM. Nothing on it is an input path, so it cannot become a cheat surface.

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

**Perf note found by the gates:** the diorama was drawing at full rate behind
the splash and drop-zone screens, where it is completely invisible — a 3D frame
ten times a second for nobody. `paint()` now skips the draw when `#world` is
hidden. On a real GPU this costs battery rather than seconds, which is why it
went unnoticed until automation made the page latency measurable.

**Still open:** with an overlay open over the diorama, page interactions under
software rendering cost several seconds each. On a real GPU compositing is
cheap, so this is largely a SwiftShader artefact — but it is worth a look during
the 7f perf pass and the mobile pass, since low-end devices composite in
software too.

## AS BUILT (7a art pass + 7b mobile pass, 2026-08-05)

**7b — the touch model is now measured, not asserted.** `npm run mobile` drives
two phone viewports (390x844 and 360x640) with touch emulation and checks: no
horizontal scroll on either the splash or the world screen, every visible
control >= 44px, drop-in working by TAP rather than click, the minimap under a
quarter of the screen, no HUD element off-screen, and the board overlay fitting
without pushing the page sideways. **Everything passed on the first run** — the
mobile CSS was written correctly and had simply never been loaded on a narrow
viewport. Verified by mutation: dropping the button `min-height` to 20px makes
the gate fail naming each offender and its measured size.

**7a — silhouettes.** Every marker except the Field HQ used to be the same
sphere, separated only by colour, which fails at a glance in a busy street and
fails completely for a colourblind player. Roles now carry shape: sites are
octahedra (taller when they are yours), informants cylinders, markets boxes,
cover shops cones, patrols cones (pointed — a thing that is looking), rivals and
your own agent spheres, HQs and holding sites boxes. The mapping lives in
`models.js` as a pure table, so the DECISION is unit-tested even though the
renderer is not; an unknown role returns null rather than silently defaulting to
a sphere. Building mass gained per-instance tint and footprint variation from a
second seeded hash draw — keying tone off the same value as height made every
tall block the same shade, which read as authored rather than grown.

**7f — D26 confirmed:** the render path loads, deploys and ticks at `SIZE=128`
as well as the 64 default (`SIZE=128 npm run smoke`). Native GPU perf still
needs the gaming PC and remains the owner's.

**NOT implemented:** real art assets (everything is still primitives), and
district tinting — the view carries district cores but not per-cell district
ids, so the client cannot tint ground by district without a view change.

## To pin

`❑` HUD layout wireframe (M3 slice, with screenshot gallery) · `⚙` zoom
bounds, camera tilt copied from Fireline then adjusted.

## Playtest 3 additions (2026-08-18)

- **Auto-extract**: `evacReady` on a human-seated Firm makes the SERVER issue
  `CMD_EXTRACT` (deduped; AI Firms issue their own). The beacon must end in a
  debrief, never a hung "ETA: 0".
- **First-deployment intro**: `#intro` overlay on the first `show("world")` of
  a browser (localStorage `sm_intro_seen`), corner notes anchored to the HUD
  clusters they describe. The ui gate asserts it appears and dismisses.
- **Pins**: up to `MAX_PINS` (3) accepted contracts; `pinnedCells` in models
  resolves through `objectiveFor` so a ring follows the contract's current
  target. Steady ring = watched, pulsing ring = current objective, on BOTH
  surfaces.
- **Burned guidance**: `burnedGuidance` in models points at the nearest cover
  shop only while burned; the radar pings it and the diorama rings it in the
  shop's mark colour.
- **HQ emblem**: ring + core on the radar, HUD ring under the tent in the
  world — a dot was invisible on the night ground.
- **The night look**: tile/lighting tokens retuned to the dystopian reference;
  building mass carries a deterministic emissive window sheet
  (`buildWindowData`, roof band reserved dark). All colour still lives in
  `style_tokens.json`.
