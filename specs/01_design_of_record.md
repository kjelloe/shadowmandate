# Shadow Mandate — Design of Record

**Subtitle:** *Run the mission. Don't get burned.*
**Status:** Design of record — supersedes `starter_design_document.md` where they conflict
**Art lineage:** Painted Low-Poly Hybrid (shared with Fireline Command)
**Relationship:** Sibling game — forked engine, same renderer approach, same art pipeline. Different genre, different feel.

---

## The Pitch

A drop-in / drop-out covert-ops game set in a persistent city-region. Every player is a lead agent working for a Firm.

You drop in from a dropship, establish a Field HQ, run contracts outward from it, and when you are done, you call an evac and extract cleanly — or you don't.

The world is always live. Other Firms are always operating — AI-run at first, human-run later. The longer you stay and the deeper you go, the more likely you are to cross paths with someone who does not want witnesses.

Being seen is the real danger. Nobody dies in this world — but agents get downed, captured, interrogated, and traded, and a burned operation costs you everything you hadn't yet banked.

> **Run the mission. Don't get burned.**

---

## Core Design Pillars

| Pillar | What it means |
|---|---|
| **Drop in, drop out** | No lobby. No waiting. The world runs. You join it and leave it on your own terms. |
| **Field HQ as anchor** | Your HQ is your base, your bank, your extraction zone. It exists only while you're deployed. |
| **Mission radius expands** | First contracts are safe and close. Each completed tier unlocks further, riskier ones — and the unlocks persist in this world. |
| **Detection is the threat** | Stealth-first: alarms, heat, and authority response are the antagonists. Combat downs, never kills. |
| **Firm identity** | You work for a faction with a name, a color, a doctrine (V3). Your HQ flies their flag. |
| **Evac is a mechanic** | Leaving is not a menu option. You call evac, you hold the HQ for 30 seconds, you extract. |
| **Living world** | The world instance persists for days or weeks. Rival Firms operate whether you're deployed or not. |

---

## Foundational Decisions (rulings)

These seven rulings resolve the open forks in the starter document and in `batch-a-refinement.md`. They are the contract for everything below.

| # | Ruling |
|---:|---|
| **D1** | **Hybrid control.** The player directly controls one lead agent (tap-to-move, contextual actions). From V2, the player can recruit AI **support agents** who follow visible stances — the batch-a "operator" layer arrives as a later stratum on top of direct control, not instead of it. |
| **D2** | **Fork Fireline Command.** Copy `engine/`, `shared/`, `server/`, `client/`, `test/`, `tools/` scaffolding from `~/GIT/firepower` into this repo; strip war-specific systems; diverge freely. No shared package between the games. |
| **D3** | **Long-lived worlds.** A seeded world instance runs on the server for days/weeks. Players drop in and out across many sessions. Per-Firm progression (reputation, unlocked mission tiers, banked resources) persists per world via a world ledger. Worlds rotate on a season cadence (Q1). |
| **D4** | **V1 is solo vs AI rivals** on the real server architecture (session seam from day one). Human multiplayer is V2. |
| **D5** | **Title: Shadow Mandate.** Repo `multisyndicate` is the codename. |
| **D6** | **Stealth-first, disable-only combat.** No entity is ever deleted by violence. Agents are downed → crawl → rescued or captured. NPC "assassination" missions are replaced by **Snatch** missions (capture and extract the target). Family-friendly, Roblox-compatible. |
| **D7** | **HQ extracts with you.** Evac winches the whole HQ aboard, exactly as the drop-out sequence describes. Offline players have zero footprint and nothing raidable. What persists between sessions is the **world ledger**: reputation, tier unlocks, and banked (extracted) resources, keyed per Firm per world. |

### Second decision batch (2026-08-03, from the Shadow Mandate design update — answers Q15–Q21)

| # | Ruling |
|---:|---|
| **D8** | **Title: Shadow Mandate** (supersedes the D5 title). Terminology contract below. "Syndicate" never appears in player-facing UI, docs, filenames, or code identifiers; repo codename `multisyndicate` is the only exception. |
| **D9** | **Exteriors only, with building entry as overlay.** No interior simulation. An agent at a building entrance can "go inside": the client opens an overlay — dialogue with options (quests/informants) or a shop menu with a static vendor portrait. The world sim sees only "agent inside building" (hidden from view, position parked at the entrance). |
| **D10** | **Identity: no accounts at start.** Browser-stored seat token + human-typeable recovery code binds a player to their Firm ledger. Later (V2): optional email OTP confirmation to secure/recover a ledger. |
| **D11** | **Session pacing:** one contract sortie should fit in 15–20 minutes; a normal deployment is 40–60 minutes. |
| **D12** | **Fog resets each drop.** No explored-map persistence in the ledger. Physical world changes persist: buildings may be damaged/changed by rival Firms or world events between your deployments — the world you re-enter is recognisably altered. |
| **D13** | **AI rivals are live actors in V1**: they run their own contracts, and HQ raids on the player can happen. |
| **D14** | **Hosting:** an official public sample world runs on the existing VM. Self-hosted servers choose **public listing** (master index heartbeat) or **invite-only** (no heartbeat, join by code only). |

### Third decision batch (2026-08-03, Q1–Q14 answers)

