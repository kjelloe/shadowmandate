# V1 Acceptance Sweep (slice 7g)

*Run 2026-08-05 against `dev_night`. Suite 203/203 double-run green; browser
gates `smoke`, `ui` and `mobile` green; D26 confirmed at 128.*

The 14 criteria are from `plan-version1.md`. **Verdicts are honest, including
the four that do not pass.** A sweep that reports what was hoped for rather
than what was measured is worth nothing.

| # | Criterion | Verdict |
|---|---|---|
| 1 | Join without lobby; dropship plays; HQ at chosen zone | **PARTIAL** |
| 2 | Tier 1 contracts complete; tier 2 unlocks and persists in the ledger | **PASS** |
| 3 | Detection and heat observably change a sortie; heat fuzzy, informant exact | **PASS** |
| 4 | Downed → capture; bail and re-drop work; an Extraction recovers a captured agent | **PASS** (D51, 2026-08-07) |
| 5 | Evac: 30s hold, interruption rules, cache banks only on clean extraction | **PASS** |
| 6 | AI rivals visibly operate; HQ raid triggers the alarm with a winnable race home | **PASS** |
| 7 | Standoff offers Engage/Withdraw/Negotiate and honours the outcome | **PASS** |
| 8 | Every present player's board shows 5 offers, disjoint (headless multi-seat test) | **PASS** (test written in this slice) |
| 9 | Returning after a day: changed world, intact ledger, fog reset, persistent building changes | **PASS** |
| 10 | A sortie fits 15–20 min; a 2–3 contract deployment fits 40–60 (battery-verified) | **PARTIAL** — sortie passes on D52 overlap; deployment and tier-3 pace do not |
| 11 | Vendor sells ≥3 meaningful upgrades; the bank has a purpose | **PASS** |
| 12 | Cleared browser + recovery code restores the Firm ledger | **PASS** |
| 13 | Replays exact; pinned fixture stable; sim gate + battery pass on shipping ruleset | **PASS** |
| 14 | Desktop + mobile browser; en/no; painted low-poly; zero "Syndicate" strings | **PARTIAL** |

**10 pass, 3 partial, 1 fail.**

---

## The four that do not pass

### 1 — dropship presentation (PARTIAL)

Join-without-lobby and HQ-at-chosen-zone both pass: `npm run smoke` drops in
from the splash and reaches a ticking world, and the drop-zone picker names
districts with their traits and offer counts. **The dropship choreography does
not exist in the client** — S05 pins 5-second inbound/outbound timelines and
`grep -rn dropship client/` returns nothing. Presentation only; no simulation
depends on it.

### 4 — Extraction recovers a captured agent (PASS, 2026-08-07)

`payBail` and re-drop work and are tested. **D17's other half shipped as D51**:
an operative left in custody is abandoned rather than lost, and a recovery
contract on a later deployment goes and gets them — reusing the extraction
machine, reserved permanently to the Firm that owes the debt, and verified
completing in live worlds. A captured colleague can now be bought back OR
rescued as a job, which is what the criterion asked for.

### 10 — pacing (FAIL)

Battery of 24 world-days on the shipping ruleset:

```
sortie (AI)         4.4 m   ->  human 8.7 - 17.4 min   (target 15-20)
deployment (AI)    13.8 m   ->  human 27.7 - 55.4 min  (target 40-60)
deploys to tier 3   5.0                                 (target 3-4)
```

Applying the 2–4x human deliberation factor, both bands *overlap* their targets
but neither sits inside them, and tier-3 pace is out of band at 5.0.

**RE-MEASURED AFTER M8 (2026-08-06) — and this is the finding.** The criterion
was deferred on the grounds that its remedy was opposition content rather than
reward tuning (D41/D42), so it should be re-read once M8 landed. M8 has landed
in full (8a–8l: alarms, cameras, beams, junctions, credentials, secured
facilities, contested contracts, raids, Defend). Pacing has **not moved**:

```
                 before M8      after M8       target
sortie              4.4 m         4.6 m        15-20 m
deployment         13.8 m        14.9 m        40-60 m
deploys to tier 3     5.0           5.0            3-4
```

**M8 fixed the MIX, not the PACING.** D42 was right that extraction was
under-opposed rather than mispriced — it fell from 1.43x over-chosen to 0.58x
and five of six types now sit in a 0.58–1.11x band. But dominance and duration
are different problems, and opposition only addressed the first. A sortie is
still short because the *work itself* is short, which is what D41 said all along:
length comes from content — multi-stage work and timing windows — not from
difficulty layered on top of the same short jobs.

So criterion 10 can no longer be deferred to M8.

**AND IT CANNOT BE MET AS WRITTEN (2026-08-07, Q43).** The criterion applies a
2–4x human deliberation factor and asks the result to sit *inside* the band. For
`[2x, 4x]` to fit inside `[lo, hi]` you need `2x >= lo` and `4x <= hi` at once:
sortie needs AI ≥ 7.5 **and** ≤ 5.0; deployment needs AI ≥ 20.0 **and** ≤ 15.0.
The factor spans a ratio of 2.0 while the bands span 1.33x and 1.5x, so no AI
number lands inside either, at any tuning. Q43 proposes judging on **overlap**,
which the current numbers already satisfy.

