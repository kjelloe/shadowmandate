# S11 — Server & Protocol

*Feeds: M3–M7 · Depends on: S05, S10 · Status: skeleton, core pinned*

## Purpose

One Node process (HTTP static + `ws`) hosting N worlds. V1 is solo-per-Firm
but the architecture is the multiplayer one (D4): seats, fog-filtered views,
reconnect — so V2 adds humans, not architecture.

## Topology

- `server/worlds.js`: world registry, lifecycle (create from seed, sleep,
  dormancy wake, season rotation via S10).
- One world = one command queue + reducer pump + snapshot/broadcast (firepower
  server pattern, largely reused).
- URL/config surface: `?world=<code>`; server config file for season, size
  (64 default / 128 capable — D26), slots (16 default).

## Protocol (frames over ws, allowlist-validated)

Client→server: `hello {firmToken|new}`, `claimFirm {recoveryCode}`,
`requestDropZones`, `dropIn`, then gameplay commands (S02–S09 command set),
`ping`.
Server→client: `welcome {firmId, view, ledger, worldMeta}`, `view {delta}`
(fog-filtered, 10Hz), `event {…}` (own-relevant events), `dropZones`,
`extractResult {debrief}`, `error`.

- **Views cross the wire, never state.** Per-Firm filtering in `engine/view.js`
  before transport (firepower invariant). Payload assertions in tests: no
  rival HQ outside fog, no exact heat without intel (D20), no pooled contracts
  beyond own 5 offers (D18).
- Reconnect (D31): token re-attaches to the live agent; **120-second grace**
  on disconnect — agent holds position, AI Firms do not *initiate* a raid on
  that player's HQ during grace (an already-running raid continues). After
  grace the agent is idle until reconnect. The world never pauses.

## Ops (M7, D14)

Single VM, systemd unit, caddy TLS, rsync-allowlist deploy (runtime files
only); official public sample world at a known URL; connection/game caps,
per-IP limits, save rotation (S10). `/version` endpoint names the commit
(batch-lane lesson: results must name their commit).

## Gates & fixtures

Real-ws-client tests: join/new, claim, drop-in, command round-trip, view
payload assertions, reconnect inside/outside grace, tamper frames rejected.
Poll-waits, never fixed settles (suite runs on the loaded PC too).

## To pin

`⚙` caps/limits · deploy runbook (M7 doc). (Reconnect grace ruled: D31, 120s.)
