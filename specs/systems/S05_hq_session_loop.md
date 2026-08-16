# S05 — HQ & Session Loop (Drop-in / Evac)

*Feeds: M3 · Depends on: S01 · Status: skeleton, core pinned*

## Purpose

The signature loop: briefing → drop zone → dropship → Field HQ → contracts →
evac beacon → 30s hold → extraction → debrief. HQ extracts with you (D7).

## Engine contract

Module: `engine/hq.js`. The dropship is presentation-only (client); the engine
knows commands and state, not animations.

### Commands

`requestDropZones(firmId)` → server returns valid zones (S01 rules, live world)
`dropIn(firmId, cell)` → HQ placed, agent spawned, `firmDeployed` event
`activateEvac(firmId)` / `cancelEvac(firmId)`
`extract(firmId)` — server-internal on beacon completion → ledger write (S10)

### Field HQ state

`hq: { firmId, cell, perimeterCells[], condition, cache: {resources, items},
evac: {active, ticksRemaining, paused} }`

- Perimeter: radius `⚙` ring; sensors are alarm-only (D13-era V1): rival or
  patrol entry → `perimeterAlarm` event to owner through fog (D21 — countdown
  generous enough to race home; alarm fires on perimeter entry, looting the
  tent takes `lootTicks ⚙` after reaching it).
- Cache: all contract rewards land here; **banked only on clean extraction**.
- HQ compromised (rival reaches tent): cache looted (transfer to raider).
- HQ destroyed: emergency evac rules.

### Evac beacon (30s hold, from design doc — all rules pinned)

| Condition during hold | Effect |
|---|---|
| agent inside perimeter | timer runs |
| agent leaves perimeter | timer pauses |
| rival enters perimeter | alarm; timer keeps running (owner chooses: repel or risk) |
| HQ destroyed | emergency evac (10s, no payout) |
| agent downed | evac cancelled |

Beacon is **visible through fog to rivals** within `beaconSignalRadius ⚙`
(intentional interception window).

### Emergency evac

60s to reach a safe zone (neutral site or map edge); cache lost to raider;
recognition kept; minor rep hit `⚙`.

### Debrief (client screen, data from `extract` result)

Contracts completed, resources banked, recognition, rep delta, tier progress —
FIRM REPUTATION string per D8.

## Presentation events (client-only choreography)

`dropshipInbound`, `dropshipOutbound` with the pinned 5s timelines from the
design doc; server state changes happen at sequence start (HQ live at
`dropIn` accept; agent gone at `extract`).

## Fireline reuse

Site placement/ownership, alarm events, fog signal patterns.

## Gates & fixtures

Headless full loop: drop → contract → evac (each interruption row above
exercised) → ledger written → re-drop shows ledger. Browser: smoke + UI
acceptance on the same flow.

## AS BUILT (M3, 2026-08-04) — `engine/hq.js`

Implemented: drop-in with ledger injection, perimeter alarm, raid looting,
the full evac state machine (every interruption row tested), emergency evac,
extraction that folds the HQ away (D7). D28 verified: activation is allowed
with a rival inside the perimeter and the clock keeps running.

**Known rough edge (Q32):** `findDropZones` scans from the top-left, so the
first zone — and therefore any naive auto-select — is always a map corner.
Safe, and terrible to play. Tests use `centralDropZone`; the client must do
better.

## To pin

`⚙ tune` perimeter radius, loot ticks, beacon signal radius, rep hits.
(Evac activation with rivals inside the perimeter is ALLOWED — ruled, D28:
the hold is the fight.)
