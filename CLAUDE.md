# Shadow Mandate (codename: multisyndicate) — Working Rules

Drop-in/drop-out covert-ops game. Sibling of Fireline Command
(`~/GIT/firepower` — the fork source, never modified from here).

**Status: M0–M6 complete; M7 done as far as it can go solo, and PLAYABLE in a
browser. `npm test` = 439 green**, plus four browser gates (`smoke`, `ui`,
`mobile`, `gallery`). Batch lane verified (`ops/BATCH_PC.md`). **Remaining in M7**:
the VM deploy (7e) and native GPU perf (7f) — both need the owner's hardware.
**M8 — opposition and site security — IS IN PROGRESS** (8a–8k done: alarms, cameras,
beams, junctions, credentials, secured facilities, contested contracts, raids
and the Defend contract). **8h re-run after 8k**: five of six contract types now
read in a 0.75–1.21x preference band and extraction is no longer dominant.
Credentials are still rare, pacing is still short, and one seed shows
unexplained accept churn — all flagged in S16. It is what the contract balance is waiting
on (D42/D43). **Playtest 4 (2026-08-22, D54–D56)**: fixed 45°/45° dimetric
camera, block massing with parcels (visual pass, D55), and the Field HQ now
auto-establishes in the nearest free safehouse at drop-in (`hqLandingFor` in
`engine/hq.js` — the single home of the landing rule). **Playtest 5
(2026-08-22, D57–D61)**: the session economy actually works (starting bank
200, purchases/bail genuinely debit, bank visible in the HUD, one-time
ledger floor migration); one Leave button that really exits; patrol-clear
landings; and the map-look pass — 2/4-lane streets with lamps, per-district
building identity (`districtMap` on the wire), typed site markers and the
prison block. Owner questions answered through D59; **Q44 is open** (the HQ
safehouse doubles as the informant building).

## Read first

1. `specs/00_document_index.md` — document map, rulings D1–D61
2. `plan-version1.md` — the operational plan (milestones M0–M7, gates)
3. `plan-implementation-order.md` — slice-by-slice execution order, per-milestone
   STATUS markers (battery runbook: `ops/BATCH_PC.md`, private ops repo)
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
| `ops/` | **gitignored, private ops repo**: deploy runbooks (`DEPLOYING.md`, `BATCH_PC.md`), agent-mail hub + batch-lane scripts — never on public GitHub |

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

## Opposition doctrine (M8/S16 — learned in 8a–8c)

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
  `ops/BATCH_PC.md` (private ops repo, gitignored).
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
per-tick · WSL Playwright is SwiftShader-only (correctness yes, FPS no) · ws
tests poll-wait, never fixed settles · era discipline: re-pin battery baselines
when `data/ruleset.json` version changes.
