# S01 — World & Urban Mapgen

*Feeds: M1 · Depends on: — · Status: skeleton, core pinned*

## Purpose

Seeded generation of a city-region with a recognisable identity: districts,
road/alley network, transit lines, contract sites, buildings, drop zones,
patrol routes. Deterministic from `(seed, ruleset)`; validated by probes.

## Engine contract

- Module: `engine/citygen.js` (replaces firepower map modules); helpers stay in
  `engine/terrain.js`, `engine/route_graph.js`.
- Static world reconstructs from `(ruleset, template, seed)`; only dynamic
  truth is stored (firepower doctrine).
- Sizes: generator parameterised by `world.size` ∈ {64, 128}; both sizes pass
  all probes (D26). Ship config: 64.

### Terrain tiles (extends firepower set)

Existing kept: `road`, `rough`, `forest`, `river`, `open`.
New urban: `street`, `alley`, `plaza`, `block` (impassable building mass),
`entrance` (building door cell), `transit` (fast lane), `checkpoint`
(authority, active at heat ≥4), `yard` (cover terrain).

`❑ pin` movement/cover modifiers per tile (S02/S03 own the numbers; table
lives in `data/terrain.json`).

### Districts

- 3–5 per map; each has `trait` ∈ {industrial, residential, commercial,
  government, research, port}, a contiguous cell region, a heat cell (S03),
  and a patrol budget.
- District identity drives: building density, patrol density, contract-type
  weights, vendor/informant placement.

### Sites

- `ContractSite`: typed marker on/adjacent to a building or yard; 12–20/map;
  spacing probe-enforced.
- `Building` (interactive): has an `entrance` cell and an interior payload
  reference (dialogue/shop id — S09). Non-interactive blocks are terrain only.
- `HoldingSite`: 1 per district ≥ a minimum size (S04 capture destination).
- Safe houses (informants), market buildings (vendors): per-district placement.

### Drop zones

- Candidate cells: open/yard/plaza, ≥ `dropzone.minClearRadius` from patrol
  routes and any deployed HQ; recomputed live at drop-in (occupied world).
- Probe guarantees ≥3 valid zones per district in an empty world.

## Ruleset data (`data/citygen.json`)

`world.size`, district count range, trait weights, road/alley density,
site counts, spacing minima, dropzone clear radius, patrol budget per trait.

## Validation probes (run per generated map, and in the 20-seed corpus gate)

1. Route redundancy: ≥2 disjoint street routes between any two district cores.
2. Site spacing ≥ `sites.minSpacing`; every site reachable on foot.
3. Patrol coverage: patrol routes touch every district; no unpatrolled tier-3
   site (risk must be real).
4. Drop-zone availability: ≥3 per district (empty world).
5. Entrance validity: every interactive building's entrance is street/alley
   adjacent and pathable.
6. Mirror check: generator output mirrors cleanly (fairness instrument S14).

## Fireline reuse

`terrain.js` (extend), `route_graph.js`, `pathfind.js` (unchanged),
`mapgen.js` (gutted → citygen), `sites.js` (adapted).

## Gates & fixtures

8×8 microscope fixture (human-inspectable) before full-size; two pinned
reference seeds (named identities, e.g. "the divided waterfront"); 20-seed
corpus at 64 AND 128 passes probes 1–6.

## AS BUILT (M1, 2026-08-04) — `engine/citygen.js`, `engine/worldprobes.js`

Implemented and green: 20-seed corpus passes all six probes at **both 64 and
128**. Reference seeds pinned: **4711, 90210**. Microscope at
`test/fixtures/microscope.txt` (`node tools/render_city.mjs 4711 16 5`).

**Deviations from this spec, and why:**
- **Main-component rule (new, load-bearing).** District dressing turns block
  mass back into open ground, and some of those cells are interior courtyards
  enclosed by buildings — reachable-looking and utterly unreachable. Every
  placement now samples only from the component connected to the street
  network. Without this, sites and holding sites strand.
- **District cores snap to the ROUTE network**, not merely to "reachable".
  A core in a courtyard joined by one carved cell made legitimate maps look
  choked. A core is by definition a place on the road.
- **Patrol routes are a nearest-neighbour tour over the district's own road
  cells**, not a geometric ring. A ring intersected with dense building mass
  filtered below the minimum length and left whole districts unpatrolled.
- **Site floor raised 12 → 16** (Q31) so phase-1 contract work exists at all;
  see S06's D18/D19 conflict note.

## To pin

`❑` exact tile modifier table (with S02/S03) · `❑` district trait → contract
weight table (with S06) · `⚙ tune` all densities/counts after M5 batteries.
