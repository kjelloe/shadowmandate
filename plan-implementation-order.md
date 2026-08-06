# Shadow Mandate — Implementation Order (M0–M7)

**STATUS 2026-08-06: M0–M6 complete (5g lane built and verified). Suite 220/220
green double-run, plus four browser gates (`smoke`, `ui`, `mobile`, `gallery`),
pushed to `dev_night`. M7 in progress and PLAYABLE in a browser: views, hosted
worlds, identity, the 2.5D diorama, objective marking, debrief, building
overlays, the drop-zone picker, the mobile pass (7b), the browser gates (7h),
the acceptance sweep (7g) and the procedural art pipeline (7a) have all landed.
Remaining in M7: the VM deploy itself (7e, needs the box) and native GPU perf
(7f, needs the gaming PC) — **both need the owner's hardware, so M7 is done as
far as it can be taken solo.** M8 added for S16 opposition: the difficulty layer D42/D43 say the contract
balance is waiting on.**

*Written 2026-08-04, for the implementing agent (me). The operational plan is
`plan-version1.md`; specs are `specs/systems/S01–S15`; this file is HOW the
milestones execute: slice breakdown, order, dependencies, and the battery/sim
runbook for the gaming PC. Update this file as slices land; history in
`dev-log.md`.*

---

## The slice loop (every slice, no exceptions)

1. Read the milestone's pinned specs (matrix in `specs/07_spec_map.md`).
2. If a product decision is missing → append to `dev-questions.md`, pick the
   spec's proposal as the provisional default behind a data flag, continue.
3. Tests first; suite double-run green; layer gate for the change (S14).
4. New positional state → four places (mirror, copyState, both hashes, view).
   New subsystem → hash-inert if possible.
5. `dev-log.md` entry: what shipped, gate numbers, dead ends with measurements.
6. From M5 on: every gameplay slice ends with the 5-seed sim gate.

Naming: `slice-<milestone><letter>` commit prefix (user commits; I stop and
report with the suggested message).

---

## M0 — Fork & Strip ✅ DONE (harvest, not strip — see dev-log)

- **0a** Copy from `~/GIT/firepower`: `shared/`, `engine/`, `server/`,
  `client/`, `test/`, `tools/`, `debugging/` scaffolding, `package.json`,
  `test.sh`/`run.sh`. Delete war modules (list pinned in `specs/02` §2:
  standards, supply, mines, caltrops, drone, drops, basewalls, bridges,
  premium, war maps sawtooth/caldera/riverline/blackwood/frontier_corridor).
  Prune their tests. Suite green.
- **0b** `data/` re-seed per S13 layout (firepower-derived values where
  modules survive); ruleset manifest + hash test; `en`/`no` catalogs seeded;
  **guard tests land first**: i18n parity, "syndicat" grep (D8), no-floats/
  no-Math.random static checks, no-entity-deletion-event invariant (D6).
- **0c** Re-pin the fixture: adapt `tools/repin_1a.mjs`, record the Shadow
  Mandate baseline (a minimal command script on a stub map), event-drift
  abort verified.
- **0d** Batch tools kept but dormant (`tools/agent-mail.py`,
  `batch_send.sh`, `batch_worker.sh`, `sim_sweep.mjs` left compiling but
  unretargeted until M5); README/CLAUDE alignment; dev-log entry.

**Watch for:** firepower modules with hidden imports of deleted systems —
delete leaf-first, run the suite after each removal, not once at the end.

## M1 — Urban World ✅ DONE

- **1a** Terrain tile extension (`street/alley/plaza/block/entrance/transit/
  checkpoint/yard`) + `data/terrain.json`; movement-cost table stub.
- **1b** `engine/citygen.js` core: district partition + road/alley network.
  **8×8 microscope fixture first** (human-inspectable, committed as text
  diagram) — only then the full-size generator.
