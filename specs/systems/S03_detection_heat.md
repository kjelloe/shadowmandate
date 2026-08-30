# S03 — Detection & Heat

*Feeds: M2 · Depends on: S01, S02 · Status: skeleton, core pinned*

## Purpose

The game's antagonist system (D6): per-agent detection states and per-district
heat. Built on Fireline's alarm-radius logic; lands **hash-inert** (empty
default state) so the M0 fixture never notices it growing.

## Engine contract

Module: `engine/detection.js` + heat fields on districts in state.

### Detection state machine (per agent, per observer side "Authority")

`unseen → noticed → burned`, decays backward.

| Transition | Trigger |
|---|---|
| unseen → noticed | enters a sensor/patrol detection radius while in Move/Hurry; or a noise event overlaps a patrol's hearing radius |
| noticed → unseen | breaks contact for `noticedDecayTicks ⚙` (out of radius, or stationary in cover terrain while Sneaking) |
| noticed → burned | remains in radius `burnTicks ⚙`; or any hostile action (combat, sabotage plant, vault interact) while observed |
| burned → noticed | out of sight for `burnCooldownTicks ⚙` AND district heat < 4 |

- **Burned effects**: agent revealed through fog to Authority; nearest patrols
  converge (pathfind to last-known cell); district heat +1; event `agentBurned`.
- Noise events: transient `(cell, radius, tick)` records from Hurry, vehicles,
  combat, sabotage. Consumed by patrol hearing checks same tick; not hashed
  history (kept out of state where possible — derived per tick).

### District heat (0–5)

| Heat | World effect |
|---:|---|
| 0–1 | baseline patrols on fixed routes |
| 2–3 | +`⚙` patrols, sensor radii ×`⚙`, contract risk premium on offers (S06) |
| 4–5 | lockdown: `checkpoint` tiles activate, tier-1 contracts suspended in district, informants go quiet (S09) |

- Heat sources: burns +1, sabotage +2, standoff-combat +1, HQ raid +1 `⚙`.
- Decay: −1 per `heatDecayTicks ⚙` of live world time; dormancy transition
  applies the elapsed-time equivalent (D16, S10).
- **Visibility (D20)**: client shows 3-step fuzz (0–1 calm, 2–3 tense, 4–5
  lockdown). Exact value is intel: informant purchase or surveillance reward
  attaches `heatIntel(districtId, expiryTick)` to the Firm's view.

### Authority patrols

NPC figures on fixed routes (from S01 patrol budget); alarm-first doctrine
(Fireline): they detect and report, converge when a burn happens. **Arrests
(D27):** patrols attempt disable-only arrest — downed agents always; burned
agents they reach while district heat ≥3. Arrest = captured, via the S04
capture path (Holding Site).

## Ruleset data (`data/detection.json`)

All radii, tick windows, heat thresholds, source values, decay rate.

## View / fog rules

Detection state is per-Firm-visible only for own agents. Rival agents appear
in your view only via normal fog rules; their burned status is visible while
they're in your sensor radius (`burned` flag on view entity).

## Fireline reuse

Alarm/detection radius logic from the NPC alarm system; fog view filtering
unchanged.

## Gates & fixtures

Headless probe (M2 gate): sneak past a patrol unseen; get burned by hurrying;
heat rises on burn and decays; checkpoint activates at heat 4. Census: every
transition fires in a 5-seed campaign. Battery metric: burns per deployment,
heat trajectory shape (S14).

## AS BUILT (M2, 2026-08-04) — `engine/detection.js`

Implemented: the full state machine, LOS through building mass, cover-modified
sight radius, per-tick derived noise (never stored), district heat with decay,
D20 fuzz bands, D27 arrests.

**Measured behaviour worth knowing:** on open street, sneaking gives an
effective sight radius of 5 — being seen 2 cells from a patrol is correct. In
an alley (cover 2) sneaking drops it to **1**, so at 4 cells you are invisible.
Cover, not stance alone, is what makes the stealth fantasy work; tune with that
relationship in mind.

## To pin

`⚙ tune` every radius/window against the M5 battery — initial values copied
from Fireline alarm radii. (Patrol arrests ruled: D27.)

## The day-night cycle (Q45) — BUILT 2026-08-24 (DN-1); night 30% RULED (D63a)