| # | Ruling |
|---:|---|
| **D15** | **Seasons are fixed 4 weeks** on the official sample world; self-hosted servers can configure their own cadence. |
| **D16** | **AI rivals act only while the world is live.** The dormancy transition covers heat decay and contract refresh only — no simulated rival progress while everyone is away. |
| **D17** | **Capture exit — player's choice of both routes:** bail (a percentage of banked resources, scaling with tier) releases the agent; or re-drop (new callsign, flat reputation hit) — the captured agent stays in the world as a rescue contract. |
| **D18** | **Contract economy:** the world pool holds **5 contracts per player slot** (a 16-slot world pools 80). Each present player is **shown 5**, and concurrent players receive **disjoint offers** — every player always has real options that aren't contested by the neighbour's board. |
| **D19** | **Tier pacing band:** median 3–4 deployments (of 40–60 min, D11) to reach tier 3 — the M6 battery gate verifies this. |
| **D20** | **Heat visibility:** fuzzy 3-step indicator by default (calm / tense / lockdown); the exact 0–5 level is intel, revealed by informants or surveillance rewards. |
| **D21** | **Cache raids reach anywhere** while you're deployed — but the perimeter alarm gives a countdown generous enough to abort a mission and race home. The race home is the story. |
| **D22** | **The standoff choice UI (Engage / Withdraw / Negotiate) ships in V1** against AI rivals; the AI answers by deterministic policy. V2 swaps the counterpart for a human. |
| **D23** | **Tone: mild noir.** Bribery is named as such; no drugs/gambling imagery. A **separate Roblox content path** (reworded vice, softened framing) is planned for if/when the V3 Roblox gate opens. |
| **D24** | **Free.** Cosmetics-only monetization door kept open per ideas.md doctrine; nothing built now. |
| **D25** | **Shared batch lane with firepower:** same agent-mail queue and PC worker; jobs are repo-tagged, results carry per-repo labels. |
| **D26** | **V1 ships at 64×64** — but engine, mapgen, and renderer must remain **128×128-capable**, with both sizes exercised in tests, so scaling up is a config change, not a project. |

### Fourth decision batch (2026-08-04, Q22–Q29 answers)

| # | Ruling |
|---:|---|
| **D27** | **Authority patrols arrest** (disable-only, same capture path as rivals): downed agents always; burned agents they reach while district heat ≥3. |
| **D28** | **Evac activation is always allowed** — even with rivals inside the perimeter. The hold is the fight. |
| **D29** | **Board rules:** max **2** simultaneously active contracts per agent; the board shows **one greyed next-tier teaser row** with its reward visible. |
| **D30** | **Vendor purchases are bank-only.** The at-risk cache cannot be spent — you must extract before you can shop. |
| **D31** | **Disconnect grace: 120 seconds.** Agent holds position; AI Firms do not *initiate* a raid on that player's HQ during grace (a running raid continues). After grace, the agent is idle until reconnect — the world never pauses. |
| **D32** | **Identity token + recovery code are per-server** (one code covers all your Firms/worlds on that server). |
| **D33** | **Season end:** bank and tier unlocks reset with the world; **recognition carries as a lifetime honor score**. V3 requirement registered: players must be able to **build their Firm/faction over time** across seasons — the V3 meta layer designs this. |
| **D34** | **V1 AI Firms use motorbikes only; full vehicle use (agents and AI, incl. armored car) arrives in V2.** |

### Fifth decision batch (2026-08-04, Q30–Q35 — raised while building M1–M4)

| # | Ruling |
|---:|---|
| **D35** | **Both halves of the offer fix.** The board fills from the Firm's radius phase first and falls back to tier-appropriate work anywhere, nearest first (the D18 promise outranks the geometry) — **and** drop-in seeds extra Contract Sites near a new HQ so there is genuinely enough close work to make phase 1 mean something. Neither alone was sufficient: the fallback alone quietly erodes the expanding-radius fantasy, and near-HQ seeding alone can still be starved by a bad seed. |
| **D36** | **Site density stays 16–24 per map.** |
| **D37** | **Auto drop-zone selection is priority-ordered:** (a) the district with the most tier-appropriate contracts, then (b) at least N cells clear of the map edge, then (c) maximally far from patrol routes. A corner is technically safe and miserable to play. |
| **D38** | **Buildings do not launder a burn — except a Cover Shop.** Entering a building while BURNED is allowed but does not clear it; patrols converge on the entrance and wait. A **Cover Shop** is a paid exception: for a fee the agent changes appearance, clears the burn, and leaves by a different exit — the GTA2 re-spray, for people. Paid from the bank (D30), so it is a reason to extract and bank rather than a free panic button. |
| **D39** | **Recognition rewards craft, not payout.** It accrues from contract tier, plus a bonus for finishing unseen, minus burns taken during the contract — the lifetime honor score reflects how well you work, not how many hours you log. |
| **D40** | **Capture starts a grace window (2–3 minutes) rather than failing contracts instantly.** A rescue or a paid bail inside the window restores the contract; after it, the contract fails. This makes rescuing a captured colleague mid-contract genuinely valuable, and matters most in V2 squads. |

### Sixth decision batch (2026-08-05, Q36)

| # | Ruling |
|---:|---|
| **D41** | **Sortie length comes from CONTENT, not from slower walking** (Q36, option c with a little of a). The M6 battery measured an AI sortie at 0.4 min against D11's 15–20; a first tuning pass reached 2.5 min and only closed a fifth of the gap by making travel slower. Slower is not the same as tenser. So: keep a modest travel slowdown, and spend the remaining minutes on **decisions** — multi-stage contracts, objectives that must be approached when a patrol is elsewhere, and legs that cannot be done in one pass. D11's targets stand; how they are reached is content. The pacing columns exist so every further pass is measured, and the owner playtests for feel. |

### Seventh decision batch (2026-08-05, Q37)

