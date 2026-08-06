// client/js/asset_factory.js — procedural Painted Low-Poly Hybrid stand-ins
// (S15, ruling D46). Forked from the sibling project's pattern.
//
// Art ships as CODE here: every model is built from style tokens rather than
// loaded from a file. That is deterministic, diffable in review, adds no binary
// blobs, needs no artist in the loop, and — the part that actually matters for
// this project — is testable headlessly, because three.js builds geometry
// perfectly well in node with no DOM.
//
// THE TINT RULE. Each builder may include meshes named "tint". Those are the
// ONLY meshes recoloured at runtime. Everything else is painted from tokens and
// stays put. This is what lets an agent's detection state (unseen / noticed /
// burned) stay legible without repainting the whole figure — the coat stays the
// coat, the state band changes.
//
// Silhouette is the primary carrier of meaning (7a): shape first, colour
// second, because colour alone fails at a glance and fails entirely for a
// colourblind player.

import * as THREE from "three";

let TOKENS = null;

export function setStyleTokens(tokens) {
  TOKENS = tokens;
}

function body() { return TOKENS?.body ?? {}; }

function mat(colorHex, tokenName = "paintedMatte") {
  const m = TOKENS?.materials?.[tokenName] ?? { roughness: 0.85, metalness: 0 };
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex ?? "#888888"),
    roughness: m.roughness, metalness: m.metalness,
  });
}

function box(w, h, d, colorHex, token) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(colorHex, token));
}
function cyl(rTop, rBottom, h, seg, colorHex, token) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat(colorHex, token));
}
function cone(r, h, seg, colorHex, token) {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(colorHex, token));
}
function oct(r, colorHex, token) {
  return new THREE.Mesh(new THREE.OctahedronGeometry(r), mat(colorHex, token));
}
function sphere(r, wSeg, hSeg, colorHex, token) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, wSeg, hSeg), mat(colorHex, token));
}

// The one slot a runtime tint is allowed to touch.
function tintable(mesh) {
  mesh.name = "tint";
  return mesh;
}

function place(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

// ── Figures ────────────────────────────────────────────────────────────────
// An upright person. The tintable band sits at the shoulders where it reads
// from a 52-degree camera without being the whole figure.
function buildAgent() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.34, 0.30, 0.24, C.coat), 0, 0.38, 0));
  g.add(place(box(0.30, 0.22, 0.22, C.trouser), 0, 0.14, 0));
  // A full shoulder yoke, not a pinstripe: this is the detection readout.
  g.add(place(tintable(box(0.40, 0.22, 0.28, "#ffffff", "firmPanel")), 0, 0.64, 0));
  g.add(place(sphere(0.125, 8, 6, C.skin), 0, 0.86, 0));
  return g;
}

// A rival reads as a person too — the shape is the same because they ARE the
// same kind of thing; the tint and the darker coat carry the difference.
function buildRival() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.34, 0.30, 0.24, C.coatDark), 0, 0.38, 0));
  g.add(place(box(0.30, 0.22, 0.22, C.trouser), 0, 0.14, 0));
  g.add(place(tintable(box(0.40, 0.22, 0.28, "#ffffff", "firmPanel")), 0, 0.64, 0));
  g.add(place(sphere(0.125, 8, 6, C.skin), 0, 0.86, 0));
  return g;
}

// A patrol is a thing that is LOOKING. The peaked cap and visor give it a
// direction-reading silhouette that a person figure does not have.
function buildPatrol() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.36, 0.26, 0.26, C.coatDark), 0, 0.35, 0));
  g.add(place(box(0.32, 0.22, 0.24, C.trouser), 0, 0.13, 0));
  // Tinted torso AND cap: an alerted patrol has to be unmissable across a
  // street, which a hat brim alone is not.
  g.add(place(tintable(box(0.40, 0.20, 0.30, "#ffffff", "firmPanel")), 0, 0.60, 0));
  g.add(place(sphere(0.125, 8, 6, C.skin), 0, 0.80, 0));
  g.add(place(tintable(cone(0.21, 0.24, 7, "#ffffff", "firmPanel")), 0, 0.98, 0));
  g.add(place(box(0.26, 0.06, 0.10, C.visor), 0, 0.84, 0.12));
  return g;
}

// ── Markers ────────────────────────────────────────────────────────────────
// A site is a place something could happen: a floating octahedron over a small
// plinth, so it reads as a marker rather than as an object in the world.
function buildSiteMarker() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(cyl(0.30, 0.36, 0.10, 6, C.plinth), 0, 0.05, 0));
  g.add(place(tintable(oct(0.30, "#ffffff", "signal")), 0, 0.46, 0));
  return g;
}

