# S16 — Opposition & Site Security

*Feeds: M8 · Depends on: S03, S04, S07, S08, S09 ·
Status: **8a–8k AS BUILT**; 8h re-run after 8k — most of D19 is now readable*

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

## AS BUILT — 8d, junction boxes (2026-08-06)

`cutJunction` in `engine/security.js`, command `CMD_CUT_JUNCTION` (43). **D45 in
one mechanism**: the answer to a camera is not a lock-picking widget, it is
walking to the box and cutting it, in the world, in time.

**The trade is the whole design.** Cutting is FREE in stealth terms — no noise,
no burn, the site alarm is not raised — but the blackout is noticed, so it costs
district heat. A local problem swapped for a global one. Without that cost the
correct play would always be "cut every box first" and the stealth layer would
collapse into an errand; the test asserts the cost exists rather than trusting
the number.

You must be **adjacent** to the box: cutting from across the street would remove
the reach-it-unseen half of the puzzle, which is the interesting half. The
blackout **ends** — it is a window, not a solution — and a box cannot be re-cut
while already down, or the heat is paid once and the blackout extends forever.

Junctions are **derived from what was actually placed**, one per site that has
cameras or beams. A switch with nothing behind it is set dressing that looks
like a mechanic.

Every refusal carries a reason (`no_junction`, `not_active`, `not_adjacent`,
`already_cut`) — a control that silently does nothing is the defect playtest 1
shipped, and the AI rejection log is how this project finds AI bugs.

### 8d client half — and a fourth palette copy

The mechanism was fully tested and completely **unreachable**: no visual, no
control. Both ship now — a `junction` builder through the manifest (amber live,
dark cut), a CUT POWER button that appears only when the operative is adjacent,
and the adjacency RULE in `models.js` so the client and engine cannot disagree
about what "at the box" means. A button that offers what the server will refuse
is worse than no button. Security events (`beamTripped`, `alarmRaised`,
`alarmEscalated`, `junctionCut`) are toasts now too: a facility that quietly
decides to escalate while you work is exactly the invisible difficulty D45
forbids.

**Found on the way: a FOURTH copy of the tile palette**, in `main.js`'s
drop-zone map preview. The 7a-4 guard scanned `scene.js`, `minimap.js` and
`terrain3d.js` and never looked at `main.js` — so it was green while the defect
it exists to prevent was still present in a file it did not read. **A guard only
protects what it reads.** The palette now comes from tokens there too, and the
guard scans all four surfaces.

## AS BUILT — 8e access control + 8f secured facilities (2026-08-06)

`engine/access.js` and the site `securityTier`. **8f is the slice D42 was
waiting for**, and it delivers: acquisition and extraction now happen inside a
facility that is reacting rather than in a quiet street.

### 8e — credentials

**Correction (found while starting 8k):** the guard source shipped
UNREACHABLE. `liftCredentialFromGuard` was written and tested, but no command
ever called it — so of the three sources described below, only the two bought
ones (informant, vendor) actually existed in the game. A function with tests and
no caller looks exactly like a working feature. 8k adds `CMD_LIFT_CREDENTIAL`
and makes it real for players and AI alike.

The lock whose counter-play is not a widget. Three sources, all diegetic: an
informant sells one (tier 1), a vendor stocks one (tier 2), or you **lift one
off a guard you disabled** (tier 1). The guard source is the one that makes the
system breathe — it turns a patrol from a thing to avoid into a thing you might
deliberately seek out.

The guard tier is deliberately the LOWEST. If a lifted badge opened everything,
buying one would be pointless and two of the three sources would be dead
content; a test asserts the bought tier exceeds the lifted one.

Credentials are **per-agent and per-sortie**: a Firm cannot buy one card and
walk every operative through the door, and the card is lost on capture and on
extraction. That keeps them a thing you plan around rather than a permanent
unlock — the same reasoning D50 applies to upgrades one level up.

**S04 had no notion of a disabled guard.** The disruptor set `alertTicks = 0`,
which is exactly what an untroubled patrol looks like, so nothing downstream
could tell "I put this guard out" from "this guard was never bothered". It now
stamps `stunnedUntil`, and `isDisrupted` is the single named predicate both
systems read.

