# Shadow Mandate — Sibling Game Design Update

**Subtitle:** *Run the mission. Don't get burned.*  
**Status:** Concept / Pre-production design brief  
**Art lineage:** Painted Low-Poly Hybrid (shared with Fireline Command)  
**Relationship:** Sibling game — same engine, same renderer, same art pipeline. Different genre, different feel. This document updates the previous **Shadow Mandate** concept and replaces that working title and terminology.

---

## Terminology Contract

Use these terms consistently in design docs, UI copy, and code comments:

| Term | Meaning | Player-facing? |
|---|---|---|
| **Shadow Mandate** | Game title / project title | Yes |
| **Firm** | A player employer / operational faction | Yes |
| **Agent** | Player-controlled character | Yes |
| **Field HQ** | Player/Firm base deployed after drop-in | Yes |
| **Contract** | Mission offered from the Field HQ | Yes |
| **Mandate** | The wider corporate/legal directive behind operations | Lore/UI flavor |
| **Burned** | Failed, exposed, abandoned, or compromised | Flavor/debrief |
| **Extraction** | Successful departure via dropship | Yes |

Avoid using **Syndicate** in player-facing UI, filenames, docs, and code identifiers for this sibling game.

---

## The Pitch

A drop-in / drop-out squad game where every player is an agent working for a shadow corporation — internally called a **Firm** — operating under a wider corporate mandate.

You drop in from a dropship, establish a Field HQ, run missions outward from it, and when you are done, you call an evac and extract cleanly — or you don't.

The world is always live. Other Firms are always operating. The longer you stay, the deeper you go, the more likely you are to cross paths with someone who does not want witnesses.

> **Run the mission. Don't get burned.**

---

## Core Design Pillars

| Pillar | What it means |
|---|---|
| **Drop in, drop out** | No lobby. No waiting. The world runs. You join it and leave it on your own terms. |
| **Field HQ as anchor** | Your HQ is your base, your save point, your extraction zone. Protect it. |
| **Mission radius expands** | First missions are safe and close. Each completed mission unlocks further, riskier ones. |
| **Firm identity** | You work for a faction with a name, a color, a doctrine. Your HQ flies their flag. |
| **Evac is a mechanic** | Leaving is not a menu option. You call evac, you wait 30 seconds, you extract. |
| **Shared world** | Multiple Firms operate simultaneously. Crossing paths is a choice and a risk. |

---

## Relationship to Fireline Command

| Axis | Fireline Command | Shadow Mandate |
|---|---|---|
| Genre | Tactical RTS / war diorama | Squad action / covert ops |
| Scale | Faction vs faction, full front | 1–4 agents per Firm, small ops |
| Player role | Field commander | Individual agent |
| Victory | Hold the Command Standard | Complete missions, extract clean |
| World | Active war, persistent front | Active city/region, persistent contracts |
| Art style | Painted Low-Poly Hybrid | Same — shared asset pipeline |
| Renderer | three.js, 2.5D diorama | Same — shared renderer |
| Drop-in | Join active war, select role | Drop in via dropship, establish HQ |
| Drop-out | Leave role, regent holds | Call evac, 30s extraction |
| Networking | Deterministic reducer, 10Hz | Same architecture |

**Shared assets:**
- Terrain tiles (roads, rivers, forest, rough, urban)
- Building silhouettes (adapted for urban/corporate maps)
- Painted low-poly vehicle chassis (adapted as Firm transports)
- Fog of war system
- Site/node system (adapted as mission targets)

---

## The World

### Setting

A near-future city-region. Corporate towers, industrial zones, port districts, research campuses, and rural outskirts. The Firms operate in the gaps between official authority.

The world is divided into **Districts**. Each District has:

