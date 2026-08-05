# S16 — Opposition & Site Security

*Feeds: V2 (design pinned in V1) · Depends on: S03, S04, S07, S08, S09 ·
Status: design note, nothing implemented*

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

## The mini-game question (Q38)

The owner asked for "a mini-game with alarm bells and laser security". The word
*mini-game* usually implies a modal panel — a lock-picking widget, a wire
puzzle. **That conflicts directly with drop-in/drop-out multiplayer**: the world
runs at 10Hz with other players in it, so a modal puzzle either freezes one
player while the world moves around them, or pauses nothing and gets them
captured while they look at a widget.

The proposal is that the "mini-game" is **diegetic** — the puzzle is spatial and
temporal, played with the agent in the world (time the sweep, cut the power,
route around the sealed door), never on a separate screen. It keeps one input
model, survives another player walking in, and needs no new presentation layer.

This is Q38 in `dev-questions.md`, with the diegetic reading implemented as the
default so nothing blocks.

## Not decided

- Whether contested contracts are opt-in (a "contested" board flag you accept
  knowingly) or assigned.
- Whether site security is per-site static or generated per contract.
- Whether a blackout should be usable offensively against a rival Firm's
  in-progress contract.