### 8f — secured facilities

A site's `securityTier` is **derived from the fixtures actually placed** (a
camera or a beam → tier 1; both → tier 2), so a facility can never demand a
credential while standing wide open, or stand watched while letting anyone walk
in.

**Working inside a secured facility climbs the alarm on its own, unseen or
not.** This is the D42 wiring: acquisition's crack timer now elapses with an
alarm rising, and it is the first thing in the game that reaches **alarm stage
3 in ordinary play** — the stage 8a shipped as deliberately unreachable.

Measured over six world-days: escalations 5 → 14, and stage 3 reached on three
seeds. **Seed 1274 reaches stage 3 with ZERO burns** — pure secured-facility
work, which is precisely the mechanism that did not exist before.

Only D42's two types are **gated** (`requiresCredential`), because gating every
type would make all contracts uniformly harder and flatten the mix D19 measures.
The alarm, by contrast, climbs for *any* work at a secured site — the facility
notices anyone doing anything at it, which gives a surveillance hold at a
watched building real texture without gating it.

### Two things measured rather than assumed

**The secured share.** Camera and beam placement roll independently, so their
shares compound: 35% + 25% produced **56–80% of sites secured** — "most
contracts harder" rather than D42's "some". Retuned to 20% + 12%, giving ~31%,
and the range is asserted across five seeds because this is the number that
decides whether opposition is a texture or a wall.

**Extraction's completion share moved ~63% → ~51%** across six seeds without a
single reward change — the D42 prediction, showing up. **This is a direction,
not a verdict**: six seeds convict nothing, and 8h re-runs the real battery.

### Follow-up, tracked honestly

**The AI cannot obtain a credential.** It never enters buildings and has no
doctrine for disabling a guard to lift a badge, so it simply declines secured
extraction and acquisition. The M5 gate caught this the moment 8f landed —
"the world is not alive" — which is the M6 acquisition-0% defect recurring:
a rule the actor does not know is a rule nobody follows. The rule now lives in
ONE place (`requiresCredential`) that both the contract machine and the AI
scorer import.

**CLOSED 2026-08-27 (owner-ruled, slice AI-1).** The AI BUYS credentials now:
the payBail cache route reached dialogue/shop purchases (isAi-scoped — D30
keeps players bank-only), the scorer nets the content's badge price off the
reward and declines only unaffordable/unpurchasable work, and aiDecide runs
the errand with player commands (walk, enter, buy, leave). Reachability was
the whole battle, twice: a pre-existing "indoors → leave" early rule fired
before the buy branch (536 enter/exit pairs, zero purchases), and the SCORER
gate itself had been dead since D51 — it read securityTier off a synthetic
objective object that never carried one, silently accepting secured work all
along. Both found by driving decides through the real reducer. The guard-lift
source remains OFF (measured pure cost); the AI also waits at the door for
NIGHT when it is at most waitForNightTicks away (D63a follow-up).

The honest consequence is that secured work is currently **player-only**, so the
AI experiences 8f as *reduced supply* of easy extraction rather than as danger.
That is a real D42 effect but a smaller one than intended, and teaching the AI
to buy or lift a pass is the first thing 8g should carry.

*(Unrelated to 8f but noted from the same sweep: `off_acquisition` is 0 across
seeds — acquisition is never offered to a tier-2 AI at all. That is D19 tier
gating working as documented, not a regression, and belongs to 8h.)*

## AS BUILT — 8g, contested contracts (2026-08-06)

A contract offered to several Firms at once, flagged on the board, paying a
premium for it: better money, and someone else is coming. A minority of the
pool (~18%) on purpose — if most work were contested the board would stop being
a choice and every sortie would be a race.

**This narrows D18, and the narrowing is the point.** D18 promises disjoint
boards so nobody walks across the city for a job that was never theirs. A
contested contract keeps that promise by *saying so*: it is flagged, it pays
more, and the view reports how many rivals are on it. What must never bend is
the other half — an UNFLAGGED contract on two boards — and a test now asserts
exactly that across three seeds. **This is a real change to D18's scope and is
flagged for the owner** rather than assumed.

