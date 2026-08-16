# V3 Roadmap — "The World"

**Goal:** The living-world promise paid in full: doctrines, seasons with stakes, territory, a richer NPC ecology, discovery/master-index for public worlds — and the explicit go/no-go gate on the Roblox/Luau twin.

**Ships when:** a season ends, standings mean something, players argue about which Firm ran the city — and the next season's seed announcement is an event.

---

## Milestones

### M14 — Doctrines
Ghost / Iron / Blade / Coin / Veil passives; doctrine chosen at first drop into a world, fixed for the season; balance batteries per doctrine pairing (firm-swap instrument mandatory — chassis vs side separation, firepower lesson).

*Gate:* n=600 battery shows no doctrine >55% cross-pairing win-equivalent on season score.

### M15 — Seasons & Territory
Season lifecycle: world birth announcement, 4-week duration (D15), end-of-season standings from reputation + territory; archive and museum replay of notable wars. Territory Seizure and cross-district Firm War as persistent map state (district influence). Season rewards are recognition/cosmetic — never power (monetization doctrine from ideas.md).

**Firm-building meta (D33 requirement):** players must be able to build their Firm/faction over time across seasons. Design here what accumulates on the per-server lifetime layer beyond the honor score — e.g. Firm history/chronicle, earned cosmetic identity (flag marks, HQ trim, callsign lineages), veteran-agent roster names, founding-member records. Never power (D24 doctrine); the Firm becomes an institution with a past, not a stronger piece.

*Gate:* full simulated season (AI-only, accelerated) produces coherent standings; territory flips are legible in the client and the debrief.

### M16 — World Ecology
Complete NPC set with interlocks (informant quality scales with heat; officials get more expensive in locked-down districts); dynamic world events (authority crackdowns, corporate audits, blackouts) generated deterministically from the seed + dormancy transitions; heat becomes a district economy every Firm must manage around.

*Gate:* event census across a simulated season; no event stalls contract generation; story battery (lead changes, comeback metrics — the firepower "story columns") shows worlds stay contested late-season.

### M17 — Public Worlds & Discovery
Master-index heartbeat (QuakeWorld pattern from RetroMultiCiv): self-hosted servers announce name, address, ruleset hashes, open seats; client Find-a-World browser; no accounts, LAN-first preserved. Per D14, listing is a per-server choice: **public** (heartbeat on) or **invite-only** (heartbeat off; world code is the invitation). The official sample world (live since V1) is always listed. Spectator seats (host-controlled, fog-filtered to a neutral observer view).

*Gate:* two independent hosts appear in one index; join from index to deployed in under a minute; spectator leaks nothing (payload assertions).

### M18 — The Roblox Gate (go/no-go decision, then execution if GO)
Decision inputs: V2 retention, mobile readability findings, family-friendly doctrine holding (D6 was chosen to keep this door open), and team bandwidth.

If GO — the RetroMultiCiv twin playbook: byte-shaped Luau transliteration in port order rng → statehash → data → subsystems, gated on cross-language anchor vectors, shared JSON scenario fixtures, golden sim checkpoints, and replay-verdict equality; `lune` in CI; data crosses by codegen; Roblox client as a separate workstream consuming the engine twin read-only.

*Gate (if GO):* all four parity gate classes green before any Roblox client work starts.

### M19 — Cross-Game Lore
Directorate/Outliers season events mirrored between Fireline Command and Shadow Mandate (shared seed drops, themed contracts referencing the other game's front). Shared universe, no shared server — coordination by content, not infrastructure.

*Gate:* one joint seasonal event shipped in both games.

---

## V3 acceptance criteria

- [ ] Doctrines are distinct in play and within balance tolerance in batteries.
- [ ] A season has a beginning, an end, standings, and cosmetic-only rewards.
- [ ] A Firm visibly accumulates identity across seasons (history, honors, earned cosmetics) without accumulating power (D33).
- [ ] Territory is visible, contested, and season-scoped.
- [ ] Public worlds are discoverable without accounts; LAN still works offline.
- [ ] Roblox decision made on evidence and recorded; if GO, engine parity gates green.

## Beyond V3 (parking lot)

Player-created world templates; ranked/competitive rulesets; replay sharing as social artifact ("watch our heist"); accessibility pass beyond baseline (remapping, reduced motion, colour-blind — baseline arrives incrementally from V1); native wrappers.
