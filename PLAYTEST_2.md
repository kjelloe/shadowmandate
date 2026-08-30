# Playtest 2 — the M8 opposition pass

One sitting, five deploys, roughly 45–70 minutes. Everything is pointer-driven;
the `(ENTER)`/`(SPACE)`/`(L)`/`(ESC)` hints in the UI have no key handler behind
them and are decorative.

```bash
npm start                      # http://localhost:8080
SEED=4711 SIZE=64 npm start    # a fixed world, if you want to repeat a run
```

Keep this file open beside the game and write under each **Note:** as you go.
The failure conditions matter more than the successes — a "yes that worked" tells
me much less than "I could not tell what it wanted."

---

## Phase 0 — the splash (point 9)

Before clicking anything, read the terminal panel and answer from it alone:

- What world is this, and how far into the season is it?
- How strong is the competition — what tier range?
- Have you been here before? (`SINCE YOUR LAST VISIT`)

**Fails if:** you cannot answer all three in about two seconds, or you do not
know whether the season is ending soon. This screen exists to answer exactly
these and nothing else.

**Note:**

---

## Phase 1 — insertion (point 10, first half)

Click `DROP IN`. Skim the briefing, then pick a drop zone — the list shows each
district's trait, contract count and heat, with one marked `RECOMMENDED`. Pick a
zone that is **not** the recommended one at least once during the session.

Watch the dropship come in. It flies for five seconds: inbound, hover, out.

**Fails if:** you miss it, cannot tell which direction it came from, or cannot
tell your Firm's colour from it.

**Note:**

---

## Phase 2 — the board, cold (point 5)

Open `AVAILABLE CONTRACTS` before moving. Read the six kinds and, without
knowing the internals, rank them: which would you take if you could only take
one? Which would you never take?

Write the ranking down now — it is worth much more before you have played than
after.

**Fails if:** two kinds are indistinguishable in what they ask of you, or one is
obviously never worth taking.

**Note (ranking):**

---

## Phase 3 — deploy 1, a clean run (point 6)

Take one **unsecured** contract and run it start to finish. No cleverness.
Click the world to move, switch stance (`SNEAK` / `MOVE` / `HURRY`) as it suits.

This deploy is the baseline: it is what the game feels like with nothing pushing
back. Track how long a contract takes against how long the deploy lasts.

- Did the deploy end before you had done anything interesting?
- How many contracts could you realistically finish in one sortie?

**Fails if:** the sortie ends mid-objective through no decision of yours.

**Note:**

---

## Phase 4 — deploy 2, the secured site (points 1, 2, 3)

**This is the most valuable half hour of the session.** Take a contract at a
secured site — one with cameras or beams.

### 4a. Watch before you move (point 1)

Stop short of the site and watch a camera through several full sweeps. The game
never tells you the cycle; learning it by eye *is* the mechanic.

- Can you tell where it is pointing right now?
- Can you predict where it will point next?
- Did you find a gap and get through it on purpose?

**Fails if:** you get caught with no sense of why, or you cannot read the facing
at all. If that happens, stop and describe what you saw instead — that is the
single most important note in this file.

**Note:**

### 4b. Cross a beam (point 1 continued)

A beam only knows that *something* crossed — it raises the alarm but does not
see you. It has a dark window long enough for the two cell-moves a crossing
takes.

- Could you time it, or did it feel like a coin flip?
- Did tripping it deliberately and hurrying feel like a real option?

**Note:**

### 4c. Credentials (point 3)

If you hit `LOCKED — YOU NEED A PASS`, go and solve it. Three sources:

1. The safe house — ask about a pass for the east gate
2. The market — a contractor badge, tier 2
3. A guard — get close and use `TAKE BADGE`

**Fails if:** you bounce off the lock and abandon the contract because no source
was available or none was findable.

**Note:**

### 4d. Cut the power (counter-play)

Find a junction and use `CUT POWER`. The button only appears when you are in
range.

- Did you know the junction was there before the button appeared?
- Was the effect legible — could you see what the cut did?

**Note:**

### 4e. The verdict (point 2)

With 4a–4d behind you: **is a secured site a different problem, or a closed
one?** This is the question M8 exists to answer and no test can answer it.

**Note:**

---

## Phase 5 — deploy 3, contact (point 8)

Run normally, but take a `DEFEND` contract if one is offered, and stay out long
enough to draw attention. Watch for `RAID INCOMING`, `ANOTHER FIRM HAS TAKEN
THIS JOB`, and standoffs (`ENGAGE` / `WITHDRAW` / `NEGOTIATE`).

- Does defending feel like a contract, or like standing still for money?
- When a rival took a job from you, did you understand you had lost it?

**Note:**

---

## Phase 6 — extraction and debrief (points 10, 4)

Call evac. Hold the HQ while the dropship comes in — watch the outbound flight
this time.

At the debrief, record: contracts completed, resources, recognition, and
**your tier**.

**Note (deploy N, tier):**

---

## Phase 7 — deploys 3 to 5, progression (point 4)

Play normally. Do not hunt for anything. After each debrief record only:

| Deploy | Tier at end | Deploy felt |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |

The instruments said tier 3 arrives at 6.0 deploys against a 3–4 target.
**That measurement was wrong** (D71, 2026-08-30): it counted every Firm's
deployments, not the reaching Firm's, and corrected it reads **3.0 — in band**.
So the question was never whether the number is correct; it is whether the wait
**dragged**. That is still the last open acceptance criterion and only you can
close it.

**Note:**

---

## Phase 8 — get captured on purpose (point 7, first half)

Save this for the second-to-last deploy; it costs you the sortie.

Go `HURRY` in the open near a secured site until you are `BURNED`, then do not
evac. Let the patrols reach you.

- Did you understand you had been captured, and what it cost?
- Did the game make clear the operative was *abandoned* rather than dead?

**Note:**

---

## Phase 9 — go and get them back (point 7, second half)

Next deploy. A recovery contract should be waiting — it is priced as an
extraction and its objective is the Holding Site.

**Known issue, so you are not hunting a ghost:** it shows on the board labelled
plain `Extraction`, with nothing marking it as a recovery. See whether you can
find it at all, and whether pulling your own operative out feels different from
a routine job once you are running it.

**Fails if:** you cannot identify which contract is the recovery, or completing
it lands with no weight.

**Note:**

---

## Phase 10 — leaving

Return to world, then main menu. If you were issued a `RECOVERY CODE`, note
whether it was clear that it is shown once.

**Closing note — the one thing most worth changing:**
