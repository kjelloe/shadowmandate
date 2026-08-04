# S09 — Building Entry, Dialogue & Shop

*Feeds: M5 (informant), M6 (vendor) · Depends on: S01 · Status: skeleton, core pinned*

## Purpose

D9: exteriors-only world with building entry as overlay — dialogue with
options (quests/informants) or a shop menu with a static vendor portrait.

## Engine contract

- Commands: `enterBuilding(agentId)` (agent on `entrance` cell) /
  `exitBuilding(agentId)`.
- State: `agent.insideBuildingId` — agent hidden from all rival/patrol views,
  position parked at entrance; world time keeps running; agent inside cannot
  act in the world (no combat, no perimeter defense).
- Interactions inside are commands too: `dialogueChoice(agentId, optionId)`,
  `buyItem(agentId, itemId)` — server-validated against the building's
  payload; effects (intel grants, purchases, contract hooks) applied by the
  reducer. **All content is data, never engine code.**

## Data format (`data/buildings/*.json`)

```json
{ "id": "safehouse_informant_1",
  "kind": "dialogue",
  "portrait": "informant_a",
  "nodes": [
    { "id": "root", "text": "dialog.informant.greet",
      "options": [
        { "text": "dialog.informant.ask_rival", "cost": {"resources": 50},
          "effect": {"revealRivalHq": true}, "next": "done" },
        { "text": "dialog.informant.ask_heat", "cost": {"resources": 30},
          "effect": {"heatIntel": {"district": "here", "ticks": 6000}} },
        { "text": "dialog.common.leave", "exit": true } ] } ] }
```

Shop kind: `"kind": "shop"`, `catalog: [{itemId, price, stock|null}]`.
Text values are **i18n keys** (S13) — never literal strings.

### V1 content set

- **Informant** (safe houses): reveal deployed rival HQ; sell exact district
  heat (D20). Goes quiet at heat 4–5 (S03): options replaced by
  `dialog.informant.too_hot`.
- **Street Vendor** (market buildings): equipment upgrades — the bank sink
  (D17's bail is the other). Catalog `❑ pin` at M6; ≥3 meaningful upgrades
  (V1 acceptance), e.g. sensor jammer II, soft-soled boots (Sneak bonus),
  cargo harness (carry cap).
- Purchases are **bank-only** (D30) — you must extract before you can spend;
  the cache stays purely as extraction tension.

## Client (S12)

Overlay panel: static portrait art (S15), text, option list with costs;
mobile-first; ESC/back = `exitBuilding`. No world interaction while open.

## Determinism note

Dialogue state (visited nodes, stock) lives in world state where it must
persist `❑ pin` (proposal: stateless dialogues + persistent shop stock=null
(infinite) in V1 — hash-inert).

## Gates & fixtures

Headless: enter → hidden from patrol view; buy applies effect and debits
bank; heat-quiet informant. Client acceptance: overlay opens, options click,
portrait renders.

## AS BUILT (partial, pulled forward by D38 — 2026-08-04) — `engine/buildings.js`

**Implemented:** `enterBuilding` / `exitBuilding` (agent parked hidden at the
entrance, `AGENT_INSIDE`), and the **Cover Shop** (D38) — cover shops generate
with a second door, entering never clears a burn, patrols post at the door, and
a bank-only purchase changes `agent.disguiseId`, clears the burn and puts the
agent out the back. Disguise variants (deliberately comic, per the owner) are in
`data/buildings/disguises.json`.

**NOT implemented:** the dialogue framework and shop catalogues themselves —
there is entry, but no informant conversation and no vendor inventory behind it.
That is still M5 (informant) and M6 (vendor).

## To pin

`❑` vendor catalog & prices (M6) · `❑` dialogue persistence · portrait art
list → S15. (Bank-only purchases ruled: D30.)
