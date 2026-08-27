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

## AS BUILT (M5 slices 5a–5c, 2026-08-04) — `engine/ai_firms.js`

Implemented: `aiLawfulView` (the only accessor the decision function may use —
enforced by a structural test), three temperaments, contract scoring by
payoff-over-risk, execution doctrine with stance switching, go-home-then-evac,
hot-district abort, and raiding for aggressive temperaments. Driven from
OUTSIDE the reducer by `stepAiFirms(state, rules, apply)` so the AI is a player
issuing ordinary commands, never a privileged subsystem.

**`stepAiFirms` returns its events, and `aiDecide` returns its telemetry.**
Both were originally written to push into `state.events`, which the very next
`apply()` discards — a full world-day of decisions produced an empty debug
census while looking healthy. Anything driving the AI must consume both.

**The rejection log is the AI's bug report.** A well-behaved AI issues ZERO
rejected commands. The first run produced 1324 `move:no_route` and 136
`activateEvac:not_at_hq` per world-day, which led to three AI fixes and the
discovery of the drop-zone stranding bug (S01/S05). Watch this number.

**NOT implemented:** the standoff policy is declared in `data/ai_firms.json`
but not yet consulted (S08 is slice 5d), and AI Firms do not use vehicles
(D34 allows motorbikes; slice 6b).

## To pin

`⚙ tune` all personality/threshold numbers by battery. (AI vehicles ruled,
D34: motorbikes only in V1 — courier flavor; full vehicle use in V2.)


## AI-1 — the AI buys its way in, and waits for dark (2026-08-27, owner-ruled 4A)

- **Purchases from the CACHE**: the payBail funding split now covers dialogue
  and shop purchases (reducer, isAi-scoped — D30 keeps players bank-only; the
  server's ledger settle skips AI events for the same reason). The AI buys
  the cheapest credential source covering a site's tier, DERIVED from the
  payload content (`credentialSourceFor`, exported and tested).
- **The scorer prices the badge** instead of declining secured work: cost off
  the reward, decline only when unpurchasable or unaffordable from cache.
  The old 8f decline had been DEAD since D51 (synthetic objective object
  carried no securityTier) — secured work was silently accepted all along,
  which taints the 8h-era readings of extraction/acquisition shares.
- **The errand** runs on player commands (walk → enter → buy → leave), with
  affordability re-checked at the counter (cache resets on extract) and
  ABANDON as the honest way out. The buy decision lives at the AGENT_INSIDE
  early rule — a pre-existing "indoors → leave" rule made any later branch
  unreachable (536 enter/exit pairs, zero purchases, in the first probe).
- **Wait for dark**: entry into a mission area defers while night is at most
  `waitForNightTicks` (2400) away — sneak-hold at the door, then in. A long
  wait is never taken; contract clocks keep running.
- **Still off**: the guard-lift errand (measured pure cost, see S16); the
  scorer has no general night term (burn probability by phase) — battery
  question, era-1.
- Probe: `debugging/dbg_ai_credentials.mjs` (live frequency = economics).
