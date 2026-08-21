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

## Playtest 4, slice B — the HQ lives in a building (2026-08-22)

The drop request is a NEIGHBOURHOOD POINTER now, not the HQ site. `dropIn`
validates the requested cell as intent (garbage is still refused loudly),
then lands via `hqLandingFor` — the single home of the landing rule: the
nearest safehouse whose door is free, meaning not claimed by another HQ and
not inside a rival's `dropZoneMinClearRadius`. Ties resolve to the lowest
building id. No safehouse qualifying → the old tent at the requested cell
(`buildingId: -1`), and the old proximity refusal guards exactly that
fallback. The lead agent lands on the door, so the view reports `atDoor`
for your own HQ from tick one.

`hq.buildingId` is hashed state (both twin writers). The populated-fixture
world now CONTAINS an HQ — hqs had been a blind spot there since M3: a field
added to one twin's hq writer alone left the whole suite green. Closed and
mutation-verified.

Client: when the HQ cell is a building entrance the safehouse IS the
structure — the tent stays packed (`hqInBuilding` in models.js, pure) and the
emblem ring alone marks home; same rule for rival HQs. The tent still ships
for the no-safehouse fallback.

The AI needed NO change: the landing rule lives engine-side where the AI's
drop command passes through it, and `debugging/dbg_ai_rejections.mjs` (kept)
verifies zero AI rejections across seeds — the instrument itself checked by
forcing a rejection through the same event path.
