# S16 — Opposition & Site Security

*Feeds: M8 · Depends on: S03, S04, S07, S08, S09 ·
Status: **8a/8b/8c AS BUILT** (staged alarms, camera cones, sensor beams); 8d–8j specced*

## Purpose

**Contract attractiveness is balanced by opposition, not by price (D42).**

The M7 pacing battery found extraction over-chosen and the instinct was to keep
cutting its payout. That was the wrong lever. Extraction and acquisition are the
two types that are *supposed* to get harder as a season progresses, and the
difficulty that will make them dangerous does not exist yet: there is no rival
team that turns up to contest a contact, and no facility that notices you. Cut
the reward now and it only has to be undone later.

So this spec is where that difficulty goes. Nothing here is implemented. It is
written now so the balance conversation has somewhere to point, and so the
engine constraints are agreed before anyone starts.

## Two families

**(a) Live opposition** — rival Firms that turn up and contest the same
objective. Extends S07 (AI Firms) and S08 (Standoff).

**(b) Site security** — alarms, sensor lines, cameras and lockdowns that make a
facility a place you *solve* rather than a cell you stand on. Extends S03
(detection/heat) and S09 (building entry).

The design touchstone the owner named is the 1993 Bullfrog squad game — teams
converging on the same objective in a top-down city. Note the terminology
contract (D8): that title must never reach a shipped artifact. It is a
reference in design docs only, and `test/guards.test.js` scans `engine/`,
`shared/`, `server/`, `client/`, `data/`, `tools/` and `debugging/` for it.

The full mission corpus is surveyed in `specs/08_reference_mission_taxonomy.md`.
Two findings from it bear directly on this spec:

- **A defended snatch is the contract S16 unlocks.** D6 already replaces the
  reference's largest mission family (assassination) with Snatch — capture and
  extract the target. A *defended* snatch needs every part of the opposition
  layer at once: access control to reach the target, a staged alarm while you
  get them out, and a plausible reason for a rival team to be there too. It is
  the natural showcase for slice 8f.
- **The reference's best missions are all guarded-facility variants**, which is
  independent confirmation that the security layer is the prerequisite for the
  content, not the other way round.

---

## (a) Live opposition — contested contracts

Today a rival Firm working the same contract is a coincidence. It should be a
scheduled event.

**Contested contracts.** A contract may be offered to more than one Firm at
once, flagged as contested on the board so the choice is informed: better pay,
someone else is coming. First to complete it takes it; the loser fails, or
switches to contesting.

**Telegraphed arrival.** The rival team's approach is announced before it
lands — the dropship choreography from S05 already exists for this, and it is
presentation, not simulation. A rival team that materialises unannounced reads
as unfair; one you can hear coming is a decision about whether to hurry, hide,
or set up.

**Interaction with standoff (S08).** The current standoff is 1v1. Contested
objectives will put more than two agents in a cell cluster, so either standoff
generalises to N-way, or contested encounters resolve as a sequence of pairwise
standoffs in a pinned order. **Pairwise-in-a-pinned-order is the cheaper and
more deterministic option and is the proposal**, because an N-way simultaneous
choice is hard to present in the 10-second window and harder to make legible.

**Disable-only still holds (D6).** A contested extraction ends with somebody
face-down and their contact walking away with the other Firm, never with an
entity deleted. This is guard-enforced and is not negotiable for a difficulty
feature.

---

## (b) Site security — the stealth layer

Each is a mechanism the player learns, then plans against. All are
**deterministic and cyclical**, because a stealth obstacle that fires randomly
is a tax, not a puzzle.

| Mechanism | Behaviour | Counter-play |
|---|---|---|
| **Sensor line** | A beam between two emitters across a corridor, cycling on/off on a fixed tick period. Crossing while live raises the alarm. | Time the gap; disable an emitter with a tool; cut power at the junction. |
| **Camera** | A vision cone sweeping a fixed arc on a fixed period. Feeds the SAME detection currency as patrols (S03) rather than inventing a second one. | Stay out of arc; cross behind the sweep; disable; a disguise (D38) that survives a glance. |
| **Access control** | Doors and interior rooms gated by a credential tier. | Credential bought from an informant, sold by a vendor (S09), or lifted from a disabled guard. |
| **Junction box** | Cutting power blacks out sensors and cameras in a zone for N ticks. | Free of charge in stealth terms, but the blackout itself is noticed — it raises district heat (D20), so it trades a local problem for a global one. |
| **Alarm** | Escalates in **stages**, never instant failure. | Stage 1 local: nearby guards converge. Stage 2 lockdown: doors seal, exit routes change, the crack timer keeps running. Stage 3 district: checkpoints, heat spike. |