- **1c** Site placement: contract sites, HoldingSite per district, safe
  houses, market buildings, entrance validity.
- **1d** Patrol routes (per-district budget) + drop-zone candidate logic.
- **1e** Probes 1–6 (S01) + 20-seed corpus runner at **64 AND 128** (D26);
  pin the two named reference seeds (pick for distinct identities).
- **1f** Mirror transform learns every city object class (HQs come later but
  sites/routes/buildings now) — the sweep's world-reflection must mirror them
  or every future mirror battery silently measures a malformed world.

**Gate:** corpus green both sizes; microscope fixture stable.

## M2 — The Agent ✅ DONE

- **2a** Agent entity + stance movement; pinned tick-count fixtures for the
  three stances on reference seed routes.
- **2b** Detection state machine, hash-inert; noise events as derived
  per-tick data (keep out of hashed state).
- **2c** Patrols animate on routes; sight/hearing checks drive
  unseen→noticed→burned; convergence on burn. Arrests per **D27**: downed
  agents always, burned agents at heat ≥3, via the S04 capture path.
- **2d** District heat: sources, decay, thresholds, checkpoint activation at
  4+; fuzzy/exact split is view-layer (D20) — exact value only enters a view
  with `heatIntel`.
- **2e** Combat items (suppressor/disruptor/sidearm) + downed/crawl +
  capture → HoldingSite. Bail/re-drop wait for M4 (needs ledger).
- **2f** Carry (package/intel/downed-agent) adapted from recovery pair logic.

**Gate:** the M2 headless probe script (sneak-past / burned-by-hurrying /
downed→captured / heat rise+decay) + census shows every transition fires.

## M3 — HQ & The Loop 🟡 ENGINE DONE (3a–3d); client 3e–3g OUTSTANDING

- **3a** HQ state + `requestDropZones`/`dropIn`; drop-zone validity against
  the live world.
- **3b** Perimeter + alarm events through fog (D21 countdown values in data).
- **3c** Evac beacon state machine (all five interruption rows as unit
  tests) + emergency evac + `extract`.
- **3d** Ledger store in `server/` + write-on-extract + drop-in injection +
  return-visit briefing data (world news headline selection).
- **3e** Client boot: session seam (`session.js`/`session-remote.js`),
  splash, briefing, drop-zone screens (S12 list).
- **3f** HUD v1 (canvas + stance selector + cache readout) + dropship
  choreography (client-only scripted paths).
- **3g** Port `client_smoke.mjs` + `ui_acceptance.mjs` harnesses; parse/
  import guard for every client file.

**Gate:** full loop headless AND in browser; re-drop shows the ledger.

## M4 — Tier 1 Contracts ✅ DONE (4a–4d); 4e board UI is client work, OUTSTANDING

- **4a** Pool generator + **D18 offer assignment** (reservation, disjoint
  boards) — the multi-seat disjointness test is the slice's core test.
- **4b** Courier + Surveillance machines (surveillance consumes S03 unseen).
- **4c** Extraction machine (rescue-follow loop).
- **4d** Capture exits: `payBail` + re-drop flow + auto-generated Extraction
  contract for held agents. Board rules per **D29**: max 2 active, one
  greyed next-tier teaser row.
- **4e** Mission board UI + loadout UI + HUD contract tracker.

**Gate:** scripted agent completes each type; economy census columns
(offered/accepted/completed/expired) emitting — these become battery columns.

## M5 — AI Rival Firms 🟢 DONE (5g lane built + verified; see BATCH_PC.md)

- **5a** **Sim harness before doctrine** (instrument-first): `tools/
  sm_worldday.mjs` — runs K Firms through a world-day of deployments on a
  seed, emits the S14 metric columns as CSV + a systems-fired census. This
  is the retarget of firepower's `sim_sweep.mjs` and the thing the batch
  worker will shard.
- **5b** AI Firm scheduler: deployment rhythm, contract scoring, execution
  doctrine (Move/Sneak switching, abort rules), evac. Lawful-view-only test.
