# S15 — Art & Assets

*Feeds: M7 (full set), earlier milestones use placeholders · Depends on: — · Status: skeleton*

## Purpose

Painted Low-Poly Hybrid, shared pipeline with Fireline Command: procedural
sprites baked to a strip PNG (`tools/build_assets.mjs`), width pinned by test;
gallery page rendered through the real renderer for screenshot-diff review.

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

`tools/build_assets.mjs` + `render_asset_strip.mjs` forked from firepower;
strip width pinned by test; gallery page at rest pose screenshot-diffed
(SwiftShader) — visual work reviewable headlessly. Placeholder policy:
flat-color stand-ins with correct footprints from each system's first slice,
so silhouette readability is tested before painting.

## AS BUILT (7a, 2026-08-05) — silhouettes only

**The pipeline in the Purpose section above does not exist yet.** Nothing has
been forked from the sibling; there is no `tools/build_assets.mjs`, no asset
manifest, no strip PNG, no gallery page. Everything in the diorama is an
untextured three.js primitive, and every "portrait" is a text glyph
(`PORTRAIT_GLYPH` in `main.js`), not an image. `find client -name "*.png"`
returns nothing.

What 7a DID do, which is the part that does not need an artist:

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

## To pin — **this is Q41**

`❑` whether to fork the sibling's procedural pipeline (S15 assumes yes; nobody
has done it) · `❑` how portraits are produced, given they are currently glyphs
and D38 wants combinatorial disguise variety rather than a fixed set of images ·
`❑` final tile/figure look, which needs the owner's eye on samples ·
`❑` splash styling.
