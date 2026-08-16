# Open Questions Queue

Numbered, answered in batches (firepower practice). Answers become rulings in
`01_design_of_record.md` and slices in the plans.

**All 36 questions answered.** The queue is empty — new questions start at Q36
(live queue: `../dev-questions.md`). Rulings D15–D40 are in `01_design_of_record.md`.

---

## Answered archive

| # | Question | Ruling | Date |
|---:|---|---|---|
| Q1 | Season length / rotation cadence? | **Fixed 4 weeks** for the official sample world (**D15**); self-hosts configurable. | 2026-08-03 |
| Q2 | Dormancy: do AI rivals progress while the world sleeps? | **No — rivals act only while the world is live.** Dormancy transition covers heat decay + contract refresh only (**D16**). | 2026-08-03 |
| Q3 | Captured lead agent exit? | **Both, player's choice**: bail (% of banked resources, tier-scaled) or re-drop (new callsign, rep hit; captured agent becomes a rescue contract) (**D17**). | 2026-08-03 |
| Q4 | Contract generation cadence and board size? | **Pool: 5 contracts per player slot** (16-slot world → 80 pooled). **Each present player is shown 5**, and concurrent players receive disjoint offers — everyone always has real options (**D18**). | 2026-08-03 |
| Q5 | Tier pacing band? | **Median 3–4 deployments of 40–60 min to reach tier 3** — accepted as starting point (**D19**). | 2026-08-03 |
| Q6 | What do banked resources buy in V1? | Street Vendor shop (equipment upgrades) in V1 M6 (via D9); bail (D17) is the second sink. | 2026-08-03 |
| Q7 | What is firepower's `engine/premium.js`? | The "underdog premium" — measured-lean fairness compensation. Dropped at M0; pattern noted for seed fairness. | 2026-08-02 |
| Q8 | Heat visibility? | **Fuzzy 3-step by default** (calm / tense / lockdown); **exact 0–5 after buying intel** (informant / surveillance reward) (**D20**). | 2026-08-03 |
| Q9 | Cache looting range for AI raids? | **Anywhere while you're deployed — but the perimeter alarm gives a countdown long enough to abort a mission and race home** (**D21**). | 2026-08-03 |
| Q10 | Standoff choice UI in V1? | **Yes** — Engage/Withdraw/Negotiate UI ships in V1 against AI rivals (AI answers by policy) (**D22**). | 2026-08-03 |
| Q11 | Audience / rating constraints? | **Mild noir**: bribery named as such, no drugs/gambling imagery — but plan for a **separate Roblox content path** (content pass at the V3 gate) (**D23**). | 2026-08-03 |
| Q12 | Monetization? | **Free now; cosmetics-only door kept open** (**D24**). | 2026-08-03 |
| Q13 | Batch lane sharing with firepower? | **Shared agent-mail queue**, repo-tagged jobs, per-repo result labels (**D25**). | 2026-08-03 |
| Q14 | World size at V1? | **Ship at 64×64** — but engine, mapgen, and renderer stay **128×128-capable**, tested at both sizes (**D26**). | 2026-08-03 |
| Q15 | Title/IP ("Syndicate" is the 1993 EA game's name) | Renamed **Shadow Mandate** + terminology contract (**D8**); splash/debrief strings SHADOW MANDATE / FIRMS / FIRM REPUTATION confirmed. | 2026-08-03 |
| Q16 | Building interiors? | Exteriors only; entry opens dialogue/shop overlay with static portrait (**D9**). Interiors revisited at V2 Vault Raid. | 2026-08-03 |
| Q17 | Player identity? | No accounts at start (seat token + recovery code); email OTP later, V2 (**D10**). | 2026-08-03 |
| Q18 | Session pacing? | Sortie 15–20 min; normal deployment 40–60 min (**D11**). | 2026-08-03 |
| Q19 | Intel persistence? | Fog resets each drop; physical building changes by rivals/events persist (**D12**). | 2026-08-03 |
| Q20 | V1 AI rival behaviour? | Rivals actively run contracts; HQ raids can happen (**D13**). One tuned default difficulty in V1. | 2026-08-03 |
| Q21 | Hosting? | Official public sample world on existing VM; self-hosters choose public listing or invite-only (**D14**). | 2026-08-03 |

| Q22 | Do Authority patrols arrest? | Yes — downed always, burned at heat ≥3, same capture path (**D27**). | 2026-08-04 |
| Q23 | Evac with rivals inside the perimeter? | Yes, always allowed (**D28**). | 2026-08-04 |
| Q24 | Board details? | Max 2 active; greyed next-tier teaser row (**D29**). | 2026-08-04 |
| Q25 | Vendor bank-only? | Yes (**D30**). | 2026-08-04 |
| Q26 | Reconnect grace? | As proposed but **120 seconds** (**D31**). | 2026-08-04 |
| Q27 | Token scope? | Per-server (**D32**). | 2026-08-04 |
| Q28 | Season-end ledger? | Recognition carries as lifetime honor; bank/tier reset. **V3 must let players build their Firm over time** (**D33**). | 2026-08-04 |
| Q29 | AI vehicles in V1? | Motorbikes only; full vehicle use V2 (**D34**). | 2026-08-04 |

| Q30 | Empty radius phase — may the board offer work outside it? | **Both fixes**: phase-first fill with fallback, AND drop-in seeds sites near the new HQ (**D35**). | 2026-08-04 |
| Q31 | Site density 16–24? | Keep (**D36**). | 2026-08-04 |
| Q32 | Auto drop-zone preference? | Contract-rich district → edge margin → far from patrols, in that order (**D37**). | 2026-08-04 |
| Q33 | Can a burned agent hide in a building? | Hiding never clears a burn and patrols post at the door — **except a paid Cover Shop**, which changes the agent's appearance and lets them leave by another exit (**D38**). | 2026-08-04 |
| Q34 | How is Recognition earned? | From **craft**: tier + unseen bonus − burns, never payout (**D39**). | 2026-08-04 |
| Q35 | Do contracts fail instantly on capture? | No — a 2–3 minute grace window; rescue or bail restores them (**D40**). | 2026-08-04 |

| Q36 | Session pacing is 3–6× short of D11 — tune, revise, or add content? | **(c) with a little of (a)**: sortie length comes from content — multi-stage work and patrol timing windows — not from slower walking. Modest travel slowdown kept; D11 targets stand; owner playtests for feel (**D41**). | 2026-08-05 |

Also confirmed 2026-08-03: **Snatch stays** (D6 — no lethal assassinations); the design update's "Assassination" rows were terminology-era leftovers.
