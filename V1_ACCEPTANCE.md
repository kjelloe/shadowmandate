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
| 4 | Downed → capture; bail and re-drop work; an Extraction recovers a captured agent | **PARTIAL** |
| 5 | Evac: 30s hold, interruption rules, cache banks only on clean extraction | **PASS** |
| 6 | AI rivals visibly operate; HQ raid triggers the alarm with a winnable race home | **PASS** |
| 7 | Standoff offers Engage/Withdraw/Negotiate and honours the outcome | **PASS** |
| 8 | Every present player's board shows 5 offers, disjoint (headless multi-seat test) | **PASS** (test written in this slice) |
| 9 | Returning after a day: changed world, intact ledger, fog reset, persistent building changes | **PASS** |
| 10 | A sortie fits 15–20 min; a 2–3 contract deployment fits 40–60 (battery-verified) | **FAIL** |
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

### 4 — Extraction recovers a captured agent (PARTIAL)

`payBail` and re-drop both work and are tested. The **other half of D17 — the
auto-generated Extraction contract for an agent left in custody — is not
implemented**, and has been a tracked gap since M5. So a captured colleague can
be bought back but cannot yet be *rescued as a job*.

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

So criterion 10 can no longer be deferred to M8. It needs its own slice, and the
lever is contract CONTENT length, with the economy pass (Q42a) alongside it
because `cacheEvacTarget` currently ends a deployment after one or two jobs.

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
guard-enforced across every shipped directory. **"Painted low-poly consistent
with Fireline" does not hold** — everything is still an untextured primitive.
The 7a pass took silhouettes as far as primitives allow (distinct shapes per
role, per-instance building tint and footprint variation), but there is no
asset pipeline and no painted art.

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
