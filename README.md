# Shadow Mandate

*Run the mission. Don't get burned.*

A drop-in / drop-out covert-ops game in a persistent city-region: drop in by
dropship, establish a Field HQ, run contracts for your Firm, and extract
cleanly — while rival Firms work the same streets. Browser (desktop + mobile),
self-hostable Node server, deterministic engine. Sibling of **Fireline
Command**, built on the same forked stack (pure reducer, fog-filtered views,
painted low-poly art).

**Status: engine in progress.** Rulings D1–D34 locked; V1/V2 plans and system
specs written. **M0–M4 of the V1 roadmap are implemented and green (77 tests):**
seeded city generation, agents with stances, detection/heat, disable-only
combat with capture, the Field HQ session loop with the world ledger, and the
contract economy. No client yet — the game is headless and driven by tests.

```bash
npm test                                   # 77 tests
node tools/render_city.mjs 4711 64         # look at a generated city
SEED=4711 node debugging/sm_systems.mjs    # what actually fires in a run
```

| Start here | |
|---|---|
| `specs/00_document_index.md` | Document map and all design rulings |
| `plan-version1.md` (+ `.html`) | V1 "The Operative" — milestones M0–M7 |
| `plan-version2.md` (+ `.html`) | V2 "The Squad" |
| `specs/07_spec_map.md` | System-spec structure for implementation |
| `CLAUDE.md` | Working rules for AI-assisted development |
| `dev-questions.md` | Open questions awaiting the owner's answers |

Licence: MIT (matching the sibling projects).
