# Shadow Mandate — Document Index

**Project codename:** multisyndicate
**Game title:** Shadow Mandate
**Status:** In production — design of record established 2026-07-31; M0–M6 built,
M7 in progress and playable in a browser (updated 2026-08-06)

## Reading order

| Step | File | Purpose |
|---:|---|---|
| 1 | `01_design_of_record.md` | The complete game design with all foundational decisions resolved |
| 2 | `02_technical_foundation.md` | Stack, fork plan from Fireline Command, module disposition, determinism doctrine |
| 3 | `03_roadmap_v1.md` | V1 "The Operative" — solo vs AI rival firms |
| 4 | `04_roadmap_v2.md` | V2 "The Squad" — human multiplayer, squads, standoffs, support agents |
| 5 | `05_roadmap_v3.md` | V3 "The World" — doctrines, living world, seasons, Roblox gate |
| 6 | `06_open_questions.md` | Archive of answered design questions (Q1–Q21); the live queue is `../dev-questions.md` |
| 7 | `07_spec_map.md` | The spec structure: how design docs, plans, and system specs relate; milestone → spec matrix |
| `08_reference_mission_taxonomy.md` | Bullfrog mission corpus mapped to our contract types; the Eliminate-family collision with D6; funding/research/upgrade meta-layer | research note |
| 8 | `systems/S01…S16` | **System specs (implementation contracts)** — state shapes, commands, ruleset keys, behaviour tables per system. S16 (opposition & site security) is specced, not built — it is what M8 implements |
| — | `../dev-questions.md` | **Live question queue (Q22+)** — pending decisions with proposals; answers become rulings and move to `06` |
| — | `../plan-version1.md` (+ `.html`) | **The operational V1 plan** — features in/out, milestones M0–M7, gates, acceptance (supersedes `03` for day-to-day work) |
| — | `../plan-version2.md` (+ `.html`) | The operational V2 plan — M8–M13 |
| — | `../plan-implementation-order.md` | Slice-by-slice execution order for M0–M7 + gaming-PC battery runbook |
| — | `design_update_2026-08-03_shadow_mandate.md` | Verbatim user design update: title, terminology contract (record; incorporated into `01`) |
| — | `starter_design_document.md` | Original concept brief. Historical — superseded where it conflicts with `01_design_of_record.md` |

## Resolved foundational decisions (2026-07-31)

| # | Decision | Ruling |
|---:|---|---|
| D1 | Control model | **Hybrid** — direct control of one lead agent; AI support agents with stances arrive in V2 |
| D2 | Codebase | **Fork Fireline Command** (`~/GIT/firepower`) as the starting skeleton; diverge freely, no shared package |
| D3 | World persistence | **Long-lived worlds** — a seeded world instance runs days/weeks; per-player progression persists per world |
| D4 | V1 scope | **Solo vs AI rivals** on the real server architecture; humans join in V2 |
| D5 | Title (superseded by D8) | Was "Syndicate Shadows"; renamed by the 2026-08-03 design update |
| D6 | Combat doctrine | **Stealth-first, disable-only** — detection is the threat; combat downs, never kills; rescue/capture loops |
| D7 | Offline presence | **HQ extracts with you** — no footprint or raidable assets while offline; ledger progression persists per world |

## Second decision batch (2026-08-03)

| # | Decision | Ruling |
|---:|---|---|
| D8 | Title & terminology | **Shadow Mandate**; Firm/Agent/Field HQ/Contract terminology contract; "Syndicate" banned from UI, docs, code identifiers (repo codename `multisyndicate` excepted) |
| D9 | Building interiors | **Exteriors only** — building entry opens a dialogue/shop overlay (static vendor portrait); no interior simulation |
| D10 | Identity | **No accounts at start** — seat token + recovery code; email OTP confirmation later (V2) |
| D11 | Session pacing | One contract sortie 15–20 min; normal deployment 40–60 min |
| D12 | Intel persistence | **Fog resets each drop**; physical world changes (buildings altered by rivals/events) persist |
| D13 | V1 AI rivals | Active on their own contracts; HQ raids on the player can happen |
| D14 | Hosting | Official **public sample world** on the existing VM; self-hosters choose public listing or invite-only |

## Third decision batch (2026-08-03, Q1–Q14)

| # | Decision | Ruling |
|---:|---|---|
| D15 | Seasons | Fixed 4 weeks (official world); self-host configurable |
| D16 | Dormancy | AI rivals act only while the world is live; dormancy = heat decay + contract refresh only |
| D17 | Capture exit | Player chooses: bail (% of bank, tier-scaled) or re-drop (rep hit; agent becomes rescue contract) |
| D18 | Contract economy | Pool 5 per player slot; each present player shown 5; concurrent players get disjoint offers |
| D19 | Tier pacing | Median 3–4 deployments (40–60 min) to tier 3 |
| D20 | Heat visibility | Fuzzy 3-step default; exact 0–5 via intel |
| D21 | Cache raids | Reach anywhere while deployed; perimeter alarm countdown allows racing home |
| D22 | Standoff UI | Engage/Withdraw/Negotiate UI ships in V1 vs AI |
| D23 | Tone | Mild noir; separate Roblox content path planned for the V3 gate |
| D24 | Monetization | Free; cosmetics-only door kept open |
| D25 | Batch lane | Shared queue/worker with firepower; repo-tagged jobs |
| D26 | World size | Ship 64×64; stay 128×128-capable, tested at both |

