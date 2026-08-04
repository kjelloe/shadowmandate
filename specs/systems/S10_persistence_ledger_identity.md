# S10 — Persistence, Ledger, Identity & Seasons

*Feeds: M3 (ledger), M6 (dormancy), M7 (identity/seasons) · Depends on: S05 · Status: skeleton, core pinned*

## Purpose

Long-lived worlds (D3): world saves, the deterministic dormancy transition
(D16), the per-Firm world ledger (D7), seat-token identity (D10), 4-week
seasons (D15). All I/O lives in `server/`; the engine stays pure.

## World persistence (server-side)

- A world = `(seed, ruleset, commandLog, periodic canonical snapshots)`.
- Snapshot rotation to disk (firepower save patterns); `.prev` shelving —
  never silently overwrite (batch-lane lesson).
- Live sim at 10Hz while ≥1 Firm deployed; empty world sleeps.

## Dormancy transition (D16 — pinned design)

On first drop-in after sleep, the server issues ONE command:
`dormancyTick(elapsedMs)` (wall time stamped by server — the only clock entry
point). The reducer applies deterministically:
- heat decay equivalent to elapsed time (capped at reaching 0),
- contract offer pool refresh (expiries + regeneration, S06),
- **nothing else** — no rival progress, no simulated history.
Replay-exact: the command with its elapsedMs is in the log like any other.

## World ledger (D7)

Store keyed `(worldId, firmId)`:
`{ reputation, tierUnlocked, bank: {resources, items}, recognition,
   heldAgents[], callsignHistory[], lastExtractTick }`
- Written only on `extract` (clean or emergency) and bail events (S04).
- Surfaced to the engine as drop-in input (initial-state injection) — the
  reducer never reads storage.
- Return-visit briefing composes ledger + world news (headline events since
  `lastExtractTick` from the event log).

## Identity (D10)

- First join: server issues `firmToken` (random 128-bit, stored in
  localStorage) + shows a **recovery code** once (human-typeable,
  `word-word-word-word` `⚙` format) — hash stored server-side.
- `claimFirm(worldCode, recoveryCode)` re-binds a new browser to the ledger.
- No accounts, no passwords, no email in V1 (OTP is V2 M13).
- Tokens are **per-server** (D32): one token + recovery code covers all your
  Firms/worlds on that server.

## Seasons (D15)

- Official world: season length 4 weeks (server config `season.days=28`);
  at end: world archives (read-only replay/standings dump), new seed
  announced. **Ledger policy (D33): bank and tier unlocks reset with the
  world; recognition carries as a lifetime honor score** (keyed per-server
  identity, D32). Registered V3 requirement: persistent Firm-building across
  seasons — the V3 meta layer designs what else accumulates.
- Self-host: `season.days` configurable, 0 = never rotate.

## Gates & fixtures

Server tests: save/rotate/reload byte-exact; dormancy replay-exact with
pinned elapsedMs fixtures; ledger write on extract; recovery-code claim flow
end-to-end (V1 acceptance: cleared browser + code restores Firm).

## To pin

`⚙` recovery code format · headline-event selection for world news
(proposal: burns, raids, lockdowns, season milestones — top 5 since last
visit). (Token scope and season-end policy ruled: D32, D33.)