**The finisher is paid, not the first taker.** `acceptedBy` stays the first
taker so every existing reader keeps working, but `contenders` is the authority
and whoever completes it is credited. Paying the first taker for someone else's
work would be the quietest possible way to make the whole race pointless.

**Losers are told and released** (`contractLost`): an objective that silently
stops being completable reads as a broken game rather than as a loss. And the
second taker's arrival is **telegraphed** at accept time, because a rival team
that materialises unannounced reads as unfair while one you can hear coming is a
decision — hurry, hide, or set up.

**The view reports a rival COUNT, never identities.** Knowing which Firm is
racing you would leak the rival board straight across the fog.

Two things worth keeping: both new fields are ARRAYS, so `copyState` and
`mirrorState` slice them — a spread copies the reference and would have made the
reducer quietly impure. And the contender cap test needed FOUR Firms against a
cap of two: with only two deployed the cap could never be exceeded, so the
assertion held with the check deleted. A world has to be able to break the rule
before a test can claim the rule is enforced.

## AS BUILT — 8i, scheduled rival raids (2026-08-06, D49b)

`engine/raids.js`. The UNCHOSEN half of D49: a rival turns up at your HQ whether
or not you took a job about it. It ships before the Defend contract on purpose —
sell someone competence at a threat they have never felt and the contract is an
abstraction.

The MECHANICS already existed (`stepPerimeter` raises an alarm and lets an
intruder loot the cache). What did not exist was **intent**: a raid was an
accident of AI mood, so it was rare, unpredictable and impossible to design
around. This schedules it, **telegraphs it**, and gives it a window.

**D31 is load-bearing**: a Firm inside its disconnect grace is never a target.
Raiding somebody whose connection just dropped is the most obviously unfair
thing this system could do, and the rule already existed to be read.

### Four defects, each found by a different instrument

**1. The raider parked one cell short.** `arrivedAt` tolerates a cell of slop —
rightly, since demanding exactness once caused 1324 `move:no_route` rejections —
but looting requires standing exactly ON the tent. Result: 6 raids dispatched, 5
perimeter alarms, **zero loots**, every seed. Found by `debugging/dbg_raids.mjs`,
not by a test.

**2. The order was placed below the contract logic** while its own comment
claimed it outranked everything. The code did not do what the comment said.

**3. Then it outranked evacuation** — and the AI stopped extracting entirely.
Precedence is now: forced choice (standoff), getting out (evac), orders (raid),
work.

**4. A successful raid never ended**, so the raider camped on the tent and
re-looted every time the owner banked anything: **5020 loots in one world-day**.
That is a siege, not a raid. A raid now ends when it succeeds, and `lootTicks`
resets — a latent hq.js bug that was invisible while raids were rare accidents.
A raider that arrives to an EMPTY tent is also released, rather than standing
there for the whole window.

### The economy check that mattered

With raids outranking contract work, **world throughput fell ~40%** —
completions 4–9 → 1–5 per world-day, clean extractions all but stopped. That is
not a difficulty effect, it is the economy being rewritten by a side feature,
and it would have poisoned 8h's battery. A raid order now waits for the current
job to finish. Measured after: completions 4–7, extractions 0–2, and raids still
land (4–5 scheduled, 1–2 succeeding). Frequency is tuned **against the AI gate**,
not by feel.

## AS BUILT — 8j, the Defend contract (2026-08-06, D49a)

The sixth type, and the one **inbound** job. Every other contract is "go
somewhere, do something, come home"; this is "be somewhere while something comes
to you". The texture inverts, and that inversion is the whole reason to add it:

- **Being seen is not failure.** It is the only contract with no stealth clause
  at all — you are supposed to be there. A genuine rest from the one texture the
  game otherwise has.
- **Leaving IS failure, immediately.** Everything else forgives a wander by
  resetting a timer; here the thing you were guarding is behind you the moment
  you step away.
- **A rival arriving PAUSES the hold, it does not lose it.** A reset would mean
  any rival wandering past costs the whole hold, making the contract a coin-flip
  rather than a job. Who ends up standing there is the standoff machine's
  business (S08), which is exactly the division of labour S16 asked for.

