# Shadow Mandate

*Run the mission. Don't get burned.*

A drop-in / drop-out covert-ops game in a persistent city-region: drop in by
dropship, establish a Field HQ, run contracts for your Firm, and extract
cleanly — while rival Firms work the same streets. Browser (desktop + mobile),
self-hostable Node server, deterministic engine. Sibling of **Fireline
Command**, built on the same forked stack (pure reducer, fog-filtered views,
painted low-poly art).

**Status: playable.** Rulings D1–D34 locked; V1/V2 plans and system
specs written. **M0–M4 of the V1 roadmap are implemented and green (77 tests):**
seeded city generation, agents with stances, detection/heat, disable-only
combat with capture, the Field HQ session loop with the world ledger, and the
contract economy. No client yet — the game is headless and driven by tests.

```bash
npm install && npm start     # then open http://localhost:8080 and play
npm test                     # 171 tests
```

See `RUNNING.md` to play, `BATCH_PC.md` for the sim battery lane.

| Start here | |
|---|---|
| `specs/00_document_index.md` | Document map and all design rulings |
| `plan-version1.md` (+ `.html`) | V1 "The Operative" — milestones M0–M7 |
| `plan-version2.md` (+ `.html`) | V2 "The Squad" |
| `specs/07_spec_map.md` | System-spec structure for implementation |
| `CLAUDE.md` | Working rules for AI-assisted development |
| `dev-questions.md` | Open questions awaiting the owner's answers |

Licence: MIT (matching the sibling projects).
