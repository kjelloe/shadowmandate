# Autonomy session plan — 2026-08-05

*Written before starting, so the owner can read it on return and see what was
intended versus what actually happened. Progress is appended at the bottom;
`dev-log.md` holds the detail. No questions block the work — anything needing a
decision goes to `dev-questions.md` with a proposal implemented behind it.*

**Starting state:** M0–M6 complete, M7 in progress, playable in a browser.
183 tests green, pushed to `dev_night` (f72782c).

## Priority order

Ordered by what most improves the thing the owner can actually play, because
five playtests have shown that is where the real defects are.

### 1. Objective ping and map marking — THE OWNER'S REQUEST
The HUD names an objective cell but the map does not show it. Needed:
- A pulsing beacon at the active objective in the diorama.
- Contract sites colour-coded by whether they are yours, offered, or scenery.
- The same marking on the minimap so the two agree.
- An off-screen arrow when the objective is outside the view.

### 2. The debrief screen — the loop currently has no ending
Extraction banks the cache and the player sees nothing. This is the payoff beat
the whole session builds toward (S05) and its absence makes a successful evac
feel identical to a crash.

### 3. Dialogue and shop overlays — engine exists, no UI
`enterBuilding`, informant dialogue, vendor and cover shop all work in the
engine and are unreachable from the browser. Includes the D38 disguise portrait
(the owner's comic-relief idea), which is currently invisible.

### 4. Evac and drop-zone polish
Evac beacon countdown is a bare overlay; the drop-zone screen has no district
names or contract counts to choose between.

### 5. Mobile pass
Verify the touch model on a narrow viewport: 44px targets, minimap size,
overlays reachable, no horizontal scroll.

### 6. Local pacing battery
The gaming PC lane is the owner's to start, but batteries run locally too.
Gather D11/D19 numbers on the current build so the pacing conversation has
fresh data.

### 7. Art pass within primitives
No asset pipeline yet, but silhouettes and colour can improve a lot: distinct
shapes per marker type, district tinting, better building variation.

### 8. VM deploy runbook
`DEPLOYING.md` for the sample world, following the sibling project's pattern.

## Rules for this session
- Every slice: tests first where testable, suite double-run green, dev-log
  entry, commit to `dev_night`.
- Never leave the tree red or unpushed.
- Client changes get verified against a live server, not assumed — the standing
  lesson from five playtests.
- Questions go to `dev-questions.md`; the proposal gets implemented so nothing
  waits.

## Progress

- **1. Objective marking — DONE.** Beacon column, colour-coded sites, matching
  minimap, off-screen arrow with distance. 4 new tests.
- **2. Debrief screen — DONE.** Server delivers on extraction; screen prints
  banked / contracts / recognition / HQ intact / ledger totals and a reputation
  bar. 2 new tests.
- **3. Dialogue and shop overlays — DONE.** Content ships on welcome; view
  gained `atDoor`/`inside`; GO INSIDE button, portrait, options and catalogue;
  informant visibly quiet at lockdown; disguise portrait changes. 4 new tests,
  plus six untranslated disguise names found and fixed.
- **4. Drop-zone and evac polish — DONE.** The picker names each district with
  its trait and how many of your offers sit inside it; evac has its countdown.
- **6. Pacing battery — DONE, and it changed the session.** It found two bugs
  (acquisition completing 0.0% of the time; sabotage planting both charges in
  the same square), a lying instrument (the AI scorer could not perceive
  time-on-objective, and we verdict YOUR pacing from AI runs), and a reward
  table that had never been priced by effort. Re-pricing rescued surveillance
  from 1.8% of contracts taken to ~24%, and extraction — the only type with no
  work stage at all — gained a `secureTicks` timer. Extraction remains
  over-chosen; that was **Q37**, now answered — the answer was that I had the
  wrong lever entirely. Extraction and acquisition are under-opposed, not
  mispriced (D42), and the difficulty belongs in the opposition system now
  specced as S16.
- **8. VM deploy runbook — DONE.** `DEPLOYING.md`, plus the `/health` endpoint
  it depends on (a sleeping world counts as healthy, per D16).
- **Unplanned, and I judged it worth the detour:** the paired-hash test — the
  project's strongest guarantee — ran only against a world with an empty
  contract pool, so the contract writers in the two twin hash functions were
  never compared. `test/fixture_populated.test.js` closes it.
- **5. Mobile pass and 7. Art pass — NOT DONE.** I stopped short of these
  deliberately. While looking at the mobile question I found that
  `test/headless/` is empty: the `client_smoke.mjs` and `ui_acceptance.mjs`
  browser gates S12 has claimed since M3 do not exist. That is the plainest
  explanation for why five playtests each found a defect a green suite could not
  see, and I think it outranks both remaining items. Playwright is already the
  house tool in both sibling projects and its browsers are installed on this
  machine, so it is a port rather than a research task. Flagged rather than
  started, because adding a dependency is your call.

## Where this leaves the balance numbers

Tier-3 unlock pace is the one verdict that moved OUT of band: it read 4.0
(in band) before the session and reads 5.0 now.

I first assumed I had inflated it by raising rewards, so I scaled the whole
table back to its original mean income. **It did not help**, which is the useful
part: the cause is not price, it is THROUGHPUT. Completed contracts per
world-day went from ~11 to ~15 because acquisition works now, sabotage plants
its second charge somewhere new, and surveillance is finally worth taking. Firms
earn faster because the game does more.

That means the tier-unlock thresholds were tuned against a partly broken
economy, and re-tuning them is a balance decision rather than a bug fix — so it
is yours, not mine. Everything needed to judge it is in
`reports/sweeps/pacing_final.csv`.
