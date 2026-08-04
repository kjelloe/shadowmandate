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

**NOT implemented (gap, needed for M4/M6 completeness):** `payBail` (D17) and
the auto-generated Extraction contract for a held agent. The command exists in
the vocabulary and is rejected as `not_implemented`.

## To pin

`❑` suppressor failure rule detail · `⚙ tune` bail % and rep hit.
(Authority arrests use this capture path — ruled, D27.)
