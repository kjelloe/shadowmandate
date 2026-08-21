# S15 — Art & Assets

*Feeds: M7 (full set), earlier milestones use placeholders · Depends on: — ·
Status: **AS BUILT** (7a-1…7a-4); the look is pinned (D48). Splash styling open.*

## Purpose

Painted Low-Poly Hybrid, pipeline forked from Fireline Command: **art ships as
code** (D46) — style tokens and a manifest, models built at runtime, nothing
loaded from a binary. A gallery page renders every visual and portrait through
the real renderer for headless review.

*(The sibling additionally bakes sprites to a strip PNG. We took the tokens,
manifest, factory and resolver but not the bake: this project draws 3D
primitives in a diorama, so there is nothing to bake to a sprite sheet.)*

## Asset inventory (V1)

| Asset | Notes | Milestone need |
|---|---|---|
| Urban terrain tiles | street, alley, plaza, block silhouettes, entrance, transit, checkpoint, yard | M1 placeholder, M7 final |
| Agent figure | 3 variants × Firm palette | M2 placeholder |
| Authority patrol figure | uniform + route indicator | M2 |
| Field HQ compound | tent, flag (Firm color), perimeter markers, crate states (deploying/folding) | M3 |
| Dropship | low-poly, Firm livery, door animation frames | M3 |
| Contract site markers | per-type icons (courier, surveillance, extraction, sabotage, vault) | M4 |
| Vehicles | light transport, motorbike, cargo van | M6 |
| Building portraits | informant ×2, vendor ×2 (static images for S09 overlay) | M5/M6 |
| Holding site | compact compound marker | M2 |
| UI chrome | splash terminal font/styling, heat fuzz glyphs, standoff panel | M3–M5 |

## Palettes (pinned from design of record)

Corporate slate/police-blue/white · Insurgent terracotta/tan/teal ·
Mercenary charcoal/warm-gray/amber (+ Ghost and Blade doctrine palettes
reserved for V3). Same color-token system as Fireline.

## Tone guard (D23)

Mild noir: no drugs/gambling/smoking imagery; bribery depicted as envelope/
terminal transaction. Portraits and icons reviewed against this at M7.

## Pipeline & gates

`npm run gallery` renders every visual and portrait through the real renderer
and the real lighting (SwiftShader), so visual work is reviewable headlessly and
screenshot-diffable. `test/art_pipeline.test.js` is the unit gate. Placeholder
policy: flat-colour stand-ins with correct footprints from each system's first
slice, so silhouette readability is settled before painting.

## AS BUILT, step 1 (7a silhouettes, 2026-08-05) — superseded below

*Kept for the reasoning, not the status: at this point nothing had been forked
from the sibling and the pipeline described in Purpose did not exist. The next
two sections are what is true now.*

What the silhouette pass did, which is the part that needs no artist:

- **Silhouettes.** Every marker except the Field HQ was the same sphere,
  separated only by colour — which fails at a glance in a busy street and fails
  completely for a colourblind player. Roles now carry shape: octahedra for
  sites (taller when yours), cylinders for informants, boxes for premises,
  cones for cover shops and for patrols (pointed — a thing that is looking),
  spheres for people. The mapping is a pure table in `client/js/models.js` so
  the DECISION is unit-tested even though the renderer is not; an unknown role
  returns `null` rather than silently defaulting to a sphere.
- **Building mass variation.** Per-instance tint and footprint from a SECOND
  seeded hash draw. Keying tone off the same value as height makes every tall
  block the same shade, which reads as authored rather than grown.

This is the placeholder policy from the Pipeline section working as intended:
flat-colour stand-ins with correct footprints, so silhouette readability is
settled BEFORE painting. Note the sibling reached the same conclusion
independently — its art test asserts team identity via "color AND symbol".

## What the sibling already has, ready to fork

`../firepower/`:

| Piece | What it does |
|---|---|
| `client/assets/metadata/style_tokens.json` | single source of truth for materials and palette; icons and procedural models are GENERATED from it |
| `client/assets/metadata/asset_manifest.json` | manifest-driven visuals, so the renderer holds no hardcoded paths |
| `client/assets/metadata/anchor_points.json` | attachment points |
| `client/js/asset_factory.js` | `buildProcedural`, `applyTeamColor`, `countTriangles` |
| `client/js/asset_resolver.js` | `visualKeyFor`, `resolveVisual`, `manifestEntry` |
| `tools/build_assets.mjs`, `tools/render_asset_strip.mjs` | bake + strip |
| `test/art_pipeline.test.js` | manifest completeness, poly budgets, no hardcoded paths |

