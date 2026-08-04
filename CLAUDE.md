# Shadow Mandate (codename: multisyndicate) — Working Rules

Drop-in/drop-out covert-ops game. Sibling of Fireline Command
(`~/GIT/firepower` — the fork source, never modified from here).

**Status: M0–M4 complete plus M5 slices 5a–5d and 5h (sim harness, AI rival
Firms, standoff, bail), engine only. `npm test` = 120 green.** No client exists
yet. Remaining in M5: informant dialogue (5f) and batch-lane bring-up (5g) —
5g needs the gaming PC, so it is the one slice that cannot be done solo.

## Read first

1. `specs/00_document_index.md` — document map, rulings D1–D34
2. `plan-version1.md` — the operational plan (milestones M0–M7, gates)
3. `plan-implementation-order.md` — slice-by-slice execution order, per-milestone
   STATUS markers, and the gaming-PC battery runbook (hub port 8972)
4. `specs/07_spec_map.md` → `specs/systems/S*.md` — implementation contracts
5. `dev-log.md` — what actually happened, including every dead end
6. `dev-questions.md` — decisions waiting on the owner

## Commands

```bash
npm test                                    # the whole suite (node --test)
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
- Test bugs and engine bugs look identical from the outside. When a probe and
  the game disagree, **check the instrument first** — two of M1's three "bugs"
  were in my own probes, and M5's AI telemetry was itself silently dropping
  every record it made.
- **Read the AI's rejected commands.** `move:no_route` and
  `activateEvac:not_at_hq` counts in a world-day found three AI defects and one
  serious player-facing bug that no test caught. A well-behaved AI issues zero
  rejections; anything else is a bug report.

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
