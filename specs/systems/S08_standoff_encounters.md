# S08 — Standoff & Encounters

*Feeds: M5 · Depends on: S04, S07 · Status: skeleton, core pinned*

## Purpose

The signature confrontation (D22): proximity triggers a 10-second
simultaneous-choice standoff. V1: player UI vs AI policy. Protocol designed
now so V2 swaps in a human without change.

## Engine contract

Module: `engine/standoff.js`.

### Trigger

Two agents of different Firms in same/adjacent cells, both aware (each inside
the other's sensor radius — an unseen Sneaking agent does NOT trigger; being
unseen is the counterplay). Event `standoffStarted(agentA, agentB)`.

### Protocol (pinned)

1. Freeze both agents' movement `❑ pin` (proposal: movement locked, timer
   10s = 100 ticks).
2. Both sides see: rival Firm name, reputation, condition band.
3. Each submits `standoffChoice(engage|withdraw|negotiate)` before timeout;
   no choice → Withdraw.
4. Resolution matrix:

| A \ B | Engage | Withdraw | Negotiate |
|---|---|---|---|
| **Engage** | combat (S04), both burned, heat +1 | B disengages 3 cells `⚙`, A cannot pursue for `⚙` ticks | combat — negotiator caught out `❑ pin` (proposal: negotiator gets first Withdraw step) |
| **Withdraw** | — | both disengage, no penalty | both disengage |
| **Negotiate** | — | — | **pact**: 5 min non-aggression |

5. Pact: `pacts[] {firmA, firmB, expiresTick}`; while active, standoffs
   between the pair don't trigger and perimeter alarms still fire (pact ≠
   trust). AI honours pacts (S07 policy consults pacts first).

### Other encounter options (design doc)

Ignore and Shadow are emergent (fog + not triggering); Intercept = moving
into the rival's path to force the trigger. No extra engine mechanics in V1.

## Client (S12)

Standoff panel: rival identity, 10s radial timer, three buttons; mobile-first
sizing; result toast. Choices are commands — server-authoritative.

## Ruleset data (`data/standoff.json`)

Timer ticks, disengage distance, no-pursue window, pact duration.

## Gates & fixtures

Headless: every matrix cell resolves as specified; pact suppresses re-trigger
and expires. Client acceptance: panel appears, buttons submit, timeout
defaults to Withdraw. Battery: standoff frequency and outcome distribution
per AI personality (S14 bands).

## AS BUILT (M5 slice 5d, 2026-08-04) — `engine/standoff.js`

Implemented: mutual-awareness trigger, 10s timer, the full resolution matrix,
timed non-aggression pacts (which also suppress re-triggering), and AI answers
by temperament.

Two rules made explicit because they are easy to erode later:
- **An UNSEEN agent never triggers a standoff.** Staying invisible is how you
  decline the encounter — the stealth pillar restated at rival contact.
- **Silence resolves as Withdraw.** A player who freezes backs off; nobody
  starts a firefight by failing to click.

Engage-vs-Negotiate resolves as `standoffBetrayed`: the negotiator takes the
hit but gets the first step away, so an ambush hurts without being an execution
(D6). An aggressive temperament withdraws when badly hurt — asserted at 5%
condition, because a disposition is not a death wish.

Movement is not frozen during the standoff (the `❑ pin` below); in practice the
10s window resolves before an agent walks out of contact.

## To pin

`❑` movement freeze vs slow-walk during standoff · `❑` Engage-vs-Negotiate
resolution detail · `⚙ tune` timer/distances.
