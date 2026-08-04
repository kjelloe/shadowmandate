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