- **5c** Raids + personalities (cautious/greedy/aggressive) + `aiDebug`
  telemetry (records failures, not just successes).
- **5d** Standoff protocol engine + resolution matrix + pacts + AI policy.
- **5e** Standoff UI panel (S12) + acceptance flows.
- **5f** ~~`enterBuilding`~~ (done early, D38) + dialogue framework + Informant
  content (S09); heat-quiet behaviour.
- **5h** `payBail` (D17) + auto-generated Extraction contract for held agents —
  raised in priority: D40's grace window makes bail matter more.
- **5g** **Batch lane bring-up** (runbook below) + first n=300 battery;
  establish baseline bands and record them in `specs/systems/S14` as the
  era-1 baseline (named by ruleset version + commit).

**Gate:** AI-vs-AI 12–16k ticks × 5 pinned seeds, zero invariant violations,
census complete; battery within provisional bands.

## M6 — Depth & Tier 2–3 🟢 DONE (D41 pacing-by-content applied; owner playtests for feel)

- **6a** Sabotage + Acquisition machines; radius phases 2–3; tier unlock
  counts; risk premium on offers in heat 2–3.
- **6b** Vehicles (lightTransport/motorbike/cargoVan) + board/exit + noise;
  AI Firms motorbike-only (D34).
- **6c** Vendor shop + upgrade catalog (bank-only, D30) — the bank sink;
  ≥3 meaningful upgrades.
- **6d** World sleep/wake in server + `dormancyTick(elapsedMs)` command +
  world-news generation; replay-exactness fixtures with pinned elapsedMs.
- **6e** **Pacing battery loop**: run pacing batteries (below), tune
  `data/` (speeds, radii, rewards, unlock counts) toward D11 (15–20 min
  sortie / 40–60 min deployment) and D19 (3–4 deployments to tier 3).
  Expect several rounds; every round re-pins the baseline.

**Gate:** pacing battery inside D11/D19 bands; dormancy replay-exact.

## M7 — Presentation & Ship 🟡 IN PROGRESS (views + world host + identity done; transport, client, art, deploy remain)

- **7a** 🟢 **DONE (2026-08-05)** — the procedural pipeline is forked and live
  (D46), portraits are feature-layer stacks so a disguise is a diff (D47), and
  `npm run gallery` renders the review surface. Art ships as CODE: no binary
  blobs, no artist in the loop, unit-tested. **7a-4 (2026-08-06)** finished the
  job the docs claimed was already done: the TILE palette had never left the
  renderer, existing in three copies across two colour spaces, so half of Q41c
  was not a token edit at all. It is now. **Only Q41c remains — the final look,
  which is the owner's judgement.**
- **7b** ✅ **DONE (2026-08-05)** — mobile pass MEASURED, not asserted:
  `npm run mobile` drives two phone viewports with touch emulation. All checks
  passed first time; mutation-verified by shrinking `min-height`.
- **7c** Identity: firmToken + recovery code + `claimFirm`, per-server
  scope (D32).
- **7d** ✅ **DONE (2026-08-06)** — season config, rotation and archive (D33),
  plus **D50's disclosure surface**: a joining player sees the world's
  day-of-season and the tier range of the Firms competing in it, on the splash
  screen and at `GET /worlds`. The season clock is DERIVED from `state.tick`
  rather than stored beside it, so it adds no positional state and cannot drift
  from the tick it describes. Rotation is checked on the **wake** path as well
  as the pump: dormancy adds slept ticks in one jump, so a season nobody
  attended must still end.
- **7e** VM deploy: systemd unit, caddy, rsync allowlist, `/version`,
  official public sample world; deploy runbook written as `RUNNING.md`.
- **7f** 🟡 **PARTIAL (2026-08-05)** — D26 128×128 render check PASSES
  (`SIZE=128 npm run smoke`). Native GPU perf still needs the gaming PC and
  remains the owner's.
