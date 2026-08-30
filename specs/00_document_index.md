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
| 8 | `systems/S01…S17` | **System specs (implementation contracts)** — state shapes, commands, ruleset keys, behaviour tables per system. S16 (opposition & site security) is specced, not built — it is what M8 implements |
| — | `../dev-questions.md` | **Live question queue (Q22+)** — pending decisions with proposals; answers become rulings and move to `06` |
| — | `../plan-version1.md` (+ `.html`) | **The operational V1 plan** — features in/out, milestones M0–M7, gates, acceptance (supersedes `03` for day-to-day work) |
| — | `../plan-version2.md` (+ `.html`) | The operational V2 plan — M9–M14 (renumbered 2026-08-23: M8 is the opposition milestone built between the plans) |
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

## Tenth decision batch (2026-08-06, Q42 custody)

| # | Decision | Ruling |
|---:|---|---|
| D51 | Custody | **An abandoned operative is a debt, not a loss.** A Firm may fold and extract leaving a captured agent in the Holding Site; a **recovery contract** is offered on a later deployment to get them back. `leadAgent` must never select a held operative |

## Eleventh decision batch (2026-08-07, Q43 + Q42a)

| # | Decision | Ruling |
|---:|---|---|
| D52 | Pacing scoring | **Overlap now, measured humans later.** The 2–4x factor spans a wider ratio than the target bands, so "inside the band" was unsatisfiable at any tuning |
| D53 | Contract pricing | **Level pay-per-effort by raising only**, and move `cacheEvacTarget` in the same edit — rewards and progression are one system |

## Twelfth decision batch (2026-08-22, playtest 4)

| # | Decision | Ruling |
|---:|---|---|
| D54 | The city view | **Fixed 45°/45° dimetric camera.** Azimuth 45 so every building shows two facades and a roof (the classic isometric read), pitch 45, closer default zoom. Still NO player rotation — the azimuth is a constant, not a control |
| D55 | Block character | **A visual massing pass over the existing maps**, not a citygen change. Blocks group and carve into parcels client-side; streets, routes, fixtures and batteries untouched. Citygen block-templates stay open as a possible later slice, after M8 balance settles |
| D56 | HQ placement | **The Field HQ auto-establishes in the nearest free safehouse at drop-in.** The drop request is a neighbourhood pointer; the landing rule (`hqLandingFor`) lives engine-side so player and AI share it; rivals follow the same rule; the tent survives only as the no-safehouse fallback |

## Thirteenth decision batch (2026-08-22, playtest 5)

| # | Decision | Ruling |
|---:|---|---|
| D57 | Session economy | **A fresh identity banks 200** (`hq.startingBank`); season rotation resets TO it; purchases and bail genuinely debit the ledger (they never had); the bank is visible in the HUD and unaffordable rows grey out. Legacy ledgers are floored to the starting bank once (version-2 migration). **Leaving a building is the overlay's own Leave button** — dialogue exit rows are gone, and a quiet informant offers an empty list |
| D58 | Streets | **2- and 4-lane streets are drawn on the existing grid** — streets get centre dashes, transit avenues the 4-lane treatment, plus kerbside lamps (lit/dead/blinking). No citygen widening: maps, routes, fixtures and batteries untouched |
| D59 | Special buildings | **Dress the EXISTING gameplay anchors.** The Holding Site is the prison (walls, watchtowers, barred gate); the six site types have typed markers so a vault reads as a vault; pure landmarks with no gameplay anchor (fire station et al) are deferred to a later slice |

## Fourteenth decision batch (2026-08-23, playtest 7)

| # | Decision | Ruling |
|---:|---|---|
| D60 | World scale | **Figures render at 1/8 of a cell; the engine grid is untouched.** The city reads 8x bigger — the agent walks the sidewalk alongside three others of his size (sidewalk widened to 0.2 cells to fit four abreast). Default camera is STREET LEVEL (~10 cells across); zoom runs 4–70. Applied by manifest class from a scale token, so the number stays tunable |

## Fifteenth decision batch (2026-08-23, playtest 8)

