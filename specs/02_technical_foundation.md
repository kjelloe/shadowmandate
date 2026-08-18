# Shadow Mandate — Technical Foundation

**Basis:** Fork of Fireline Command (`~/GIT/firepower`), per ruling D2.
Companion reading: `~/GIT/retrogradegames/game-stack-revised.md` (Fireline practices) and
`~/GIT/retrogradegames/game-stack-overview.md` (original stack rationale).

---

## 1. The stack (inherited, non-negotiable)

| Layer | Choice |
|---|---|
| Language | JavaScript (Node.js, ESM), **zero runtime dependencies** in `shared/` and `engine/` |
| Server | Node HTTP + `ws` — one process serves static client and the WebSocket world |
| Client | Vanilla ES modules + three.js 2.5D diorama, no framework, no bundler, importmap |
| State | Pure reducer — `apply(state, command)`; the server is a thin pump |
| Math | Integer fixed-point, 256 units/cell, **entities at cell centres**; no floats in game code |
| Randomness | Deterministic PRNG (`shared/prng.js`), state-held; no `Math.random`, no wall clock |
| Hashing | FNV-1a 64 over canonical little-endian serialization; the hash is the contract |
| Tick | 10 Hz fixed |
| i18n | Key-identical `en`/`no`, enforced by test |
| Testing | `node --test`, no framework |
| Licence | MIT |

**Inherited invariants:**
- Server-authoritative; **views cross the wire, never state** — each Firm seat gets a fog-filtered view.
- Anything gameplay-relevant must be headlessly testable.
- No file/network I/O in `shared/` or `engine/`; persistence lives in `server/`.
- Ruleset numbers live in `data/*.json`, never in engine code.

---

## 2. Fork plan (V1 Milestone 0)

Copy from `~/GIT/firepower`: `engine/`, `shared/`, `server/`, `client/`, `test/`, `tools/`, `debugging/` scaffolding, `data/` structure, CLAUDE.md working rules (adapted). The firepower repo is never modified. No shared package — divergence is expected and free (D2).

The fork lands as a **strip**: delete war-specific modules, get the trimmed suite green, re-pin fixtures for the new baseline. Every hashed field lives in BOTH `engine/snapshot.js` and the test-local hash copy — the deliberate duplication carries over.

### Module disposition — AS BUILT (M0, 2026-08-04)

**M0 was a harvest, not a strip.** On inspection, firepower's `reducer.js`
(2708 lines, ~45 handlers) and `state.js` were almost entirely war-specific:
mines, caltrops, sandbags, satchels, gun stations, hardpoints, carrier
boarding, towing, bridges, drops, prisons, standards, plus a pinned
32-operator / 2-team / 8-asset spawn layout. Stripping would have meant
deleting ~80% of a 2700-line file and rewriting the rest, leaving dead code and
a fixture pinned to half-removed war logic. Instead:

| Class | Modules | Reality |
|---|---|---|
| **Verbatim copy** | `shared/prng.js`, `shared/canonical.js`, `shared/fixedmath.js` | Byte-level determinism contracts — unchanged, and the reason cross-machine hashing works |
| **Written fresh against the S-specs** | `engine/state.js`, `commands.js`, `reducer.js`, `snapshot.js`, `terrain.js`, `citygen.js`, `pathfind.js`, `agents.js`, `detection.js`, `combat.js`, `hq.js`, `contracts.js`, `mirror.js`, `worldprobes.js` | Patterns harvested (copyState rule, reject/event shape, canonical byte writer, paired hash, hash-inert growth); code is ours |
| **Not yet needed** | firepower `los.js`, `route_graph.js`, `transport.js`, `ai_regency.js` | Harvest when M5/M6 need them, not before |
| **Dropped** | every war module listed below | Never copied |

The original planning table follows, kept for the record of what was intended:

### Module disposition (original M0 plan, superseded by the table above)