- **7g** ✅ **DONE (2026-08-05)** — V1 acceptance sweep: **10 pass, 3 partial,
  1 fail**, written up with evidence in `V1_ACCEPTANCE.md`. The fail is pacing
  (criterion 10) and per D41/D42 its remedy is M8 opposition content rather
  than reward tuning, so it should be re-measured after M8. The partials are
  the dropship choreography (presentation, never built), the D17 rescue
  contract, and painted art. The sweep also wrote the multi-seat board
  disjointness test the criterion had asked for and which did not exist.
- **7h** ✅ **DONE (2026-08-05) — Browser test gates.** `tools/client_smoke.mjs` and
  `tools/ui_acceptance.mjs`, ported from `../firepower/tools/`. S12 has claimed
  these since M3 and `test/headless/` is an empty directory; every one of the
  five playtest defects was invisible to a green suite and obvious within ten
  seconds of a real page load. Playwright is the house tool in both sibling
  projects and its browsers are already installed on this machine, so this is a
  port, not research. Shipped as `npm run smoke` / `npm run ui`, ~25s each,
  both mutation-tested against the historical defects they guard. Found two
  real things on the way in: the diorama rendered at full rate behind the
  splash screen, and `TICK_MS` needed to be ops-overridable because headless
  software rendering cannot keep up with a 10Hz diorama.

---

## M8 — Opposition & Site Security 🟡 IN PROGRESS (8a–8g, 8i, 8j done; 8h next)

The difficulty layer. D42 rules that extraction and acquisition are
under-opposed rather than mispriced, so this is what the contract balance is
waiting on; D45 rules that every challenge here is diegetic — solved with the
agent in the world, never in a modal panel. Contract: `S16_opposition_security.md`.

Ordered so each slice is playable and measurable on its own.

- **8a** ✅ **DONE (2026-08-06)** — staged alarm machine (local → lockdown →
  district) in `engine/security.js`, triggered from existing burn events so the
  escalation was testable before anything could raise it. **Hash-inert**: alarms
  are their own collection, so no fixture re-pin and no era bump. Fogged in the
  view. Two findings: the alarm radius must stay under citygen's site spacing
  (at 6 vs 5 one burn woke every neighbour), and **stage 3 is unreachable until
  8f** — by design, so the numbers must NOT be tuned to force it.
- **8b** ✅ **DONE (2026-08-06)** — camera cones in `engine/cameras.js`, sweep
  derived from `state.tick`, feeding the existing detection currency. Four
  places done; cameras mirror in position AND facing. Cameras stand OFF their
  site looking away: mounted on the objective cell they covered it every tick
  and surveillance could never complete. Found and fixed a pre-existing AI bug
  (three unguarded HQ moves) that cameras made loud.
- **8c** ✅ **DONE (2026-08-06)** — sensor beams in `engine/sensors.js`, integer
  square-wave cycle, laid across the approach. A beam raises the alarm but does
  NOT touch detection: you can trip one and still be unseen. First tuning had a
  25-tick dark window against a 56-tick crossing — uncrossable, and now checked
  against `agents.baseSpeed`.
- **8d** ✅ **DONE (2026-08-06)** — junction boxes and `CMD_CUT_JUNCTION`.
  Blacks out every camera and beam at a site for a window, costs district heat,
  must be reached and touched. Derived from what was actually placed, so no
  switch exists with nothing behind it.
- **8e** ✅ **DONE (2026-08-06)** — credentials in `engine/access.js`. Three
  diegetic sources (informant, vendor, lifted off a disabled guard), per-agent
  and per-sortie, lost on capture and extraction. Gave S04 a real disabled-guard
  state, which it did not have.
