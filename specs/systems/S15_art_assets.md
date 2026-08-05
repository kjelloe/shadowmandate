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

## To pin — **Q41c, the owner's call**

`❑` **final tile/figure look.** The pipeline makes this cheap to answer: a
candidate look is a token file, not a rewrite. Run `npm run gallery` and look at
`reports/gallery.png`. · `❑` splash styling.