| firepower module | Disposition | Becomes |
|---|---|---|
| `shared/prng.js`, `canonical.js`, `fixedmath.js` | **Keep verbatim** | — |
| `shared/factions.js` | Adapt | Firm definitions |
| `engine/reducer.js`, `state.js`, `commands.js`, `clock.js` | ~~Keep, slim~~ → **written fresh** | Core loop |
| `engine/terrain.js`, `los.js`, `pathfind.js`, `route_graph.js` | Keep | + urban tile types |
| `engine/view.js`, `snapshot.js`, `replay.js`, `session.js` | Keep | Fog-filtered views, hashing, replays |
| `engine/sites.js` | Adapt | Contract Sites, safe houses, Holding Sites |
| `engine/downed.js`, `recovery.js` | Adapt | Agent downed/crawl; carry = packages, subdued targets, downed agents |
| `engine/prisons.js` | Adapt | Authority Holding Sites; capture/rescue loop |
| `engine/units.js`, `transport.js` | Adapt | Agents + Firm vehicles |
| `engine/combat.js` | Slim heavily | Disable-only, short-range, noise events |
| `engine/ai_regency.js` | Adapt/extend | AI rival Firms + (V2) support-agent stances |
| `engine/mission.js` | Adapt | Contract generation/lifecycle |
| `engine/mapgen.js` | ~~Rewrite guts~~ → **written fresh** as `citygen.js` | Urban district generator (blocks, roads, transit, patrol routes) |
| `engine/victory.js` | Replace | Season standings / reputation, no battlefield victory |
| `engine/pings.js` | Keep | Comms (V2 squads) |
| `engine/standards.js`, `supply.js`, `mines.js`, `caltrops.js`, `drone.js`, `drops.js`, `basewalls.js`, `bridges.js` | **Drop** | War-specific |
| `engine/sawtooth.js`, `caldera.js`, `riverline.js`, `blackwood.js`, `frontier_corridor.js` | **Drop** | War maps; replaced by seeded city templates |
| `engine/premium.js` | **Drop** | Fireline's measured-map-lean underdog premium; no two-team war here. The pattern (sweep-derived, disclosed compensation) may return for seed fairness (Q7) |
| `server/*` | Keep, extend | + world persistence (long-lived saves, ledger) |
| `client/*` model/view split | Keep pattern | New HUD: mission board, heat, stealth indicators |
| `tools/` sim sweep, batch lane, asset pipeline | Keep | Retarget metrics (see §5) |

### New systems (no firepower ancestor)

| System | Notes |
|---|---|
| Detection & heat | Agent detection states (Unseen/Noticed/Burned), district heat 0–5, decay over ticks. Land it **hash-inert** (empty/default state hashes to nothing) so the fixture doesn't churn while it grows. |
| HQ lifecycle | Drop-zone validation, placement, perimeter, cache, evac beacon, fold-up |
| World ledger | Per-Firm-per-world persistence: reputation, tier unlocks, banked resources. Lives in `server/` (I/O), surfaced to the engine as initial-state input at drop-in — the reducer stays pure |
| Contract board | Generation cadence, tier gating by ledger, expiry |
| Dropship presentation | Scripted-path client event; server only registers HQ placement/removal |
| Standoff | Proximity trigger, 10s timer, deterministic AI policy (V1) / choice UI (V2) |
| Building entry overlay (D9) | Engine: `enterBuilding`/`exitBuilding` commands park the agent hidden at the entrance cell. Client: dialogue panel with options, or shop menu with static portrait. Dialogue/shop content is data (`data/*.json`), never engine code |
| Identity (D10) | Seat token in browser storage + human-typeable recovery code, bound to `(worldId, firmId)` ledger. V2: optional email OTP to secure/recover. No accounts, no passwords |
| Urban mapgen | Seeded districts with identity; validation probes (route redundancy, patrol coverage, contract-site spacing, drop-zone availability) |

---

## 3. Long-lived world architecture (D3/D7)

- One Node process hosts N worlds. Each world = seed + ruleset + accumulated command log + periodic canonical snapshots.
- **Sim clock:** the world ticks at 10Hz while ≥1 Firm is deployed. While empty, the world sleeps; on next drop-in the server applies a **dormancy transition** (heat decay, contract refresh, NPC reshuffle) as a single deterministic command parameterised by elapsed wall time — never by free-running catch-up ticks. This keeps replays exact and cost flat (Q2 refines this).
- **Persistence:** snapshot + command-log rotation to disk (firepower save patterns extended); the world ledger is a separate small store keyed `(worldId, firmId)`.
- **Determinism boundary:** wall-clock time enters the sim only as an explicit field on the dormancy-transition and drop-in commands, stamped by the server. Nothing else may read a clock.
- Ops target: single small VM, systemd, caddy for TLS, rsync-allowlist deploys (RetroMultiCiv pattern). Measured heap ~1MB per active game in the sibling projects; dormant worlds should cost ~0.
- **Hosting model (D14):** an official public sample world runs on the existing VM from V1. Self-hosted servers choose per-server: public (heartbeat to the master index, V3) or invite-only (no heartbeat; join by world code only — the code IS the invitation).

