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

## What the era-2 verdicts turned into (2026-08-30, D69)

Two of the three findings above were **not** what they looked like, and both
mistakes have the same shape.

**A quantity nobody computed reads exactly like a quantity computed badly.**
The battery reported courier at 0.17x and it was written up as a balance
problem. It was not: D53 priced pay-per-effort per **WORK-tick** and courier has
none, so the pass had never priced it at all, while the AI scorer charged it two
full legs of travel. The fix completes D53 rather than revisiting it.

**Before acting on "type X is mis-valued", check that X's value was ever
DERIVED.** A tuning pass keyed on a property some case lacks skips that case in
silence and leaves a stale literal wearing the shape of a decision. A comment
claiming the intention ("courier is priced by TRAVEL") is not evidence the
intention was executed — that exact comment sat in `test/ai_firms.test.js`
while the number it described had never been calculated.

**Ask what the harness never does.** `completedThisTier` was discarded on every
extraction, so real players lost partial tier progress — and **a world-day
battery is structurally blind to it**, because it runs continuously and never
extracts. The tier-3 figure printed at the time was therefore OPTIMISTIC for
players — and the value itself, 6.0, was separately wrong (D71: it counted every
Firm's deployments). Any continuous-run instrument cannot see a cost paid at a session
boundary; enumerate those boundaries before trusting a progression number.

**THE INSTRUMENT'S SHAPE IS PART OF THE INSTRUMENT.** Re-queuing the era-3
follow-up with the obvious command produced **36000 ticks** against the era-2
baseline's **60000**, because `pacing`'s CLI default differed from `patrol`'s
and no response recorded run length. The era flag would have been **green** —
the era really did match — so the only symptom would have been a progression
verdict disagreeing with its predecessor for no visible reason. Now: pacing
defaults to 60000, responses record `ticks`/`base`, and `status` prints the run
shape and flags a response that ran at a length other than the one queued.

**An instrument must not print a target that has been retired.**
`analyze_pacing.py` still printed `(target 40-60)` after D69 retired that band.
An instrument that prints a target is telling the reader what to conclude, so a
stale one silently manufactures a failing verdict. The deployment row now
reports a bare number and says the band is retired.

### Two guard patterns worth reusing

- **Derive the requirement from the consumer.** `test/server.test.js` asserts
  that every field `applyDebrief` reads off a debrief is one the server actually
  supplies — rather than pinning `completedThisTier` by name. There are TWO
  debrief constructions and only `server/world.js`'s reaches the ledger, so a
  field added to the engine's alone leaks silently past a green suite AND a
  passing round-trip test. Because the guard is derived, the next field added is
  covered without editing it.
- **Assert the RANKING, not the literal.** The courier guard asserts it is
  neither the worst-scoring contract on the board nor the best, using the real
  scorer against a real pool. A pinned reward would have to be edited by every
  future tuning pass; the ranking encodes the design promise that actually
  failed ("a contract the AI always ranks last is one it never takes") and can
  fail in both directions.

## The era-3 reading (2026-08-30, n=300, `0004-pacing`)

First battery through the fixed lane: `eraMatch: true` and **`ticks: 60000`
recorded and matched**, which is the new drift guard doing its job.

**The mix problem largely dissolved.** Courier went **0.17x -> 0.59x**, and the
spread collapsed with it: era 2 flagged three types over-chosen (surveillance
1.62x, sabotage 2.35x, defend 2.03x); **era 3 flags none**. Only one reward
moved. Courier's accepted share went 3.3% -> 9.1%, and the accepts came mostly
out of defend (11.2% -> 6.2%) — a reminder that contract choice is a RANKING, so
making one option viable redistributes across the whole board rather than
trading one-for-one with a neighbour.

**Tier-3 pace is unchanged at 6.0, and that is the expected result — but the
reason matters more than the number.** `tools/sm_worldday.mjs` imports no ledger
at all, and `extractHq` never cleared `completedThisTier`, so the firm object
carried it across redeploys naturally. **The battery was always modelling the
no-leak world.** D69(b) therefore could not move this measurement; what it moved
was REALITY, up to meet the instrument. Before the fix, 6.0 was optimistic
relative to what a player actually experienced; after it, 6.0 is what a player
gets. Reach rate 56% -> 64%.

**How to apply.** When a fix produces no movement in a battery, do not conclude
it did nothing until you have checked whether the harness was ever exposed to
the defect. A harness that skips a subsystem (here: the ledger) silently models
the FIXED world, so it reports "no change" for a real improvement and, worse,
reported healthy numbers for a broken one right up until somebody looked.

**A battery cannot answer a question about a boundary it never crosses.** The
world-day never extracts through a ledger, so no run of it — at any n — could
have found the leak or can now confirm the fix. Confirming D69(b) needs a
ledger-crossing harness, or the analytic argument above. That is a gap in the
instrument set, not a gap in the data.

## The tier-3 metric counted the wrong thing (2026-08-30, D71)

**The single most consequential instrument defect this project has found**, and
it was found by accident: adding `ticksToTier3` produced a row that contradicted
its neighbour. 6.0 deployments at ~10 min each is 60 minutes, but elapsed time
to tier 3 read **38**. Deployments cannot outlast the wall clock — unless they
belong to different Firms.

They did. `deploysToTier3` captured `m.deployments` — a counter incremented on
**every** `firmDeployed` event, for all three AI Firms — at the moment the
**first** Firm reached tier 3. So it answered "how many deployments happened in
this world before somebody arrived", while **D19's band of 3–4 is per Firm**.
Corrected to count only the reaching Firm, the same worlds read **3.0: inside
the band.**

Every tier-3 verdict this project has printed was that number: 5.0 at M8, 6.5
and 6.0 on eras 2 and 3, each graded HIGH or FAIL. **D19 was never failing.**
The "progression is SLOW" reading that ran from Q52 through D69 and D70 was an
instrument defect, and `unlockCompletions` — the lever repeatedly proposed to
fix it — never needed touching. It never was touched, through three separate
opportunities, each time for the incidental reason that something else needed
measuring first.

**The lessons, in order of how much they would have saved:**

- **A ratio is only meaningful if numerator and denominator have the same
  scope.** `completed / deployments` is fine — both are world-wide. Comparing a
  world-wide count against a per-Firm band is a category error that no amount of
  n fixes, and n=300 made it look authoritative.
- **Cross-check a new metric against an existing one that must agree with it.**
  Nothing failed. No test went red, no exit status was non-zero, no probe
  disagreed with the game. The defect surfaced only because two numbers
  measuring overlapping things were printed side by side and one was impossible
  given the other. **Print the redundant number.**
- **A number that has been wrong for months looks exactly like a number that is
  right.** This one survived being quoted in a design ruling, two acceptance
  criteria, a playtest brief and four battery verdicts, because it was plausible
  and everyone downstream reasoned about *why* it was high rather than *whether*
  it was true.
- **Suspicion should scale with how much a number is used, not how new it is.**
  The most-cited figure in the pacing set was the least examined.

## The corrected measurement (`0005-pacing`, n=300, era 3) — and the same error twice

**Deployments to tier 3: 2.0, against a band of 3-4. LOW, not HIGH.** The belief
that progression was slow, held from Q52 through D69 and D70 and written into a
design ruling, two acceptance criteria and a playtest brief, was backwards.

**The cleanest possible confirmation of the defect.** `0004-pacing` and
`0005-pacing` ran the same era and the same rules on different commits, and
differ in **zero cells across 46 shared columns and 300 rows**. The same 193
Firms reach tier 3 in both. Only the tier-3 column moved: 6.0 -> 2.0, a ratio of
**exactly 3.0 — the AI Firm count**, which is the defect's signature. It is also
a free determinism check across two commits, the same gift `0001`/`0003` gave.

**And I committed the identical category error inside the ruling that diagnosed
it.** D71(a) argued that "a deployment yields 1.19 completions while D11 intended
2-3", concluding the design was missing its own target. But **1.19 is a
world-wide average across all Firms and D11's intent is per Firm** — the same
scope mix that produced the 6.0. The Firm that reaches tier 3 does **2.5
completions per deployment** (5 completions, by construction, across 2.0
deployments): **inside D11's intent.** The 1.19 is depressed by deployments that
complete nothing.

**How to apply — the sharpened rule.** Scope errors are not a bug you fix once.
Every quantity in a multi-agent battery is per-world or per-agent, and the two
are only comparable after an explicit conversion. **Label the scope in the name
or in the column comment**, because `deploysToTier3` and `completionsPerDeploy`
both read as per-Firm and neither is. When comparing any measured number against
a design intent, state whose scope each side is in before drawing the conclusion.

**No verdict is drawn from the 2.0.** It is expressed in the unit D71(a) revised
away from, precisely because "deployment" changed meaning under drop-in/drop-out.
The criterion is time — **47 min AI, 94-188 min human-adjusted, 64% arriving** —
and it has no band yet (Q54). `unlockCompletions` stays untouched, now for the
strongest reason available: nothing measured says it is wrong.

## The populated-fixture hole opened a FOURTH time (2026-08-31, D74)

`beam.inside` is a new hash-inert per-beam array. Both twins gained a writer for
it, and **deleting the writer from `snapshot.js` left the entire suite green at
537/537** — because no compared world ever had a beam with an occupant, so the
two writers only ever ran over empty arrays.

That is the same hole this file exists to close, now for the fourth time:
contracts (2026-08-05), alarms (M8 8a), `hq.buildingId` (2026-08-22), and now
this — **and I opened it myself, in the same session in which I had already
re-read the rule.** Fixed by putting an occupant in a beam in `populatedWorld()`
and asserting it, with both directions proved: drift one twin (red), and
un-populate the subject (red).

**The rule, restated because restating it clearly has not been enough:** adding
a hash-inert collection or a variable-length field to a hashed entity means
adding a POPULATION step and an assertion in the same edit. The four places
(`copyState`, both hash twins, mirror) are necessary and **not sufficient** —
they make the field travel correctly, while nothing makes the twins actually
COMPARE it. A green suite after adding a hashed field is the alarm, not the
all-clear.

**A cheap check that would have caught all four**: after adding any hashed
field, delete it from ONE twin and confirm the suite goes red. It takes one run
and it is the only thing that distinguishes "the twins agree" from "the twins
were never asked".