The owner's direction: buildings light up at night; sneaking is easier in the
dark; safehouses offer "stay until nightfall"; paid cubby holes (cost 10,
ruled) hold you until dark. This section is the S03 half of the contract —
S09 carries the building actions (both BUILT: DN-1 here, WD-1 in S09).
As built: `lightPhase`/`sightPctAt` in engine/season.js; `dayNight
{dayTicks 10800, nightTicks 7200, nightSightPct 70}` in data/season.json —
a compressed 30-minute cycle; the WATCHER factor applies at exactly two
seams (`effectiveSightRadius`, `cameraCoversCell`) and, since AR-1, at the
indoor guards' sight through the same `sightPctAt`.

### The clock is DERIVED, never stored

`phaseOf(tick, season.dayTicks)` returns DAY or NIGHT plus a 0..1 progress —
computed from `state.tick` exactly like the season clock, so the four-places
rule never applies and dormancy jumps need no special handling. Proposed
shape: a game "day" of `season.dayTicks` (existing day length), split
`dayShare` (proposed 0.6) light / 0.4 dark. All numbers in `data/season.json`.

### What night CHANGES (detection)

One multiplier, applied where perception radii are computed:
`nightSightFactor` (proposed 0.7 — patrols and cameras see 30% shorter at
night; **the exact NN% needs the owner's ruling before build**). Rules:

- The factor applies to the WATCHERS (patrol perception, camera range), not
  to the agent's own fog sight — night helps the sneak, it does not blind
  the player.
- Heat, alarms and arrest thresholds are unchanged: night makes being seen
  less likely, not being caught less costly.
- The AI scorer must learn the factor IN THE SAME SLICE (a rule the actor
  does not know…): night shifts its risk pricing exactly as it shifts the
  player's.
- Determinism: the factor is a pure function of tick — batteries stay
  replayable; re-pin era baselines when the data version bumps.

### Client contract

The world visibly darkens/lightens (lighting tokens interpolated by phase —
lighting is art direction, D46: a `lightingNight` token set beside the
existing one); window density rises at night. The HUD shows the phase the
same way it shows the season day — derived, never sent (the client computes
phaseOf from view.tick and the ruleset it already has).

### AS BUILT — the clock and the watcher factor (DN-1, 2026-08-24)

`lightPhase`/`sightPctAt` in engine/season.js (derived from the tick, wraps
under dormancy); `data/season.json dayNight` = 18 min day / 12 min night
(compressed game time — a D11 deployment must see both phases), nightSightPct
70 (the ruled 30%). Applied in the TWO watcher seams and nowhere else:
`effectiveSightRadius` (base radius scaled before stance/cover adjustments)
and `cameraCoversCell` (range) — both read the one `sightPctAt`. The view
carries `night` + `phaseMille`; the client eases lighting between the night
tokens and the new `lightingDay` set and shows a DAY/NIGHT chip.
test/daynight.test.js pins the real promise: a patrol that sees you by day
MISSES you at night at the same distance. Still open from the draft: the
night-aware AI scorer (a battery question — night changes burn probability,
not any rule the AI must obey; the AI also does not USE the waiting actions
yet, same follow-up). The S09 waiting actions are BUILT (WD-1).

## Measured, 2026-08-30 (Q49 — owner playtesting)

Trying to photograph an alerted patrol failed four times, which surfaced a
number worth writing down: **a patrol on a cover tile at CALM heat effectively
sees about three cells.** `patrolSightRadius` is 6, HURRY adds 1, and
`coverSightPenalty` subtracts 2 per cover tier. Patrols then only go ALERTED
when a burn CONVERGES them (`convergePatrols`, called from `burnAgent`) — being
merely noticed does nothing to them.

That compounds with the standing playtest-9 note that drop zones deliberately
land ≥8 cells from any patrol: **early sorties can run their whole length
without the opposition registering at all**. The alerted-patrol marker (D66) is
built either way; this only decides how often a player sees it.

Not tuned. The owner is playtesting it directly (Q49), and this is exactly the
D42/D43 shape — a difficulty reading taken by feel against a system whose
numbers were never swept. If it does get folded into a battery, note that the
queued runs are **era 2**, not era 1: Q50 changed HQ placement and safehouse
density, so any comparison of patrol exposure across that boundary is comparing
two different worlds.