**Why staged alarms.** An instant-fail alarm makes the correct play "reload",
and there is no reload in a persistent shared world. Staged alarms turn a
mistake into a worsening situation the player is still inside — which is the
tension the game is for, and which is also what fills the D11 sortie minutes
that D41 says must come from content rather than slower walking.

**This is where acquisition and extraction get their difficulty.** Acquisition's
`crackTicks` currently elapse in a quiet street; they should elapse inside a
secured facility with an alarm climbing. Extraction's contact should be behind
access control rather than standing on a cell. Neither type needs a reward
change once that is true (D42).

---

## Engine constraints (agree these before writing code)

Non-negotiable, from the existing doctrine:

- **Deterministic**: cycle phases derive from `state.tick` and seeded values.
  No `Math.random`, no wall clock. Sensor and camera periods are integers.
- **Integer fixed-point**: cones and beams are computed in the existing
  256-units-per-cell space. No floats anywhere in `engine/`.
- **Disable-only (D6)**: no security mechanism may produce an entity-deletion
  event. Guard-enforced.
- **Acyclic module graph**: security reacts to events in the reducer rather
  than importing across subsystems. Alarms feed heat the way burns already do.
- **The four places**: any positional security state (emitter cells, camera
  origin/arc) must be added to `copyState`, `engine/snapshot.js`,
  `test/fixture_hash.js`, and `engine/mirror.js` `POSITIONAL_FIELDS`. The
  MIRROR AUDIT fails on an undeclared `x`/`*X` field, and a missed mirror field
  silently invalidates every future battery.
- **Views cross the wire, state does not**: a client must not be sent a camera's
  full schedule, or the whole stealth layer is solved by reading the socket.
  Send what the agent can currently perceive — and note that this makes
  "learnable pattern" a *fog* problem, not just a data problem.
- **Tick order is a contract**: security perception belongs inside the existing
  perceive step, not as a new stage, or the pinned call sequence in
  `test/contracts_engine.test.js` changes and every fixture re-pins.

## Challenge is diegetic — RULED (D45)

**Every challenge is solved with the agent in the world. No modal panels, ever.**

A mini-game that opens a separate screen fights drop-in/drop-out at the root: the
world runs at 10Hz with other players in it, so a modal puzzle either freezes one
player while the world moves around them, or pauses nothing and gets them
captured while they stare at a widget.

So the "puzzle" in every mechanism above is spatial and temporal:

| Instead of a modal... | ...the challenge is |
|---|---|
| a lock-picking widget | finding the credential, or the guard carrying it |
| a wire-cutting puzzle | reaching the junction box unseen, and paying the heat |
| a hacking rhythm game | holding position inside the crack timer while the alarm climbs |
| a laser-maze overlay | timing the sweep, in the street, with the cycle you learned |

This applies to all future difficulty content, not only S16. It also means a
challenge must stay legible to a spectator and to a second player standing next
to it — if it cannot be watched, it is the wrong design.

## Defend: both a contract and an event — RULED (D49)

The owner ruled **both** halves of Q39, and they are not alternatives — they are
the chosen and unchosen versions of the same fiction.

- **The event (8i).** Rival raids happen to your Field HQ **unprompted**. This
  is what makes an HQ a place worth defending at all, and it teaches the
  mechanic before anyone is asked to sell it. D28 already rules that evac
  activation is always allowed because "the hold is the fight", and Q20 already
  established that rival Firms run their own missions.
- **The contract (8j).** Defend then joins the board as a sixth type, so a
  player can *choose* the job. It is the only contract where **being seen is not
  automatically failure** — a genuinely different texture in a stealth-first
  game — and the only one that is naturally co-operative for a second player who
  drops in mid-session.

Shipping only the event would mean you can never choose it; only the contract
would mean an HQ is attacked strictly by appointment. Both, in that order:
8i teaches the threat, 8j sells competence against it.

## Not decided

- Whether contested contracts are opt-in (a "contested" board flag you accept
  knowingly) or assigned.
- Whether a Defend contract's attackers are a real rival Firm's agents or a
  scripted force — the first is more honest, the second is schedulable.
- Whether site security is per-site static or generated per contract.
- Whether a blackout should be usable offensively against a rival Firm's
  in-progress contract.