- A set of **Contract Sites** (mission targets)
- **Neutral infrastructure** (roads, transit lines, safe houses)
- **Rival Firm presence** (other players' HQs and agents)
- **Civilian traffic** (ambient NPCs — same farmhand/convoy logic as Fireline Command)
- **Authority patrols** (NPC guards — alarm-first, same doctrine as Fireline Command)

### Scale

| Parameter | Value |
|---|---|
| Map size | 64×64 to 128×128 cells (same as Fireline Command) |
| Active Firms per map | 2–6 |
| Agents per Firm | 1–4 |
| Mission sites per map | 12–20 |
| Districts per map | 3–5 |

---

## Drop-In: The Dropship Sequence

### Overview

When a player joins the world, they do not spawn at a menu. They drop in.

### Sequence

#### Step 1 — Firm Briefing (10 seconds, skippable)

A cold terminal screen shows:

```
FIRM: [NAME]
OPERATIVE: [CALLSIGN]
DISTRICT: [TARGET DISTRICT]
OBJECTIVE: ESTABLISH FIELD HQ
INSERTION METHOD: AIR DROP
```

#### Step 2 — Drop Zone Selection (15 seconds)

The player sees a fog-filtered top-down view of the district.

- Available drop zones are marked (clear of rival HQs and authority patrols).
- Player selects a drop zone.
- If no selection is made, the system auto-selects the safest available zone.

#### Step 3 — Dropship Animation

A low-poly dropship (painted style, Firm colors) flies in from the map edge.

| Frame | What happens |
|---|---|
| 0.0s | Dropship appears at map edge, moving toward drop zone |
| 1.5s | Dropship slows, descends |
| 2.5s | Side door opens (simple geometry animation) |
| 3.0s | Agent figure drops / rappels down |
| 3.5s | Dropship ascends and exits |
| 4.0s | Agent lands, stands up |
| 4.5s | HQ crate deploys (unfolds from a dropped container) |
| 5.0s | Field HQ is live. Player has control. |

**Implementation note:** The dropship is a low-poly mesh on a scripted path. No physics. Same approach as Fireline Command vehicle movement. The animation is a presentation layer event — the server simply registers the HQ as placed at the selected coordinates.

#### Step 4 — Field HQ Established

The HQ appears on the map as a small compound:

- A command tent or prefab structure (painted low-poly).
- A Firm flag (faction color).
- A perimeter marker (visible to own team, hidden from rivals in fog).
- A mission board (the UI entry point for contracts).

---

## Field HQ

### What the HQ Is

The Field HQ is the player's anchor in the world. It is:

- The **spawn point** for the agent after any mission.
- The **mission board** — contracts are accepted and tracked here.
- The **extraction zone** — evac must be called from here.
- The **resource depot** — mission rewards are banked here.
- A **capturable/destroyable site** — rival Firms can raid it.

### HQ Components

| Component | Function |
|---|---|
| Command Tent | Visual anchor, mission board access |
| Firm Flag | Faction identity, visible on map |
| Perimeter Sensors | Alarm-only guards (same doctrine as Fireline Command) |
| Safe House Slots | Up to 3 agents can bunk here between missions |
| Resource Cache | Holds mission rewards until extraction |
| Evac Beacon | Triggers the 30-second extraction sequence |

### HQ Vulnerability

The HQ can be raided by rival Firms.

| Event | Effect |
|---|---|
| Rival agent enters HQ perimeter | Perimeter alarm triggers — owner is alerted through fog |
| Rival agent reaches command tent | HQ is compromised — resource cache is looted |
| HQ is destroyed | Owner must call emergency evac or redeploy |
| Owner is not present | HQ is defended only by perimeter sensors (alarm-only v1) |

**Design note:** HQ raids are high-risk for the raider too. They must enter enemy-alerted territory, loot, and extract before the owner returns. This mirrors the prison raid mechanic in Fireline Command.

---

## Missions

### Mission Structure

Missions are **Contract Sites** on the map. Each site has:

- A **type** (see below)
- A **difficulty tier** (1–4, based on distance from HQ and rival presence)
- A **reward** (resources, intel, recognition)
- A **time window** (some contracts expire)

### Mission Radius Expansion

This is the core progression loop.

| Phase | Distance from HQ | Mission types available | Risk level |
|---|---|---|---|
| **Phase 1 — Local** | 0–8 cells | Courier, Surveillance, Extraction | Low — own territory |
| **Phase 2 — District** | 8–20 cells | Sabotage, Acquisition, Intimidation | Medium — neutral ground |
| **Phase 3 — Deep** | 20–40 cells | Vault Raid, Lab Infiltration, Assassination | High — rival territory |
| **Phase 4 — Cross-District** | 40+ cells | Firm War, Territory Seizure | Very high — open conflict |

**Unlock mechanic:** Each completed mission in a phase unlocks access to the next tier. The player cannot skip phases. This creates a natural risk escalation without a level gate.

### Mission Types

| Type | Description | Reward |
|---|---|---|
| **Courier** | Carry a package from A to B without being intercepted | Resources |
| **Surveillance** | Reach a site, hold for N seconds, extract with intel | Intel + recognition |
| **Extraction** | Rescue a contact from a guarded site (same loop as POW rescue) | Resources + seat unlock |
| **Sabotage** | Reach a site, plant a charge, extract before it blows | Resources + map effect |
| **Acquisition** | Steal an item from a guarded vault (same loop as vault raid) | Resources + tech nudge |
| **Intimidation** | Hold a rival's site for N seconds to send a message | Territory control |
| **Vault Raid** | Full heist — breach, loot, extract under pressure | Large resource payout |
| **Lab Infiltration** | Escort a scientist out of a rival-controlled lab | Tech nudge (passive bonus) |
| **Assassination** | Reach a target NPC, neutralise, extract clean | Recognition + rival debuff |
| **Firm War** | Open conflict with a rival HQ — raid and destroy | Territory seizure |

### Mission Board UI

The mission board is accessed at the HQ. It shows:

```
AVAILABLE CONTRACTS

[TIER 1] Courier — Dockside → Warehouse 7         ★☆☆☆  12 min  +80 res
[TIER 1] Surveillance — Transit Hub Alpha          ★☆☆☆  open    +40 res +intel
[TIER 2] Sabotage — Rival Relay Station 3          ★★☆☆  8 min   +120 res
[TIER 3] Vault Raid — Corporate Tower B            ★★★☆  open    +300 res
[TIER 4] Firm War — IRON VEIL HQ              ★★★★  open    territory

SELECT CONTRACT (ENTER) | BACK (ESC)
```

---

## Firms

### What a Firm Is

A Firm is the player's employer and operational faction. It has:

- A **name** (procedurally generated or chosen from a curated list)
- A **color scheme** (applied to HQ, flag, vehicles, agent uniform)
- A **doctrine** (passive playstyle modifier)
- A **reputation** (grows with completed missions, decays with failures and burns)

### Firm Doctrines

| Doctrine | Passive effect | Playstyle |
|---|---|---|
| **Ghost** | Agents move faster in fog, perimeter sensors have longer range | Stealth, surveillance, extraction |
| **Iron** | HQ has higher HP, perimeter sensors deal suppression (v2) | Defensive, vault raids, territory hold |
| **Blade** | Assassination missions pay double recognition | Aggressive, targeted strikes |
| **Coin** | Courier and acquisition missions pay +25% resources | Economic, trade route control |
| **Veil** | Rival Firms cannot see your HQ on the map (fog extended) | Counter-intelligence, deep ops |

### Firm Names (Curated List)

**Authoritarian / Corporate:**
- The Directorate (shared with Fireline Command lore)
- Iron Veil
- The Consensus Bureau
- Apex Standard
- The Mandate Group

**Insurgent / Independent:**
- The Outliers (shared with Fireline Command lore)
- Freehold Collective
- The Current
- Wayfarers Inc.
- The Breakers

**Neutral / Mercenary:**
- Greyline Solutions
- The Compact
- Dusk Operators
- Frontier Associates
- The Arrangement

---

## Agents

### Agent as a Character

Each agent is a single player-controlled figure. Unlike Fireline Command (where the player commands vehicles), here the player IS the agent.

| Attribute | Detail |
|---|---|
| Movement | Grid-based, same cell system as Fireline Command |
| Speed | Faster than vehicles on foot, slower on open ground |
| Visibility | Fog of war applies — agents have a sensor radius |
| Equipment | Loadout selected at HQ before each mission |
| Downed state | Same as Fireline Command crew — crawl, wait for rescue |
| Capture | Rival agents can capture downed agents (same Scout mechanic) |

### Agent Loadouts

| Slot | Options |
|---|---|
| Primary | Suppressor (stealth), Disruptor (alarm disable), Sidearm (light combat) |
| Tool | Satchel charge, Sensor jammer, Medkit, Grapple line |
| Vehicle | Light transport, Armored car, Motorbike (speed), Cargo van (carry capacity) |

### Agent Vehicles

Agents drive Firm vehicles — painted low-poly, same chassis system as Fireline Command but smaller and faster.

| Vehicle | Role | Special |
|---|---|---|
| Light Transport | General purpose | Fast, low profile |
| Armored Car | Combat / HQ defence | Higher HP, slower |
| Motorbike | Scout / courier | Fastest, no cargo |
| Cargo Van | Acquisition / extraction | High carry capacity, slow |
| Dropship (NPC) | Drop-in / evac only | Not player-driven |

---

## Drop-Out: The Evac Sequence

### Overview

Leaving the game is a mechanic, not a menu option. This is the defining feature of the drop-out system.

### Sequence

#### Step 1 — Agent Returns to HQ

The agent must physically return to their Field HQ. They cannot call evac from the field.

**Design note:** This creates a natural "wrap up and come home" loop. Players cannot abandon mid-mission without consequence.

#### Step 2 — Evac Beacon Activated

At the HQ, the agent activates the Evac Beacon.

```
EVAC BEACON ACTIVE
DROPSHIP ETA: 30 SECONDS
HOLD THE HQ
```

#### Step 3 — 30-Second Hold

The 30-second window is the tension mechanic.

| During the 30 seconds | Effect |
|---|---|
| Agent stays in HQ perimeter | Evac proceeds normally |
| Agent leaves perimeter | Evac timer pauses — must return |
| Rival agent enters perimeter | Alarm triggers — owner must repel or evac is interrupted |
| HQ is destroyed | Emergency evac — dropship arrives in 10 seconds, no resource payout |
| Agent is downed | Evac is cancelled — must be rescued or recaptured |

**The 30 seconds is visible to nearby rival agents through fog (a beacon signal).** This is intentional. It creates a "last chance to intercept" window for rivals and a "hold on, we're almost out" moment for the extracting team.

#### Step 4 — Dropship Arrives

Same animation as drop-in, reversed:

| Frame | What happens |
|---|---|
| 0.0s | Dropship appears at map edge |
| 1.5s | Dropship descends to HQ |
| 2.5s | Door opens |
| 3.0s | Agent boards |
| 3.5s | HQ crate folds up and is winched aboard |
| 4.0s | Dropship ascends |
| 4.5s | Dropship exits map |
| 5.0s | Player sees debrief screen |

#### Step 5 — Debrief

```
EXTRACTION COMPLETE

OPERATIVE: [CALLSIGN]
FIRM: [NAME]
MISSIONS COMPLETED: 3
RESOURCES EXTRACTED: 480
RECOGNITION EARNED: +240
AGENTS RESCUED: 1
HQ INTACT: YES

SYNDICATE REPUTATION: ████████░░ +12

RETURN TO WORLD (ENTER) | MAIN MENU (ESC)
```

### Emergency Evac

If the HQ is destroyed while the agent is in the field:

- Agent has 60 seconds to reach any safe zone (neutral site or map edge).
- Dropship picks up from the safe zone.
- Resource cache is lost (looted by the raider).
- Recognition is preserved.
- Reputation takes a minor hit.

---

## Multiplayer: Firm Squads

### Drop-In Together

Up to 4 agents can operate under one Firm flag.

- Each agent drops in separately (own dropship animation).
- All agents share the same Field HQ.
- Missions can be run solo or as a squad.
- Squad members see each other through fog (friendly markers).

### Shared HQ

The shared HQ is larger than a solo HQ:

- More perimeter sensors.
- More safe house slots.
- A shared resource cache.
- A shared mission board.

### Evac Together

When the squad calls evac:

- All agents must return to HQ within the 30-second window.
- Any agent not present when the dropship arrives is left behind.
- Left-behind agents enter a downed state and must be rescued by a future drop-in.
- The dropship can make one return trip for a left-behind agent (costs 60 seconds and a resource fee).

**Design note:** "Don't leave anyone behind" is a real decision under pressure. This is the correct emotional beat for a Firm squad game.

---

## Crossing Paths: Rival Firm Encounters

### How Encounters Happen

Rival Firms operate simultaneously on the same map. Encounters happen when:

- Two Firms target the same Contract Site.
- A Firm raids another's HQ.
- Agents cross paths on a road or transit route.
- A Firm's mission requires passing through rival territory.

### Encounter Options

When two agents are in proximity, the encounter is not automatic combat. The player chooses:

| Option | Effect |
|---|---|
| **Ignore** | Both agents continue. Fog of war applies — you saw them, they may not have seen you. |
| **Shadow** | Follow the rival agent without triggering an alarm. Intel gained. |
| **Intercept** | Move to block the rival's path. Forces a standoff. |
| **Engage** | Direct conflict. High risk, high reward. |
| **Negotiate** | Propose a temporary non-aggression pact (both must agree). |

### Standoff Mechanic

If two agents are in the same cell or adjacent cells:

- A standoff timer begins (10 seconds).
- Both players see each other's Firm name and reputation.
- Both choose: Engage, Withdraw, or Negotiate.
- If both choose Engage: combat resolves (same damage system as Fireline Command).
- If one withdraws: they move away, no penalty.
- If both negotiate: a 5-minute non-aggression pact is active.

**Design note:** The standoff is the Firm equivalent of the Fireline Command front line. It is the moment of maximum tension and player agency.

---

## NPC World: Making It Feel Alive

Same doctrine as Fireline Command — NPCs add texture without stealing the show.

| NPC | Behaviour | Effect |
|---|---|---|
| **Authority Patrols** | Move on fixed routes, alarm-only v1 | Reveal agents through fog if detected |
| **Civilian Traffic** | Move on roads, flee combat | Reveal movement to all Firms when fleeing |
| **Neutral Trader** | Crosses map on a fixed route | First Firm to escort gets a resource packet |
| **Informant** | Stationary NPC at a neutral site | Approach to reveal a rival HQ location |
| **Corrupt Official** | At an authority building | Bribe to disable patrols in a district for 3 minutes |
| **Scientist** | At a lab site | Escort to HQ for a tech nudge (same as Fireline Command) |
| **Street Vendor** | At a market site | Trade resources for equipment upgrades |

---

## Technical Architecture

### Shared with Fireline Command

| System | Reuse |
|---|---|
| Deterministic reducer | Full reuse — `apply(state, command)` |
| Fog of war | Full reuse — fog-filtered views |
| Site/node system | Full reuse — adapted for Contract Sites |
| Terrain system | Full reuse — same tile types |
| Tow/carry mechanic | Full reuse — adapted for agent rescue and item carry |
| NPC alarm system | Full reuse — same detection radius logic |
| three.js renderer | Full reuse — same 2.5D diorama camera |
| 10Hz tick rate | Full reuse |

### New Systems Required

| System | Description | Complexity |
|---|---|---|
| Dropship animation | Scripted path + door open/close | Low |
| Field HQ placement | Drop zone selection + HQ deploy | Low-Medium |
| Evac beacon | 30s timer + fog signal + dropship return | Medium |
| Agent loadout | Equipment selection at HQ | Medium |
| Mission board | Contract list + tier unlock | Medium |
| Standoff mechanic | Proximity detection + choice UI | Medium |
| Firm reputation | Per-Firm score, decays over time | Low |
| Squad drop-in | Multi-agent shared HQ | Medium |

---

## Art Direction

### Shared with Fireline Command

- Painted Low-Poly Hybrid style.
- Same terrain tiles.
- Same building silhouettes (adapted for urban/corporate context).
- Same color token system.

### New Art Required

| Asset | Description |
|---|---|
| Dropship | Low-poly transport, Firm-colored livery |
| Field HQ | Command tent + flag + perimeter markers |
| Agent figure | Small humanoid, Firm colors, 3 variants per faction |
| Firm vehicles | Light transport, armored car, motorbike, cargo van |
| Contract Site markers | Per-type icons (vault, lab, cache, etc.) |
| Urban terrain tiles | Corporate tower, alley, transit hub, market |
| Authority patrol NPC | Uniform figure, patrol route indicator |

### Firm Color Palettes

| Firm type | Primary | Secondary | Accent |
|---|---|---|---|
| Corporate / Authoritarian | Slate gray | Police blue | White |
| Insurgent / Independent | Terracotta | Sun-bleached tan | Teal |
| Mercenary / Neutral | Charcoal | Warm gray | Amber |
| Ghost doctrine | Deep navy | Pale cyan | Silver |
| Blade doctrine | Dark red | Black | Gold |

---

## Splash Screen / Intro

Adapt the Fireline Command splash concepts:

**Recommended intro for Shadow Mandate:**

Use **Concept 2 (Command Boot Sequence)** adapted:

```
SYNDICATE SHADOWS
FIELD TERMINAL v1.0

WORLD STATUS ............ ACTIVE
ACTIVE SYNDICATES ....... 4
CONTRACTS AVAILABLE ..... 17
YOUR SYNDICATE .......... [NAME]
FIELD STATUS ............ UNDEPLOYED

DROP IN? (ENTER)
```

Then cut to the drop zone selection screen.

---

## Phase Plan (Suggested)

| Phase | Scope |
|---|---|
| **Alpha** | Single agent, single Firm, one district, 3 mission types (Courier, Surveillance, Extraction), dropship in/out, Field HQ, evac beacon |
| **Beta** | Multi-agent squads, 3 Firms, rival HQ raids, standoff mechanic, full mission type set |
| **Release** | Full map, 6 Firms, all NPC types, Firm doctrines, reputation system |
| **Post-release** | Cross-game lore events (Directorate / Outliers appear as Firms in Shadow Mandate) |

---

## The Lore Bridge

Shadow Mandate and Fireline Command share a world.

The Directorate and The Outliers are not just factions in Fireline Command — they are also political and commercial powers whose affiliated Firms operate in the same region. A player who has been running Directorate missions in Fireline Command is fighting the same war that Shadow Mandate agents are operating inside.

This creates a **shared universe** without requiring a shared server:

- Fireline Command: the open front, the war of territory.
- Shadow Mandate: the covert layer, the war of information and resources.

The same map can appear in both games, with different layers of activity visible to each.

> **In Fireline Command, you hold the front.**  
> **In Shadow Mandate, you work the shadows behind it.**

---

## Acceptance Criteria (Alpha)

- [ ] Player can join a world without a lobby.
- [ ] Dropship animation plays on drop-in.
- [ ] Field HQ is placed at selected drop zone.
- [ ] Agent can accept and complete a Tier 1 mission.
- [ ] Mission radius expands after Tier 1 completion.
- [ ] Evac beacon triggers 30-second countdown.
- [ ] Dropship arrives and extracts agent after 30 seconds.
- [ ] Debrief screen shows mission results.
- [ ] HQ is visible to rival Firms if fog is cleared.
- [ ] Perimeter alarm triggers on rival approach.
- [ ] Works on desktop browser and mobile.
- [ ] Painted Low-Poly Hybrid art style consistent with Fireline Command.
