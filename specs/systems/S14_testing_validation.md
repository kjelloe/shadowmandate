# S14 — Testing & Validation

*Feeds: M0 and every gate · Depends on: — · Status: pinned (doctrine inherited)*

## Purpose

The layered gate system, retargeted from firepower. Each layer catches what
the layer below can't; every plan-version1 milestone gate maps onto these.

## Layers

1. **Unit tests** — per engine subsystem, `node --test`, no deps.
2. **The pinned fixture** — M0 re-pins firepower's 1A pattern for Shadow
   Mandate: a fixed command script with every intermediate hash, duplicated
   hash function in the test (two-file conscious change), re-pin tool with
   event-drift abort. New subsystems land hash-inert; silent state changes
   preferred for routine ticks.
3. **Headless sim campaigns** — the standard gate: 5 pinned seeds × 12–16k
   ticks, outcome + systems-fired census. **Every gameplay slice ends here.**
4. **Batteries** — `tools/sm_worldday.mjs`: one CSV row per simulated world-day,
   including D11/D19 pacing columns. **LIVE since 2026-08-05** — hub on the
   dev machine, worker on the shared PC (D25); full setup, ports and rules in
   `ops/BATCH_PC.md` (private ops repo, gitignored here).
   The worker refuses red suites, names its commit in every result, mails
   failure as loudly as success, and shelves rather than clobbers.
5. **Client smoke + UI acceptance** — Playwright/SwiftShader per S12.
6. **Server tests** — real ws clients per S11; poll-waits only.
7. **(V3) twins gate** — dormant until the Roblox decision.

## Battery metric set (V1 — pinned columns)

Per world-day row: contracts offered/accepted/completed/expired (per type,
tier); burns per deployment; heat trajectory (max, time≥4 per district);
captures, bails, re-drops, rescues; cache banked vs lost; raid attempts /
successes; standoff count + outcome distribution; AI Firm rep spread;
deployment length distribution (D11 check); deployments-to-tier-3 (D19 check).

## Fairness instruments

- **Mirror**: world reflection must mirror every positional subsystem — HQs,
  contract sites, patrol routes, holding sites, buildings. The transform is
  maintained code (firepower lesson: a new positional system that the mirror
  doesn't learn silently voids every mirror battery).
- **Firm-swap**: AI personality assignment swapped across seeds to separate
  personality strength from seed geometry.
- Verdict rules: never tune or convict on 5 seeds; n=300+ decides; era
  discipline — baselines re-pinned per ruleset version (S13), old numbers void.

## Standing invariants (suite-enforced, every run)

No entity-deletion events (D6); no floats/`Math.random`/wall-clock in
`shared/`+`engine/` (the only clock entry is `dormancyTick.elapsedMs`); view
payload assertions (fog, D18 offer privacy, D20 heat intel); i18n parity; D8
"syndicat" grep; copyState deep-copy audit for each new nested state.

## Probe library

`debugging/dbg_*.mjs` one-offs kept forever; instrument-first doctrine —
verify a probe's event-field names against the reducer before trusting zeros;
config self-checks print what war 1 actually starts with.

## Milestone gate map

M0 fixture+layout · M1 probe corpus (S01, both sizes) · M2 detection census ·
M3 loop e2e (headless+browser) · M4 economy census + disjoint-boards test ·
M5 AI campaign + first battery · M6 pacing battery + dormancy replay · M7
full acceptance + native perf (WSL Playwright is correctness-only; FPS via
`tools/perf_native.ps1`).


## The fixture coverage hole (found and closed 2026-08-05)

`fixture.test.js` builds its world with `createInitialState({seed, size})` — no
ruleset, no city. That world has no sites, no buildings and an empty contract
pool, and because hashing is deliberately **hash-inert for empty collections**
(an empty list writes no bytes, so fixtures do not churn as the game grows),
none of the contract or site code in `engine/snapshot.js` or its deliberate twin
`test/fixture_hash.js` was ever executed by the paired-hash test.

So the project's strongest guarantee had a hole exactly where the paired-hash
rule was supposed to bite: add a field to one hasher's contract writer, forget
the other, and every test stayed green.

`test/fixture_populated.test.js` closes it by running the same comparison
against a fully populated world. It **pins no hashes on purpose** — pinned eras
catch intended-versus-unintended behaviour drift, whereas the risks here (the
twins splitting, and the world not replaying identically) are provable from the
run itself, so the file costs nothing to keep green when balance numbers move.

It was verified the only way a guard should be: by deliberately breaking what it
watches. With an extra field written on one side only, the new file fails 2 of
4 tests while `fixture.test.js` stays completely green.

**The general lesson, now twice-learned:** a guard that has never been observed
to fail is not yet a guard. Previously it was guards matching prose in comments
instead of code; this time it was a test whose subject was empty.

## The battery lane, git-transported (2026-08-30)

The worker machine moved and the LAN agent-mail hub's assumption stopped
holding. **Git is the transport now**: the dev machine commits a task and
pushes; the worker pulls, runs, commits a response and pushes back.

```
batch/tasks/0001-pacing.json      queued by the dev machine
batch/responses/0001-pacing.json  status, commit, era, row count
batch/responses/0001-pacing.csv   the data
```

A task with no response is pending. That is the entire protocol — no claim
step, no daemon, no shared network. One worker at a time; two would both run a
pending task and race to push, which is fixable with a claim file if it ever
matters and is complexity for nothing today.

**Every rule the mail worker had earned is preserved**, and each was verified
against the new runner rather than assumed:

- **It refuses to serve on a red suite** and writes a FAILED response for every
  pending task rather than going quiet. Results from a broken build are worse
  than no results, because they look like data.
- **It names the commit and the era in every result.** `sm_worldday` already
  stamps both into the CSV header; the response repeats them so a directory
  listing answers the question without opening a file.
- **It refuses empty shard output.** A shard that dies silently would otherwise
  merge into a cheerful "0 rows".

**One rule the old lane never needed: nothing written may be private.** `ops/`
is gitignored precisely so host and LAN details never reach a public remote;
these files are tracked. So the runner records no hostname and no user, and
scrubs absolute paths out of any captured error. `test/batch.test.js` checks the
scrubber against repo paths, `/home` and `/Users`, asserts the length cap, and
scans the actual tree for leaks.

**And one the new transport introduced: era mismatch.** A task queued under one
era and run under another is not wrong — it answers a different question, and
reading it as the old one is exactly the stale-baseline hazard the era
discipline exists for. The response records `queuedForEra` and `ranOnEra` and
the board prints `<-- ERA MISMATCH`; it is never silently corrected.