## Fourth decision batch (2026-08-04, Q22–Q29)

| # | Decision | Ruling |
|---:|---|---|
| D27 | Patrol arrests | Downed agents always; burned agents at heat ≥3; same disable-only capture path |
| D28 | Evac under raid | Activation always allowed — the hold is the fight |
| D29 | Board rules | Max 2 active contracts; one greyed next-tier teaser row |
| D30 | Vendor economy | Bank-only purchases |
| D31 | Disconnect grace | 120 s: agent holds, AI won't initiate raids on that HQ; world never pauses |
| D32 | Token scope | Per-server (one recovery code per server) |
| D33 | Season end | Bank/tier reset; recognition = lifetime honor; V3 must add persistent Firm-building |
| D34 | Vehicles | V1 AI: motorbikes only; full vehicle use (agents + AI) in V2 |

## Fifth decision batch (2026-08-04, Q30–Q35)

| # | Decision | Ruling |
|---:|---|---|
| D35 | Offer supply | Phase-first fill WITH fallback, **and** near-HQ site seeding at drop-in |
| D36 | Site density | Stays 16–24 |
| D37 | Auto drop zone | Contract-rich district → edge margin → far from patrols, in that order |
| D38 | Burn laundering | Buildings never clear a burn; a paid **Cover Shop** does (appearance change + alternate exit) |
| D39 | Recognition | Earned from tier + unseen bonus − burns, not from payout |
| D40 | Capture | 2–3 min grace window; rescue or bail restores the contract |

## Sixth decision batch (2026-08-05, Q36)

| # | Decision | Ruling |
|---:|---|---|
| D41 | Sortie pacing | Length comes from **content** (multi-stage work, patrol timing windows), not from slower walking; modest travel slowdown retained. D11 targets stand |

## Seventh decision batch (2026-08-05, Q37–Q38)

| # | Decision | Ruling |
|---:|---|---|
| D42 | Contract attractiveness | Balance extraction and acquisition with **opposition, not price**. They are under-opposed, not mispriced; a reward cut made now has to be undone when S16 lands |
| D43 | The D19 ceiling | **Deferred until opposition exists.** A contract mix measured in a world with nothing pushing back is not a verdict about the finished game |
| D44 | Opposition | A **system, not a difficulty number**: live rival teams contesting the objective, plus site security (alarms, sensor lines, lockdowns). Disable-only (D6), deterministic, legible before lethal. Spec: `systems/S16` |
| D45 | Challenge presentation | **Always diegetic, never a modal panel.** A mini-game on its own screen fights drop-in/drop-out at the root — the world runs at 10Hz with other players in it. Applies to all future difficulty content |

## Eighth decision batch (2026-08-05, Q41a/Q41b)

| # | Decision | Ruling |
|---:|---|---|
| D46 | Art pipeline | **Art ships as CODE** — fork the sibling's procedural pipeline. Style tokens are the single source of truth, the manifest is the seam, and art is unit-testable because three.js builds geometry in node with no DOM |
| D47 | Portraits | **Procedural feature-layer stacks**, so a D38 disguise is a *diff on the layers*. The comic requirement is combinatorial, not illustrative: a fixed image set can only produce unrelated pictures, never "the same person, different glasses" |

## Ninth decision batch (2026-08-06, Q39–Q41c)

| # | Decision | Ruling |
|---:|---|---|
| D48 | The V1 look | **The 7a gallery look is pinned as shipped.** Approved art for V1, not immutable art — the whole look is a token file, so a revision is an edit |
| D49 | Defend | **Both a contract type and an event.** Rival raids happen to your HQ unprompted (the threat exists whether or not you took the job); Defend also joins the board in M8 after 8g, so you can choose it |
| D50 | Progression | **Full upgrade tree, season-scoped and disclosed.** Upgrades reset with the world beside bank and tier (D33); recognition still carries (D39). A joining player sees the world's day-of-season and the tier range of competing Firms. Multiple hosted worlds across servers are explicit |

**All owner questions are answered.** The live queue in `../dev-questions.md`
holds only tracked gaps.

## Sibling project references

| Project | Location | What it contributes |
|---|---|---|
| Fireline Command | `~/GIT/firepower` | The engine being forked; sim-campaign workflow; batch lane; art pipeline |
| RetroMultiCiv | `~/GIT/multiciv` | The original stack pattern (reducer, twins, session seam, scenario fixtures) |
| Stack write-ups | `~/GIT/retrogradegames/game-stack-overview.md`, `game-stack-revised.md` | Architecture rationale and the earned-gotchas list |
