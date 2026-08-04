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

## To pin

`❑` final tile/figure look (art samples at M7, mobile readability test —
firepower's pending art-direction discipline applies) · `❑` splash styling.