---

## 4. Client

- Same 2.5D three.js diorama camera, interpolating 10Hz snapshots; renderer strictly non-authoritative.
- Session seam from day one: `session.js` (local/solo) and `session-remote.js` (server) implement one interface; every UI module reads `session.state`, calls `session.apply()` — V2 multiplayer costs no UI rewrites (RetroMultiCiv lesson).
- Mobile is the same client, gated on `(pointer: coarse)`; touch model per the design doc (tap/double-tap/stance selector).
- Pure tested model modules feeding thin DOM/canvas views (`missionboard_model.js`, `heat_model.js`, `standoff_model.js`, `debrief_model.js`, …).
- URL params as config surface (`?seed`, `?world`, `?debug=1`); capture `location.search` at module eval.

---

## 5. Testing & simulation doctrine (inherited, retargeted)

Layered gates, each catching what the layer below can't:

1. **Unit tests** per engine subsystem.
2. **Pinned fixture** (the M0 re-pin of firepower's 1A pattern): a fixed command script with every intermediate hash. New subsystems land hash-inert; re-pins are explicit, reasoned, and abort on event drift.
3. **Headless sim campaigns** — AI-vs-AI Firm worlds on fixed seeds. The standard gate: 5 pinned seeds, systems-fired census. **Every gameplay slice ends with this.**
4. **Batteries** — `tools/sim_sweep.mjs` retargeted: one CSV row per simulated world-day. Metrics: contracts completed/failed per tier, burn rate, heat trajectories, capture/rescue counts, cache-vs-bank outcomes, standoff resolutions, AI Firm reputation spread. Fairness instruments: mirror + firm-swap (the mirror transform must learn every new positional subsystem — HQs, contract sites, patrol routes).
5. **Client smoke + UI acceptance** (Playwright, SwiftShader) — page errors, join, ticks; buttons DO things.
6. **Server tests** — real ws clients: drop-in, evac, reconnect grace, ledger write/read, dormancy transition, tamper rejection.
7. **Batch lane** — reuse the agent-mail queue to the shared batch PC for 300+ world batteries; results name their commit; failures mailed as loudly as success. Machine detail lives in `ops/` (private).

**Balance doctrine:** never tune or convict on 5 seeds; batteries decide. Every measured number belongs to an era; re-pin baselines on era changes (coordinate/ruleset/AI-doctrine shifts).

### The greatest-hits gotcha list (carried over verbatim as doctrine)

1. Probe vs sweep disagree → check config plumbing first.
2. New positional state → mirror transform, copyState deep-copy, BOTH hash functions, view projection — four places, every time.
3. No new events inside the pinned fixture's steps; prefer silent state changes for routine ticks.
4. Read the FAIL COUNT, not the exit code.
5. Telemetry must record failure, not just success; verify the instrument before believing the reading.
6. Sandbox traps produce fake verdicts — check test-world defaults before debugging "engine bugs".
7. WSL Playwright is SwiftShader-only: fine for correctness, useless for perf. Native perf via `tools/perf_native.ps1`.
8. ws tests use poll-waits, never fixed settles.

---

## 6. Development workflow (inherited)

- **Slices:** every change is a named slice (`slice-…`), tests first, suite double-run green, layer gate, dev-log entry.
- **Design of record:** product rulings land in `specs/`; code comments cite the ruling.
- **Questions queue:** open questions numbered in `specs/06_open_questions.md`, answered in batches; answers become specs and slices.
- **AI rivals as first playtesters:** the AI Firm doctrine is developed with gameplay-grade rigor — it IS the measurement instrument for V1 fun and balance.
- **Autonomy loop:** long unattended sessions work ruled slices, collect questions, end with a morning report in `reports/`.

---

## 7. Roblox / Luau twin

Deferred to a V3 gate (see `05_roadmap_v3.md`). The engine stays Luau-portable by inheritance (restricted JS subset, integer math, no null in state, named index helpers), but no twin is built before the browser game proves fun. Decision inputs at the gate: V2 retention, art readability on Roblox, and the D6 family-friendly doctrine (which was chosen partly to keep this door open).
