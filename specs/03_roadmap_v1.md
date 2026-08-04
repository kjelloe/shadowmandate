# V1 Roadmap — "The Operative"

**Goal:** Prove that the drop-in → contracts → evac loop is fun, solo, against AI rival Firms, in one long-lived browser world — on the real server architecture so V2 multiplayer is an unlock, not a rewrite.

**Ships when:** a player can visit the same world across several evenings, feel it moved while they were away, and choose "one more contract" over a safe evac because the cache is worth the risk.

---

## Milestones

### M0 — Fork & Strip
Copy the firepower skeleton; delete war-specific modules (standards, supply, mines, caltrops, drones, drops, basewalls, bridges, war maps); trimmed suite green; fixture re-pinned as the Shadow Mandate baseline; `premium.js` dropped (Q7 ruling). Terminology contract (D8) applies to all new identifiers from the first commit.

*Gate:* suite double-run green; replay of the new pinned fixture byte-identical; dev-log entry documenting every dropped module.

### M1 — Urban World
Seeded city mapgen: districts with traits, block/road/alley structure, transit lines, contract-site placement, patrol routes, drop zones. Map validation probes (route redundancy, site spacing, patrol coverage, drop-zone availability per district). 8×8 human-inspectable microscope fixture before the full-size template (firepower M0 practice).

*Gate:* 20-seed corpus passes all probes **at both 64×64 and 128×128** (D26 — ship config is 64, capability is 128); two named reference seeds pinned for all future sim gates.

### M2 — The Agent
Lead agent entity: stance-based movement (Sneak/Move/Hurry), fog + sensor radius, detection states (Unseen/Noticed/Burned), district heat with decay, Authority patrols on routes, disable-only combat (downed → crawl → capture to Holding Site). Landed hash-inert where possible.

*Gate:* headless probe demonstrates: sneak past a patrol unseen; get burned by hurrying; get downed and captured; heat rises and decays. Sim census shows every detection state fires.

### M3 — HQ & The Loop
Drop-zone selection, HQ placement (tent/flag/perimeter/cache), perimeter alarm, evac beacon with 30s hold rules, emergency evac, dropship presentation events client-side, debrief screen. World ledger: bank-on-evac, reputation, per-world keying.

*Gate:* full session loop headless AND in browser: drop in → move → evac → ledger written → re-drop shows persisted ledger. Client smoke + UI acceptance green.

### M4 — Tier 1 Contracts
Contract generation per the D18 economy (pool of 5 per player slot, 5 disjoint offers shown per present player) and board UI; Courier, Surveillance, Extraction; tier gating by ledger; rewards to cache; capture exits per D17 (bail or re-drop); loadout selection (Primary + Tool slots; vehicles deferred to M6).

*Gate:* 5-seed sim campaign with a scripted agent completes each contract type; contract economy census (offered/accepted/completed/expired per type).

### M5 — AI Rival Firms
2–3 AI Firms per world: they drop in, run contracts, raise heat, evac, and reappear — driven by the adapted regency AI. Informant NPC (reveals a deployed rival HQ; sells exact district heat per D20). Civilian traffic. **Standoff choice UI** (Engage/Withdraw/Negotiate, D22) with the AI answering by deterministic policy. HQ raid per D21: rival AI can loot a cache wherever the owner is on the map — the perimeter alarm countdown makes the race home winnable.

*Gate:* AI-vs-AI worlds run 12–16k ticks on 5 pinned seeds with zero invariant violations; systems census shows rivals completing contracts, raiding, and evacing. First battery (n=300 world-days) on the batch lane: burn rates, heat trajectories, AI reputation spread within tolerances.

### M6 — Depth & Tier 2–3
Sabotage and Acquisition contracts; mission radius phases 2–3; Firm vehicles (light transport, motorbike, cargo van); **building entry overlay (D9)**: dialogue framework (data-driven options; Informant moves onto it) and the **Street Vendor shop** (static portrait, equipment upgrades as the resource sink); dormancy transition (world evolves between visits: heat decay, contract refresh, rival activity headlines, persistent building changes per D12); return-visit briefing shows world news.

*Gate:* battery confirms tier progression pacing (median 3–4 deployments to tier 3, D19); dormancy transition (heat decay + contract refresh only, D16) deterministic under replay.

### M7 — Presentation & Ship
Art set (agent figures, HQ, dropship, urban tiles, vehicles, site markers); splash terminal; mobile touch pass; `en`/`no` catalogs complete; perf pass on real GPU; single-VM deploy with world rotation config, including the **official public sample world (D14)** at a known URL; seat-token identity with recovery code (D10).

*Gate:* full V1 acceptance list below; native perf ≥ 60fps on reference hardware; a stranger can play on a phone without instruction.

---

## V1 acceptance criteria

- [ ] Player joins a world without a lobby; dropship sequence plays; HQ placed at chosen zone.
- [ ] Tier 1 contracts can be accepted and completed; tier 2 unlocks and persists in the ledger.
- [ ] Detection states and district heat observably change how a sortie plays.
- [ ] Getting downed leads to capture; a later Extraction contract can recover the agent.
- [ ] Evac beacon: 30s hold, interruption rules, cache banks only on clean extraction.
- [ ] AI rivals visibly operate: their HQs appear/disappear, heat moves while you play, an informant can point you at one.
- [ ] Returning to a world after a day shows a changed world and an intact ledger.
- [ ] Replays are exact; the pinned fixture is stable; sim gate + battery pass on the shipping ruleset.
- [ ] A single contract sortie fits in 15–20 minutes; a 2–3 contract deployment fits in 40–60 (D11, battery-verified pacing).
- [ ] Entering a safe house or market building opens the dialogue/shop overlay; the vendor sells at least 3 meaningful upgrades (D9).
- [ ] A cleared browser + recovery code restores the player's Firm ledger on the sample world (D10).
- [ ] Works on desktop and mobile browser; en/no complete; painted low-poly style consistent with Fireline.

## Explicit V1 exclusions

Human multiplayer and squads; support agents; Intimidation/Vault Raid/Lab Infiltration/Snatch/Firm War; doctrines; trader/official/scientist NPCs; building interiors as simulated spaces (only the D9 overlay ships); email OTP identity (seat token + recovery code only); territory; Roblox; monetization. (The standoff choice UI is IN per D22.)