---

## AS BUILT — 8a, staged alarms (2026-08-06)

`engine/security.js` + `data/security.json`. The escalation machine, shipped
**with no new way to trigger it**: alarms are raised from the burn events
detection already emits. That was deliberate — it makes the state machine
testable before anything can raise it, so 8b/8c add a trigger to a machine that
is already proven rather than debugging both at once.

Stages 0 clear → 1 local → 2 lockdown → 3 district. Escalates while a burned
agent stays within `radius` of the site; eases **one stage at a time** after
`calmTicks` of quiet; leaves the collection entirely at clear. Reaching stage 3
spikes district heat exactly once.

**Hash-inert by construction.** Alarms are their own collection rather than
fields on every site, so a world with nothing wrong writes no alarm bytes and
hashes exactly as it did before this file existed — no fixture re-pin, no era
bump. The counterpart obligation: `test/fixture_populated.test.js` now raises an
alarm, because a hash-inert collection is only compared between the twin hashers
while it is non-empty. **That hole had already reappeared once** — the twins'
alarm writers were completely uncovered by the whole suite until the fixture was
populated, which is the same defect that file was originally written to close.

**Tick placement**: between `stepDetection` and `stepHeat`. Alarms are a
consequence of being seen and a source of heat, so they sit between the two;
running them after `stepHeat` would delay every district spike by a tick and let
the same tick's decay cancel a spike that had just been earned. The seven
functions the tick-order contract pins are untouched and still in order.

**The view is fogged.** A site's alarm stage is reported only when the Firm can
currently see the site. Knowing every alarm in the world would hand the player a
free map of where every rival Firm is working — the stealth layer is a fog
problem before it is a data problem. Out of sight reports stage 0, identical to
clear: the view deliberately cannot distinguish "clear" from "I cannot tell".
The internal escalation clock never crosses the wire, or a tense situation
becomes a countdown widget and a scripted client plays perfectly.

### Two findings

**The alarm radius must stay below citygen's site `minSpacing`.** At radius 6
against a spacing of 5, one burn woke every neighbouring facility at once, so
the player could not tell which building had reacted to them and the alarm read
as weather rather than as consequence. Radius is 4 and a test asserts the
relationship, so a future citygen spacing change cannot silently undo it.

**Stage 3 is currently unreachable in play, and that is correct.** A 6-seed
world-day probe (`debugging/dbg_alarms.mjs`) shows the machine working — 12
burns produced 10 raises, 4 escalations to lockdown, all eventually cleared —
but never stage 3, which needs 900 ticks of *continuously* being burned beside a
facility. A burned AI agent evacuates or is arrested long before that. **Do not
tune the numbers to force it.** Stage 3 is designed for the scenario 8f builds:
an acquisition `crackTicks` timer elapsing INSIDE a secured facility while the
alarm climbs. Tuning it reachable now, against absent content, is the same
error D42/D43 rule against for contract rewards.

## AS BUILT — 8b, camera cones (2026-08-06)

`engine/cameras.js` + `citygen.cameras` config. A camera feeds the **existing**
detection currency: being caught on camera makes you noticed and then burned
through the machine patrols already drive. A parallel "camera suspicion" track
would have doubled every balance question for no design gain.