// ── Structures ─────────────────────────────────────────────────────────────
// Premises you can walk into. Three distinct roof profiles, because "which shop
// is that" has to be answerable without reading a label.
function kiosk(roofBuilder) {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.72, 0.52, 0.72, C.kiosk), 0, 0.26, 0));
  g.add(place(box(0.26, 0.34, 0.04, C.visor), 0, 0.17, 0.37));   // doorway
  const roof = roofBuilder(C);
  g.add(roof);
  g.add(place(tintable(box(0.76, 0.08, 0.10, "#ffffff", "signal")), 0, 0.56, 0.34));
  return g;
}
function buildKioskTall() {
  return kiosk((C) => place(cyl(0.16, 0.16, 0.44, 8, C.post), 0, 0.74, 0));
}
function buildKioskWide() {
  return kiosk((C) => place(box(0.88, 0.10, 0.88, C.kioskRoof), 0, 0.57, 0));
}
function buildKioskPeak() {
  return kiosk((C) => place(cone(0.56, 0.40, 6, C.kioskRoof), 0, 0.72, 0));
}

// Where your people are held. Bars, so it is unmistakable.
function buildHoldingPen() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.90, 0.08, 0.90, C.plinth), 0, 0.04, 0));
  for (const [x, z] of [[-0.40, -0.40], [0.40, -0.40], [-0.40, 0.40], [0.40, 0.40]]) {
    g.add(place(cyl(0.05, 0.05, 0.62, 5, C.bars), x, 0.39, z));
  }
  g.add(place(tintable(box(0.94, 0.09, 0.94, "#ffffff", "signal")), 0, 0.72, 0));
  return g;
}

// The Field HQ: a canvas shelter and a flag. The flag is the tint slot, which
// is how you find your own base at a glance, and how a rival base reads as
// someone else's from the same distance.
function buildFieldHq() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(1.10, 0.10, 1.10, C.plinth), 0, 0.05, 0));
  g.add(place(cone(0.72, 0.52, 4, C.canvas), 0, 0.36, 0));
  g.add(place(cyl(0.035, 0.035, 0.90, 5, C.post), 0.42, 0.55, 0.42));
  g.add(place(tintable(box(0.34, 0.20, 0.03, "#ffffff", "firmPanel")), 0.60, 0.88, 0.42));
  return g;
}

// A camera on a post (S16 8b). It must be findable at a glance and readable at
// a glance in TWO ways: where it is, and which way it is pointing — a stealth
// obstacle the player cannot see is not a puzzle, it is an ambush. The barrel
// is the direction cue; scene.js rotates the whole group to the facing the
// server reports. The lens is the tint slot, so a disabled camera (8d) can go
// dark without rebuilding the model.
function buildCamera() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(cyl(0.06, 0.08, 0.80, 5, C.post), 0, 0.40, 0));
  // A wide housing and a LONG barrel. The first version was a thin post with a
  // 0.055 lens: legible in a gallery at 1200px, unreadable in the diorama,
  // where the one thing a player must read is which way it is looking. A camera
  // whose direction cannot be seen is an ambush, not a puzzle (D45).
  g.add(place(box(0.30, 0.24, 0.34, C.bars), 0, 0.92, 0));
  // The barrel points along +Z; scene.js turns the group so +Z is the facing.
  g.add(place(cyl(0.09, 0.11, 0.34, 6, C.kioskRoof), 0, 0.92, 0.30));
  // A brow over the lens, so the "front" is obvious even from behind.
  g.add(place(box(0.30, 0.05, 0.16, C.visor), 0, 1.06, 0.20));
  g.add(place(tintable(sphere(0.10, 7, 6, "#ffffff", "glass")), 0, 0.92, 0.46));
  return g;
}

// A junction box (S16 8d): a wall cabinet on a short plinth with a handle. It
// has to read as INTERACTIVE at a glance — it is the one fixture the player
// walks up to and uses, rather than avoids.
function buildJunction() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.44, 0.10, 0.34, C.plinth), 0, 0.05, 0));
  g.add(place(box(0.38, 0.46, 0.26, C.kiosk), 0, 0.33, 0));
  g.add(place(box(0.30, 0.06, 0.04, C.bars), 0, 0.45, 0.15));      // handle
  g.add(place(tintable(box(0.30, 0.12, 0.04, "#ffffff", "signal")), 0, 0.24, 0.15));
  return g;
}

const BUILDERS = {
  camera: buildCamera,
  junction: buildJunction,
  agent: buildAgent,
  rival: buildRival,
  patrol: buildPatrol,
  siteMarker: buildSiteMarker,
  kioskTall: buildKioskTall,
  kioskWide: buildKioskWide,
  kioskPeak: buildKioskPeak,
  holdingPen: buildHoldingPen,
  fieldHq: buildFieldHq,
};

export function proceduralKeys() {
  return Object.keys(BUILDERS);
}

export function buildProcedural(key) {
  const builder = BUILDERS[key];
  if (!builder) return null;
  const g = builder();
  g.userData.proceduralKey = key;
  return g;
}

// Recolour only the meshes the tint rule allows. Returns how many it touched,
// so a caller (or a test) can tell "tinted nothing" from "tinted something" —
// a visual that silently accepts a tint and shows none is the failure mode.
export function applyTint(group, colorHex) {
  let touched = 0;
  group.traverse((o) => {
    if (o.isMesh && o.name === "tint") {
      o.material.color.set(colorHex);
      touched++;
    }
  });
  return touched;
}

export function countTriangles(object3d) {
  let tris = 0;
  object3d.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    tris += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(tris);
}
