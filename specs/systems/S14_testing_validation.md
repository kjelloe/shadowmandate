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

## The era-2 verdicts (2026-08-30, n=300)

The first batteries through the git lane, and the run D42/D43 deferred to.
`batch/responses/0001-pacing`, `0002-patrol` (base 3), `0003-patrol` (base 4).

**`0001-pacing` and `0003-patrol` returned byte-identical.** Correct, not a
fault: the pacing job runs at the DEFAULT patrol base, which is 4. A free
determinism confirmation — and a note for whoever queues next, because paying
for both buys one result.

**D42 confirmed by measurement.** Extraction's preference ratio went from 1.43x
over-chosen (era 0, before opposition existed) to **1.03x** with its reward
never touched. The ruling was "balance attractiveness with OPPOSITION, not
price"; the opposition got built and the number came to parity on its own. A
price cut would have been made and then had to be undone. The eras differ so it
is not a clean A/B, but the direction is exactly what was predicted.

**A difference that was never there.** The n=24 pre-day-night patrol sweep read
"3 is gentlest on the economy". At n=300 on the current build every statistic
separating base 3 from base 4 is inside noise (all |t| < 1.2, reach-rate
z = -0.41). The old reading's own caveat — "differences of this size are within
noise on several axes" — was the correct one to have written down.

**Read the analyser, not an ad-hoc column mean.** Checking the numbers by hand I
computed 3.93 deploys to tier 3 and nearly reported it as inside the 3-4 band.
It was wrong: 132 of 300 seeds never reach tier 3 at all, and averaging them in
as "0 deploys" drags the mean down. `analyze_pacing.py` filters to Firms that
actually got there and reports a median of **6.0** — the opposite verdict. The
instrument was right and the improvised check was wrong, which is the reverse of
this project's usual failure and worth the same suspicion.

**Tier gating is not a balance problem.** Acquisition completes at 2.7% and it is
tempting to read that as an unattractive contract. It is tier 3, and 43% of
Firms never reach tier 3 in a world-day — its rarity is downstream of
progression, not of its own pricing. (This column was 0.0% once and that WAS a
bug, D41. Non-zero means alive.)
