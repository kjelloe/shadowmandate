# Shadow Mandate — Version 1 Plan: "The Operative"

*Created 2026-08-03. Status: **pre-code — design complete** (rulings D1–D26 locked,
all 21 design questions answered). HTML twin: `plan-version1.html`.
Design of record: `specs/01_design_of_record.md`. Fork source: `~/GIT/firepower`.*

## Version 1 definition

**Solo covert ops against live AI rival Firms in one long-lived browser world.**
A player drops in by dropship, establishes a Field HQ, runs contracts outward,
and extracts — while 2–3 AI Firms run their own contracts, raise heat, and
sometimes raid. Ships when a player can visit the same world across several
evenings, feel it moved while they were away, and choose "one more contract"
over a safe evac because the unbanked cache is worth the risk.

V1 runs on the real server architecture (session seam from day one) so V2
human multiplayer is an unlock, not a rewrite.

## Key parameters

| Parameter | Value | Ruling |
|---|---|---|
| World size at ship | 64×64 cells (128×128-capable, tested at both) | D26 |
| Tick rate | 10 Hz fixed, deterministic reducer | stack |
| Season | 4 weeks (official world); self-host configurable | D15 |
| AI rival Firms | 2–3, active only while the world is live | D13, D16 |
| Contract pool | 5 per player slot; 5 disjoint offers shown per player | D18 |
| Sortie / deployment length | 15–20 min / 40–60 min | D11 |
| Tier pacing | median 3–4 deployments to tier 3 | D19 |
| Combat | stealth-first, disable-only; Snatch not assassination | D6 |
| Identity | seat token + recovery code, no accounts | D10 |
| Hosting | official public sample world on existing VM | D14, D21 |
| Tone | mild noir; "Syndicate" banned from UI/code | D8, D23 |

## Features IN

