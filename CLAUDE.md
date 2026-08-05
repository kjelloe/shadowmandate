# Shadow Mandate (codename: multisyndicate) — Working Rules

Drop-in/drop-out covert-ops game. Sibling of Fireline Command
(`~/GIT/firepower` — the fork source, never modified from here).

**Status: M0–M6 complete; M7 in progress and PLAYABLE in a browser.
`npm test` = 220 green**, plus four browser gates (`smoke`, `ui`, `mobile`,
`gallery`). Batch lane verified (`BATCH_PC.md`). **Remaining in M7**: season
rotation (7d), the VM deploy itself (7e, needs the box) and native GPU perf
(7f, needs the gaming PC). **M8 — opposition and site security — is specced and
is what the contract balance is waiting on** (D42/D43).

## Read first

1. `specs/00_document_index.md` — document map, rulings D1–D47
2. `plan-version1.md` — the operational plan (milestones M0–M7, gates)
3. `plan-implementation-order.md` — slice-by-slice execution order, per-milestone
   STATUS markers, and the gaming-PC battery runbook (hub port 8972)
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
node debugging/dbg_choke.mjs 1548 64        # example one-off probe (kept)
node tools/repin_fixture.mjs "<reason>"     # deliberate fixture re-pin
```

## Repo layout

| Path | Contents |
|---|---|
| `shared/` | prng, canonical byte writer + FNV-1a 64, fixedmath — **verbatim from firepower**, do not edit |
| `engine/` | pure reducer and subsystems: state, commands, reducer, snapshot, terrain, citygen, worldprobes, pathfind, agents, detection, combat, hq, contracts, buildings, standoff, ai_firms, mirror |
| `server/` | all I/O: `ruleset.js` (loads `data/`), `ledger.js` (world ledger, identity) |
| `data/` | every tuned number, 12 files + `ruleset.json` manifest with an era version |
| `client/js/` | the browser client: `main.js`, `scene.js` (diorama), `minimap.js`, `terrain3d.js`, `models.js` (view-model decisions, unit-tested) |
| `client/assets/metadata/` | **all art direction**: `style_tokens.json` (materials, marks, body, Firm identity, tile palette, triangle budgets, lighting) + `asset_manifest.json` (role → builder) |
| `client/i18n/` | `en.json` / `no.json`, key-parity enforced |
| `test/` | suite + `helpers.js` + `fixture_hash.js` (the paired hash) + `fixtures/` |
| `tools/`, `debugging/` | re-pin tool, city renderer, agent-mail; probes kept forever |

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
- **A guard must match the form the bug actually took.** The colour guard
  scanned for `0x......` only — while the historical defect, the palette
  duplicated into `minimap.js`, was written as `"#RRGGBB"` strings and would
  have walked straight past it. It was green, and green for the wrong reason.
  Mutate with the *real* defect, not a convenient one.
- **Anything a player clicks must outlive the click.** A list rebuilt on every
  tick destroys its own buttons between mousedown and mouseup, so clicks never
  land and nothing errors. Re-render interactive DOM only when its content
  changes (see `boardSignature` in main.js).
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
- **Batch lane** (D25): shared with firepower, repo-tagged, hub port 8972.
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
