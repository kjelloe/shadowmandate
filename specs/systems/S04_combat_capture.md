# S04 — Combat, Downed & Capture

*Feeds: M2, M4 (exits) · Depends on: S02, S03 · Status: skeleton, core pinned*

## Purpose

Disable-only combat (D6): short, loud, risky. Downed → crawl → rescue or
capture; captured agents go to Holding Sites; exits via bail or re-drop (D17).

## Engine contract

- Module: `engine/combat.js` (slimmed Fireline) + `engine/downed.js` (reused)
  + `engine/holding.js` (adapted `prisons.js`).
- Command: `useItem(agentId, targetCell|targetId)` — primaries resolve as
  short-range area effects (Fireline data-driven area actions). No
  entity-target-lock main interaction (Fireline doctrine).

### Primaries (loadout slot 1)

| Item | Range | Effect | Noise |
|---|---|---|---|
| Suppressor | adjacent `⚙` | instant subdue of one NPC/agent if user is unseen/noticed (not burned); fails loudly if target observes you `❑ pin` | none on success |
| Disruptor | short | disables a sensor/perimeter device for `⚙` ticks | small |
| Sidearm | short | area effect, damages condition → downs at threshold | large; always burns user (S03) |

### Damage & downed

- Condition bands (Fireline readable bands), no HP bar granularity.
- At `downed`: agent drops carried item, enters crawl (Fireline walking-downed
  loop); crawl speed `⚙`; visible to whoever sees the cell.
- Rescue: friendly agent adjacent + `rescue` interaction over `⚙` ticks →
  agent recovers at Move-capped condition. (V1 solo: only relevant via
  Extraction contracts and V2 squads; still implemented for AI Firms.)
- Capture: rival agent or Authority patrol adjacent + `capture` interaction →
  captured; body removed to nearest HoldingSite (rival HQ capture is V2).

### Capture exits (D17)

- State: `heldAgents[]` on HoldingSite; Firm notified through fog.
- **Bail**: command `payBail(firmId, agentId)` — costs
  `bail.pctOfBank ⚙ × tierFactor`; agent released at HQ (if deployed) or next
  drop-in. Only from banked resources (not cache).
- **Re-drop**: player drops in with a new callsign; flat reputation hit `⚙`;
  held agent remains — the world generates an Extraction contract targeting
  that HoldingSite (S06 hook).
- NPCs subdued by Suppressor wake after `⚙` ticks (no capture of NPCs in V1).

## Ruleset data (`data/combat.json`)

Item stats, subdue rules, condition thresholds, crawl/rescue/capture tick
counts, bail percentages, wake timers.

## Fireline reuse

Area-effect combat core, condition bands, downed/crawl loop, prisons →
holding, recovery interactions.

## Gates & fixtures

Headless: suppressor stealth-subdue vs failed-when-observed; sidearm downs
and burns; capture → holding → bail releases; re-drop spawns Extraction
contract. All disable-only invariants: **no entity deletion event exists**
(suite-enforced grep + reducer invariant).

## AS BUILT (M2, 2026-08-04) — `engine/combat.js`

Implemented: suppressor / disruptor / sidearm, condition damage, downed+crawl,
rescue, capture to Holding Sites, D27 Authority arrests. The D6 no-deletion
invariant is enforced by `test/guards.test.js`, not merely intended.

**`payBail` (D17) SHIPPED in M5 slice 5h:** bank-only (D30), priced as a
tier-scaled share of the bank, releases the agent to its HQ — and because that
happens inside D40's grace window it also restores the contracts the agent was
running. The two rulings only pay off together.

**Still NOT implemented:** the auto-generated Extraction contract for an agent
left in custody (D17's other half) — **SHIPPED 2026-08-07 as D51**, see below.

## AS BUILT — custody and recovery (D51, 2026-08-07)

**An operative left in custody is ABANDONED, not lost.** The Firm may fold and
extract without them; on a later deployment a **recovery contract** is waiting.
Capture stops being a death sentence and becomes a debt with your name on it.

This resolved a genuine dead end: a Firm whose only agent was captured could
neither work (the agent cannot act) nor leave (the beacon cancelled when the
lead was held). **3 of 8 battery seeds ended with a Firm frozen for the rest of
the world-day.**

The recovery reuses the EXTRACTION machine wholesale — travel, a secure timer on
the objective, carry home — because that is exactly the shape of the job.
`objectiveCellOf` is the single definition of where a contract wants you, and it
returns a Holding Site for a recovery; every stage check and the AI both read
it, so there are no branches anywhere else.

### Five things that each made the feature silently do nothing

Every one was found by measurement, not by reasoning, and none broke a test:

1. **`leadAgent` matched any state except absent**, so a redeploying Firm chose
   its own prisoner and folded again immediately — 18 extractions in one
   world-day. It excludes held agents now, and so does `aiLawfulView`.
2. **Excluding them made the dead loop SILENT** rather than fixing it: 977 ticks
   of `no_agent` with the Firm still marked deployed. Worse than the loud
   version, because nothing in the telemetry looked wrong. The fold now happens
   from the no-agent branch.
3. **`rebuildOffers` released the reservation** when the Firm went home —
   correct for ordinary work, fatal for a debt, which became an anonymous
   contract nobody was on the hook for. Recoveries are exempt.
4. **It was never put on a board.** `rebuildOffers` only considers contracts
   with `reservedBy < 0`, so a job pre-reserved to one Firm was invisible to it.
   Recoveries are inserted directly, at the front.
5. **The AI scored it as unscorable** (`state.sites.find` on a contract with no
   site returns undefined), then scored it *below a courier run*. It is now
   priced through `objectiveCellOf` and weighted by `recoveryPriority` — a value
   judgement stated as a priority rather than smuggled into the reward, since
   inflating the money would distort the economy to say something that is really
   "you do not go back for your own people because it pays well".

Measured after: **0 of 8 seeds stuck** (was 3–4), deployments back to a normal
3–8 per world-day, zero AI rejections, and recoveries completing in live worlds.

## To pin

`❑` suppressor failure rule detail · `⚙ tune` bail % and rep hit.
(Authority arrests use this capture path — ruled, D27.)