| # | Decision | Ruling |
|---:|---|---|
| D61 | 16x world + walking positions | **Figures render at 1/16 of a cell** (up from D60's 1/8 — room for more agents on the sidewalks later); default camera 6 cells across, zoom 3–70. **The agent walks one of four positions on a road** — left sidewalk, left lane, right lane, right sidewalk — whichever lies nearest the straight line to the destination; render-only, always inside the simulated cell; agent only for now, rivals/patrols queued |

## Sixteenth decision batch (2026-08-23, playtest 10 answers)

| # | Decision | Ruling |
|---:|---|---|
| D62 | Playtest 10 omnibus | **Q44 closed: HQ and informant stay ONE building** (no separate handler actions exist; revisit only if they ever do). Day-night: S03/S09 spec drafts commissioned; **cubby holes cost 10**; the night sneak percentage still needs a number. Walking: **sensible side en route** (right hand of travel), tapped kerb takes over on the final stretch. The splash carries a **wordmark** over the title diorama. The drop picker shows **server-predicted landings** and deploys the server's own pick — the emblem is a promise, not an estimate. **plan-version2 renumbered M9–M14**; M8 stays the opposition milestone. Patrol-density batteries commissioned at 3 and 4 per district |

## Seventeenth decision batch (2026-08-23, playtest 12)

| # | Decision | Ruling |
|---:|---|---|
| D63 | Night + scale + mission areas | **Night sneak factor: 30%** (watchers see 30% shorter at night — unblocks the S03/S09 day-night build). **World scale**: figures at 1/8 of a cell with a much closer camera (default 3.5 cells, min 1.5 — the full 8x-taller figure at closest zoom); clutter/lamps/beams re-proportioned to match. **Mission areas (revises D45)**: live SHARED 3D spaces on the same world tick — "Begin extraction/surveillance" enters a guarded interior; sneak, bloodless takedowns, hackable terminals; other players may enter to help or sabotage; long goal: multi-team HQ assault. Spec: S17; first slices build extraction AND surveillance areas together. **City life**: patrols to 4/district (battery-verified); civilians and hover cars specced in S17 as engine-side ambient life, own slice |

## Eighteenth decision batch (2026-08-24, Q46 answers)

| # | Decision | Ruling |
|---:|---|---|
| D64 | Mission-area shape | **Compound scale** (~24x16 with courtyards). **Burned inside: play on** under escalating lockdown (D44's worsening-situation doctrine, indoors). **PvP takedowns inside: yes** — a rival can put you down and leave you for the guards; that IS sabotage. Ambient city-life numbers delegated (proposals in S17) |
| D65 | Era 1, AI purchases, the cyberpunk grade | **Era bump ruled** (Q47-A): `sm-era-1`; every era-0 battery baseline void; the version now actually reaches the hash (it never had). **AI buys credentials** from its HQ cache through player commands and **waits for dark** when night is close (owner 4A). **Visual direction** (ref `debugging/cyperpunk-example.png`): the splash goes street-level with haze skylines and edge neon; districts gain facade neon (commercial pink-dominant) and industrial pipe runs. Avenue density deferred (owner: note for later). Waiting polish: the shelter survives lockdown; nightfall countdown in the overlay |

## Nineteenth decision batch (2026-08-28/30, playtest 13 and Q48–Q51)

| # | Decision | Ruling |
|---:|---|---|
| D66 | Playtest 13, eight findings | **Camera moves**: right-drag pan and FOUR quarter-turn azimuths (the "no rotation" rule relaxed — a fixed compass hides two facades, and a stealth game must not hide the board). **rAF frame loop**: the "jerky, lag skip" was drawing once per 10Hz snapshot. **Figures 41% taller / 79% leaner**. **Cover shops are standing landmarks**; **alerted patrols scale and pulse**. **A captured Firm is told its options.** **Mission areas: four floor plans by site type**, camera follows at street zoom (the ruled 8x). **Smoke and parks.** **Two typographic voices** — display for chrome, plain ink for anything read to decide |
| D67 | Q50 / Q48 / Q49 | **Q50**: safehouses 1→**8 per district** and the HQ landing confined to the chosen district — 62% of drops used to start elsewhere, now 0% by construction. **Era `sm-era-2`**; era-1 baselines void at zero cost (those batteries had not run). **Q48**: the **mid-sortie redrop** (`CMD_REDROP`), so `redropReputationHit` finally reads to something; folding banks the cache, redropping keeps you earning at risk. AI taught it in the same slice. **Q49**: owner playtesting, nothing changed |
| D68 | City Info (Q51) | One tabbed panel, splash and field. **Rival intel earned or bought only**, gated at the view; **human/AI never disclosed** (`isAi` not sent); **standing is yours, not theirs**. BOARD folds in as default (panes shown/hidden, never rebuilt — playtest-5 click safety). LEGEND derived from `tokens.marks`. Only HISTORY needed persisted state. **KIT closed a real gap**: `credentialTier` was never in the view, so a bought badge was invisible while 8f gated the work behind it |

**Open owner questions: Q45 remainders** (the night sneak percentage; the
patrol-density verdict once the batteries read) in `../dev-questions.md`.
Q48–Q51 are ruled and closed; the era-2 batteries are the only outstanding
measurement.

## Sibling project references

| Project | Location | What it contributes |
|---|---|---|
| Fireline Command | `~/GIT/firepower` | The engine being forked; sim-campaign workflow; batch lane; art pipeline |
| RetroMultiCiv | `~/GIT/multiciv` | The original stack pattern (reducer, twins, session seam, scenario fixtures) |
| Stack write-ups | `~/GIT/retrogradegames/game-stack-overview.md`, `game-stack-revised.md` | Architecture rationale and the earned-gotchas list |