| # | Ruling |
|---:|---|
| **D42** | **Extraction and acquisition are not mispriced — they are under-opposed. Stop tuning their rewards.** The battery reported extraction 1.43x over-chosen after an effort-pricing pass, and the instinct was to keep cutting its payout. That is the wrong lever: these two types get *harder as the world progresses*, because the opposition that will make them dangerous is not built yet. Once a contested extraction can go wrong — a rival Firm arriving on the same contact, a facility that notices you — the take falls on its own, and a reward cut made now would have to be undone. **Contract attractiveness is balanced by OPPOSITION, not by price.** Prices are already priced by effort (S06) and that part stands. |
| **D43** | **D19 "no dominant type" is judged on the preference ratio** (accepted share over offered share), not raw completion share. Raw share cannot answer the question: short contracts finish more often per unit time whatever anyone prefers, and tier gating means a tier-1 Firm sees only 3 of the 5 types, so uniform choice is already 33.3% against a 35% ceiling. The ceiling itself is deferred until opposition exists, per D42 — a mix measured against absent difficulty is not a verdict. |
| **D46** | **Art ships as CODE: fork the sibling's procedural pipeline** (Q41a, option a). Models are built at runtime from `client/assets/metadata/style_tokens.json` rather than loaded from files. Deterministic, diffable in review, no binary blobs, no artist in the loop, and — the reason it beats authored models *for this project* — testable headlessly, because three.js builds geometry perfectly well in node with no DOM. `test/art_pipeline.test.js` enforces manifest completeness, triangle budgets (a MOBILE constraint, since 7b put the client on a phone), and that the renderer carries no colours of its own. **The manifest is the seam**: swapping a procedural stand-in for a painted model later is a manifest edit, never a renderer edit. |
| **D47** | **Portraits are procedural and composed from feature layers** (Q41b, option a) — head, hair, brow, eyes/glasses, moustache, collar, drawn from seeded parameters and the same style tokens. The owner's comic-relief requirement ("same agent, big moustache, or completely different glasses, big pink instead of agent lean black") is **combinatorial, not illustrative**: a fixed set of images cannot express "same person, different glasses", and a D38 disguise is then simply a *diff on the layers*. This also makes the Cover Shop legible — you can see what you paid for. |
| **D45** | **Challenge is always in the game world — never a modal panel** (Q38, option a). A mini-game that opens a separate screen fights drop-in/drop-out at the root: the world runs at 10Hz with other players in it, so a modal puzzle either freezes one player while the world moves around them, or pauses nothing and gets them captured while they look at a widget. Every challenge is therefore **diegetic** — solved with the agent in the world, in space and time: time the sensor sweep, cut the power at the junction, route around the door that just sealed, break line of sight from the camera. One input model, survives another player walking in, needs no new presentation layer, and remains legible to a spectator. This applies to all future difficulty content, not only S16. |
| **D44** | **Opposition is a system, not a difficulty number.** Two families, specced in S16: (a) **live opposition** — rival Firm teams that turn up and contest the same objective; (b) **site security** — alarms, sensor lines and lockdowns that make a facility a place you solve rather than a cell you stand on. Both must obey the existing engine doctrine: disable-only (D6), deterministic, and legible before they are lethal. |

### Eighth decision batch (2026-08-06, Q39–Q41c)

| # | Ruling |
|---:|---|
| **D48** | **The V1 look is the 7a gallery look** (Q41c). Pinned as shipped: the marks, body palette, Firm identity, tile palette and lighting currently in `style_tokens.json`. Not "final art" — it is the *approved* art for V1, and because the whole look is now a token file, a later revision is an edit rather than a project. S15's `❑ final tile/figure look` is closed; splash styling remains open. |
| **D49** | **Defend is BOTH a contract type and an event** (Q39, options a **and** b). The two are not alternatives — they are the chosen and the unchosen halves of the same fiction. **(a)** Defend joins the board as a sixth contract type in M8, after 8g, because it needs rivals who actually arrive; it is the only contract where being seen is not automatically failure, and it is naturally co-operative for a second player who drops in mid-session. **(b)** Rival raids also happen to your Field HQ *unprompted*, so the threat exists whether or not you took the job. The event teaches the mechanic and makes the world feel unsafe; the contract lets you sell that competence deliberately. Shipping only (b) would mean you can never choose it; only (a) would mean an HQ is only ever attacked by appointment. |
| **D50** | **Full upgrade tree, bounded by the season and disclosed on the way in** (Q40, option d, qualified). The parity objection to (d) is real and is answered by two things rather than by weakening the tree. **(1) Upgrades are season-scoped**: they join `resetsWithWorld` beside bank and tier (D33), so a veteran's advantage expires with the world instead of compounding forever. Recognition still carries as lifetime honour (D39) — craft persists, power does not. **(2) A world's state is disclosed before you join**: a joining player sees how many days into the season the world is, and the lowest and highest tier among the Firms competing in it. A newcomer meeting stronger agents is only unfair if it was unforeseeable; a server list that says "day 24 of 28, tiers 2–4" turns it into an informed choice. **Multiple hosted worlds across different servers are explicit** in the design, so choosing a fresh one is always available. |

### Ninth decision batch (2026-08-06, Q42 custody)

