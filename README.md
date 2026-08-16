# Shadow Mandate

*Run the mission. Don't get burned.*

A drop-in / drop-out covert-ops game in a persistent city-region: drop in by
dropship, establish a Field HQ, run contracts for your Firm, and extract
cleanly — while rival Firms work the same streets. Browser (desktop + mobile),
self-hostable Node server, deterministic engine. Sibling of **Fireline
Command**, built on the same forked stack (pure reducer, fog-filtered views,
painted low-poly art).

**Status: playable in a browser.** Rulings D1–D50 locked; V1/V2 plans and
system specs written. **M0–M6 are complete, M7 is done as far as it can go
without the owner's hardware, and M8 (opposition) is under way:** seeded city
generation, agents with stances, detection/heat, disable-only combat with
capture, the Field HQ session loop with the world ledger, the contract economy,
AI rival Firms, hosted worlds, identity and seasons, the 2.5D diorama client
with procedurally generated art, and the beginnings of site security — staged
alarms, sweeping camera cones, sensor beams and the junction boxes that cut
them.

```bash
npm install && npm start     # then open http://localhost:8080 and play
npm test                     # 313 tests
npm run gallery              # every visual and portrait -> reports/gallery.png
```

See `RUNNING.md` to play. The sim battery lane and deploy runbooks live in
the private ops repo (checked out locally as `ops/`, gitignored).

| Start here | |
|---|---|
| `specs/00_document_index.md` | Document map and all design rulings |
| `plan-version1.md` (+ `.html`) | V1 "The Operative" — milestones M0–M7 |
| `plan-version2.md` (+ `.html`) | V2 "The Squad" |
| `specs/07_spec_map.md` | System-spec structure for implementation |
| `CLAUDE.md` | Working rules for AI-assisted development |
| `dev-questions.md` | Open questions awaiting the owner's answers |

Licence: MIT (matching the sibling projects).