- **8f** ✅ **DONE (2026-08-06)** — **the slice D42 was waiting for, delivered.**
  Site `securityTier` derived from the fixtures placed; working inside a secured
  facility climbs the alarm unseen, so acquisition's crack timer elapses with an
  alarm rising and **stage 3 is reachable in ordinary play** for the first time.
  Measured: escalations 5 → 14, stage 3 on three of six seeds, extraction's
  completion share ~63% → ~51% with no reward change. Secured share retuned from
  a compounded 56–80% down to ~31%. **Follow-up: the AI cannot yet get a pass,
  so secured work is player-only** — 8g should carry it.
  Showcase content is the **defended snatch** — D6 already turns the reference
  corpus's assassination family into capture-and-extract, and a defended one
  exercises access control, staged alarm and a rival arrival together
  (`specs/08_reference_mission_taxonomy.md`).
- **8g** ✅ **DONE (2026-08-06)** — contested contracts: offered to several
  Firms (capped), flagged on the board, paying a premium, arrival telegraphed at
  accept time. The finisher is paid, not the first taker; losers are told and
  released. **Narrows D18** — disjoint boards except where deliberately flagged
  — which is recorded and flagged for the owner.
- **8i** ✅ **DONE (2026-08-06)** — **Rival raids on your Field HQ, the EVENT half of D49.** Unprompted:
  a rival Firm turns up at your HQ whether or not you took a job about it. Comes
  before the contract deliberately — it is what teaches the mechanic and what
  makes an HQ feel like a place worth defending, and D28 already rules that evac
  activation is always allowed because "the hold is the fight".
- **8j** ✅ **DONE (2026-08-06)** — **Defend contracts, the CHOSEN half of D49.** The one whole family the
  reference corpus has and we do not; every current type is outbound. Needs 8g
  and 8i first: defending is meaningless without rivals who arrive, and the
  contract is the player *selling* competence at a threat 8i already made real.
  It is also the only contract type where being seen is not automatically
  failure, and the only one that is naturally co-operative for a second player
  who drops in mid-session.
- **8h** **Re-run the pacing battery and re-read D19** on the preference ratio.
  Only now is a dominance number a verdict (D43). Expect extraction's ratio to
  fall without a single reward change; if it does not, THEN the price is wrong.

---

## Battery / sim runbook (the gaming PC lane)

Adapted from firepower's proven `BATCH_PC.md`; per D25 we share the machine
and the tooling pattern. **Topology precedent: one hub per project** —
multiciv owns 8970 (on the PC), firepower owns 8971 (on the dev machine).
**Shadow Mandate takes port 8972, hub on the dev machine** (firepower
pattern).

### Local quick gates (dev machine — NOT the PC)

```bash
npm test                                   # unit + fixture layers
bash debugging/sim_campaign.sh             # the 5-seed gate (12–16k ticks,
                                           # outcomes + systems census) —
                                           # every gameplay slice ends here
SEED=… node debugging/sm_systems.mjs       # which systems actually FIRED
node tools/sm_worldday.mjs 20              # small local sweep, CSV to stdout
```

Five seeds tell you systems fire. **Never tune or convict on them** —
batteries decide (n=300+).

### One-time bring-up (at slice 5g)

Dev machine (WSL):
```bash
bash tools/hub_up.sh                       # port 8972; verifies portproxy
                                           # freshness + firewall, prints the
                                           # admin commands if stale
```
One-time ADMIN PowerShell on the dev machine's Windows side (re-run the
portproxy line after reboots — the WSL IP changes and a stale proxy
black-holes the hub silently):
```powershell
netsh interface portproxy add v4tov4 listenport=8972 listenaddress=0.0.0.0 connectport=8972 connectaddress=<WSL-IP>
netsh advfirewall firewall add rule name="shadow-mandate agent-mail hub" dir=in action=allow protocol=TCP localport=8972
```
Gaming PC (WSL2, beside the firepower clone):
```bash
git clone <remote> multisyndicate && cd multisyndicate
npm install && npm test                    # MUST be green — the worker
                                           # refuses to serve on a red suite
echo "http://<dev-machine-lan-ip>:8972" > .agent-mail/remote
bash tools/batch_worker.sh                 # sits in flag-wait forever
# ONCE=1 bash tools/batch_worker.sh        # drain once (bring-up test)
# --verbose / --debug when anything looks stuck; always logs to
# reports/sweeps/worker.log regardless
```