| # | Ruling |
|---:|---|
| **D51** | **An operative left in custody is ABANDONED, and recovering them is a job.** This is D17's unimplemented other half, and it resolves a real dead end: a Firm whose agent was captured could neither work nor leave, because the agent cannot act and the evac beacon cancels when the lead is held — 3 of 8 battery seeds ended with a Firm sitting in a permanent dead loop. So: **the Firm may fold and extract, leaving the operative in the Holding Site.** They are not lost — on a later deployment a **recovery contract** is offered to go and get them back. Two consequences that matter. (a) Capture stops being a death sentence for a Firm and becomes a *debt*: you leave, you redeploy, and the person you left is now a job with your name on it. (b) `leadAgent` must never select a held operative, or the Firm redeploys onto its own prisoner and churns — that was measured at 18 extractions in a single world-day before the rule was written down. Bail (D40) remains the fast, expensive way out; recovery is the slow, cheap one. |

### Tenth decision batch (2026-08-07, Q43 + Q42a)

| # | Ruling |
|---:|---|
| **D52** | **Pacing is judged on OVERLAP now, and on measured humans later** (Q43, a then c). Criterion 10 applied a 2–4x human deliberation factor and demanded the result sit *inside* the target band — arithmetically impossible, because the factor spans a ratio of 2.0 while the bands span 1.33x and 1.5x. No AI number could ever land inside either, and three measurement rounds were spent chasing it. **(a) now:** the criterion passes when the projected human range OVERLAPS the band, which puts the admissible AI window at 3.75–10 min per sortie and 10–30 min per deployment. **(c) later:** instrument real playtests and drop the factor entirely — a measured human number needs no multiplier, and the 2–4x guess is the only reason this was ever ambiguous. |
| **D53** | **Pay-per-effort is levelled across contract types, by RAISING only** (Q42a). Work-priced types ranged from 0.053 to 0.116 reward per work-tick: surveillance asked for 3600 stationary ticks and paid a third of acquisition's rate per minute, while being the most-offered type — taken because it was there, not because it was worth it. All work-priced types are brought to a common rate; nothing is cut, so D42's protection of extraction and acquisition is untouched. **`cacheEvacTarget` moves in the same edit**: rewards and progression are one system (S06), and levelling without it made one contract exceed the evac target so a Firm banked once and left — deployments collapsed to 0.7 min and surveillance took 60% of accepts. |

### Twelfth decision batch (2026-08-22, playtest 4)

| # | Ruling |
|---:|---|
| **D54** | **The city is seen through a FIXED 45°/45° dimetric camera** (playtest 4: "the city does not look like a city — change the perspective"). Azimuth 45° so every building shows two facades and a roof — the classic isometric read of the genre original — pitch 45°, default zoom 26 cells. The compass stays fixed: no player rotation, same doctrine as ever (a player who can spin the world loses their sense of where the patrol was). Pitch 40° was tried and rejected by screenshot — it buried the streets, which are the tap-to-move surface. Two engineering consequences are recorded in S15: the camera clamp must protect the followed TARGET rather than the frame, and the key light must sit on the camera's side of the world. |
| **D55** | **Block character is a VISUAL massing pass, not a citygen change.** Contiguous mass cells group into blocks and carve into hashed parcels client-side (`blockMassing`), each parcel drawing one architectural template. Streets, routes, gameplay, fixtures and battery baselines are untouched — a citygen change would invalidate all of them and reopen the M8 balance readings. Generating maps FROM authored block templates stays open as a possible later slice, to be decided after M8 settles. The honesty rule holds: the drawn footprint is exactly the block tiles, and height implies nothing the simulation does not model. |
| **D56** | **The Field HQ auto-establishes in the nearest free safehouse at drop-in** (playtest 4: "the player needs to establish an HQ in the building they are dropped into, visible on the player map"). The drop request becomes a neighbourhood pointer; `hqLandingFor` — engine-side, the single home of the rule, shared by player and AI paths — lands the HQ at the nearest safehouse not claimed by another HQ and not inside a rival's clear radius. Rivals follow the same rule; two HQs can never share a safehouse; the tent survives only as the no-safehouse fallback, guarded by the old proximity refusal. The lead agent lands on the door, so home has an inside from tick one. Spawned Q44: the safehouse is also the informant building. |

### Thirteenth decision batch (2026-08-22, playtest 5)

