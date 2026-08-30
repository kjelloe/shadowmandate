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
one vertex-coloured ground mesh, instanced building mass, and — since
playtest 4 (D54) — a 45°/45° dimetric orthographic camera with **no
rotation**, clamped so the followed TARGET stays on screen (`clampMargin`;
the full-footprint clamp pushed a corner drop off-screen). Building mass is
block-massed into parcels with per-block character (D55, detail in S15).

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
- **HQ emblem**: ring + core on the radar, HUD ring at the HQ in the world —
  a dot was invisible on the night ground. Since playtest 4 (D56) the HQ
  lives in a safehouse: when the HQ cell is a building entrance the tent
  stays packed (`hqInBuilding` in models.js) and the ring marks the building;
  rings ignore depth so a tower cannot hide them.
- **The night look**: tile/lighting tokens retuned to the dystopian reference;
  building mass carries a deterministic emissive window sheet
  (`buildWindowData`, roof band reserved dark). All colour still lives in
  `style_tokens.json`.

## Playtest 7 additions (2026-08-23)

- **The mission banner**: top-centre, always — mission type, current stage,
  work progress, `(+n)` when more jobs are queued; red when the contract is
  in its capture grace. Completion and failure are EVENTS (a finished
  contract leaves the active list the same tick), so they FLASH for four
  seconds — teal MISSION COMPLETE, red MISSION FAILED — before the banner
  moves to the next job or hides. The banner reads the same first-active
  contract the objective pill, beacon and edge arrow already point at, via
  `models.missionBanner` (pure, tested); the ui gate asserts it names the
  mission after accepting one.
- **World scale (D60)**: the scene applies `tokens.scale[class]` (manifest
  per-entry override) to every pooled visual at build time; figure rings
  follow the figure, cell rings stay cell-sized; default zoom is street
  level (10 cells), range 4–70.
- **Gate hygiene**: every tool that spawns a server (`ui`, `smoke`, `mobile`,
  `dbg_look`) now passes a throwaway `LEDGER_PATH` — `reports/ledger.json`
  holds REAL player progression since the economy went live, and the ui gate
  BUYS things. Also learned the hard way: a hung gate run holds the fixed
  port, and the next run silently talks to the STALE server with old client
  code — if the ui gate times out at random checks, look for an orphaned
  `server/index.js` before suspecting the client.

## Playtest 8 additions (2026-08-23, D61)

- 16x world: `scale.figure` 0.0625, default zoom 6 (range 3–70); ALL HUD
  rings scale with zoom (`ringZoom`), the agent's additionally with the
  figure. Clutter/lamps/beams re-proportioned; dropship approach 8 cells,
  cruise 3.5 — the drop-in flight is finally something you watch.
- The four walking positions (`models.walkOffset`, pure, tested): nearest of
  {left sidewalk, left lane, right lane, right sidewalk} to the line toward
  the destination; the scene slews toward it. Render-only, in-cell — honest
  at the cell granularity the engine plays at.
- NPC refusals speak IN the dialogue: reject reasons for dialogue/shop
  commands map to in-character lines shown in the greet slot for 5s
  (`dialog.respond.*`); everything else keeps the technical toast.
- Every voluntary overlay (board, building) closes from a top-right ✕ —
  44px, so the mobile gate measures it; the standoff deliberately has none
  (it is a forced choice). The building ✕ still SENDS exitBuilding.
- Pavement pads under every lamp post (an intersection corner has no
  sidewalk strip, and a lamp standing on asphalt read wrong).

## Playtest 8 review addendum (2026-08-23)

