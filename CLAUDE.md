# Shadow Mandate (codename: multisyndicate) — Working Rules

Drop-in/drop-out covert-ops game. Sibling of Fireline Command
(`~/GIT/firepower` — the fork source, never modified from here).

**Status: M0–M6 complete; M7 done as far as it can go solo, and PLAYABLE in a
browser. `npm test` = 521 green**, plus four browser gates (`smoke`, `ui`,
`mobile`, `gallery`). Batch lane runs through GIT now (`batch/README.md`).
**Remaining in M7**:
the VM deploy (7e) and native GPU perf (7f) — both need the owner's hardware.
**M8 — opposition and site security — 8a–8k done** (alarms, cameras, beams,
junctions, credentials, secured facilities, contested contracts, raids, the
Defend contract); the contract balance verdict still waits on D42/D43.
**Playtests 4–12 (2026-08-22/24, D54–D64)** turned the client into a game:
45°/45° dimetric camera, HQ auto-landing (`hqLandingFor`), the session
economy end to end (bank 200, debits keyed on command TYPE at the socket
layer, throwaway `LEDGER_PATH` for every gate — `reports/ledger.json` holds
REAL progression), 4-lane streets with the four walking positions, mission
banner, title diorama, server-predicted drop landings. **Built 2026-08-24/26
(post-playtest-12, all on `dev_night`):**
- **DN-1 day-night** (D63a): 30-min compressed cycle, watchers see at 70%
  after dark (the ruled "night sneak 30%") through the single `sightPctAt`;
  client eases night↔day lighting; DAY/NIGHT HUD chip.
- **AR-1/AR-2 mission areas** (S17, D63c/D64): derived 24x16 compounds with
  guards, flank takedowns, terminals, PvP dumping; extraction carries the
  asset OUT, surveillance holds unseen at the vantage; the AI plays them
  with player commands (stage → cross-when-clear → cool off outside); the
  client renders the compound (area3d.js) with BEGIN/LEAVE/TAKEDOWN/HACK.
  The 8f credential gate moved to the ASSET; detection decay has ONE home
  (`decayDetection`). Live probe: `debugging/dbg_area_look.mjs`.
- **CL-1 city life**: engine civilians (8/district, flee trouble, never
  watchers — guard-enforced) + client hover-car theatre on transit lanes.
  Probe: `debugging/dbg_street_life.mjs`.
- **WD-1 waiting for dark** (S09/Q45): free at the safehouse, 10 at the new
  cubby holes (building kind 3, own rng stream, layout undisturbed);
  `waitForDark` is a dialogue effect, the reducer pops agents out at
  nightfall, early exit cancels.
**Built 2026-08-27 (D65)**: era `sm-era-1` (version finally HASHED — never
was); AI buys credentials from cache and waits for dark (AI-1 — the dead-
since-D51 8f scorer gate found and fixed); waiting polish (shelter survives
lockdown, nightfall countdown); BEGIN discoverable (intro + banner hints);
the cyberpunk splash (SP-1) and district neon/pipes (DC-2), all token-
driven; the wire's own fog fixed (agent-only events resolved to their firm —
four event types were mapped, tested and silently dropped). Era-1 batteries
QUEUED for the batch PC (pacing 300, patrol 3/4).
**Playtest 13 (2026-08-28), all eight findings built** on `dev_night`, suite
513 green:
- **PT13-A** camera: right-drag pan, quarter-turn rotation (four azimuths, all
  odd multiples of 45° so every view stays two-facade), and the **rAF frame
  loop** — the "jerky, lag skip" was drawing once per 10Hz snapshot. Every
  per-frame slew became dt-based (`slewAlpha`); movers ease via `smoothTo` and
  SNAP past 4 cells so compound entry does not slide across the void.
- **PT13-B** figures 1.03 → 1.455 tall, ratio 1.78 → 3.18 (the splayed arms, not
  the coat, were what read as stocky). The gallery had been reviewing art at
  PITCH 52 since playtest 4 and cropping half the cast; both fixed.
- **PT13-C/D** cover shops are standing landmarks (hollow rings on the radar,
  not dots); alerted patrols pulse and scale; a captured Firm with nobody left
  gets a centre overlay offering PAY BAIL and the D51 fold — both shipped
  months ago and never mentioned on screen. `bailQuote` gives the quoted and
  charged price one home.