| # | Ruling |
|---:|---|
| **D57** | **The session economy actually works now** (playtest 5: "player has no starting cash, so cannot do any actions"). Three stacked defects, all ruled and fixed together: a fresh identity banks `hq.startingBank` (200) and a season rotation resets TO it, not to zero; purchases and bail genuinely debit the ledger — the reducer only ever CHECKS `command.bank` (pure, D30 bank-only) and until this batch **no server code ever subtracted the money**, so every buy since M4 was silently free; and the bank is VISIBLE — a HUD pill beside the cache, with unaffordable rows greyed, because a player who cannot see their balance reads every refusal as a broken game. Legacy ledgers are floored to the starting bank exactly once (version-2 stamp), since no pre-fix entry can be below the floor for having spent. **Leaving a building is the overlay's own Leave button**: the dialogue's leave row duplicated it (and the panel close only HID the overlay while the agent stayed inside — a market was a building you could never leave); the row and the `option.exit` mechanism are gone, and a quiet informant offers an EMPTY list. |
| **D58** | **Proper streets are a VISUAL treatment of the existing grid** (playtest 5). Street tiles draw as 2-lane with centre dashes, transit tiles as 4-lane avenues with a double centre line and lane dashes; intersections stay unpainted; kerbside lamps split lit / dead / blinking (two opposite phases). Widening streets in citygen was declined for the same reason as D55: it would invalidate fixtures, batteries and the M8 balance readings for a look goal the paint achieves. Same honesty contract as all set dressing: paint is flat, lamps stand off cell centres, nothing implies an obstacle the simulation does not model. |
| **D59** | **Special-purpose buildings DRESS the existing gameplay anchors** (playtest 5). The Holding Site is the prison — perimeter walls, wire, corner watchtowers, barred gate, the state band over the gate. The six site types carry typed markers (cache / vault / lab / relay / transit hub / warehouse, mirroring the engine's SITE_* order with a guard test) so a mission target is recognisable at a glance, while contract state still recolours the tint slot. New engine building kinds and pure landmarks with no gameplay anchor (fire station et al) are deferred — scenery that looks clickable but is not would be an ambush. |

### Fourteenth decision batch (2026-08-23, playtest 7)

| # | Ruling |
|---:|---|
| **D60** | **World scale: figures render at 1/8 of a cell** (playtest 7: "the road and buildings have to be much bigger scale, 8 or 12 times"). The ENGINE GRID IS UNTOUCHED — cells, movement, detection and pathing are exactly what they were; this is render scale, applied by manifest class from `tokens.scale` at build time (per-entry override for the dropship, a vehicle). Consequences held together: the sidewalk widened to 0.2 cells so the agent walks it alongside three others of his size — four 8x-scaled figures abreast, guard-tested against the sidewalk constant the renderer actually builds with; clutter re-proportioned to human scale (a drum is chest-high); beams dropped to waist height; a figure's ring follows the figure while cell-anchored rings (HQ, pins, re-spray) stay cell-sized; the default camera moved to STREET LEVEL (~10 cells across, zoom 4–70) because at this scale that is where the game is played, with overview one zoom-out or the minimap away. |

### Fifteenth decision batch (2026-08-23, playtest 8)

| # | Ruling |
|---:|---|
| **D61** | **The world doubles again: figures at 1/16 of a cell** (playtest 8: "let's try 16x, so we have room to add more agents later"). Engine untouched, as with D60 — one token. Default camera 6 cells across (zoom 3–70); every HUD ring now breathes with the zoom (a cell-sized emblem at street zoom read as a stadium); clutter, lamps and beams re-proportioned to the new human scale; the dropship approach shrank from 26 cells to 8 so the drop-in flight happens ON SCREEN. **The four walking positions**: on a road the agent renders at left sidewalk / left lane / right lane / right sidewalk — whichever lies NEAREST the straight line to the destination (the owner's rule) — slewed smoothly so kerb-hops and crossings are visible movement. Render-only and always inside the agent's simulated cell: gameplay stays cell-granular, so the honesty rule holds at the granularity the engine actually plays at. Agent only for now; rivals and patrols are a queued slice. Also under this batch: the landing rule keeps doors outside active CAMERA range (a camera six cells from the door noticed a spawn at tick 80 — patrol clearance alone was not clearance), and a refused informant purchase answers IN the dialogue, in character, instead of a technical toast. |

### Sixteenth decision batch (2026-08-23, playtest 10 answers)

| # | Ruling |
|---:|---|
| **D62** | **The playtest-10 omnibus.** (a) **Q44 closed — merged**: the safehouse's informant IS the handler; no separate handler actions exist, so separating the buildings would buy nothing. Revisit only if handler-specific dialogue is ever designed. (b) **Day-night commissioned**: spec drafts live in S03 (derived clock, watcher-side night sight factor — the NN% still needs a ruling) and S09 ("stay until nightfall" free at safehouses; **cubby holes at cost 10**, parked-agent mechanic, world time never skips). (c) **Walking, final form**: en route the operative keeps the SENSIBLE side — the right hand of travel, swapping through turns like a pedestrian — and the tapped kerb takes over within two cells of the destination, so arrival is still exactly where the player pointed. (d) **The wordmark** stands over the title diorama (yields on very short viewports — DROP IN never falls below the fold for a title's sake). (e) **The drop picker stops estimating**: the server sends one pick per district plus its landing, computed by the engine's own `hqLandingFor`, and the client deploys with the server's pick — the shown emblem is a promise. (f) **plan-version2 is M9–M14**; M8 keeps its name as the opposition milestone; slice ids 8a–8l untouched. (g) Patrol density batteries at 3 and 4 per district commissioned (n=24 x 60k local; the verdict is a battery reading, not a feel report). |

---

## Terminology Contract (D8)

Use these terms consistently in design docs, UI copy, and code identifiers:

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

---

## The World

### Setting

A near-future city-region. Corporate towers, industrial zones, port districts, transit lines, research campuses, and rural outskirts. The Firms operate in the gaps between official authority.

### World lifecycle

- A **world** is created from a seed and runs continuously on the server: 10Hz sim while any Firm is deployed; while empty, a single deterministic dormancy transition on next drop-in covers heat decay and contract refresh only — AI rivals do not progress while everyone is away (D16).
- Worlds last a **season** — fixed 4 weeks on the official sample world, configurable on self-hosts (D15) — then archive. Season-end standings feed a meta layer (V3).
- The seed defines the city's identity, per batch-a: block/road/alley structure, transit lines, district traits (industrial, residential, commercial, government, research, port), security density and patrol routes, corporation-owned and neutral sites. A good seed produces a *recognisable* city — "the divided waterfront with three bridges", "the surveillance-heavy business grid" — not just random terrain.
- The evolving state is the story: district heat, contract history, reputation standings, temporary closures and damaged facilities. Buildings can be changed or damaged by rival Firms and world events, and those changes persist — the world you re-enter is recognisably altered (D12).
- **Fog resets each drop (D12).** Nothing you scouted last deployment is remembered for you; only the ledger (reputation, tiers, bank) persists. Re-learning the current state of the city is part of every drop-in.

### Districts

The world is divided into **Districts** (3–5 per map). Each District has:

- A set of **Contract Sites** (mission targets)
- **Neutral infrastructure** (roads, transit lines, safe houses)
- **Rival Firm presence** (HQs of currently-deployed rivals, their agents)
- **Civilian traffic** (ambient NPCs — reuse of Fireline convoy/farmhand logic)
- **Authority patrols** (NPC guards — alarm-first doctrine)
- A **heat level** (see Detection & Heat)

### Scale

| Parameter | Value |
|---|---|
| Map size | **64×64 at V1 ship**; engine/mapgen/renderer stay 128×128-capable and tested at both (D26). Fireline grid: 256 fixed-point units/cell, entities at cell centres |
| Active Firms per world | 2–6 (V1: player + 2–3 AI rivals) |
| Agents per Firm | 1 lead (V1); 1 lead + up to 3 support or human squadmates (V2) |
| Contract sites per map | 12–20 |
| Districts per map | 3–5 |
| Tick rate | 10 Hz fixed |

---

## Control Model (D1)

### The lead agent (V1)

The player IS one agent. Direct, grid-based control:

- **Tap terrain** — move cautiously (default gait, low noise).
- **Double-tap terrain** — hurry (faster, noisier, wider detection profile).
- **Tap a site/NPC/object in range** — contextual action menu (infiltrate, plant, pick up, talk, bribe…).
- **Tap own HQ** — mission board, loadout, evac beacon.
- A persistent stance selector: `Sneak / Move / Hurry` governs the noise/speed tradeoff.

Movement, pathfinding, facing, and footprint reuse the Fireline systems unchanged.

### Support agents (V2)

Recruited AI teammates commanded batch-a style — high-level intents, never micromanagement:

- Tap support agent, then destination/target: they pathfind and act autonomously.
- Each support agent shows a visible **stance**: `Conceal / Return to HQ / Defend HQ / Follow lead / Low-risk route only`.
- When the player evacs or disconnects, support agents follow regency doctrine (default: return to HQ, then extract with it). This is the Fireline `ai_regency` module wearing a trenchcoat.

---

## Detection, Heat & Stealth (D6 — the core antagonist system)

This is the game's replacement for Fireline's front line. It is new design, built on the existing alarm-radius logic.

### Agent detection states

| State | Meaning | Trigger |
|---|---|---|
| **Unseen** | Nothing knows you're there | Default in fog / out of sensor radii |
| **Noticed** | A patrol or sensor has a contact; investigating | Entering a detection radius while moving; noise events |
| **Burned** | Identified and reported; alarm raised | Lingering while Noticed; taking hostile action while observed |

- Noticed decays back to Unseen if the agent breaks contact (leaves radius, stops moving in cover terrain).
- Burned triggers a **district alarm**: patrols converge, the agent is revealed through fog to Authority (and to any rival with intel taps in that district, V2+).

### District heat

Each district has a heat level (0–5) that rises with burned events, sabotage, snatches, and standoffs, and decays slowly over real time.

| Heat | Effect |
|---:|---|
| 0–1 | Baseline patrols on fixed routes |
| 2–3 | Extra patrols, wider sensor radii, some contracts pay more (risk premium) |
| 4–5 | District lockdown: checkpoints on roads, Tier 1 contracts suspended, informants go quiet |

Heat is world state — a rival Firm burning a district affects your operations there too. Heat is the shared consequence system that makes the world feel inhabited even before humans arrive.

**Visibility (D20):** players see a fuzzy 3-step indicator by default (calm / tense / lockdown). The exact 0–5 level is intel — revealed by informants or as a surveillance-contract reward.

### Disable-only combat

- Combat is short, risky, and loud (always raises heat; usually burns you).
- Damage downs an agent: **downed → crawl → rescued by a teammate OR captured by whoever reaches them** (direct reuse of the Fireline downed/recovery loop).
- Captured player agents are held at an Authority **Holding Site** or a rival HQ (reuse of the prisons module). Getting them out is an Extraction mission.
- A captured lead agent with no squad — player's choice of both exits (D17): **bail** (a tier-scaled percentage of banked resources; agent released) or **re-drop** (new callsign, flat reputation hit; the captured agent stays in the world as a rescue contract).
- NPCs are likewise only ever subdued (Snatch) or bypassed — never killed. Authority patrol figures that are subdued wake after a timer.

---

## Drop-In: The Dropship Sequence

Unchanged from the starter document, and confirmed as designed:

1. **Firm briefing** (10s, skippable) — terminal screen: firm, callsign, target district, objective.
2. **Drop zone selection** (15s) — fog-filtered top-down district view; valid zones marked clear of rival HQs and patrols; auto-select on timeout.
3. **Dropship animation** (~5s) — low-poly dropship on a scripted path; door, rappel, HQ crate deploys. Presentation-layer only; the server just registers HQ placement.
4. **Field HQ established** — command tent, flag, perimeter markers, mission board.

On a **return visit to a world** (D3/D7): the briefing screen additionally shows your ledger (reputation, banked resources, unlocked tier) and the world's news since last visit (heat changes, rival activity headlines).

---

## Field HQ

The HQ exists only while its Firm is deployed (D7).

| Component | Function |
|---|---|
| Command Tent | Visual anchor, mission board access |
| Firm Flag | Faction identity, visible when fog-revealed |
| Perimeter Sensors | Alarm-only (V1); alert the owner through fog on rival/patrol approach |
| Safe House Slots | Up to 3 additional agents bunk here (V2) |
| Resource Cache | Holds **unbanked** mission rewards — lost if the HQ is compromised, banked only on clean evac |
| Evac Beacon | Triggers the 30-second extraction sequence |

### HQ vulnerability

- Rival agent enters perimeter → alarm to owner through fog.
- Rival agent reaches the tent → HQ compromised, cache looted.
- HQ destroyed → emergency evac rules apply.
- The risk window is **only while you're deployed** — the raider must beat you in real time, not farm your sleep.
- Raids can hit your cache **wherever you are on the map** (D21) — but the perimeter alarm's countdown is generous enough to abort a mission and race home. The race home is the story.

**The cache/bank split is the session's tension arc:** everything you earn this deployment is at risk until you extract it. Stay longer for more, or bank what you have.

---

## Missions (Contracts)

### Structure

Contracts appear at **Contract Sites**. Each has a type, a difficulty tier (1–4), a reward (resources, intel, recognition), and optionally a time window.

**Economy (D18):** the world maintains a pool of **5 contracts per player slot** (a 16-slot world pools 80). Each present player's board shows **5 offers**, and concurrent players receive **disjoint offers** — nobody's board is the neighbour's leftovers, and a returning player always finds tier-appropriate work.

**Pacing (D11):** a single contract sortie — accept, travel, execute, return — should fit in 15–20 minutes. A normal deployment (drop-in to extraction) targets 40–60 minutes and 2–3 contracts. Tier 1 contracts sit at the short end so a tight-on-time player can still run one and bank it.

### Mission radius expansion

| Phase | Distance from HQ | Contract types | Risk |
|---|---|---|---|
| **1 — Local** | 0–8 cells | Courier, Surveillance, Extraction | Low |
| **2 — District** | 8–20 cells | Sabotage, Acquisition, Intimidation | Medium |
| **3 — Deep** | 20–40 cells | Vault Raid, Lab Infiltration, Snatch | High |
| **4 — Cross-District** | 40+ cells | Firm War, Territory Seizure | Very high (V2+) |

Completing contracts in a phase unlocks the next tier. **Tier unlocks persist in the world ledger** (D3) — a returning player resumes at their earned tier; the radius is measured from wherever their current HQ stands.

### Contract types

| Type | Loop | Reward | Version |
|---|---|---|---|
| **Courier** | Carry a package A→B without being burned | Resources | V1 |
| **Surveillance** | Reach site, hold N seconds unseen, extract with intel | Resources + intel | V1 |
| **Extraction** | Rescue a contact (or captured agent) from a guarded site — POW-rescue loop | Resources + agent back | V1 |
| **Sabotage** | Reach site, plant charge, extract before it blows | Resources + district effect | V1 (M6) |
| **Acquisition** | Steal an item from a guarded vault | Resources + tech nudge | V1 (M6) |
| **Intimidation** | Hold a rival-aligned site N seconds to send a message | Rep + heat | V2 |
| **Vault Raid** | Full heist — breach, loot, extract under pressure | Large payout | V2 |
| **Lab Infiltration** | Escort a scientist out of a guarded lab | Tech nudge | V2 |
| **Snatch** (replaces Assassination, per D6) | Subdue a target NPC, carry them out, extract | Recognition + rival debuff | V2 |
| **Firm War** | Open conflict with a rival HQ while both are deployed | Territory | V2/V3 |

### Mission board UI

```
AVAILABLE CONTRACTS                      DISTRICT HEAT: ▂▂▄░░

[TIER 1] Courier — Dockside → Warehouse 7         ★☆☆☆  12 min  +80 res
[TIER 1] Surveillance — Transit Hub Alpha          ★☆☆☆  open    +40 res +intel
[TIER 2] Sabotage — Rival Relay Station 3          ★★☆☆  8 min   +120 res
[TIER 3] Vault Raid — Corporate Tower B            ★★★☆  open    +300 res

SELECT CONTRACT (ENTER) | LOADOUT (L) | BACK (ESC)
```

---

## Firms

A Firm has a **name** (curated list below), a **color scheme** (HQ, flag, vehicles, uniform), a **doctrine** (V3 passive modifier), and a **reputation** per world (grows with completions, decays with failures and burns).

### Doctrines (V3)

| Doctrine | Passive effect | Playstyle |
|---|---|---|
| **Ghost** | Faster in fog; longer perimeter sensor range | Stealth, surveillance |
| **Iron** | Higher HQ HP; sensors suppress | Defensive, vault raids |
| **Blade** | Snatch missions pay double recognition | Targeted strikes |
| **Coin** | Courier/acquisition +25% resources | Economic play |
| **Veil** | HQ hidden from rival map intel | Counter-intelligence |

### Names (curated)

- **Authoritarian/Corporate:** The Directorate*, Iron Veil, The Consensus Bureau, Apex Standard, The Mandate Group
- **Insurgent/Independent:** The Outliers*, Freehold Collective, The Current, Wayfarers Inc., The Breakers
- **Neutral/Mercenary:** Greyline Solutions, The Compact, Dusk Operators, Frontier Associates, The Arrangement

*Shared with Fireline Command lore — see The Lore Bridge.

---

## Agents

| Attribute | Detail |
|---|---|
| Movement | Grid-based, Fireline cell system, stance-modified speed/noise |
| Visibility | Fog of war; agents have a sensor radius; detection per the stealth system |
| Equipment | Loadout selected at HQ before each sortie |
| Downed state | Crawl, await rescue or capture (Fireline crew loop) |
| Capture | Held at rival HQ or Authority Holding Site; rescued via Extraction |

### Loadouts

| Slot | Options |
|---|---|
| Primary | Suppressor (stealth takedown), Disruptor (disables alarms/sensors), Sidearm (loud, downs at range) |
| Tool | Satchel charge, Sensor jammer, Medkit, Grapple line |
| Vehicle | Light transport, Armored car, Motorbike (speed), Cargo van (carry capacity) |

Vehicles are painted-low-poly Fireline chassis, smaller and faster. Dropship is NPC-only.

---

## Drop-Out: The Evac Sequence

Unchanged from the starter document and confirmed: agent must return to HQ; beacon starts a 30-second hold; the beacon is **visible to nearby rivals through fog** (intentional interception window); timer pauses if the agent leaves the perimeter; HQ destruction downgrades to emergency evac (10s, cache lost); a downed agent cancels evac.

Dropship arrives, agent boards, **HQ crate folds and is winched aboard** (D7), debrief screen shows the session summary and writes the ledger: cache → bank, recognition, reputation delta, tier progress.

### Emergency evac

HQ destroyed while afield: 60 seconds to reach any safe zone (neutral site or map edge). Cache lost to the raider; recognition preserved; minor reputation hit.

### Squad evac (V2)

All squad agents must be inside the perimeter when the dropship lands. Anyone left behind is downed in place and becomes an Extraction contract for a future drop-in. One paid return trip is available (60s + resource fee). "Don't leave anyone behind" is a real decision under pressure — this is the emotional beat of the squad game.

---

## Crossing Paths: Rival Encounters

Encounters happen at contested contract sites, HQ raids, roads, and rival territory transit. Proximity does not mean automatic combat:

| Option | Effect |
|---|---|
| **Ignore** | Continue; fog applies — you saw them, they may not have seen you |
| **Shadow** | Follow without triggering alarm; earn intel |
| **Intercept** | Block their path; forces a standoff |
| **Engage** | Disable-only combat; loud; heat |
| **Negotiate** | Propose a timed non-aggression pact (both must agree) |

### Standoff (choice UI from V1, per D22)

Two agents in the same/adjacent cells → 10-second standoff timer; both see the other's Firm and reputation; both choose Engage / Withdraw / Negotiate. Both engage → combat. One withdraws → clean exit. Both negotiate → 5-minute pact. The standoff is this game's front line — the moment of maximum tension and agency.

In V1 the player gets the full choice UI and the AI rival answers by deterministic policy; V2 swaps the counterpart for a human without changing the protocol.

---

## NPC World

Same doctrine as Fireline: NPCs add texture without stealing the show.

### Building entry (D9)

The world is exteriors-only, but interactive buildings have an entrance cell. An agent at the entrance can **enter**: their figure disappears inside (parked at the entrance, hidden from rival view), and the client opens an overlay — a **dialogue panel** with options (quest givers, informants, officials) or a **shop menu** with a static portrait (vendors). Time keeps running in the world while you're inside; the perimeter can still be watched. No interior maps, rooms, or indoor combat — interiors as simulated spaces are a separate V2+ decision (Vault Raid presentation).

| NPC | Behaviour | Effect | Version |
|---|---|---|---|
| **Authority Patrols** | Fixed routes, alarm-first | Detection pressure; the stealth antagonist | V1 |
| **Civilian Traffic** | Roads, flee from incidents | Fleeing civilians reveal movement to everyone | V1 |
| **Informant** | In a safe house (enter building, dialogue) | Reveals a rival HQ location (when one is deployed) | V1 (M5) |
| **Street Vendor** | In a market building (enter building, shop menu) | Trade banked/cache resources for equipment upgrades | V1 (M6) |
| **Neutral Trader** | Fixed cross-map route | First Firm to escort gets a resource packet | V2 |
| **Corrupt Official** | Authority building (enter, dialogue) | Bribe: patrols disabled in district for 3 min | V2 |
| **Scientist** | Lab site | Escort to HQ for a tech nudge | V2 |

---

## Art Direction

Painted Low-Poly Hybrid, shared pipeline with Fireline Command: same terrain tile system (extended with urban tiles), same building silhouettes adapted to corporate/urban context, same color token system, same procedural-sprite/asset-strip tooling.

### New art required

Dropship; Field HQ compound; agent figures (3 variants per faction); Firm vehicles (light transport, armored car, motorbike, cargo van); contract-site markers per type; urban tiles (corporate tower, alley, transit hub, market, checkpoint); Authority patrol figure.

### Firm palettes

| Type | Primary | Secondary | Accent |
|---|---|---|---|
| Corporate/Authoritarian | Slate gray | Police blue | White |
| Insurgent/Independent | Terracotta | Sun-bleached tan | Teal |
| Mercenary/Neutral | Charcoal | Warm gray | Amber |
| Ghost doctrine | Deep navy | Pale cyan | Silver |
| Blade doctrine | Dark red | Black | Gold |

### Splash

Command-boot-sequence terminal (Fireline Concept 2 adapted):

```
SHADOW MANDATE
FIELD TERMINAL v1.0

WORLD ................... [SEED NAME]   DAY 12 OF SEASON
ACTIVE FIRMS ....... 4
CONTRACTS AVAILABLE ..... 17
YOUR FIRM .......... [NAME]        REP ████████░░
FIELD STATUS ............ UNDEPLOYED

DROP IN? (ENTER)
```

---

## i18n

Key-identical `en`/`no` catalogs from day one, enforced by test (Fireline practice — a missing key in one locale is a red suite).

---

## The Lore Bridge

Shadow Mandate and Fireline Command share a world. The Directorate and The Outliers fight the open war in Fireline Command; in Shadow Mandate they operate the covert layer behind it. Shared universe, no shared server. The same map seed can appear in both games with different activity layers visible to each.

> **In Fireline Command, you hold the front.**
> **In Shadow Mandate, you work the shadows behind it.**