Procedural means art ships as CODE: deterministic, diffable, no binary blobs,
no artist in the loop, and testable headlessly — which is why it suits this
project's constraints better than authored models would.

## AS BUILT (7a-1/2/3, 2026-08-05) — the pipeline exists now

**D46 (Q41a): the pipeline is forked and live.** Art ships as code.

```
client/assets/metadata/style_tokens.json    materials, marks, body palette,
                                            Firm identity, triangle budgets, lighting
client/assets/metadata/asset_manifest.json  role -> builder, and the tint it takes
client/js/asset_factory.js                  builders, applyTint, countTriangles
client/js/asset_resolver.js                 role -> visual, manifest access
client/js/assets.js                         load once, share with both surfaces
client/js/portraits.js                      feature-layer portraits (D47)
client/gallery.html + client/js/gallery.js  the review surface
tools/render_gallery.mjs                    `npm run gallery` -> reports/gallery.png
test/art_pipeline.test.js                   the guarantees
```

**The manifest is the seam.** Swapping a procedural stand-in for a painted model
later is a manifest edit, never a renderer edit.

**The tint rule.** Only meshes named `tint` are recoloured at runtime, so an
agent's detection state stays legible without repainting the figure. The test
fails if the manifest claims a tint the model has no slot for — a visual that
accepts a tint and shows nothing is the failure mode that looks like a design
decision.

**Colours left the renderer.** They lived in `scene.js` as literal hex AND were
duplicated into `minimap.js` as separate string literals. The minimap's own
comment said "two views that disagree about what a thing looks like are worse
than one view" — which duplicated constants cannot guarantee. Lighting moved
too: it is art direction, not renderer plumbing, so a look candidate changes the
mood without touching `scene.js`. A guard fails the suite if a colour creeps
back in.

**D47 (Q41b): portraits are feature-layer stacks**, and a disguise is a DIFF on
the stack. The comic requirement — "same agent, big moustache" / "big pink
instead of agent lean black" — is combinatorial, not illustrative: a fixed image
set can only produce six unrelated pictures. Tests assert the promise directly:
the moustache disguise changes *exactly* the moustache layer, the pink glasses
change *exactly* the eyes layer, and no disguise is invisible against the base.

**Found by looking at the gallery, which is why the gallery exists:** the first
figures read as dark blobs and the tintable state band was a pinstripe too thin
to see. Detection state is gameplay information, not styling — if UNSEEN and
BURNED are not tellable apart at a glance the figure has failed at its only job.
Figures now carry a full shoulder yoke, an alerted patrol tints torso and cap,
and the coats were lifted off the night background.

## AS BUILT (7a-4, 2026-08-06) — the tile palette, and a guard that was green for the wrong reason

Writing the docs above turned up that they were **half untrue**. "Colours left
the renderer" held for the marks; it did not hold for the tiles. The tile look —
which is the greater part of Q41c — existed in **three copies across two colour
spaces**: float triples in `terrain3d.js` for the diorama ground, a hand-synced
hex table in `minimap.js` for the radar, and a third inline ramp for building
mass. Nothing kept them equal, and "a candidate look is a token file" was
therefore only true of the figures.

The tile palette, the block tone ramp and the radar backdrop are now
`terrain` in the style tokens, read by both surfaces. Two things worth keeping:

- **The colour-space trap.** These floats are written straight into a
  vertex-colour buffer, so they convert with a plain `/255` and deliberately
  **not** through `THREE.Color`, whose colour management would sRGB-decode them
  and darken the whole ground about fivefold. Recorded because the failure
  renders *successfully*, just wrong — the hardest kind to spot.
- **The guard was green for the wrong reason.** It scanned for `0x......` only,
  while the historical defect — the palette duplicated into `minimap.js` — was
  written as `"#RRGGBB"` strings and would have walked straight past it. It now
  matches both forms across all three world renderers, and is mutation-verified
  with the real defect rather than a convenient one.

Measured drift from the retired float table: worst 3/255 (alley), block ramp
exact — the authored hex winning over a hand-typed approximation.

Also closed in the same pass: the test's role list is **derived from the
manifest** rather than restated (one more copy that could drift), the gallery is
checked to show every visual the game can draw, and `models.js`'s role tables
are checked against the manifest — so a role the renderer can ask for cannot be
missing from either.

## PINNED — D48 (2026-08-06)

