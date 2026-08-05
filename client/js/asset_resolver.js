// client/js/asset_resolver.js — role → visual key, and manifest access (S15,
// ruling D46). Pure and node-testable.
//
// The renderer asks this module WHAT to show; the manifest and the factory
// decide HOW it looks. That separation is the whole point of the pipeline:
// replacing a procedural stand-in with a painted model later is a manifest
// edit, not a renderer edit, and nothing in `scene.js` needs to know.

export function manifestEntry(manifest, visualKey) {
  return manifest?.figures?.[visualKey]
    ?? manifest?.markers?.[visualKey]
    ?? manifest?.structures?.[visualKey]
    ?? null;
}

// Resolution order: painted model when one exists and is loaded, procedural
// stand-in otherwise. `available` is injected so the browser can check a
// preloaded set and a test can check the filesystem — neither is baked in.
export function resolveVisual(manifest, visualKey, { available = () => false } = {}) {
  const entry = manifestEntry(manifest, visualKey);
  if (!entry) return { kind: "missing", visualKey };
  if (entry.model && available(entry.model)) {
    return { kind: "model", url: entry.model, entry };
  }
  if (entry.procedural) {
    return { kind: "procedural", key: entry.procedural, entry };
  }
  return { kind: "missing", visualKey };
}

// The mark colour a visual takes at runtime. `state` is the one dynamic case:
// an agent's tint is its DETECTION state, which is gameplay information rather
// than identity, so the caller supplies it.
export function tintFor(tokens, entry, stateMark = null) {
  if (!entry || !entry.tint) return null;
  if (entry.tint === "state") return stateMark ? (tokens?.marks?.[stateMark] ?? null) : null;
  return tokens?.marks?.[entry.tint] ?? null;
}

export function firmToken(tokens, firmId) {
  const firms = tokens?.firms ?? [];
  return firms.find((f) => f.id === firmId) ?? firms[0] ?? null;
}

// Detection state (0 unseen, 1 noticed, 2 burned) → mark name. Kept here rather
// than in the renderer so every surface that draws an agent agrees.
export function detectionMark(detection) {
  return detection === 2 ? "agentBurned" : detection === 1 ? "agentNoticed" : "agentUnseen";
}