**The obvious lever also backfires now.** Giving courier real work and
lengthening extraction's grab moved sortie 4.0 → 6.0 min but doubled burns
(13 → 27.5), captures (5.5 → 14) and sextupled failures (2 → 12). Making courier
unattractive concentrated the AI onto extraction, whose work is standing still —
and since M8, standing still is what alarms, cameras and beams punish. Reverted.
Admissible content has narrowed to content that MOVES you: extra legs, a second
site, a timing window waited out under cover. That is design work, not tuning.

Two things worth saying plainly:

- **The remedy is not more reward tuning.** D42 rules that extraction and
  acquisition are under-opposed rather than mispriced, and D43 defers the D19
  ceiling until opposition exists. Sortie length is meant to come from content
  (D41), and the content that fills those minutes — alarms you have to work
  under, facilities you have to get into — is M8.
- **Tier pace drifted out of band because the game got better.** Completions
  per world-day rose from ~11 to ~15 once acquisition stopped completing 0% of
  the time and surveillance became worth taking. Scaling rewards back to the
  original mean income changed nothing, which is how the cause was identified.
  The thresholds were tuned against a partly broken economy and want a pass
  with fresh eyes.

**This criterion should be re-measured after M8, not chased now.**

### 14 — presentation (PARTIAL)

Desktop and mobile both pass (`npm run mobile`, two viewports, measured).
`en`/`no` key parity is enforced by test. Zero "Syndicate" strings is
guard-enforced across every shipped directory.

**Updated 2026-08-07.** The asset pipeline now exists (D46 — style tokens, a
role→builder manifest, procedural models built at runtime), portraits are
feature-layer stacks (D47), and the owner has **pinned the current gallery look
as the V1 look (D48)**. "Painted low-poly" is therefore met in the sense this
project ships it: art as code, reviewed through `npm run gallery`.

Still PARTIAL for one honest reason: **portrait colours are not style tokens**,
so a future look revision reaches the world but not the faces. Everything else
in this criterion passes.

---

## Evidence for the passes

| # | How it was verified |
|---|---|
| 2 | Contract completion and tier progression measured across 24 world-days; `test/contracts.test.js`, `test/hq.test.js` |
| 3 | `test/detection.test.js` (sneak-in-cover stays UNSEEN, hurry-in-open BURNS); D20 banding and informant exact-heat in `engine/view.js` + tests |
| 5 | `test/hq.test.js` evac hold, interruption, bank-on-clean-extract |
| 6 | `engine/hq.js` raid path; AI rivals measured operating in every world-day run |
| 7 | `test/standoff.test.js`; the panel is driven in the browser by `npm run ui` |
| 8 | `test/contracts.test.js` — written in this slice; four seats, five offers each, disjoint, and still disjoint after 30 ticks. Mutation-verified by removing the `reservedBy` filter |
| 9 | `test/dormancy.test.js`, `test/server.test.js` ledger persistence |
| 11 | `data/buildings/payloads.json` — vendor catalogue carries three upgrades (sneak, carry, jammer) plus a heal; D30 makes purchases bank-only, so extracting is what pays for them |
| 12 | `test/server.test.js` — `claimWithCode` restores the Firm, and the recovery code is asserted absent from the serialised store |
| 13 | `test/fixture.test.js` + `test/fixture_populated.test.js` (added this session — the paired-hash rule had never run against a world containing contracts) |

## What this sweep changed

- Added the criterion-8 multi-seat disjointness test, which the plan had asked
  for explicitly and which did not exist. It passes, and was mutation-verified.
- Nothing else. The remaining gaps are content and art, not defects.

### 10 — pacing, re-scored under D52 (2026-08-07)

D52 rules the criterion is judged on **overlap** rather than containment, since
containment was arithmetically impossible. Under that rule the admissible AI
windows are **3.75–10 min** per sortie and **10–30 min** per deployment.

Measured on the D53 ruleset (24 world-days, `reports/sweeps/pacing_final.csv`):

```
sortie (AI)          5.8 m  ->  human 11.5 - 23.0   OVERLAPS 15-20   PASS
deployment (AI)      9.4 m  ->  human 18.9 - 37.8   misses 40-60     FAIL
deploys to tier 3    6.5                            target 3-4       FAIL
```

**Sortie now passes.** Deployment misses by a hair, and the binding constraint is
NOT the evac target — raising it from 550 to 700 moved deployment 9.3 → 9.4 min.
Deployments end on CAPTURE (D51 folds the HQ and goes home) far more often than
on banking out, so deployment length is now a survivability question rather than
an economy one. That is the next thread to pull, and it is the same thread as
`deploysToTier3`: a Firm that keeps losing its operative never gets far.