Tier 2 rather than 1, because it needs rivals who actually arrive (8g/8i), and
priced on its 1800-tick hold like every other type since the effort pass. The AI
scorer sees that hold — a scorer blind to it prices the job as free, which is
precisely the blindness that made surveillance look cheap before.

Two integration details worth keeping: `stageTicks` is advanced once for every
contract kind *above* the switch, so pausing means giving that tick back rather
than skipping an increment that never happened; and `stageTargetTicks` needed a
Defend case or the HUD bar sits blank for three minutes, which reads as a hung
game rather than as a contract in progress.

`KIND_COUNT` is the single place that decides whether a type is ever generated,
so a test asserts the pool actually rolls Defend (~22% of tier-2 work) — a type
the generator never produces is dead content whatever the constants say.

## 8h — the battery re-read, and why D19 still cannot be verdicted (2026-08-06)

24 world-days at 60k ticks, `reports/sweeps/pacing_m8.csv`.

### The instrument was wrong first

8j added a sixth contract type and BOTH instruments hardcoded five. `KIND[5]`
was `undefined`, so every Defend contract landed in a column that did not exist
and the battery measured **five sixths of the game while printing a D19
verdict**. Defend turned out to be **30.5% of all completions** — the single
largest share — and it was invisible.

Both now derive their type list from the engine and from the CSV header
respectively, so adding a seventh type cannot silently repeat it. *Check the
instrument before the finding* — this is the fourth time in this project.

### What the corrected battery says

| type | offered | accepted | completed | preference |
|---|---:|---:|---:|---:|
| courier | 20.3% | 42.7% | 18.3% | **2.10x** |
| surveillance | 35.1% | 22.9% | 24.4% | 0.65x |
| extraction | 32.9% | 12.3% | 19.7% | **0.38x** |
| sabotage | 3.0% | 9.3% | 3.3% | **3.11x** |
| acquisition | 3.7% | 0.3% | 3.8% | **0.08x** |
| defend | 5.1% | 12.5% | 30.5% | **2.45x** |

**Extraction is no longer dominant.** It read 1.43x over-chosen before M8 and
now reads 0.38x — ignored. That is D42's prediction, and it arrived without a
single reward change, exactly as ruled.

### But the verdict is BLOCKED, and saying otherwise would be dishonest

**The AI is structurally barred from two of the six types.** It cannot obtain a
credential (8e/8f follow-up), so it declines every secured extraction and
acquisition. Acquisition's 0.08x is not a preference reading — it is a Firm that
*cannot take the job*. Extraction's collapse is at least partly the same effect
rather than opposition making it unattractive.

**Pacing also went the wrong way**: sortie 4.8 min against D11's 15–20, worse
than M7's 8.7–17.4. The mechanism is the same — an AI barred from the long
secured jobs fills its time with couriers, which are short.

So D19 stays deferred, now for a *different* reason than D43 gave. D43 deferred
it because opposition did not exist. Opposition exists; what is missing is an AI
that can engage with it.

### The one thing that must happen before 8h can be re-read

**Teach the AI to obtain a credential** — buy one at a vendor (needs the ledger
plumbed into the AI seam, since D30 makes purchases bank-only) or lift one from
a guard it disabled. Until then every battery measures a world where a third of
the contract space is closed to the only actor being measured.

## AS BUILT — 8k, the AI can get a pass (2026-08-06)

### First: the source did not exist

`liftCredentialFromGuard` shipped in 8e with five passing tests and **no
command**. Lifting a badge off a disabled guard was unreachable for the AI *and*
for players — one of the three credential sources described in this spec simply
was not in the game. A function with tests and no caller looks exactly like a
working feature. `CMD_LIFT_CREDENTIAL` and a HUD control fix that, and the view
now reports which guard is down (without it the client cannot tell a guard you
put down from one standing still).

### Then: teaching the AI, and three failed shapes

The guard route rather than the vendor, because buying needs the BANK, which
lives in the server ledger and never enters the engine (D30) — a vendor purchase
would mean plumbing the ledger through the AI seam.

Three versions did nothing, each for a different reason, and each found by
tracing rather than reasoning:

