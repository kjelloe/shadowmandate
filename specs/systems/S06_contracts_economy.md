# S06 — Contracts & Economy

*Feeds: M4 (tier 1), M6 (tier 2–3) · Depends on: S01, S05 · Status: skeleton, core pinned*

## Purpose

The D18 contract economy and the V1 contract types with their objective state
machines, tier gating, and rewards.

## Engine contract

Module: `engine/contracts.js` (adapted `mission.js`).

### The D18 economy (pinned algorithm)

- World pool target: `5 × playerSlots` contracts (16-slot world → 80),
  distributed across districts by trait weights (S01) and tiers.
- Regeneration: on completion/expiry, deterministic generator refills toward
  target (seeded PRNG, in-state).
- **Offers**: each deployed Firm sees exactly 5 offers on its board, selected
  from the pool filtered by (a) unlocked tier, plus **one greyed next-tier
  teaser row** with its reward visible (D29), (b) radius phase from HQ, (c)
  **disjoint assignment** — an offered contract is reserved to that Firm's
  board; no two concurrent boards share a contract. Reservation released on
  decline/evac.
- Accept: contract becomes `active(firmId)`; **max 2 active per agent** (D29).

### V1 contract types — objective state machines

| Type | Tier | Machine | Reward |
|---|---|---|---|
| Courier | 1 | pickup at A (`carry`) → deliver B. Fail: package dropped+lost on capture | resources |
| Surveillance | 1 | reach site → hold `N ⚙` ticks **unseen** (S03) → auto-complete | resources + intel (exact heat, D20, or rival tip) |
| Extraction | 1 | reach HoldingSite/guarded site → `rescue` contact (S04) → contact follows (regency follow) → reach HQ | resources; if target was own captured agent: agent back |
| Sabotage | 2 | reach site → `plant` (`⚙` ticks, hostile action → burns if observed) → leave radius before `fuse ⚙` → site disabled, district heat +2 | resources + map effect (site's function offline `⚙` ticks) |
| Acquisition | 2–3 | reach vault site → `crack` (`⚙` ticks) → `carry` item → deliver HQ | resources + tech nudge |

Radius phases (design doc): 0–8 / 8–20 / 20–40 cells from HQ gate tiers 1–3.
Tier unlock: `tierUnlocked` in ledger after `n ⚙` completions of current tier
(pacing verdict D19: median 3–4 deployments to tier 3).

### Rewards & risk premium

Base rewards per type/tier in `data/contracts.json`; heat 2–3 districts add
`riskPremium ⚙` (D20 table). Rewards → HQ cache (S05), bank on extraction.

### Expiry

Some offers carry `expiresTick` (real deployed-world time); expiry returns
them to pool regeneration. Dormancy refresh (S10) rewrites the offer pool.

## Ruleset data (`data/contracts.json`)

Pool multiplier (5/slot), offer count (5), type/tier stats, phase radii,
unlock counts, rewards, premiums, expiry windows.

## Fireline reuse

`mission.js` skeleton, sites, carry loop, POW-rescue loop → Extraction.

## Gates & fixtures

Headless scripted agent completes each type; economy census
(offered/accepted/completed/expired per type/tier); multi-seat headless test:
**boards disjoint** (V1 acceptance); battery: D19 pacing, no dominant type.

## AS BUILT (M4, 2026-08-04) — `engine/contracts.js`

Implemented: the D18 pool and disjoint reserved boards, D29 teaser row and
2-active cap, five objective machines, tier unlocks (D19), risk premium.
Rewards land in the HQ **cache**; only extraction banks.

**THE D18/D19 CONFLICT AND ITS RESOLUTION (Q30).** Boards came out empty:
phase 1 gates contracts to 0–8 cells from the HQ, but sites on a 64-cell world
sit ~18 cells apart. D18 promises five real options; D19 says work starts
close. On a sparse map these contradict. **The promise outranks the geometry** —
the offer builder fills from the radius phase first, then falls back to any
tier-appropriate contract, nearest first. The tier gate stays absolute; only
the distance gate softens. Phase radii also scale with world size so "phase 1"
means the same thing at 128 (D26).

**D41 (pacing by content, 2026-08-05):** surveillance is three separate passes;
sabotage plants a second charge at another site under the fuse; acquisition
delivers to a drop-off rather than home, because the vault alarms behind you;
and a **patrol window** blocks working an objective while a patrol is within 7
cells. Measured effect: AI sortie 0.4 → 2.3–4.5 min, deployment 1.3 → 8.3–16.4
min. Waiting for the window is meant to be the decision that fills the time.

**NOT implemented:** `siteAction` is only wired for the courier pickup path;
the other kinds progress from the per-tick stepper. `payBail` shipped (5h); the
auto-generated Extraction contract for a held agent has not.

## To pin

`⚙ tune` everything listed — all in data, battery-verdicted. (Teaser row and
max-2-active ruled: D29.)
