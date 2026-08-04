# Shadow Mandate (codename: multisyndicate) — Working Rules

Drop-in/drop-out covert-ops game. Sibling of Fireline Command
(`~/GIT/firepower` — the fork source, never modified from here).
**Status: pre-code, design complete.** Next milestone: M0 Fork & Strip.

## Read first

1. `specs/00_document_index.md` — document map, rulings D1–D26
2. `plan-version1.md` — the operational plan (milestones M0–M7, gates)
2b. `plan-implementation-order.md` — slice-by-slice execution order + the
   gaming-PC battery runbook (hub port 8972; contention rules with firepower)
3. `specs/07_spec_map.md` — milestone → system-spec matrix; pin the specs a
   milestone needs BEFORE starting its slice
4. `specs/systems/S*.md` — implementation contracts (state, commands, data keys)

## Terminology contract (D8 — enforced)

Game title **Shadow Mandate**. Factions are **Firms**. Player character is an
**Agent**; base is the **Field HQ**; missions are **Contracts**. The word
"Syndicate" is banned from UI copy, code identifiers, filenames, and new docs
(repo codename `multisyndicate` and historical spec records are the only
exceptions). A suite test greps for violations once code exists.

## Engine doctrine (non-negotiable, inherited from the siblings)

- Pure deterministic reducer `apply(state, command)`; 10Hz; integer
  fixed-point (256 units/cell, entities at cell centres); seeded PRNG
  in-state; no floats, no `Math.random`, no wall clock in `shared/`/`engine/`
  — the ONLY clock entry is the `dormancyTick.elapsedMs` command field.
- Zero runtime dependencies in `shared/` and `engine/`. Numbers live in
  `data/*.json` (S13), never in engine code.
- Views cross the wire, never state. Fog-filtering before transport.
- New positional state touches four places: mirror transform, copyState
  deep-copy, BOTH hash functions, view projection.
- New subsystems land hash-inert; no new events inside the pinned fixture's
  steps; prefer silent state changes for routine ticks.
- Disable-only combat (D6): no entity-deletion event may exist.

## Workflow

- **Slices**: named `slice-…`, tests first, suite double-run green, the layer
  gate for the change (see S14), then a `dev-log.md` entry. Every gameplay
  slice ends with the 5-seed sim gate once the harness exists (M5+).
- **Questions**: anything needing the user's decision goes to
  `./dev-questions.md` (numbered Q22+, with context + proposal + blank
  `Answer:`). The user answers in batches; answers become rulings in
  `specs/01_design_of_record.md` and the question moves to the
  `specs/06_open_questions.md` archive. Never guess on a product decision —
  queue it and continue with other work.
- **Prompts log**: a UserPromptSubmit hook appends every user prompt to
  `dev-prompts.md` (gitignored). Don't edit that file except to repair the log.
- **Batch lane** (D25): sweeps run on the shared firepower agent-mail queue,
  repo-tagged; never tune or convict on 5 seeds — batteries (n=300+) decide.
- Git: the user handles all commits and pushes (global rule). Stop and report.

## Gotchas quick list (earned in the sibling projects — details in S14)

Probe vs sweep disagree → check config plumbing first · read the FAIL COUNT,
not the exit code · telemetry must record failure · verify a probe's event
fields against the reducer before trusting zeros · WSL Playwright is
SwiftShader-only (correctness yes, FPS no) · ws tests poll-wait, never fixed
settles · era discipline: re-pin battery baselines when the ruleset changes.
