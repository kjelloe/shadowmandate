# S17 — Mission Areas ("the minigames that are places")

*Status: SPEC DRAFT (2026-08-23, owner-directed). Nothing built. Revises D45.*

## The ruling this implements (D63)

Playtest 12: "just waiting for extraction and surveillance to go up is no
good gameplay." Missions gain a PLAYABLE inside: a "BEGIN EXTRACTION" /
"BEGIN SURVEILLANCE" action at the site fades the street map and takes the
operative into a 3D mission area — sneak past guards, bloodless takedowns,
hack terminals to kill alarms. Inspiration: the stealth-game canon, with
this project's disable-only doctrine (D6).

**D45 is revised, not repealed.** D45's objection was to MODAL minigames
that pause a shared 10Hz world. The owner's own design dissolves it: mission
areas are LIVE SHARED SPACES — they run on the same world tick, and other
players (or AI Firms) can enter the same area mid-mission to sabotage or
help. Nothing pauses; drop-in/drop-out survives; the area is a PLACE, not a
screen. The long goal is the proof: a multi-team assault on a Firm HQ,
several squads inside one area on offence and defence at once.

## Architecture (the parts that must be true from day one)

- **Same engine, same tick.** An area is engine state: `areas[]` keyed by
  siteId, with its own small grid (authored template per site type,
  deterministic from world seed + siteId), guards, terminals, and occupants.
  `applyAdvanceTick` steps areas after the street layer. All the doctrine
  holds: pure reducer, fixed-point, disable-only, four-places for any
  positional state, hash-inert while empty.
- **Entry/exit are commands.** `enterArea` at the site (replaces the passive
  work timer for extraction/surveillance), `exitArea` at the area's door
  cells. An agent in an area is `insideAreaId >= 0` — off the street exactly
  like `insideBuildingId`, invisible to street-level rivals, but VISIBLE to
  other occupants of the same area.
- **Shared by construction.** The view gains an `area` block (the area the
  firm's agent occupies: local grid, visible guards/occupants/terminals,
  fog'd by area sight). Another player who walks to the same site and enters
  joins the SAME area state. AI Firms use the same commands — a rule the
  actor does not know is a rule nobody follows.
- **Detection continuity.** Being seen inside feeds the SAME detection
  ladder (unseen/noticed/burned) and district heat; a blown mission area is
  a blown street presence. Alarms inside are S16 alarms — terminals are
  junction-box cousins that suppress area cameras/alarm stages.
- **Takedowns are disable-only** (D6): a from-behind takedown puts a guard
  down exactly like combat does (crawl/recover applies); no deletion event
  can exist. Guards carry credentials (8e) — the lift mechanic works inside.
- **The street mission types keep their contracts.** The contract machine's
  stages gain an `IN_AREA` work stage for extraction and surveillance; the
  reward/effort pricing (D53) is retuned only after the areas play, per the
  batteries — not before (D42's lesson).

## The first slice pair (owner: "both at once")

- **AR-a Extraction area**: reach the asset through a guarded interior,
  carry it out. Toolkit: guard patrol loops with vision cones, two takedown
  spots minimum per template, one terminal that kills the area's cameras
  for a window, one alternate exit.
- **AR-b Surveillance area**: reach a vantage, stay unseen through a hold
  timer that TICKS ONLY WHILE UNSEEN — waiting becomes hiding, which is
  gameplay. One guard sweep crosses the vantage per cycle, forcing at least
  one reposition.
- **AR-c Shared entry**: second occupant support (help or sabotage), the
  occupancy view rules, and the standoff question inside areas.
- **AR-d Terminals & alarm depth**, **AR-e AI Firms run areas**,
  **AR-f the HQ assault** (multi-team, the long goal) follow.

## City life (same directive, separate track)

More patrols (done — 4/district, battery-verified), plus CIVILIANS walking
the streets minding their own business and scattering from trouble, and
sci-fi hover cars on the avenues. Civilians and cars are AMBIENT
world-layer life — spec question: engine entities (they can be seen by
patrols? they react to real alarms honestly) versus client-side deterministic
theatre (cheap, but a "person" the sim cannot see is a lie the honesty rule
has so far refused). Proposed: ENGINE-side lightweight ambient agents with
no detection participation except flee-from-alarms — visible to everyone,
never watchers. Needs its own slice and a Q ruling on density/perf.

## Answered (D64, 2026-08-24)

1. **Compound scale**: ~24x16 areas with outdoor courtyards between wings.
2. **Burned inside: play on** — detection inside escalates the area's alarm
   stages (lockdown pressure), never a fail-and-eject.
3. **PvP takedowns inside: YES** — a rival can put you down and leave you
   for the guards. That is what sabotage means.

## Ambient city life — proposed numbers (D64 delegated)

- **Civilians**: engine-side ambient walkers, `perDistrict: 8` (24 on a
  64-map — twice the patrol count, so streets read peopled), roaming street
  and plaza tiles on short seeded routes; they FLEE (hurry away from) any
  cell with an active alarm stage or a burn event within `fleeRadius: 6`;
  they are visible to everyone, never watchers, and never targets (D6 has
  nothing to say to them). Perf: one instanced figure class, same movement
  stepper as patrols; step every 2nd tick to halve cost.
- **Hover cars**: 2 per district, transit avenues only, pure spline-riders
  at kerb-flying height with a headlight cone; despawn/respawn at map edges.
  Client-side theatre is ACCEPTABLE here (unlike civilians they never react
  to the sim) — deterministic from seed, drawn by the road layer.
- Both wait behind the mission-area slices unless the owner reorders.
