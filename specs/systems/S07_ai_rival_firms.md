# S07 — AI Rival Firms

*Feeds: M5 · Depends on: S03–S06 · Status: skeleton, doctrine outlined*

## Purpose

2–3 AI Firms that ARE the V1 world (D13): they drop in, run real contracts,
raise heat, raid, and evac — through the same commands as a player. They are
also the measurement instrument (firepower doctrine: AI regency is developed
with gameplay-grade rigor).

## Engine contract

- Module: `engine/ai_firms.js` (adapted `ai_regency.js`); deterministic,
  staggered scheduler; **lawful knowledge only** (AI reads its own fog-filtered
  view, never raw state — suite-enforced).
- AI Firms issue the same commands as players (`dropIn`, `move`, `accept`,
  `activateEvac`…). No AI-only mechanics.

### Doctrine (the behaviour loop)

1. **Deployment rhythm**: each AI Firm follows a seeded schedule of
   deployments (`⚙` per world-day-equivalent, only while world is live — D16),
   duration targeting D11 (40–60 min equivalents).
2. **Contract selection**: from its own 5 offers, score by
   `reward / (distance + risk(heat, tier))`; personality weights per Firm
   `⚙` (one cautious, one greedy, one aggressive — gives worlds texture).
3. **Execution**: navigate in Move; switch Sneak near patrols (S03 awareness
   from own view); abort if burned and heat ≥4 (`return to HQ` doctrine).
4. **Raiding**: aggressive personality may target a deployed rival HQ
   (including the player's) when its own board is weak: approach, trigger
   perimeter (accepted cost), loot after `lootTicks`, flee to own HQ. Fires
   the D21 race for the defender.
5. **Standoff policy** (S08): deterministic per personality —
   cautious→Withdraw, greedy→Negotiate, aggressive→Engage if
   condition advantage else Withdraw `⚙`.
6. **Evac**: banks when cache ≥ target or board exhausted; holds the 30s.

### Telemetry (instrument-first doctrine)

`aiDebug` per Firm: decisions with scores, aborts with reasons, raid attempts
(success AND failure — telemetry must record failure). Exposed to probes.

## Ruleset data (`data/ai_firms.json`)

Personality weight sets, deployment rhythm, raid thresholds, abort rules,
standoff policy table.

## Gates & fixtures

M5 gate: AI-vs-AI worlds 12–16k ticks × 5 pinned seeds, zero invariant
violations; census shows contracts completed, raids attempted, evacs held by
AI. Battery (n=300 world-days): burn rate, heat trajectories, rep spread,
raid frequency within tolerance bands (S14 owns the bands).

## To pin

`⚙ tune` all personality/threshold numbers by battery. (AI vehicles ruled,
D34: motorbikes only in V1 — courier flavor; full vehicle use in V2.)
