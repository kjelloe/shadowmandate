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

**COMPLETED in M5 slice 5f (which also covers M6's vendor, 6c):** the dialogue
and shop framework. Content lives in `data/buildings/payloads.json` and is
purely declarative — options, costs and typed effects — so an author adds an
informant line or a shop item without touching engine code. Every string is an
i18n key, enforced by test against `en.json`.

Shipped content: the **informant** (sells a rival HQ location; sells exact
district heat as *temporary* knowledge per D20, which expires — otherwise one
purchase would make the fuzz band meaningless forever; goes quiet at lockdown
heat), and the **vendor** (three upgrades plus a medkit, bank-only per D30, no
double-selling an owned upgrade).

Firm-level state added: `heatIntel` (expiring), `knownRivalHqs`, `upgrades`.

## To pin

`❑` vendor catalog & prices (M6) · `❑` dialogue persistence · portrait art
list → S15. (Bank-only purchases ruled: D30.)

## Playtest 4 note — the HQ moved in upstairs (2026-08-22, D56)

The Field HQ now auto-establishes in a safehouse (S05), which makes the
safehouse two things at once: the district's informant building AND somebody's
HQ. Consequences to keep straight:

- `hq.buildingId` claims the building for the deployment; a second Firm's
  drop snaps to a different safehouse (`hqLandingFor`, S05). The informant
  payload is unchanged — walk into your own HQ and the informant dialogue
  opens, which currently reads as "your handler works out of your safehouse".
  Owner verdict pending as **Q44**; implemented as proposed (keep it).
- An informant selling "reveal deployed rival HQ" is now literally pointing
  at another safehouse's door. Nothing breaks — the reveal already stores a
  cell — but any future copy should say "their safehouse", not "their tent".

## Playtest 5 — one Leave, and it works (2026-08-22, D57)

Leaving a building is `CMD_EXIT_BUILDING`, issued by the overlay's own Leave
button — the only leave control. What changed and why:

- The dialogue's leave row (`option.exit`) duplicated the overlay button and
  was cut from content; the `exit` mechanism went with it, because a
  mechanism no content can express is a feature that silently does nothing.
- The overlay close button used to only HIDE the panel while the agent stayed
  inside engine-side — and `renderBuilding` re-shows the panel every tick
  while `view.inside` is set, so it was a no-op that flickered. Worse: a
  market has no dialogue rows at all, so a market was a building you could
  never leave. The button now sends the exit command; the panel hides when
  the view agrees you are out.
- A quiet informant (lockdown) offers an EMPTY options list — both the
  engine's `payloadFor` and the client's `payloadForBuilding` mirror agree
  (the duplicate-constants lesson: the client copy had to change too).
- `tools/ui_acceptance.mjs` now walks the real flow — GO INSIDE at spawn,
  overlay opens, Leave exits — and the check was mutation-tested by making
  Leave a no-op (fails by name, with the downstream checks collapsing behind
  it exactly as a trapped agent would).