| Area | Features | Rulings |
|---|---|---|
| **World** | Seeded urban mapgen with district identity (3–5 districts); contract sites; drop zones; patrol routes; validation probes; two pinned reference seeds | D26 |
| **Agent & stealth** | Direct lead-agent control (Sneak/Move/Hurry); fog of war; detection states Unseen→Noticed→Burned; district heat 0–5 with decay; fuzzy heat display, exact via intel; disable-only combat; downed→crawl→rescue/capture; Holding Sites | D1, D6, D20 |
| **HQ & session loop** | Drop-zone selection; dropship sequences (in/out); Field HQ (tent, flag, perimeter sensors, cache, evac beacon); 30s evac hold with interruption rules; emergency evac; debrief; cache-vs-bank tension (banked only on clean extraction) | D7 |
| **Contracts** | D18 economy (pool per slot, disjoint offers); Courier, Surveillance, Extraction (tier 1); Sabotage, Acquisition (tier 2–3); mission radius phases 1–3; tier unlocks persist in ledger; capture exits: bail or re-drop | D17, D18, D19 |
| **AI rivals & standoff** | 2–3 AI Firms running real contract loops (drop in, operate, evac, return); HQ raids with race-home alarm window; **standoff choice UI** (Engage/Withdraw/Negotiate) vs deterministic AI policy | D13, D21, D22 |
| **NPCs & buildings** | Authority patrols (alarm-first); civilian traffic; building entry overlay: Informant dialogue (rival HQ tips, exact heat), Street Vendor shop (equipment upgrades — the bank's sink) | D9, D20 |
| **Persistence** | Long-lived world (10Hz live, deterministic dormancy transition: heat decay + contract refresh only); world ledger per (world, Firm): reputation, tier unlocks, bank; fog resets each drop, physical building changes persist; seat token + recovery code | D3, D10, D12, D15, D16 |
| **Presentation** | Painted Low-Poly Hybrid art (agent figures, HQ, dropship, urban tiles, vehicles, site markers); 2.5D three.js diorama; splash terminal (SHADOW MANDATE / FIRMS strings per contract); mobile touch; `en`/`no` catalogs | D8, D23 |
| **Ops** | Single VM, systemd, caddy; official public sample world at a known URL; world rotation on the 4-week season | D14, D15 |

## Features OUT (deferred)

| Deferred to | Features |
|---|---|
| **V2** | Human multiplayer, squads, shared HQ, squad evac; support agents (hybrid control layer); human-vs-human standoffs and pacts; Intimidation, Vault Raid, Lab Infiltration, Snatch, Firm War; Scientist/Corrupt Official/Neutral Trader NPCs; email OTP; interiors decision |
| **V3** | Doctrines (Ghost/Iron/Blade/Coin/Veil); seasons meta + territory; full NPC ecology and world events; public-world master index with public/invite-only listing; Roblox gate (with D23 content path); cross-game lore events |
| **Never (V1 doctrine)** | Lethal combat; accounts/passwords; pay-for-power (free per D24, cosmetics door open) |

## Milestones

| # | Name | Scope | Gate |
|---:|---|---|---|
| M0 | Fork & Strip | Copy firepower skeleton; drop war modules (standards, supply, mines, caltrops, drones, drops, basewalls, bridges, war maps, premium); D8 terminology from first commit | Trimmed suite double-run green; new pinned fixture replays byte-identical; dev-log records every dropped module |
| M1 | Urban World | Seeded city mapgen, districts, contract sites, patrol routes, drop zones; validation probes | 20-seed corpus passes probes at 64×64 AND 128×128; two reference seeds pinned |
| M2 | The Agent | Stance movement, fog, detection states, heat (fuzzy display), patrols, disable-only combat, capture to Holding Site | Headless probe: sneak past unseen / burned by hurrying / downed→captured; heat rises and decays; census shows every state fires |
| M3 | HQ & The Loop | Drop-zone select, HQ deploy, perimeter alarm, evac beacon rules, emergency evac, dropship presentation, debrief; ledger with bank-on-evac | Full loop headless AND in browser; re-drop shows persisted ledger; client smoke + UI acceptance green |
| M4 | Tier 1 Contracts | D18 contract economy + board UI; Courier/Surveillance/Extraction; capture exits (bail / re-drop); loadouts | 5-seed campaign completes each type; contract economy census (offered/accepted/completed/expired) |
| M5 | AI Rival Firms | 2–3 AI Firms with real loops; informant (tips + exact heat); civilians; standoff choice UI vs AI policy; HQ raids with race-home window | AI-vs-AI worlds 12–16k ticks × 5 seeds, zero invariant violations; first n=300 battery: burn rates, heat trajectories, rep spread in tolerance |
| M6 | Depth & Tier 2–3 | Sabotage, Acquisition; radius phases 2–3; vehicles (transport, motorbike, van); building overlay (informant dialogue + vendor shop); dormancy transition; return-visit world news | Battery confirms D19 pacing (3–4 deployments to tier 3); dormancy deterministic under replay |
| M7 | Presentation & Ship | Full art set; splash; mobile pass; en/no complete; GPU perf pass; VM deploy with official public sample world + 4-week season config; seat-token identity | V1 acceptance list below; ≥60fps on reference hardware; a stranger plays on a phone without instruction |

## Acceptance criteria

*Swept 2026-08-05 (slice 7g). Full evidence and the reasoning behind every
partial in `V1_ACCEPTANCE.md`. **10 pass, 3 partial, 1 fail.***

- [~] Join without lobby; dropship plays; HQ at chosen zone. — join and HQ pass; **dropship choreography not built in the client**.
- [x] Tier 1 contracts complete; tier 2 unlocks and persists in the ledger.
- [x] Detection states and heat observably change how a sortie plays; heat shows fuzzy, informant sells exact.
- [~] Downed leads to capture; bail and re-drop both work; an Extraction contract recovers a captured agent. — bail and re-drop pass; **the auto-generated rescue contract (other half of D17) is not implemented**.
- [x] Evac: 30s hold, interruption rules, cache banks only on clean extraction.
- [x] AI rivals visibly operate; an HQ raid triggers the alarm with a winnable race home.
- [x] A standoff with an AI rival presents Engage/Withdraw/Negotiate and honours the outcome.
- [x] Every present player's board shows 5 offers, disjoint from other players' boards (headless multi-seat test). — **test written in 7g**; four seats, disjoint, and still disjoint after 30 ticks.
- [x] Returning after a day: changed world, intact ledger, fog reset, persistent building changes.
- [ ] A sortie fits 15–20 min; a 2–3 contract deployment fits 40–60 (battery-verified). — **FAIL**: 8.7–17.4 and 27.7–55.4 human-adjusted; both overlap their target, neither sits inside it, and tier-3 pace is 5.0 against 3–4. Per D41/D42 the remedy is the M8 opposition content, not more reward tuning. **Re-measure after M8.**
- [x] Vendor sells ≥3 meaningful upgrades; bank has a purpose.
- [x] Cleared browser + recovery code restores the Firm ledger.
- [x] Replays exact; pinned fixture stable; sim gate + battery pass on shipping ruleset.
- [~] Desktop + mobile browser; en/no; painted low-poly consistent with Fireline; zero "Syndicate" strings. — desktop, mobile, i18n parity and the terminology guard all pass; **there is no painted art, only primitives**.

## Working practices (inherited from firepower)

Slices with tests-first and double-run green suites; every gameplay slice ends
with the 5-seed sim gate; batteries (n=300+) on the **shared batch lane**
(repo-tagged jobs, per-repo labels — D25); never tune on 5 seeds; mirror +
firm-swap fairness instruments maintained for every positional subsystem;
telemetry records failure; dev-log every slice; product decisions verbatim in
`dev-prompts.md`, rulings in `specs/`.
