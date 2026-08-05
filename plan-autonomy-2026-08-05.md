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
- **4–8** — in progress; see dev-log.