The sweep is a **triangle wave over octant offsets**, derived from `state.tick`
— pure, integer, and expressed as a learnable sequence ("left, centre, right,
centre") rather than trigonometry, because timing a crossing is the mechanic.
Facing is derived, never stored. Cameras are staggered by a `phase` so a
facility's cameras do not sweep as one: synchronised cameras leave a single
global safe moment, a much weaker puzzle than several overlapping ones.

A camera that sees anyone raises **its own site's alarm immediately**, whatever
the agent's detection state — that is the difference between a street and a
facility. A patrol seeing you is a person noticing; a camera seeing you is the
building noticing, and the building acts at once. The 8b→8a seam is read from
the events detection emits, so the module graph stays acyclic
(`detection → cameras → agents`; cameras imports no detection code).

**Camera ids and patrol ids are different id spaces**, so `agentNoticed` now
carries a tagged observer (`patrolId` / `cameraId` / `siteId`, unused ones -1)
rather than cramming both into `patrolId`. A consumer that guessed would
converge patrols on a camera's position.

### The placement rule, learned by breaking it

**A camera stands off its site and looks AWAY from it.** The first version
mounted cameras on the objective cell, where coverage is unconditional at
distance 0 — so the site was watched every tick, **surveillance could never
complete anywhere in the world**, and the AI burned itself repeatedly trying. A
camera with no gap in its cycle is a wall, not a puzzle.

The geometry makes this provable rather than hopeful: facing directly away puts
the site at facing+4 octants, and with `arc` 1 and `span` ≤ 2 the cone comes no
closer than 3 octants. `test/cameras.test.js` walks a full sweep cycle for every
camera in three cities and asserts the site is never covered, so widening the
arc or span in data cannot silently make site work impossible again.

Only `sitePercent` of sites are watched. A city where every site is watched
removes the choice of which job to take, and D42 wants opposition to make *some*
contracts harder rather than all of them uniformly harder.

**The view never carries the schedule.** Span, dwell and phase never cross the
wire — with them a client computes every future safe window and plays the
stealth layer perfectly without looking. Only position, current facing, arc,
range and a disabled flag are sent, and only for cameras the Firm can see.

### It found a pre-existing AI bug

Cameras made burns common, and 213 `move:no_route` rejections appeared. The
cause predates cameras entirely: **three of the AI's five move commands targeted
the HQ with no reachability guard**, and the "burned and the district is hot,
break off" path had no in-progress check either, so a burned agent re-ordered
the same move every cadence tick. All three now guard, and the AI is back to
zero rejections. The rejection log found it, exactly as it did in M5.

### The camera has to be VISIBLE (8b, client half)

A stealth obstacle the player cannot see is not a puzzle, it is an ambush, so
the camera ships with its visual in the same slice. Added through the pipeline
(D46) rather than to the renderer: a `camera` builder in `asset_factory.js`, two
manifest roles (`camera`, `cameraDisabled`) whose tint is the LENS, so a
disabled camera goes dark without rebuilding the model. Drawn in the diorama
with its facing, and dotted on the radar — knowing where the watched ground is
is half of planning a route around it.

**The rotation was off by PI and would have shipped.** `octantToRadians` first
read `-PI/2 + octant * PI/4`, which points every camera at its own back. A
camera facing exactly the wrong way renders perfectly and reads as plausible set
dressing — nothing in the game complains, the player is simply caught by cameras
that appear to be looking elsewhere. Caught by deriving it against the eight
unit vectors instead of eyeballing it (barrel is +Z; `rotation.y = t` sends +Z
to `(sin t, 0, cos t)`; engine +y is south and maps to scene +z), and all eight
octants are now pinned in `test/cameras.test.js`.

**The gallery earned its place again, twice.** `test/art_pipeline.test.js` fails
if a manifest role is missing from the gallery, so the new visual could not ship
unreviewed. And looking at the render showed the first model — a thin post with
a 0.055 lens — was legible at 1200px and unreadable in the diorama, where the
one thing a player must read is which way it looks. Wider housing, longer
barrel, a brow over the lens, and a lens twice the size: 138 triangles against a
260 budget.

## AS BUILT — 8c, sensor beams (2026-08-06)

`engine/sensors.js`. The first mechanism whose counter-play is **pure timing**: a
camera can be walked behind, a beam has no behind. It is on or off on a fixed
integer cycle, and the whole puzzle is the gap.

**What a beam knows, and what it does not.** A camera SEES you and feeds the
detection currency. A beam only knows that *something* crossed it — so it raises
the facility's alarm and deliberately leaves your detection state alone. You can
trip a beam and still be unseen, which is a genuinely different texture and
creates the real decision: trip it and hurry, or wait for the gap.

Beams are laid ACROSS an approach at `standoff` cells out, never through the
objective — the lesson 8b paid for, and asserted for every beam in three cities.

### The gap has to be crossable, and the first tuning wasn't

`offMin` started at 25 ticks. Crossing a beam means stepping INTO its cell and
out again — two cell-moves at ~28 ticks each — so **no one could ever have
crossed one**, and the mechanism would have read as a random punishment rather
than as something to time. That is the precise failure a timing mechanism cannot
survive. The dark window is now 70–100 ticks, and the test checks it against
`agents.baseSpeed` rather than a literal, so a movement retune cannot silently
make every beam uncrossable.

**The view carries the endpoints and whether it is live right now — never the
cycle.** `onTicks`/`offTicks`/`phase` would let a client compute every future
gap and cross perfectly without watching, deleting the only mechanic whose
counter-play is timing. A dark beam is still DRAWN, at low opacity: you must be
able to see where the line is in order to plan a crossing through it.