Patrols and rivals carry zoom-adaptive rings in their radar mark colours
(0.7x the agent's ring): at 1/16 figure scale an unmarked patrol is pixels
tall, and a patrol you cannot see is an ambush — the opposition doctrine
applied to the renderer. Both surfaces (diorama, radar) speak the same mark
tokens, so they cannot disagree about what a colour means.

## Playtest 10 — the title diorama (2026-08-23)

The splash carries a living attract scene (`client/js/attract.js`): the dark
city at street level and a 24-second vignette — an operative sneaks the
sidewalk, ducks behind crates while a patrol's cone sweeps past, captures a
rival (red flash) and walks the captive off. Rules it lives under:

- **Pure theatre.** Wall-clock driven, no server, no engine; the world's
  honesty rules do not apply. Theatre may cheat SCALE (actors play at twice
  the world figure scale so the story reads from across the room) — never
  colour: every material comes from the tokens and the models from the
  manifest, and `attract.js` is inside the D46 colour guard's scan list, so
  the splash can never advertise a look the game does not have.
- **The choreography is a pure function** (`attractScript(t)`), so the STORY
  is unit-tested without WebGL (`test/attract.test.js`): the hide really
  overlaps the sweep, the capture really happens, the loop seam is clean.
- **The stage is authored for the camera**: mass NORTH of the street only —
  the first cut put towers south and they stood between the camera and the
  entire vignette. The action strip sits low-left, clear of the terminal.
- **Battery rule**: starts only while the splash is visible, stopped by
  `show()` the moment any other screen takes over — same rule that stopped
  the main diorama drawing behind hidden screens. A broken attract must
  never block DROP IN (wrapped, surfaces via `fatal`).

## Playtest 11 additions (2026-08-23)

- **Exact arrival**: on the final stretch (within two cells of the
  destination) the drawn operative walks to the EXACT tapped point — both
  axes, any tile, clamped inside the destination cell (`ARRIVE_CLAMP`) — and
  the destination pin stands on that same point, so pin and arrival always
  agree. En route the sensible-side rule is unchanged. The engine remains
  cell-granular; this is the render layer keeping the player's intent.
- **Mission-target circles**: a dedicated `objective` mark (violet) for the
  beacon, world halo and the minimap's objective ring — distinct from
  `siteActive`, which tints the site MODEL — and all mission rings are SLIM
  now (a fat ring reads as a zone, a thin one as a destination). Pinned
  rings slimmed too, keeping their own mark.
- The attract scene honours `prefers-reduced-motion`: one composed still of
  the city instead of the loop.

## Playtest 13 (PT13-A/C/D/G)

- **The frame loop is rAF**, not the snapshot. Drawing once per 10Hz snapshot
  is what "completely jerky, lag skip" was. The simulation is unchanged; movers
  ease toward the latest snapshot via `smoothTo` and SNAP past 4 cells, because
  entering a compound is a teleport. Every per-frame slew is dt-based
  (`slewAlpha`) — a fixed factor would make easing speed a property of the
  player's monitor. `window.__smFrames` lets the browser gate assert that
  frames outnumber snapshots, which is the only machine-checkable statement of
  "it is not a slideshow".
- **Camera controls**: right-drag pans (`panDelta`, with the pitch
  foreshortening term derived rather than guessed), stored as an OFFSET from
  the followed target so the view still travels with the operative; a recentre
  control appears the moment the camera stops following. Rotation is FOUR
  quarter turns off 45°, eased — a fixed compass makes the two rear facades
  permanently unknowable, which in a stealth game is hiding the board.
- **Cover shops are standing landmarks** in both surfaces, not a burned-only
  ping; the radar draws them HOLLOW so they read as a different kind of place
  from the site tokens. Alerted patrols pulse and scale rather than only
  changing hue.
- **The capture overlay** appears only when NO operative is left on their feet,
  and offers the options that already existed: PAY BAIL (`CMD_PAY_BAIL`) and
  the D51 fold-with-nobody-left. The bail price comes from `bailQuote`, shared
  with the reducer, so the quoted and charged numbers cannot drift.
- **Typography is two voices**, token-driven (`--type-*` written at boot):
  a tracked uppercase display face for chrome, and the plain monospace body
  face for anything a player reads to decide — dialogue, journal, option
  labels, intro copy. Terminals keep the body face by FUNCTION: their dot
  leaders are built with `padEnd`, which only aligns in monospace.

## City Info (CI-1, owner-ruled 2026-08-28)

One panel, five tabs, reachable from the splash and the field.

| Tab | Owns | Source |
|---|---|---|
| FIRM | bank, reputation, recognition, tier, **progress toward the next tier** (D70a), cache at risk, standing | ledger + view |
| SORTIE | status, clock, contracts taken/completed/failed, burns, captures | **the client journal** |
| CITY | world, season, day, light phase, districts, contracts, Firms deployed | briefing + live view |
| FIRMS | the rival roster | view, gated |
| LOG | the journal | client |

**Rulings encoded here:**

- **Rival intel is EARNED OR BOUGHT ONLY.** The roster carries name and tier —
  a Firm operating in a city is not a secret, and the informant has always sold
  HQ locations, so "somebody is here" was never the fogged part. A position
  crosses the wire only when `visible()` or `knownRivalHqs` says so. Gated at
  the VIEW, because a client cannot un-leak a field it was given.
- **The human/AI distinction is never disclosed.** `isAi` is not sent at all
  rather than sent-and-ignored.
- **No new hashed state.** Sortie figures derive from the journal the client
  already keeps, so nothing here touches the four places or churns a fixture.
  The trade is honest and printed on the panel: those figures are per SESSION.
- **Live numbers beat the briefing.** `briefing` is sent once at welcome and
  never updated; reading `activeFirms` from it made the CITY tab contradict the
  FIRMS tab on the same panel. Anything the live view can answer, it answers.
- **`displayDay` is the single home for "what day is it".** `seasonDay` is
  0-based for the rotation maths; every player-facing surface adds one, so the
  season clock and `gameClock` cannot disagree.

### CI-2 (2026-08-29): the legend, and the board folded in

Tabs are BOARD · LOG · FIRM · SORTIE · CITY · FIRMS · LEGEND, ordered by how
often a player reaches for them; BOARD opens by default.

- **Panes are shown and hidden, never rebuilt.** The board's lists carry live
  buttons and in-place progress bars maintained by `renderBoard`/`renderActive`
  under their own change signatures. Regenerating them with the panel would
  destroy each button between mousedown and mouseup — the playtest-5 defect that
  made ACCEPT do nothing for a whole round. The `ui` gate's "a contract row
  outlives 15 world ticks" check is what proves the move kept it safe.
- **The legend is DERIVED from `tokens.marks`.** `LEGEND_GROUPS` carries only
  grouping and order (editorial); coverage is asserted against the token table,
  and `LEGEND_EXCLUDED` must give a reason for anything left out. A new mark
  fails the test until it is placed. Swatches read the same table the renderers
  read, so the legend cannot disagree with what it explains (D46).
- Legend entries EXPLAIN rather than name — "Sensor beam, dark. This is the
  window to cross" is the mechanic in a line.

### CI-3/CI-4 (2026-08-30): kit, places, districts, history

| Tab | Source | Note |
|---|---|---|
| KIT | view (`credentialTier`, agent) | `credentialTier` was **not in the view at all** — a badge bought from the vendor was invisible while 8f gated the work behind it. Items are deliberately absent: the engine has no inventory model (items are used by slot, never owned), and a panel inventing one would describe a game that does not exist |
| PLACES | view (`buildings`) | Nearest first, **distance only** — a bearing would start doing the radar's job from inside a menu. Newly worth having because Q50 took safehouses from 4 per city to 24 |
| DISTRICTS | view (`districts`, `board`, `holdingSites`) | D20 holds untouched: the band always, the exact number only where the view had already decided intel was bought |
| HISTORY | ledger, via the briefing | The ONLY panel needing persisted state. Zero rows are kept — "Surveillance 0" is a fact about how somebody plays |

**Rank is "yours, not theirs"**: the engine sends a position and a count, so no
rival reputation crosses the wire.

**A row value may be an interpolated catalogue entry**, and `t()` fills a missing
arg with an EMPTY STRING — so a dropped interpolation leaves a hole, not a
visible `{0}`. `cityRow` forwards args, and the `ui` gate reads the standing row
and asserts it keeps its numbers. A unit test that formats rows with its own
helper stayed green under mutation, because it was not reading the renderer.