1. **No approach step.** It disrupted guards from three cells away and never
   closed: 13 disruptions, zero lifts. Stunning a guard you never reach is worse
   than doing nothing — it spends the item and the noise for nothing.
2. **The unseen gate was on the whole block.** The disruptor makes noise, so the
   agent was noticed by its own action and then refused to walk the three cells
   to the guard it had just put down.
3. **No intent.** Acting only when a patrol happened to wander within range
   produced 15 disruptions and zero credentials across four world-days.

A trace of the approach settled it: the agent closes from 18 cells to 1, is
noticed at 8 and burned at 2 — *by the guard it is walking up to*. Being seen is
the price of the badge, not a disqualification.

### The trade-off, stated plainly

Idle guard-hunting and throughput trade **directly** against each other:

| seek radius | credentials / 6 world-days | completions (median) | clean extracts |
|---|---:|---:|---:|
| 20 cells, idle | ~3 | 4.0 | 0.0 |
| 10 cells, idle | 1 | restored | restored |
| 20 cells, **purposeful** | 2 | restored | restored |

The errand now needs a REASON — a job on the Firm's own board that the credential
would actually unlock — which makes it rare and targeted instead of frequent and
speculative. Wandering off to mug somebody on the off-chance is not worth an
operative's time, and the numbers said so before the design did.

### What the battery says now

Re-run at the wide idle setting (the one that produced the most credentials),
the D19 mix moved a long way:

| type | before 8k | after 8k |
|---|---:|---:|
| courier | 2.10x | **1.16x** |
| surveillance | 0.65x | 0.75x |
| extraction | **0.38x** | **0.77x** |
| sabotage | 3.11x | 1.21x |
| acquisition | 0.08x | 0.40x |
| defend | 2.45x | **4.61x** |

**Five of six types now sit in a 0.75–1.21x band**, and extraction is neither
dominant nor artificially crushed — which is the first genuinely readable
version of this table since D42 was ruled. Defend is the new outlier at 4.61x
and is the obvious next balance question.

### Still open, and NOT resolved

- **Credentials remain rare** (2 per six world-days at the shipped setting), so
  acquisition's 0.40x is still partly "cannot take the job".
- **Pacing is unchanged and still short**: sortie 4.8 min against D11's 15–20.
- **One unexplained anomaly**: seed 1411 reports 273 accepts against 2
  completions in the world-day sweep. Every other seed is normal, the suite is
  green, and my probe could not reproduce it because `contractAccepted` is
  emitted inside `stepAiFirms` and overwritten by the following tick — the
  instrument, not the world. **Flagged rather than explained.** It should be the
  first thing looked at before any further balance tuning.

## AS BUILT — 8l, making Defend cost something (2026-08-06)

Defend read **4.85x over-chosen and 31.1% of completions**. Three things were
wrong, in descending order of importance.

### 1. The instrument was reading a live-lock (the real find)

The AI abandons a contract whose objective it cannot path to — and
`rebuildOffers` then put that contract straight back on its board, where it
scored well and was taken again. **Two contracts on seed 1411 were accepted 133
times each, with 268 abandons in one world-day.** Every D19 reading was computed
over that loop.

Fixed at the source: the AI no longer *takes* what it cannot reach, which is
simply the abandon rule asked before committing instead of after walking.
Stateless, and symmetric with the rule it mirrors. Accepts on that seed fell
from 273 to 5, and with the loop gone acquisition moved 0.40x → 1.35x and
courier 1.16x → 1.03x. **A balance table computed over a live-lock is not a
balance table.**

### 2. Defend was never effort-priced

Every other type went through the effort pass; Defend's 240 was set by feel when
the type was added. It paid **0.133 per work-tick against a family median of
0.0767**. It is now the family rate (0.0767 x 1800 = 138) times the project's
own existing contested premium (`contested.rewardPct` 150) = **207**.

**This is not the reward cut D42 forbids.** D42 protects types that were already
effort-priced from being re-cut to chase a dominance number. Defend had never
had that pass at all; this is that pass, applied late, and it is derived rather
than felt.

### 3. Nothing attacked a defence

The type is "hold this while somebody tries to take it", and nobody tried — a
defence was contested twice in six world-days, by rivals wandering past, and
completed nearly always. Two mechanisms now:

