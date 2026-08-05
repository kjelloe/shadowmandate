// client/js/assets.js — load the art metadata once, share it everywhere (S15,
// D46).
//
// Both the diorama and the minimap draw the same world, and before the pipeline
// they each carried their own copy of the palette as literal hex strings. The
// minimap's own comment said "same colour language as the diorama — two views
// that disagree about what a thing looks like are worse than one view", which
// is exactly right and exactly what duplicated constants cannot guarantee.
// Now both read these tokens.

import { setStyleTokens } from "./asset_factory.js";

let tokens = null;
let manifest = null;

export async function loadArt() {
  if (tokens && manifest) return { tokens, manifest };
  const [t, m] = await Promise.all([
    fetch("assets/metadata/style_tokens.json").then((r) => r.json()),
    fetch("assets/metadata/asset_manifest.json").then((r) => r.json()),
  ]);
  tokens = t; manifest = m;
  setStyleTokens(tokens);
  return { tokens, manifest };
}

export function art() {
  return { tokens, manifest };
}

// Mark colour by name, for the 2D surfaces that draw with CSS colour strings
// rather than three.js materials.
export function mark(name) {
  return tokens?.marks?.[name] ?? "#888888";
}

// The tile palette, shared by the diorama ground and the radar. Throws rather
// than substituting a default: a radar baked from a fallback palette is a
// uniform slab that looks exactly like a citygen bug, and this project has
// already paid once for a render fault that drew "successfully" in the wrong
// colour (the fog bug, S12).
export function terrain() {
  if (!tokens?.terrain) throw new Error("assets: loadArt() must run before terrain is drawn");
  return tokens.terrain;
}