`☑` **final tile/figure look — the 7a gallery look is the V1 look.** Owner
reviewed `reports/gallery.png` and approved it as shipped: the marks, body
palette, Firm identity, tile palette and lighting currently in
`style_tokens.json`.

This is *approved* art, not immutable art. Because the whole look is now a token
file, a later revision is an edit rather than a project — which is the entire
point of having done 7a-1 and 7a-4 before asking the question.

`❑` splash styling is still unpinned.

**One honest exception:** portrait colours (skin, hair, frames, hi-vis) still
live in `portraits.js` rather than the tokens, because they read as part of the
layer definitions rather than the world's look. If a look candidate should reach
the faces too, that is a small follow-up and the guard's scope comment says so.

## Playtest 3, finding 3 — the deferred half (2026-08-19)

The dystopian night pass (2026-08-18) shipped the palette, lighting and window
sheet; this closes the two pieces recorded as deferred:

- **The detail pass.** Every builder in `asset_factory.js` was upgraded from
  literal boxes: figures share a `personCore` (legs, boots, flared coat, arms,
  hands) under their class-specific reads (yoke, cap, lamp); kiosks gained
  corner posts, a framed doorway with an awning, a shuttered window and a wall
  vent plus per-variant roof furniture; the HQ is a working camp (comms mast,
  crates, sandbag arc, entrance flap); the dropship has a nose cone, winglets,
  twin fins, cylindrical pods with intake rings and skids. `triBudget` rose to
  700/420/900 (figure/marker/structure) — still a phone constraint (7b) — and
  a new **`triFloor`** (320/100/220) makes the pass *assertable*: a builder
  that quietly regresses to boxes stays under budget and green, and "a feature
  can silently do nothing" is this project's signature failure.
- **Street clutter.** `terrain3d.js` grows `clutterPlacements` (pure,
  node-testable) + `buildClutter` (instanced crates, barrels, vents, tarps;
  colours and density from `terrain.clutter` tokens). The honesty rule applies
  hardest here: clutter lands only on alleys, yards and rough ground (streets
  are the navigation surface), sits outside a 0.2-cell clearance ring around
  every cell centre so it can never cover a standing agent, and stays
  knee-high. The eligible-tile set is PINNED in the test as a deliberate
  duplicate — the first version checked placements against `CLUTTER_TILES`
  itself, which is self-referential: widening the set in code widened the
  check with it, found by mutation.

## Playtest 4, finding 1 — the city view and block massing (2026-08-22)

**The camera** (S12, recorded here with the rest of the look): orthographic,
pitch 45°, azimuth 45° — the classic 1993 isometric read where every building
shows two facades and a roof — default zoom pulled in from 34 to 26 cells.
The compass stays FIXED (no player rotation, same doctrine as ever). Pitch 40
was tried first and buried the streets behind the mass; 45 keeps the tap
surface visible. Two consequences, both learned by screenshot:

- **The clamp must protect the TARGET, not the frame.** Clamping the whole
  rotated view rectangle inside the map pushed the camera 18 cells off an
  agent dropped near a corner — the followed operative left the screen
  entirely. `clampMargin` now bounds the clamped target's worst rotated
  offset inside the view instead; the price is dark backdrop past the map
  edge, and the void is night while the off-screen agent was a bug. The
  promise is asserted over every map position in `test/massing.test.js`.
- **The key light must live on the camera's side.** With the key in the NW
  and the camera in the SE, every visible facade rendered in raw ambient and
  the city read as pure black. Key and bounce swapped sides in the lighting
  tokens (lighting is art direction, D46).
- Rings (own agent, HQ, pinned, re-spray) are HUD affordances and now ignore
  depth — a tower can stand between the camera and your operative, and a HUD
  marker a building can hide is not a HUD marker.

**Block massing** (`blockRegions` / `blockMassing` in terrain3d.js, pure):
contiguous mass cells group into blocks; blocks over 9 cells carve into
2–4-cell-pitch hashed PARCELS; each parcel draws one architectural character —
tower, hut, slab, stepped terrace, courtyard, podium-and-tower, rows,
industrial-with-stacks. Cells of a multi-cell block join at width 1.02
(exactly-touching boxes z-fight; a visible seam splits the building back into
the tower row the pass exists to kill). Tone anchors per parcel, drifts per
cell. Height cap 3.8.

Why parcels: measured on seed 4711, 59% of the map is mass and half the
regions run 21–69 cells — one template across 69 cells is a monolith, which
was the playtest's "wall of windows" verbatim. The honesty rule is untouched:
the drawn footprint is exactly the block tiles, and height still implies
nothing the simulation does not model.
