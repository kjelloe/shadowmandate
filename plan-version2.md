# Shadow Mandate — Version 2 Plan: "The Squad"

> **Renumbered 2026-08-23 (owner ruling):** V2 milestones are **M9–M14**.
> **M8 is the opposition-and-site-security milestone** (spec S16) built
> between the two plans — it took the number first, and the collision is now
> resolved in its favour.

*Created 2026-08-03. Status: **planned — starts after V1 ships**. HTML twin:
`plan-version2.html`. Prerequisite: `plan-version1.md` complete.
Design of record: `specs/01_design_of_record.md` (rulings D1–D26).*

## Version 2 definition

**Humans in the world.** Squads of up to 4 under one Firm flag, rival human
Firms in the same long-lived worlds, the standoff as a real player-vs-player
decision, AI support agents completing the hybrid control model, and the full
ten-contract set. Ships when two friends can drop into a stranger's world, run
a heist together, get intercepted by a rival squad at the evac beacon — and
talk about it afterwards.

V2 changes no game rules that V1 proved: it swaps AI counterparts for humans
(same standoff protocol per D22), scales the HQ for squads, and fills out the
contract and NPC sets.

## Key parameters

| Parameter | Value | Ruling |
|---|---|---|
| Agents per Firm | 1 lead + up to 3 support agents or human squadmates | D1 |
| Active Firms per world | up to 6 (humans + AI mixed) | — |
| Join flow | no-lobby: world code / QR / LAN, mid-session | D4 heritage |
| Identity upgrade | optional email OTP attaches to a Firm ledger | D10 |
| Standoff | same protocol as V1; counterpart now human | D22 |
| World size | 64×64 default; 128×128 available for big worlds | D26 |
| Vehicles | full roster incl. armored car; AI Firms graduate from motorbikes to full use | D34 |
| Snatch, not assassination | disable-only doctrine unchanged | D6 |

## Features IN

| Area | Features | Rulings |
|---|---|---|
| **Humans online** | No-lobby join (tokens, world codes, QR/LAN); reconnect grace; disconnect regency (agent returns to HQ and holds); per-seat fog-filtered views; solo remains the same code path | D10 |
| **Squads** | Up to 4 humans under one flag; scaled shared HQ (perimeter, safe-house slots, cache); shared mission board; squad fog markers; pings; squad evac — all aboard or left behind; left-behind agents become Extraction contracts; one paid return trip | — |
| **Standoff vs humans** | Simultaneous-choice resolution over the network; timed non-aggression pacts enforced both ways; Shadow and Intercept encounter options; one protocol for mixed human/AI worlds | D22 |
| **Support agents** | Recruit up to 3 at the HQ; intent-based command (tap agent, tap target); visible stances (Conceal / Return / Defend HQ / Follow / Low-risk only); regency on evac/disconnect; the solo player's squad in a world of human squads | D1 |
| **Full contract set** | Intimidation, Vault Raid, Lab Infiltration, Snatch, Firm War v1 (HQ raid while both deployed); Vault Raid presentation decides the interiors question (overlay vs simulated spaces) | D6, D9 |
| **NPC ecology** | Scientist (escort → tech nudge); Corrupt Official (D9 dialogue, bribe disables patrols); Neutral Trader (escort race); vendor catalog expansion | D9, D23 |
| **Full vehicle use** | Armored car chassis (combat/HQ defence); AI Firms use the full vehicle roster; vehicle play in raids and Firm War | D34 |
| **Identity & robustness** | Email OTP to secure/recover ledgers (no passwords, no profiles); server caps, per-IP limits, allowlist frame validation, save rotation; hosted + LAN parity | D10 |
| **Fairness & scale** | Batteries at human-shaped loads (mixed human/AI, 6 Firms); mirror + firm-swap instruments extended to squad HQs and war targets — on the shared batch lane | D25 |

## Features OUT (deferred to V3+)

Doctrines; seasons meta, standings, and territory as persistent map state;
world events and full NPC interlocks; public-world master index (public
listing vs invite-only is a V3 discovery feature — V2 self-hosts are join-by-code);
spectators; Roblox gate and its D23 content path; cross-game lore events;
monetization (D24 door stays closed).

## Milestones

| # | Name | Scope | Gate |
|---:|---|---|---|
| M9 | Humans Online | No-lobby join, reconnect grace, disconnect regency, per-seat views verified against server views | Server tests with real ws clients: join/play/drop/reconnect/tamper-reject; two-device LAN session completes a full loop |
| M10 | Squads | Shared scaled HQ, squad board and markers, pings, squad evac with left-behind loop and paid return trip | 4-client Playwright flow: squad drop-in, joint contract, deliberate leave-behind, later rescue |
| M11 | Standoff vs Humans | Networked simultaneous choice, pacts enforced both ways, Shadow/Intercept options, one mixed-world protocol | Acceptance flows for every choice combination; battery: standoffs within pacing band, AI honours pacts |
| M12 | Support Agents | Recruitment, intent commands, stances, regency; carry/rescue duties | Census: support agents complete courier legs, rescues, HQ defense; a solo player clears a tier-3 contract that a lone agent cannot |
| M13 | Full Contract Set | Five new contract types incl. Firm War v1; Scientist/Official/Trader NPCs; vendor expansion; interiors decision at Vault Raid | Every type fires in census; heist and war loops pass 5-seed gates; economy battery: no contract type >35% of optimal play |
| M14 | Fairness & Scale | n=600 mixed-load batteries; extended mirror/firm-swap instruments; server robustness; email OTP; LAN/hosted parity | Battery in fairness tolerances; server soak under churn; OTP recovers a ledger end-to-end; deploy runbook updated |

## Acceptance criteria

- [ ] A friend joins my world and squad from a code/QR in under a minute, mid-session.
- [ ] Squad evac pressure is real: leaving someone behind is possible, visible, and recoverable.
- [ ] A human-vs-human standoff presents real choices; pacts are enforced on both sides.
- [ ] Support agents make solo play viable in a world of human squads.
- [ ] All ten contract types live; Snatch everywhere, no lethality anywhere (D6).
- [ ] Reconnect never loses an agent or a cache to a network blip.
- [ ] An email-OTP-secured ledger survives token loss; an unsecured one still works via recovery code.
- [ ] n=600 mixed human/AI battery within fairness tolerances on both map sizes.

## Working practices

Unchanged from V1: slices, 5-seed gates per gameplay slice, shared batch lane
(D25) for batteries, mirror + firm-swap on every new positional system (squad
HQs and war targets are new positional state — remember the four places:
mirror transform, copyState, both hash functions, view projection), dev-log
per slice, decisions verbatim in `dev-prompts.md`, rulings in `specs/`.
