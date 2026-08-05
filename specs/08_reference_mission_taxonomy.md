# 08 — Reference Mission Taxonomy (Bullfrog corpus)

*Research note, 2026-08-05. Source: the owner's survey of Bullfrog's 1993
squad game and its 1996 sequel — mission lists for both campaigns, plus their
funding, research and upgrade systems.*

**This is reference material, not a plan.** It exists so that M8 content and the
V2/V3 roadmaps can be argued against a real corpus instead of invention. Where
the reference collides with a ruling, the ruling wins and the collision is
recorded here rather than quietly resolved.

**Terminology note (D8):** the source titles and their in-fiction faction names
appear in this file because it is a design document. They must never reach a
shipped artifact. `test/guards.test.js` scans `engine/`, `shared/`, `server/`,
`client/`, `data/`, `tools/` and `debugging/` — `specs/` is deliberately not
scanned so that research like this can name its sources.

---

## The corpus

Two campaigns, arranged in chapters. Each chapter arrives as an in-fiction email
carrying a **REF number** and holds up to three missions, often the same
objective offered in different cities. Roughly 45 missions across both
campaigns, in a persistent world map where completed territory funds the next
operation.

Two structural ideas worth stealing outright, independent of any mission type:

- **The REF/chapter frame.** Missions arrive as correspondence with a reference
  number, and a chapter is a small set you may attack in any order. This is a
  briefing fiction that costs nothing and gives a session shape. Our contract
  board is a flat list of five offers (D18); a chapter frame is how a *campaign*
  would sit on top of it without changing the board.
- **The same objective in several cities.** The reference repeats "persuade a
  scientist" across four cities in one chapter. That is content reuse done
  honestly — the objective is a template, the place makes it different. Our
  citygen already generates the place; this is the argument for contract
  templates over hand-authored contracts.

---

## Mission taxonomy, mapped to our contract types

Our five types are courier, surveillance, extraction, sabotage, acquisition
(S06).

| Reference family | Reference examples | Maps to | Status |
|---|---|---|---|
| **Eliminate / Assassinate / Neutralise** | *Eliminate the Unguided*, *Neutralise agent*, *De Saxo must perish* | **Snatch** — capture and extract the target | **Already ruled (D6).** See below. |
| **Persuade / Recruit** | *Friendly Persuasion*, *Where Is Wisdom?*, *Convert Ormandoz* | `extraction` (secure a contact, bring them home) | Covered, but the *fiction* differs — see below. |
| **Acquire / Steal** | *Steal Cult technology*, *Steal Eurocorp weapon design*, *Get shuttle nav computer* | `acquisition` | Covered. The reference's "heavily guarded facility" is exactly S16 slice 8f. |
| **Destroy infrastructure** | *Destroy R&D Facilities*, *Destroy Eurocorp weapon bunker* | `sabotage` | Covered. |
| **Deliver vehicle / cargo** | *Deliver car to evac zone*, *Donation* (bullion car) | `courier` + vehicles (6b, V2) | Covered once vehicles land. |
| **Reach / activate a location** | *Proceed to IML link*, *Activate IML link* | `surveillance` (hold a position) | Covered. |
| **Protect / Escort / Defend** | *Protect executives*, *Protect the Bahrain AI*, *Escort Professor Drennan*, *Protect your brethren and the temple* | — | **GAP. We have nothing.** |
| **Heist** | *Acquire funds*, robbing banks for vaults and suitcases | `sabotage` + `acquisition`, but neither alone | **Partial gap.** |
| **Rescue** | *Rescue Professor Drennan*, *Abduct Eurocorp captive*, *Recapture* | D40 capture-grace rescue exists as a *mechanic*, not as a contract | **Partial gap.** |
| **Mass violence** | *Sterilise city*, *Crush the Uprising* | — | **Incompatible.** Wrong game, wrong tone. |

### The Eliminate family — half the corpus, and we cannot do it

Counting both campaigns, kill objectives are the single largest family. **D6
rules them out**: no entity is ever deleted by violence, agents go down → crawl
→ rescued or captured, and the ruling already states that assassination missions
are replaced by **Snatch** (capture and extract the target).

That is a strength, not a shortfall. "Neutralise agent" survives translation
almost intact — our combat already disables rivals — and "assassinate the
professor's assistant" becomes a *harder and more interesting* job when the
target has to leave the map alive and in your custody. The reference's own
best missions (*Bring Him Back Alive*, *Abduct Eurocorp captive*) are already
snatches.