### Job kinds (implemented in OUR worker at 5g)

Queued from the dev machine with `bash tools/batch_send.sh <kind> …`:

| Kind | Body | Purpose |
|---|---|---|
| `sweep N` | world-day sweeps, auto-sharded across cores | balance census (S14 columns) |
| `mirror N` | same seeds, world mirrored | geometry-vs-doctrine separation |
| `firmswap N` | AI personalities trade seats | personality strength vs seed geometry |
| `pacing N` | player-shaped scripted Firm + AI rivals | D11 sortie/deployment length + D19 tier pacing columns |
| `heat K N` | heat-source multiplier override | heat tuning ladders |
| `size128 N` | world.size=128 sweep | D26 capability check |
| `update` / `resync` / `sendresults` / `perf` | as firepower | worker maintenance + GPU |

`batch_send.sh board` shows queue + status; `batch_send.sh collect` settles
summaries and extracts CSVs into `reports/sweeps/` (gitignored) —
`.prev`-shelving on same-label collisions, never silent overwrite.

### Rules of the lane (inherited, all earned)

- **Results name their commit** (`/version`-style stamp in every CSV +
  summary). Era discipline: baselines are re-pinned per ruleset version;
  numbers from an older era are void. Never mix pacing rows into standard
  baselines.
- The worker mails failure as loudly as success: unparsed job bodies, shard
  non-zero exits, red suites (with failing lines) all mail home. A silent
  worker is a bug — check `reports/sweeps/worker.log`.
- After worker-feature slices land here, queue `update` (autostash-safe);
  after a REBASE upstream, queue `resync` (hard-reset, safe — worker authors
  nothing and results are gitignored). A stale worker refuses unknown kinds
  by mail, naming its commit — that's the version check.
- **PC contention (D25):** before queueing a ≥300 battery, run `board` on
  BOTH repos (`bash tools/batch_send.sh board` here and in
  `~/GIT/firepower`). One big battery at a time — both workers shard to all
  6 cores and will thrash if run together. Overnight: queue one repo's
  batteries, let them drain, then start the other worker.
- When a probe and a sweep disagree → **config plumbing first** (print what
  world-day 1 actually starts with; the sweep has a config self-check).

### Native GPU perf (M7 — NOT a worker job)

The `perf` worker job runs in WSL = SwiftShader = measures a software
rasteriser. Real numbers come from the PowerShell runner on the PC:
```powershell
powershell -ExecutionPolicy Bypass -File tools\perf_native.ps1 -InstallDeps
```
(or from WSL: `powershell.exe -ExecutionPolicy Bypass -File "$(wslpath -w tools/perf_native.ps1)"`).
It runs headed with ANGLE d3d11 and **exits 2 if the summary names
SwiftShader** — a software run can never pass as native. Keep `.ps1` files
pure ASCII (PS 5.1 + em dash = silently truncated string; enforced by test).
Results ride home automatically with the next worker job (new/changed files
in `reports/sweeps/` are auto-mailed).

---

## Battery usage per milestone (summary)

| Milestone | Lane usage |
|---|---|
| M0–M4 | none — unit/fixture/local gates only |
| M5 | bring-up (5g); first `sweep 300` + `mirror 300`; pin era-1 baseline |
| M6 | `pacing 300` ladders (the D11/D19 tuning loop); `firmswap 300` once personalities stabilise; `heat` ladders as needed |
| M7 | `size128 300` capability battery; native perf; final `sweep 600` + `mirror 600` on the ship candidate — the shipping baseline |
