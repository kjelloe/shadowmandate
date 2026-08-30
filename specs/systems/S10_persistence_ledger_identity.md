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
`{ reputation, tierUnlocked, completedThisTier, bank: {resources, items},
   recognition, heldAgents[], callsignHistory[], lastExtractTick }`
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

### AS BUILT (7d, 2026-08-06)

**The season clock is DERIVED, never stored** (`engine/season.js`). Everything
is a pure function of `state.tick` and the ruleset, so the season adds no
positional state, no `copyState` entry, no snapshot field and no mirror
declaration — and cannot drift from the tick it describes. A stored `seasonDay`
counter would have been a second source of truth for one fact, which is the
defect this project keeps finding elsewhere in its own code.

This works only because `state.tick` is **real-time anchored**: `applyDormancy`
adds the slept ticks, so a world nobody visits for a week still ages a week.
Rotation is therefore checked on the **wake path as well as the pump** — a
season measured in awake ticks would never end on a quiet world, which is
backwards, and a per-tick-only check passes every test while being wrong on the
live host.

The **season number** is deliberately not in engine state: rotation resets the
tick to zero, so "which season is this" is server bookkeeping. It lives in the
ledger (`seasonOf`/`setSeason`) so a host that reboots mid-season does not
silently reopen as season 1 and re-archive over its own dump.

On rotation: archive the standings **before** the reset (archiving after dumps
the empty world that replaced the season), `rotateSeason` the ledger, derive the
next city seed from the current one (`nextSeasonSeed` — deterministic, because a
random seed would make season 2 unreproducible from config), rebuild through the
same path a new world uses, and **tell every seated player**. A client whose
agent and HQ silently vanished is indistinguishable from a crash.

### Disclosure before joining — D50

A joining player sees **day-of-season and the tier range of the Firms competing
in the world**, because D50 permits a full upgrade tree only on the condition
that its parity cost is bounded (by the season) and *disclosed*. Meeting
stronger agents is unfair only when it was unforeseeable.

- `World.standing()` — season, day, days, daysRemaining, tier low/high, seats,
  size. Tier range **includes AI Firms**: reporting only human tiers would
  describe a world that is mostly AI as empty of strong opponents, which is the
  precise misinformation this exists to prevent.
- `GET /worlds` — public and unauthenticated on purpose; you must be able to
  read it before you have an identity on this server. It instantiates the
  configured world so a freshly restarted host does not answer "no worlds here".
- The **briefing** carries the standing too, so it renders on the splash screen
  where the drop-in button is — not in a server list nobody visits.

## Gates & fixtures

Server tests: save/rotate/reload byte-exact; dormancy replay-exact with
pinned elapsedMs fixtures; ledger write on extract; recovery-code claim flow
end-to-end (V1 acceptance: cleared browser + code restores Firm).

## To pin

`⚙` recovery code format · headline-event selection for world news
(proposal: burns, raids, lockdowns, season milestones — top 5 since last
visit). (Token scope and season-end policy ruled: D32, D33.)

## Playtest 5 — the bank works now (2026-08-22, D57)

- `emptyLedger` seeds `bank` from `rules.hq.startingBank` (200); a season
  rotation resets the bank TO the starting bank, not to zero — a fresh start
  that cannot afford any action is the exact defect this closes.
- **Purchases and bail debit the ledger.** The reducer stays pure and only
  checks `command.bank` (D30 bank-only, injected at the socket layer); the
  settlement lives in `world.tick()`, which spends every priced event
  (`itemBought`, `dialogueChosen`, `coverBought`, `bailPaid`) against the
  store. Until this batch nothing subtracted the money — every buy since M4
  was silently free. A refused buy provably does not debit.
- **The bank rides on the view** (`viewFor` attaches it) and renders as a HUD
  pill; unaffordable overlay rows grey out and disable.
- **Version-2 ledger migration**: on load, a file without the version stamp
  has every firm bank floored to the starting bank, once. No pre-fix entry
  can legitimately be below the floor for having SPENT (spending did not
  work), so the floor is safe; every save carries the stamp so spending below
  the floor sticks forever after. Pinned in `test/hq.test.js`, both
  directions: legacy files floor, stamped files never re-floor.

## CI-4 career fields (2026-08-30)

The ledger gains three fields for the City Info HISTORY panel:

| Field | Meaning |
|---|---|
| `sorties` | deployments that ENDED — an extraction or a fold. The only place a sortie is known to be over. |
| `bankedTotal` | lifetime earned, never spent down. `bank` is a BALANCE and says nothing about a career: a Firm that banked 4000 and spent 3900 reads identically to one that never worked. |
| `completedByKind` | completions per contract type, in the engine's own kind order. Derived from `contractCompleted` events at the server — never from a restated list of kinds, which is how the pacing instruments once dropped 30% of completions into a column that did not exist. |

**`completedThisTier` (D69) — progress TOWARD the next tier, not just the tier
reached.** It was the one thing extraction discarded: a Firm four contracts into
a five-contract tier lost all four **by going home**, which in a
drop-in/drop-out game is a penalty on the core loop. No battery could see it —
a world-day runs continuously and never extracts — so the measured "deploys to
tier 3" was the optimistic figure.

Two properties that make it unlike its neighbours here:

- **It is the only ledger counter that legitimately goes DOWN.** Crossing a tier
  resets it to 0, so `applyDebrief` ASSIGNS it where every neighbouring field
  takes a `Math.max`. Maxing would pin a Firm at its pre-unlock count forever
  and hand it each following tier for free.
- **There are TWO debriefs, and only one reaches the ledger.** `engine/hq.js`
  builds one as its return value; `server/world.js` rebuilds another from state
  on `firmExtracted`, and **that is the production path**. A field added only to
  the engine's would leave progression leaking with a green suite and a passing
  round-trip test. The guard in `test/server.test.js` is therefore DERIVED:
  whatever `applyDebrief` reads off a debrief, the server must supply.

**`normaliseLedger` fills defaults on READ.** `get()` substitutes a whole missing
RECORD, not missing FIELDS, so a file written before these existed would return
`undefined` and every read site would have to defend itself until `?? 0` had
spread far enough that nobody knew which fields were real. Normalising means no
version bump and no rewrite of anybody's file, and it extends `completedByKind`
if a contract kind is ever added.