- **Rival assault** — the raid scheduler (8i) gained a SITE target, so a Firm
  settling in to hold draws a dispatched attacker. Honest limitation: it needs a
  spare Firm and almost never gets one, so it rarely fires yet.
- **The authorities notice** — a defence draws patrols to the site every
  `patrolDrawTicks`, reusing the exact converge helper a burn already uses
  rather than a second one that could drift from it. Patrols are always
  available, which is why this is the one that actually bites.

### Result, and what I am NOT claiming

| | before | after |
|---|---:|---:|
| defend completion share | 31.1% | **27.2%** |
| defend preference | 4.85x | 4.62x |
| other five types | 0.60–1.35x | **0.68–1.21x** |

Completion share is now **comfortably under D19's 35% ceiling**, and that is the
sounder reading. The preference ratio stays high because Defend is offered only
5.3% of the time and taken whenever it appears — which is precisely the artifact
`analyze_pacing.py` warns about in its own NOTE 2: a popular contract leaves the
board sooner, depressing its offered share and overstating its ratio. **I have
not chased that number further**, because chasing a figure the instrument says
is inflated is how a balance pass ends up tuning the tool instead of the game.

## The beam is LEVEL-triggered, and that is the heat spiral (2026-08-31)

**Diagnosis of the 36% of worlds that never reach tier 3** (owner ruled
"diagnose before acting"). They are not slow. They are locked down: 1.85x the
district-ticks at or above `checkpointsActiveAt`, a third the completions, and a
completion rate per accepted contract of 0-38% against a healthy 60-100%.

**The event census names the cause without ambiguity.** Summed over four spiral
and four healthy worlds:

| event | spiral | healthy | ratio |
|---|---|---|---|
| `beamTripped` | **1687** | **0** | infinite |
| `alarmEscalated` | 144 | 18 | 8.0x |
| `alarmRaised` | 108 | 26 | 4.2x |
| `contractCompleted` | 6 | 23 | 0.26x |
| `tierUnlocked` | 1 | 9 | 0.11x |

Everything below `beamTripped` is its cascade.

**The mechanism.** `applySecurity` trips a beam for an agent *standing in* it,
once per beam **per tick**:

```
// 8c: a LIVE beam that an active agent is standing in trips the facility.
```

So the beam is **level-triggered, while the design it implements is a
CROSSING** — the comment two lines below says so: "A beam knows only that
something crossed it". An agent that STOPS inside one becomes a permanent siren.
Measured on seed 22509: **614 consecutive ticks** of one agent tripping one
beam, with all three Firms' agents doing it to the same beam (614/420/314). A
crossing is about 56 ticks at `agents.baseSpeed`, so this is 11x a crossing.

**Why an agent stops there is not a defect** — it is the game working. D41 makes
an objective workable only while no patrol is within `patrolWindow`, so waiting
is the intended decision; WD-1 adds waiting for dark. Both park an agent, and
nothing ever asserted what a beam does to a stationary agent.

**Beam count correlates hard**: spiral worlds carry 3/4/1/5 beams against
healthy 1/2/0/0. But seed 7165 spiralled on a SINGLE beam, so presence is not
sufficient — it is whether an agent's waiting cell sits inside one.

**This is the doctrine's own rule failing on a case it did not enumerate.**
"Every mechanism must have a usable gap" was asserted for a crossing: the dark
window must exceed the two cell-moves a crossing takes, and
`debugging/dbg_area_ring.mjs` checks it. Nobody asked what the gap means for an
agent who is not crossing. **A mechanism verified against its intended use can
still be pathological in a state the verification never modelled.**

Probe: `debugging/dbg_heat_spiral.mjs` — real battery seeds, trajectory plus a
full event-census diff. The census was deliberately not a hand-picked list of
events; choosing them in advance would have answered the question by assumption,
and the first two hypotheses (credential gating, then civilians tripping beams)
were both wrong and both discarded on evidence.

**Not fixed. Owner ruled diagnose-first, and the remedy is a design choice** —
edge-trigger, cooldown, or dampen the alarm rather than the trip. See Q55.