- **PT13-E** four interior templates derived from site type (warehouse, office,
  industrial, transit) + the compound camera follows at street zoom, which IS
  the ruled 8x (the old fit put 28 cells across a 3.5-cell frame). Three ring
  defects found by the M5 gate going red: waypoints in walls park guards
  forever, naive snapping recreated 8a on the objective, and the AI staged for
  a crossing the office plan does not need.
- **PT13-F** smoking works stacks and residential parks; both were invisible
  when first written (2px plumes; lawns buried under the terrain's own relief).
- **PT13-G** display type for menus, plain monospace ink for dialogue, all
  token-driven.

**Ruled and built 2026-08-28 (era `sm-era-2`)**:
- **Q50** — safehouses 1 → **8 per district** and `hqLandingFor` confined to the
  requested district. 62% of drops used to land in a district the player did not
  choose; it is 0% now, exact rather than statistical (no radius got below ~4%).
  At the old density, 51% of drops with four rivals deployed got no building at
  all. **Worldgen change: era bumped, fixtures re-pinned, era-1 baselines void —
  at zero cost, because those batteries had not run.**
- **Q48** — the **mid-sortie redrop** (`CMD_REDROP`), so
  `bail.redropReputationHit` finally reads to something. Folding EXTRACTS and
  banks the cache; redropping keeps you earning with the cache at risk and costs
  standing. The AI got it in the same slice.
- **Q49** — owner is playtesting; nothing changed.
- **CI-1..CI-4 City Info** — eleven tabs (board / log / kit / firm / sortie /
  history / city / places / districts / firms / legend) on the splash and in the
  field, BOARD default. **KIT closed a real gap**: `credentialTier` was not in
  the view at all, so a badge bought from the vendor was invisible while the 8f
  rule gated extraction and acquisition behind it. HISTORY is the only panel
  needing persisted state (`sorties`, `bankedTotal`, `completedByKind`,
  normalised on read so no file migrates). Rank is "yours, not theirs". Rival intel is
  **earned or bought only** and the human/AI split is **never disclosed** (not
  sent at all). No new hashed state: the persistent half is `knownRivalHqs`, the
  session half derives from the journal. The **legend is derived from
  `tokens.marks`** — coverage asserted, exclusions must state a reason, so a new
  mark cannot go undocumented. Panes are shown/hidden, NEVER rebuilt: the
  board's buttons are the playtest-5 defect's original victim.

**Open**: the **era-2** battery verdicts (queue unchanged, still needs the batch
PC; the queue is committed at `batch/tasks/`); the AI's general night pricing; area retune behind
D42; avenue density (7B, noted). Q48/Q49/Q50/Q51 are all ruled and closed.

## Read first

1. `specs/00_document_index.md` — document map, rulings D1–D65
2. `plan-version1.md` — the operational plan (milestones M0–M7, gates)
3. `plan-implementation-order.md` — slice-by-slice execution order, per-milestone
   STATUS markers (battery lane: `batch/README.md`)
4. `specs/07_spec_map.md` → `specs/systems/S*.md` — implementation contracts
5. `dev-log.md` — what actually happened, including every dead end
6. `dev-questions.md` — decisions waiting on the owner

## Commands

```bash
npm test                                    # the whole suite (node --test)
npm run smoke                               # real browser: loads, drops in, ticks
npm run ui                                  # real browser: the controls DO things
npm run mobile                              # real browser: two phone viewports
npm run gallery                             # every visual + portrait -> reports/gallery.png
SIZE=128 npm run smoke                      # D26: render path at 128
node --test test/citygen.test.js            # one file
node tools/render_city.mjs 4711 64          # eyeball a generated city
node tools/render_city.mjs 4711 16 5        # the microscope config
SEED=4711 node debugging/sm_systems.mjs     # event census: what actually FIRED
node tools/sm_worldday.mjs 12               # AI world-day sweep, CSV metrics
MIRROR=1 node tools/sm_worldday.mjs 300     # fairness instrument
FIRMSWAP=1 node tools/sm_worldday.mjs 300   # personality vs seat
node debugging/dbg_alarms.mjs 6 12000       # do S16 alarms actually FIRE?
node debugging/dbg_choke.mjs 1548 64        # example one-off probe (kept)
SEED=4711 node debugging/dbg_ai_rejections.mjs 12000  # AI rejected commands (0 = healthy)
node debugging/dbg_look.mjs                 # drop in, photograph the live look
node debugging/dbg_area_look.mjs            # S17: enter a compound, render, exit
node debugging/dbg_street_life.mjs          # S17: crowd + hover cars, live shot
node debugging/dbg_district_look.mjs        # DC-2: commercial neon, via zone picker
node debugging/dbg_ai_credentials.mjs 1000 36000  # AI-1: live purchase census
node debugging/dbg_area_ring.mjs            # S17: guard-ring legality (4 zero columns)
node debugging/dbg_ai_areas.mjs 4711 8000   # the counts behind the M5 gate's binary
node debugging/dbg_poi_look.mjs             # playtest 13: shops + patrol markers
node debugging/dbg_cityinfo.mjs             # CI-1: every City Info tab, splash + field
node debugging/dbg_district_look.mjs Industrial 53,39 4   # a named district, aimed
node tools/batch.mjs queue pacing 300 60000  # queue a battery (commit + push it)
node tools/batch.mjs status                 # the battery board, either machine
node tools/batch.mjs run                    # WORKER: run everything pending
node tools/repin_fixture.mjs "<reason>"     # deliberate fixture re-pin
```

## Repo layout

| Path | Contents |
|---|---|
| `shared/` | prng, canonical byte writer + FNV-1a 64, fixedmath — **verbatim from firepower**, do not edit |
| `engine/` | pure reducer and subsystems: state, commands, reducer, snapshot, terrain, citygen, worldprobes, pathfind, agents, detection, combat, hq, contracts, buildings, standoff, ai_firms, security, cameras, sensors, season, mirror |
| `server/` | all I/O: `ruleset.js` (loads `data/`), `ledger.js` (world ledger, identity) |
| `data/` | every tuned number, 13 files + `ruleset.json` manifest with an era version |
| `client/js/` | the browser client: `main.js`, `scene.js` (diorama), `minimap.js`, `terrain3d.js`, `models.js` (view-model decisions, unit-tested) |
| `client/assets/metadata/` | **all art direction**: `style_tokens.json` (materials, marks, body, Firm identity, tile palette, triangle budgets, lighting) + `asset_manifest.json` (role → builder) |
| `client/i18n/` | `en.json` / `no.json`, key-parity enforced |
| `test/` | suite + `helpers.js` + `fixture_hash.js` (the paired hash) + `fixtures/` |
| `tools/`, `debugging/` | re-pin tool, city renderer; probes kept forever |
| `batch/` | the battery lane: `tasks/` queued by the dev machine, `responses/` written by the worker. **Git is the transport** — see `batch/README.md` |
| `ops/` | **gitignored, private ops repo**: deploy runbooks (`DEPLOY.md`, `NOTES.md`, `ssh-deploy.sh`, the unit) and the retired LAN batch scripts — never on public GitHub |

## Terminology contract (D8 — enforced by test)

Game title **Shadow Mandate**. Factions are **Firms**, the player character is
an **Agent**, the base is the **Field HQ**, missions are **Contracts**. The
word "Syndicate" is banned from every shipped artifact (`engine/`, `shared/`,
`server/`, `client/`, `data/`, `tools/`, `debugging/`); the repo codename is the
only sanctioned occurrence. `test/guards.test.js` fails the suite on a violation.

## Engine doctrine (non-negotiable)

- Pure deterministic reducer `apply(state, command)`; 10Hz; integer fixed-point
  (256 units/cell, entities at cell centres); seeded PRNG in state; no floats,
  no `Math.random`, no wall clock in `shared/`/`engine/` — the ONLY sanctioned
  clock entry is `dormancyTick.elapsedMs`. Guard tests enforce all of this.
- Zero runtime dependencies in `shared/` and `engine/`. Numbers live in
  `data/*.json`, loaded by `server/ruleset.js` and passed in as `state.rules`
  (shared by reference, never hashed except its version).
- Disable-only combat (D6): no entity-deletion event may exist. Guard-enforced.
- **The tick order in `applyAdvanceTick` is a contract**: move → perceive →
  heat → arrests → HQs → contracts. Reordering changes outcomes and the hash;
  `test/contracts_engine.test.js` asserts the call sequence.
- **Keep the module graph acyclic.** When a subsystem needs to react to another
  (burns attributed to contracts, say), do it in the reducer from the events
  already emitted rather than importing across subsystems.

### The four places (every time positional state is added)

1. `copyState` deep copy · 2. `engine/snapshot.js` hashState ·
3. `test/fixture_hash.js` (the deliberate duplicate) · 4. `engine/mirror.js`
`POSITIONAL_FIELDS` + `mirrorState`.

`test/mirror.test.js` has a MIRROR AUDIT that fails when a new `x`/`*X` field
is undeclared. A missed mirror field silently invalidates every future battery.

## Art doctrine (D46/D47 — art ships as CODE)

- **No colour lives in a renderer.** `client/assets/metadata/style_tokens.json`
  is the single source of truth for marks, body, Firm identity, the tile palette
  and lighting; `scene.js`, `minimap.js` and `terrain3d.js` carry none of their
  own, guard-enforced in `test/art_pipeline.test.js`. This is not tidiness: two
  surfaces draw the same world, and **duplicated constants cannot guarantee they
  agree** — which is exactly how the tile palette ended up in three copies and
  two colour spaces until 7a-4.
- **The manifest is the seam.** `asset_manifest.json` maps role → builder, so
  swapping a procedural stand-in for a painted model is a manifest edit, never a
  renderer edit. Roles in the tests are DERIVED from the manifest — never
  restated as a second list.
- **The tint rule.** Only meshes named `tint` are recoloured at runtime. A
  visual that accepts a tint and shows nothing looks like a design decision, so
  the test fails when the manifest claims a tint the model has no slot for.
- **Tile colours convert with a plain `/255`, never `THREE.Color`** — colour
  management would sRGB-decode them and darken the ground about fivefold, and a
  ground that renders "wrong but plausibly" is the hardest render fault to spot.
- **Look at `npm run gallery`.** Every visual, every portrait, real renderer,
  real lighting. The first render found figures reading as dark blobs with a
  detection band too thin to see — invisible to the code, the tests and a green
  suite. **A green suite cannot tell you the game looks wrong.**

## Opposition doctrine (M8/S16 — learned in 8a–8c, and again in PT13-E)

- **A patrol route is only legal against a FLOOR PLAN.** The area guard ring is
  pure geometry; the moment a second interior template existed it put 25% of
  waypoints inside walls (a guard advances only on arrival, so it parks forever
  — a wall with eyes) and, once naively snapped, one cell from the objective,
  which is 8a indoors and makes surveillance impossible everywhere that plan is
  used. Waypoints are legalised against the plan: passable, REACHABLE (a sealed
  room parks a guard exactly like a wall does) and outside guard sight of the
  objective. `debugging/dbg_area_ring.mjs` — four columns, all must read zero.
- **"Every mechanism must have a usable gap" applies to floor plans.** The room
  holding the objective had one door, which a single guard seals by standing in
  it. Two doors, on different bearings, is what took the last red seed green.

- **A security fixture must never cover the objective it guards.** Cameras were
  first mounted on the site cell, where a cone covers at distance 0
  unconditionally — so surveillance, which needs an unseen hold, could not
  complete anywhere in the world. Fixtures go on the APPROACH: the stealth
  problem is getting there, and the work itself stays possible. Asserted across
  a full sweep cycle for every camera and beam in three cities.
- **Every mechanism must have a usable gap.** A camera with no gap in its cycle
  is a wall; a beam whose dark window is shorter than the two cell-moves a
  crossing takes is a random punishment. Both are now asserted, and the beam
  check reads `agents.baseSpeed` so a movement retune cannot silently break it.
- **Never send the schedule.** Cameras and beams cross the wire as "where, and
  what it is doing right now" — never span/dwell/phase/onTicks. With the cycle a
  client plays the stealth layer perfectly without looking, which deletes the
  mechanic. Learning the pattern by watching IS the mechanic (D45).
- **A mechanic the player cannot see is an ambush.** The visual ships in the
  same slice as the mechanism, through the manifest (D46), and a dark beam is
  still drawn — you must see the line to plan a crossing through it.
- **A gating rule must live in ONE place both readers import.** 8f gated
  acquisition and extraction behind a credential and the AI was not told — the
  M5 gate went red with "the world is not alive", which is the M6
  acquisition-0% defect verbatim. `requiresCredential` is now imported by both
  the contract machine and the AI scorer.
- **RE-BASELINE BEFORE EVERY EDIT.** Two replacements in one script sharing one
  `before` snapshot: the second `assert s != before` compares against the
  original text, which the FIRST replacement already changed — so a no-op
  replacement passes its own assertion. This is the assert-the-mutation-applied
  rule failing from the inside, and it cost a full measurement cycle in D51.
- **A tested function with no caller is not a feature.** 8e shipped
  `liftCredentialFromGuard` with five passing tests and no command wiring it to
  anything, so one of the three credential sources did not exist in the game at
  all. Unit tests prove behaviour, never REACHABILITY. When adding a mechanic,
  check the path from a player input to the code — and from the AI too.
- **A battery tool that restates the engine's type list will silently measure
  the wrong game.** Both pacing instruments hardcoded five contract kinds while
  the game had six, so every Defend contract fell into a column that did not
  exist — and Defend was 30.5% of completions. They derive the list now. If an
  instrument enumerates anything the engine also enumerates, derive it.
- **Independent placement rolls COMPOUND.** Cameras at 35% and beams at 25% made
  56–80% of sites secured, not 35%. Measure the resulting share across seeds and
  assert it; D42 asks for *some* contracts harder, and the difference between
  "some" and "most" is the difference between a texture and a wall.
- **Distinguish what each thing knows.** A camera SEES you (feeds detection); a
  beam only knows *something* crossed (raises the alarm, leaves detection
  alone). That asymmetry is what makes "trip it and hurry" a real choice.

## Test conventions (earned, not stylistic)

- **Check the exit status before believing a number.** Reverting two of four
  files to measure a baseline left import errors; every process died, printed
  nothing, and an `awk` pipeline reported the empty output as "0 completions".
  A confident, entirely fictional baseline, nearly acted on (PT13-E).
- **Measure the thing, not a proxy for it.** A silhouette test that compared
  height against the COAT width reported a flattering 2.7 while the real
  bounding box gave 1.78 — the splayed arms were the widest part and the whole
  problem. A door-count test that walked outward from the objective measured
  door ALIGNMENT and called a two-door room zero-door.
- **A geometric feature can be invisible and still pass every test.** Smoke
  plumes at 0.07 cells render, emit, pass their census, and are two pixels on
  screen; park lawns at a fixed height are buried by a yard tile's own relief.
  Size against the CAMERA, and A/B by recolouring the thing bright magenta —
  in its intended colour it fails "wrong but plausibly".

- **`tickCollecting(state, apply, n)`** from `test/helpers.js` whenever you
  assert something happens *sometime during* a run. `state.events` holds only
  the LAST command's events — a loop that ticks 121 times and then reads
  `state.events` sees only tick 121 and silently misses what it looked for.
- **Never assert something that cannot fail.** A stealth test asserting
  `hurry >= sneak` passed while both burned, proving nothing. Assert the actual
  design promise (sneak in cover stays UNSEEN; hurry in the open gets BURNED).
- **Use `reachableDestination` / `centralDropZone` / `quietCell`** rather than
  hand-picked coordinates. `x + 3` lands in building mass; the first drop zone
  is always a map corner. Those failures are the test's fault, not the engine's.
- **Guards must read code, not prose.** Strip comments before scanning source
  in a test. This has now bitten twice: the dependency guard matched the phrase
  `from "this seat is lucky"` in a comment, and the CSS guard matched the rule
  written inside the comment explaining the bug it was checking for.
- **A guard only protects what it READS.** 7a-4 consolidated the tile palette
  and added a guard over `scene.js`, `minimap.js` and `terrain3d.js` — and a
  FOURTH copy sat in `main.js`'s drop-zone preview, in a file the guard never
  opened. Green, while the defect it exists to prevent was still in the tree.
  "I fixed all the copies" is a claim about a search, not about the code:
  enumerate the surfaces, then scan all of them.
- **A guard must match the form the bug actually took.** The colour guard
  scanned for `0x......` only — while the historical defect, the palette
  duplicated into `minimap.js`, was written as `"#RRGGBB"` strings and would
  have walked straight past it. It was green, and green for the wrong reason.
  Mutate with the *real* defect, not a convenient one.
- **Anything a player clicks must outlive the click.** A list rebuilt on every
  tick destroys its own buttons between mousedown and mouseup, so clicks never
  land and nothing errors. Re-render interactive DOM only when its content
  changes (see `boardSignature` in main.js).
- **A test can prove the DATA right while the TEXT is gibberish.** The season
  disclosure passed every unit test while the splash rendered
  `DAY  OF ....... 0 / 28` — an interpolated catalog entry used as a *label*,
  so both slots came out empty. Assert the rendered string, not just the row.
- **Never `git checkout <file>` to undo a mutation test.** It reverts
  uncommitted work with it; twice in one session. Restore from the backup copy
  the harness already made.
- **A silent client is the worst client.** Failures must surface on the page
  (`fatal()` in main.js). An empty canvas looks identical whether the renderer
  threw, the data never arrived, or everything drew in the background colour —
  that ambiguity cost three playtest rounds.
- **Isolate rendering faults in order: geometry → camera → wiring → shading.**
  Each is testable headlessly. The fog bug was found only after the first three
  were eliminated with numbers.
- **A UI claim is not verified until the flow runs against a live server.**
  Playtest 1 was unplayable — stacked screens, a dead button, invisible
  rejections — while the suite was green, because nothing exercised the client
  end to end. `npm run smoke` and `npm run ui` (Playwright, 7h) now do exactly
  that and both mutation-test clean against the historical defects.
- **Three times in one session, a mutation test failed to apply and I nearly
  concluded the guard was broken.** The `.screen{display:flex}` mutation could
  not beat the `!important` already in the CSS; the board-signature mutation
  targeted an `if`-block that is actually an early `return`. **Assert that the
  mutation changed the file** before drawing any conclusion from it — a
  mutation that silently no-ops looks exactly like a guard with no teeth.
- Test bugs and engine bugs look identical from the outside. When a probe and
  the game disagree, **check the instrument first** — two of M1's three "bugs"
  were in my own probes, and M5's AI telemetry was itself silently dropping
  every record it made.
- **Read the AI's rejected commands.** `move:no_route` and
  `activateEvac:not_at_hq` counts in a world-day found three AI defects and one
  serious player-facing bug that no test caught. A well-behaved AI issues zero
  rejections; anything else is a bug report.
- **A 0% in the battery is a bug report, not a balance reading.** Acquisition
  completed 0.0% across 24 world-days because D41 moved its delivery to a
  drop-off site and `ai_firms.targetCellFor` was never told, so the AI walked
  home and waited forever. Change what a contract requires, and change the AI's
  decision path in the same edit — a rule the actor does not know is a rule
  nobody follows.
- **The AI scorer is a measuring instrument.** D11 and D19 are verdicted from AI
  runs, so anything the scorer cannot perceive does not exist in the numbers. It
  priced `reward / (distance + heat)` with no term for time-on-objective, which
  made surveillance's 3600 stationary ticks free. Fixing it made the reported
  mix look *worse*, because it had started telling the truth.
- **Raw share cannot answer "is any type dominant."** Short contracts finish
  more often per unit time whatever anyone prefers, and tier gating means a
  tier-1 Firm sees only 3 of 5 types (uniform choice = 33.3%, already at D19's
  35% ceiling). Read the preference ratio in `debugging/analyze_pacing.py`, and
  mind its own caveat: "offered" samples board residence, which is depressed for
  popular types.
- **Rewards and progression are one system.** Every reward change moved
  "deploys to tier 3" in or out of its 3-4 band. Check both whenever either
  moves.
- **Balance attractiveness with OPPOSITION, not price (D42).** Extraction read
  1.43x over-chosen and the instinct was to keep cutting its payout. Wrong
  lever: extraction and acquisition are meant to get harder as a season
  progresses, and the opposition that makes them dangerous is not built yet
  (`specs/systems/S16_opposition_security.md`). A reward cut made now has to be
  undone later. Effort-pricing is done; leave the numbers alone.
- **Do not read a balance verdict against absent difficulty (D43).** The D19
  ceiling is deferred until opposition exists. A contract mix measured in a
  world with nothing pushing back is not a verdict about the finished game.
- **Every hash-inert collection must be POPULATED in
  `test/fixture_populated.test.js`.** Hash-inert growth is deliberate (an empty
  collection writes no bytes, so fixtures do not churn), but it means the twin
  hashers are only compared where a collection is non-empty. Adding `alarms` in
  8a re-opened the exact hole that file was written to close: deleting a field
  from one twin left the ENTIRE suite green. Populate it, and prove both
  directions — drift the twin, and un-populate the subject.
- **A mutation can apply to the FILE and not to the executed path.** Mutating a
  default parameter proved nothing because every caller passes the argument
  explicitly. "The mutation applied" now means the *behaviour* changed, not the
  bytes: if the suite stays green, check reachability before concluding the
  guard is toothless.
- **A test whose subject is empty proves nothing.** The paired-hash test ran
  only against a world with no contracts, and hashing is deliberately hash-inert
  for empty collections, so the twins' contract writers were never compared.
  `test/fixture_populated.test.js` asserts the world is populated BEFORE
  comparing. Prove a new guard can fail by breaking what it watches.

## Workflow

- **Slices**: named `slice-<milestone><letter>`, tests first, suite double-run
  green, the layer gate for the change, then a `dev-log.md` entry recording
  gate numbers and any dead end with its measurement.
- **Questions**: anything needing the owner's decision goes to
  `./dev-questions.md` (numbered from Q30) with context, a proposal, and a
  blank `Answer:`. Implement the proposal so nothing blocks; answers become
  rulings in `specs/01_design_of_record.md` and move to the `specs/06` archive.
  **Never guess a product decision.**
- **Fixture re-pins** are deliberate: `node tools/repin_fixture.mjs "<reason>"`.
  It refuses on event drift (exit 2) — that means the reducer changed, not the
  fixture. Inspect `test/fixtures/microscope.txt` by eye before regenerating it.
- **Batch lane** (D25): shared with firepower, repo-tagged; setup in
  `batch/README.md`. **Git is the transport** (2026-08-30): the dev machine
  commits `batch/tasks/NNNN-kind.json` and pushes; the worker pulls, runs
  `node tools/batch.mjs run`, and pushes `batch/responses/`. A task with no
  response is pending. The runner refuses to serve on a red suite, names the
  commit AND era in every result, flags an era mismatch rather than correcting
  it, and scrubs absolute paths out of any error — these files are tracked and
  the remote is public.
  Never tune or convict on 5 seeds — batteries (n=300+) decide. Not live until
  M5 slice 5g.
- **Git (updated 2026-08-04): committing and pushing to `dev_night` is
  allowed.** Remote is `git@github.com:kjelloe/shadowmandate.git`. Commit at
  slice boundaries with a green double-run suite, never on a red one. Any other
  branch, and anything resembling a merge, rebase or force-push, still stops
  and reports.

## Gotchas quick list

Probe vs game disagree → check the instrument, then config plumbing · read the
FAIL COUNT, not the exit code · telemetry must record failure · events are
per-tick · WSL Playwright is SwiftShader-only (correctness yes, FPS no; and it
cannot `page.screenshot` above ~640x360 — probes stay small) · ws tests
poll-wait, never fixed settles · era discipline: re-pin battery baselines
when `data/ruleset.json` version changes · a DISPERSAL assertion (things got
farther away) passes under a random walk — assert the STATE the mechanism
sets (fleeTicks, not distance), then mutation-test BOTH halves of any
two-source condition: the civilians' burned-flee test stayed green with the
feature deleted because an alarm CASCADE produced the same motion · a
hand-kept key map (SPOKEN_LINES) silently falls back on new content — derive
the requirement from the content and guard it.
