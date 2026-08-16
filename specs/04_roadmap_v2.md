# V2 Roadmap — "The Squad"

**Goal:** Humans in the world. Squads under one flag, rival human Firms, the standoff as a real player-vs-player decision, and the batch-a "operator" layer via AI support agents.

**Ships when:** two friends can drop into a stranger's world, run a heist together, get intercepted by a rival squad at the evac beacon, and talk about it afterwards.

---

## Milestones

### M8 — Humans Online
No-lobby join for human seats (firepower server flow: tokens, human-typeable world codes, QR/LAN join); reconnect grace windows; disconnect regency (agent returns to HQ and holds); per-seat fog-filtered views verified against the server view (not just local play). Solo remains a special case of the same path.

*Gate:* server tests with real ws clients — join, play, drop, reconnect, tamper-reject; two-device LAN session completes a full loop.

### M9 — Squads
Up to 4 human agents under one flag: shared HQ (scaled perimeter/slots/cache), shared mission board, squad markers through fog, pings. Squad evac: all aboard or left behind; left-behind agents become Extraction contracts; one paid return trip.

*Gate:* 4-client Playwright flow: squad drop-in, joint contract, evac with one member deliberately left behind and later rescued.

### M10 — The Standoff vs Humans
The choice UI exists from V1 (D22); M10 makes the counterpart human: simultaneous-choice resolution over the network, timed non-aggression pacts enforced both ways, Shadow and Intercept encounter options. Mixed worlds (humans + AI) use one protocol.

*Gate:* acceptance flows for every choice combination; battery confirms standoffs resolve within pacing band and pacts are honoured by AI.

### M11 — Support Agents (Hybrid control, D1)
Recruit up to 3 AI support agents at the HQ; intent-based command (tap agent, tap destination/target); visible stances (Conceal / Return / Defend HQ / Follow / Low-risk only); regency on player evac/disconnect. Carry capacity and rescue duties make them the solo player's squad.

*Gate:* sim census shows support agents completing courier legs, rescues, and HQ defense; a solo player can run a tier-3 contract with support agents that a lone agent cannot.

### M12 — The Full Contract Set
Intimidation, Vault Raid, Lab Infiltration, Snatch (D6 replacement for assassination), and Firm War v1 (HQ raid while both deployed, full loot/destroy loop, emergency evac interplay). Scientist, Corrupt Official (D9 dialogue overlay), and Neutral Trader NPCs; Street Vendor shop (V1) expands its catalog. Vault Raid presentation decides whether interiors stay overlay-only or gain simulated spaces (D9 boundary).

*Gate:* every contract type fires in the census; heist and war loops pass 5-seed gates; economy battery shows banked resources have a use and no dominant-strategy contract type (no type >35% of optimal play).

### M13 — Fairness & Scale
Batteries at human-shaped loads: mixed human/AI worlds, 6 Firms, mirror + firm-swap instruments extended to every V2 positional system (squad HQs, war targets). Server robustness: caps, per-IP limits, allowlist frame validation, save rotation. Hosted worlds + LAN parity. **Email OTP confirmation (D10)**: optionally attach an email to a Firm ledger; OTP recovers or re-secures it — still no passwords, no profiles.

*Gate:* n=600 battery within fairness tolerances; server soak under connection churn; deploy runbook updated.

---

## V2 acceptance criteria

- [ ] A friend can join my world and my squad from a code/QR in under a minute, mid-session.
- [ ] Squad evac pressure works: leaving someone behind is possible, visible, and recoverable.
- [ ] A human-vs-human standoff presents real choices and honours pacts.
- [ ] Support agents make solo play viable in a world of human squads.
- [ ] All ten contract types are live; Snatch replaces assassination per D6 with no lethality anywhere.
- [ ] Reconnect never loses an agent or a cache to a network blip.

## Explicit V2 exclusions

Doctrines; season meta and world rotation rewards; territory control as persistent map state; cross-game lore events; Roblox; monetization.