**Implication for M8:** a defended snatch is the single most valuable contract
S16 unlocks, because it needs every part of the opposition layer at once —
access control to reach the target, a staged alarm while you extract them, and a
plausible reason for a rival team to be there too.

### Persuade — the mechanic maps, the fiction should not

The reference's Persuadertron is mind control: point a device at a civilian and
they follow you forever. Mechanically this is our extraction escort. The fiction
is a poor fit for us — it is a magic wand that removes the decision, and it sits
badly with a family-friendly, stealth-first game.

**Proposed re-skin, entirely diegetic (D45):** you persuade with **leverage, not
a ray gun**. The credential, the heat intel, or the compromising file bought
from an informant (S09) is what turns a scientist. That makes the informant
economy load-bearing instead of flavour, and it makes the "conversion" a thing
you prepared for rather than a button.

---

## The two real gaps

### 1. Protect / Defend — a sixth contract family

Every one of our five types is **outbound**: go somewhere, do something, come
home. The reference has a whole defensive family and it inverts the loop — you
are stationary, and something is coming to you.

We already have the pieces: HQ raids were ruled in (the owner's Q20 answer —
rival Firms are active on their own missions and *a raid on the HQ could
happen*), the evac hold is explicitly "the hold is the fight" (D28), and S16
gives rivals a reason to arrive.

Why it is worth having:

- It is the only contract type where **being seen is not automatically failure**,
  which is a genuinely different texture in a stealth-first game.
- It gives the drop-in/drop-out model something valuable to do with a second
  player who arrives mid-session — defending is naturally cooperative.
- It fills D11 sortie minutes with tension rather than travel, which is exactly
  what D41 asks content to do.

This is **Q39**.

### 2. Heist — the multi-stage that spans two of our types

*Blow the vault, then loot what spills out* is neither pure sabotage (which ends
when the charge goes off) nor pure acquisition (which has nothing to breach).
The reference makes it a two-beat: **breach**, then **carry out under a rising
alarm**.

We would not need a new type so much as a **compound contract** — sabotage
stage, then acquisition stage, with S16's staged alarm as the timer. Deferred
until 8a (alarms) and 8f (secured facilities) exist, since it is meaningless
without them.

---

## The meta-layer: funding, research, upgrades

The reference funds the war from conquered territory (set local tax rates; too
high and the region revolts and must be pacified again), supplements it by
robbing banks mid-mission, and spends it on a research tree (sliders across
Weapons / Cybernetics / Equipment) and a four-tier cybernetic upgrade path
(eyes → accuracy, brains → auto-target, chest → health, legs → speed).

| Reference system | Our position |
|---|---|
| Territory tax + revolt pressure | **V3 candidate.** The owner's Q28 answer already puts "build your Firm over time" in V3. The tax/anger loop is a good pressure system: it makes expansion cost something ongoing. |
| Robbing banks for budget | The Heist contract above. |
| Research tree (hire scientists, fund tracks) | **V2 candidate**, and a natural home for the existing `firm.upgrades`. Between-sessions HQ management is compatible with drop-in/drop-out precisely because it is *not* in the world. |
| Four-tier cybernetic body upgrades | **Collides with our core — see below.** |

### The progression-parity problem

The reference is a single-player campaign, so permanent per-agent power upgrades
are pure reward. **We are drop-in/drop-out and persistent**, and that changes the
maths: a newcomer dropping into a season-old world would meet agents with
upgraded speed, accuracy and health, and lose to them for reasons they cannot
see or counter.

Our design has so far avoided this deliberately. **D39 makes recognition a
lifetime honour score that rewards *craft* — tier, finishing unseen, burns
avoided — explicitly not payout or hours logged.** A cybernetics tree points the
other way: accumulate to win.

The tension is real and unresolved, and it needs a decision before V2 upgrades
are designed rather than after. This is **Q40**.

Three shapes that would keep parity, for the record:

- **Sidegrades, not upgrades** — tools that change *how* you solve a site
  (silent entry vs. speed vs. intel), never raw stat increases.
- **Consumables** — bought from the bank per sortie (D30 already forces you to
  extract before you can shop), so an advantage is spent rather than owned.
- **Loadout, not body** — upgrades attach to the contract you took, not to a
  permanent agent, which also suits agents being disposable in a drop-in world.

---

## What this changes right now

Nothing in flight. 7h (browser gates) still goes first, and M8's slice order is
unaffected — if anything the corpus confirms it, since the reference's most
interesting missions are all "guarded facility" variants that S16 is the
prerequisite for.

The two questions (Q39 defend family, Q40 progression parity) are in
`dev-questions.md`.
