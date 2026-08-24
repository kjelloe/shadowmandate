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
//
// DETAIL PASS (playtest 3, finding 3 — the deferred half). The first builders
// were literal boxes: one torso, one trouser slab, a head. This pass gives
// figures limbs and structures their furniture, inside raised budgets that are
// still a phone constraint (7b). The floor in triFloor is deliberate: a detail
// pass that quietly regresses to boxes would leave every test green, and "a
// feature can silently do nothing" is this project's signature failure.

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
function torus(r, tube, radSeg, tubSeg, colorHex, token) {
  return new THREE.Mesh(new THREE.TorusGeometry(r, tube, radSeg, tubSeg), mat(colorHex, token));
}

// The one slot a runtime tint is allowed to touch.
function tintable(mesh) {
  mesh.name = "tint";
  return mesh;
}

function place(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }
function tilt(mesh, rx = 0, ry = 0, rz = 0) { mesh.rotation.set(rx, ry, rz); return mesh; }

// ── Figures ────────────────────────────────────────────────────────────────
// The shared humanoid: legs, boots, a coat with a flared hem, arms, hands.
// Agent and rival share it deliberately — they ARE the same kind of thing, and
// the tint plus the coat shade carry the difference (see buildRival).
function personCore(coatHex) {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.12, 0.26, 0.14, C.trouser), -0.08, 0.13, 0));
  g.add(place(box(0.12, 0.26, 0.14, C.trouser), 0.08, 0.13, 0));
  g.add(place(box(0.13, 0.07, 0.18, C.visor), -0.08, 0.035, 0.01));
  g.add(place(box(0.13, 0.07, 0.18, C.visor), 0.08, 0.035, 0.01));
  g.add(place(box(0.34, 0.28, 0.24, coatHex), 0, 0.42, 0));
  g.add(place(box(0.38, 0.12, 0.27, coatHex), 0, 0.29, 0));      // coat hem
  g.add(place(tilt(box(0.09, 0.30, 0.13, coatHex), 0, 0, 0.10), -0.235, 0.42, 0));
  g.add(place(tilt(box(0.09, 0.30, 0.13, coatHex), 0, 0, -0.10), 0.235, 0.42, 0));
  g.add(place(box(0.08, 0.07, 0.10, C.skin), -0.25, 0.25, 0.02));
  g.add(place(box(0.08, 0.07, 0.10, C.skin), 0.25, 0.25, 0.02));
  return g;
}

// An upright person. The tintable band sits at the shoulders where it reads
// from a 52-degree camera without being the whole figure.
function buildAgent() {
  const C = body();
  const g = personCore(C.coat);
  // A full shoulder yoke, not a pinstripe: this is the detection readout.
  g.add(place(tintable(box(0.40, 0.20, 0.28, "#ffffff", "firmPanel")), 0, 0.64, 0));
  g.add(place(box(0.20, 0.06, 0.20, C.coatDark), 0, 0.755, -0.01));  // collar
  g.add(place(sphere(0.125, 12, 9, C.skin), 0, 0.87, 0));
  g.add(place(sphere(0.115, 10, 6, C.visor), 0, 0.915, -0.025));     // hair cap
  return g;
}

// A rival reads as a person too — the shape is the same because they ARE the
// same kind of thing; the tint and the darker coat carry the difference.
function buildRival() {
  const C = body();
  const g = personCore(C.coatDark);
  g.add(place(tintable(box(0.40, 0.20, 0.28, "#ffffff", "firmPanel")), 0, 0.64, 0));
  g.add(place(box(0.20, 0.06, 0.20, C.trouser), 0, 0.755, -0.01));
  g.add(place(sphere(0.125, 12, 9, C.skin), 0, 0.87, 0));
  g.add(place(sphere(0.115, 10, 6, C.visor), 0, 0.915, -0.025));
  return g;
}

// A patrol is a thing that is LOOKING. The peaked cap and visor give it a
// direction-reading silhouette that a person figure does not have.
function buildPatrol() {
  const C = body();
  const g = personCore(C.coatDark);
  // Tinted torso AND cap: an alerted patrol has to be unmissable across a
  // street, which a hat brim alone is not.
  g.add(place(tintable(box(0.40, 0.20, 0.30, "#ffffff", "firmPanel")), 0, 0.62, 0));
  g.add(place(sphere(0.125, 12, 9, C.skin), 0, 0.83, 0));
  g.add(place(tintable(cone(0.20, 0.22, 10, "#ffffff", "firmPanel")), 0, 1.00, 0));
  g.add(place(box(0.26, 0.05, 0.11, C.visor), 0, 0.87, 0.13));
  // A shoulder lamp: the working-kit detail that separates uniform from coat.
  g.add(place(box(0.07, 0.06, 0.07, C.bars), -0.20, 0.735, 0.06));
  g.add(place(cyl(0.02, 0.02, 0.05, 6, C.visor), -0.20, 0.78, 0.06));
  return g;
}

// ── Markers ────────────────────────────────────────────────────────────────
// A site is a place something could happen. Since playtest 5 each SITE TYPE
// has its own centrepiece — a vault reads as a vault before you read any
// label — while the shared plinth-and-halo language keeps them all reading as
// MARKERS rather than as objects the world would collide with, and the
// centrepiece stays the tint slot so contract state still recolours it.
function siteBase() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(cyl(0.30, 0.36, 0.10, 8, C.plinth), 0, 0.05, 0));
  g.add(place(tilt(torus(0.34, 0.025, 6, 14, C.bars), Math.PI / 2), 0, 0.46, 0));
  return g;
}

// A cache: a field footlocker — lid ridge, two straps.
function buildSiteCache() {
  const g = siteBase();
  const C = body();
  g.add(place(tintable(box(0.42, 0.24, 0.30, "#ffffff", "signal")), 0, 0.24, 0));
  g.add(place(box(0.44, 0.05, 0.32, C.visor), 0, 0.385, 0));
  g.add(place(box(0.05, 0.30, 0.33, C.post), -0.12, 0.25, 0));
  g.add(place(box(0.05, 0.30, 0.33, C.post), 0.12, 0.25, 0));
  return g;
}

// A vault: a strongbox with a door ring and a dial.
function buildSiteVault() {
  const g = siteBase();
  const C = body();
  g.add(place(box(0.44, 0.44, 0.36, C.kiosk), 0, 0.32, 0));
  g.add(place(tilt(torus(0.15, 0.03, 6, 12, C.bars)), 0, 0.34, 0.185));
  g.add(place(tintable(cyl(0.07, 0.07, 0.05, 8, "#ffffff", "signal")), 0, 0.34, 0.20));
  g.add(place(box(0.05, 0.05, 0.04, C.visor), 0.15, 0.15, 0.185));   // hinge
  return g;
}

// A lab: a glass dome over benched flasks.
function buildSiteLab() {
  const g = siteBase();
  const C = body();
  g.add(place(box(0.46, 0.16, 0.40, C.kiosk), 0, 0.18, 0));
  g.add(place(tintable(sphere(0.21, 10, 6, "#ffffff", "glass")), 0, 0.34, 0));
  g.add(place(cyl(0.035, 0.045, 0.16, 6, C.canvas), -0.15, 0.34, 0.12));
  g.add(place(cyl(0.03, 0.04, 0.22, 6, C.post), 0.16, 0.37, 0.10));
  return g;
}

// A relay: a mast and a tipped dish, feed horn glowing.
function buildSiteRelay() {
  const g = siteBase();
  const C = body();
  g.add(place(cyl(0.025, 0.035, 0.62, 6, C.post), 0, 0.31, 0));
  g.add(place(tilt(cyl(0.22, 0.05, 0.09, 10, C.bars), 0.7, 0, 0.3), 0.06, 0.62, 0.05));
  g.add(place(tintable(sphere(0.06, 8, 6, "#ffffff", "signal")), 0.13, 0.72, 0.11));
  g.add(place(box(0.16, 0.10, 0.12, C.kiosk), 0, 0.10, 0.14));       // relay hut
  return g;
}

// A transit hub: a sign gantry with a hanging plate.
function buildSiteTransit() {
  const g = siteBase();
  const C = body();
  g.add(place(cyl(0.03, 0.035, 0.66, 6, C.post), -0.28, 0.33, 0));
  g.add(place(cyl(0.03, 0.035, 0.66, 6, C.post), 0.28, 0.33, 0));
  g.add(place(box(0.66, 0.05, 0.06, C.post), 0, 0.66, 0));
  g.add(place(tintable(box(0.40, 0.18, 0.04, "#ffffff", "signal")), 0, 0.52, 0));
  return g;
}

// A warehouse: stacked pallets under a tarp.
function buildSiteWarehouse() {
  const g = siteBase();
  const C = body();
  g.add(place(box(0.24, 0.20, 0.24, C.kiosk), -0.12, 0.20, 0.04));
  g.add(place(box(0.22, 0.18, 0.22, C.post), 0.14, 0.19, -0.06));
  g.add(place(box(0.20, 0.16, 0.20, C.kiosk), 0.0, 0.42, 0));
  g.add(place(tintable(box(0.30, 0.06, 0.30, "#ffffff", "signal")), 0, 0.54, 0));
  return g;
}

// ── Structures ─────────────────────────────────────────────────────────────
// Premises you can walk into. Three distinct roof profiles, because "which shop
// is that" has to be answerable without reading a label. The detail pass hangs
// working-city furniture on all three: corner posts, a framed doorway with an
// awning, a shuttered window, a wall vent.
function kiosk(roofBuilder) {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.72, 0.52, 0.72, C.kiosk), 0, 0.26, 0));
  for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) {
    g.add(place(cyl(0.03, 0.035, 0.56, 6, C.post), x, 0.28, z));
  }
  g.add(place(box(0.26, 0.34, 0.04, C.visor), 0, 0.17, 0.37));          // doorway
  g.add(place(box(0.32, 0.04, 0.05, C.post), 0, 0.36, 0.37));           // lintel
  g.add(place(box(0.04, 0.34, 0.05, C.post), -0.15, 0.17, 0.37));       // jambs
  g.add(place(box(0.04, 0.34, 0.05, C.post), 0.15, 0.17, 0.37));
  g.add(place(tilt(box(0.40, 0.03, 0.22, C.canvas), 0.5), 0, 0.44, 0.44));  // awning
  g.add(place(box(0.24, 0.16, 0.03, C.visor), 0, 0.30, -0.365));        // rear window
  g.add(place(box(0.28, 0.03, 0.04, C.kioskRoof), 0, 0.40, -0.365));    // shutter
  g.add(place(box(0.10, 0.10, 0.03, C.bars), 0.26, 0.40, 0.365));       // wall vent
  const roof = roofBuilder(C);
  g.add(roof);
  g.add(place(tintable(box(0.76, 0.08, 0.10, "#ffffff", "signal")), 0, 0.56, 0.34));
  return g;
}
function buildKioskTall() {
  return kiosk((C) => {
    const g = new THREE.Group();
    g.add(place(cyl(0.14, 0.16, 0.44, 10, C.post), 0, 0.74, 0));
    g.add(place(sphere(0.07, 8, 6, C.bars), 0, 0.99, 0));
    return g;
  });
}
function buildKioskWide() {
  return kiosk((C) => {
    const g = new THREE.Group();
    g.add(place(box(0.88, 0.08, 0.88, C.kioskRoof), 0, 0.56, 0));
    g.add(place(box(0.92, 0.04, 0.92, C.post), 0, 0.62, 0));           // roof lip
    g.add(place(box(0.16, 0.10, 0.16, C.bars), 0.22, 0.69, -0.18));    // rooftop unit
    g.add(place(cyl(0.05, 0.05, 0.06, 8, C.visor), 0.22, 0.77, -0.18)); // its fan
    return g;
  });
}
function buildKioskPeak() {
  return kiosk((C) => {
    const g = new THREE.Group();
    g.add(place(cone(0.56, 0.40, 8, C.kioskRoof), 0, 0.72, 0));
    g.add(place(sphere(0.05, 8, 6, C.bars), 0, 0.94, 0));              // finial
    return g;
  });
}

// Where your people are held: a PRISON BLOCK (playtest 5 — the anchors get
// architecture). Perimeter walls, corner watchtowers, a barred gate, and the
// tint band running over the gate so state still reads at a glance.
function buildHoldingPen() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(1.04, 0.06, 1.04, C.plinth), 0, 0.03, 0));
  // Perimeter walls with a gate gap on the south face.
  g.add(place(box(1.0, 0.34, 0.07, C.kiosk), 0, 0.20, -0.485));
  g.add(place(box(0.07, 0.34, 1.0, C.kiosk), -0.485, 0.20, 0));
  g.add(place(box(0.07, 0.34, 1.0, C.kiosk), 0.485, 0.20, 0));
  g.add(place(box(0.34, 0.34, 0.07, C.kiosk), -0.33, 0.20, 0.485));
  g.add(place(box(0.34, 0.34, 0.07, C.kiosk), 0.33, 0.20, 0.485));
  // Wire coils along the wall tops: one lying along x, two along z.
  g.add(place(tilt(cyl(0.03, 0.03, 0.96, 5, C.bars), 0, 0, Math.PI / 2), 0, 0.40, -0.485));
  g.add(place(tilt(cyl(0.03, 0.03, 0.96, 5, C.bars), Math.PI / 2, 0, 0), -0.485, 0.40, 0));
  g.add(place(tilt(cyl(0.03, 0.03, 0.96, 5, C.bars), Math.PI / 2, 0, 0), 0.485, 0.40, 0));
  // The gate: bars in the south gap.
  for (const x of [-0.10, 0, 0.10]) {
    g.add(place(cyl(0.018, 0.018, 0.32, 5, C.bars), x, 0.19, 0.485));
  }
  // The cell block inside, with a dark slit-window band.
  g.add(place(box(0.56, 0.40, 0.44, C.plinth), -0.08, 0.23, -0.10));
  g.add(place(box(0.58, 0.08, 0.46, C.visor), -0.08, 0.30, -0.10));
  // Corner watchtowers: leg, cabin, cap.
  for (const [x, z] of [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]]) {
    g.add(place(cyl(0.035, 0.045, 0.52, 5, C.post), x, 0.26, z));
    g.add(place(box(0.16, 0.12, 0.16, C.kiosk), x, 0.58, z));
    g.add(place(cone(0.12, 0.09, 4, C.kioskRoof), x, 0.685, z));
  }
  // The state band, arched over the gate.
  g.add(place(tintable(box(0.34, 0.08, 0.10, "#ffffff", "signal")), 0, 0.42, 0.485));
  return g;
}

// The Field HQ: a canvas shelter with a working camp around it — mast, crates,
// a sandbag arc — and a flag. The flag is the tint slot, which is how you find
// your own base at a glance, and how a rival base reads as someone else's from
// the same distance.
function buildFieldHq() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(1.10, 0.10, 1.10, C.plinth), 0, 0.05, 0));
  g.add(place(cone(0.72, 0.52, 8, C.canvas), 0, 0.36, 0));
  g.add(place(tilt(box(0.26, 0.30, 0.03, C.visor), -0.62), 0, 0.22, 0.52));  // entrance flap
  g.add(place(cyl(0.035, 0.035, 0.90, 6, C.post), 0.42, 0.55, 0.42));
  g.add(place(tintable(box(0.34, 0.20, 0.03, "#ffffff", "firmPanel")), 0.60, 0.88, 0.42));
  // Comms mast: an HQ is a place that TALKS to somewhere.
  g.add(place(cyl(0.018, 0.022, 1.05, 6, C.bars), -0.42, 0.62, -0.38));
  g.add(place(box(0.20, 0.02, 0.02, C.bars), -0.42, 1.00, -0.38));
  g.add(place(box(0.13, 0.02, 0.02, C.bars), -0.42, 1.10, -0.38));
  g.add(place(sphere(0.035, 6, 5, C.visor), -0.42, 1.17, -0.38));
  // Supplies.
  g.add(place(box(0.20, 0.16, 0.20, C.kiosk), 0.40, 0.18, -0.36));
  g.add(place(tilt(box(0.16, 0.13, 0.16, C.kioskRoof), 0, 0.5, 0), 0.42, 0.325, -0.33));
  // A sandbag arc guarding the entrance side.
  for (let i = 0; i < 5; i++) {
    const a = -0.55 + i * 0.275;
    const s = place(sphere(0.085, 8, 5, C.kioskRoof), Math.sin(a) * 0.62 - 0.05, 0.115, Math.cos(a) * 0.62);
    s.scale.set(1.25, 0.62, 1);
    g.add(s);
  }
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
  g.add(place(cyl(0.06, 0.08, 0.80, 8, C.post), 0, 0.40, 0));
  g.add(place(cyl(0.015, 0.015, 0.74, 5, C.visor), 0.055, 0.37, 0));   // cable conduit
  g.add(place(box(0.10, 0.06, 0.12, C.bars), 0, 0.79, 0));             // bracket
  // A wide housing and a LONG barrel. The first version was a thin post with a
  // 0.055 lens: legible in a gallery at 1200px, unreadable in the diorama,
  // where the one thing a player must read is which way it is looking. A camera
  // whose direction cannot be seen is an ambush, not a puzzle (D45).
  g.add(place(box(0.30, 0.24, 0.34, C.bars), 0, 0.92, 0));
  // The barrel points along +Z; scene.js turns the group so +Z is the facing.
  g.add(place(cyl(0.09, 0.11, 0.34, 10, C.kioskRoof), 0, 0.92, 0.30));
  // A brow over the lens, so the "front" is obvious even from behind.
  g.add(place(box(0.30, 0.05, 0.16, C.visor), 0, 1.06, 0.20));
  g.add(place(tintable(sphere(0.10, 10, 8, "#ffffff", "glass")), 0, 0.92, 0.46));
  return g;
}

// A junction box (S16 8d): a wall cabinet on a short plinth with a handle and
// its conduits. It has to read as INTERACTIVE at a glance — it is the one
// fixture the player walks up to and uses, rather than avoids.
function buildJunction() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.44, 0.10, 0.34, C.plinth), 0, 0.05, 0));
  g.add(place(box(0.38, 0.46, 0.26, C.kiosk), 0, 0.33, 0));
  g.add(place(cyl(0.025, 0.025, 0.30, 6, C.bars), -0.12, 0.68, -0.06)); // conduits up
  g.add(place(cyl(0.025, 0.025, 0.24, 6, C.bars), 0.10, 0.65, -0.06));
  g.add(place(box(0.30, 0.06, 0.04, C.bars), 0, 0.45, 0.15));           // handle
  g.add(place(box(0.10, 0.08, 0.02, C.kioskRoof), -0.11, 0.36, 0.14));  // hazard plate
  g.add(place(tintable(box(0.30, 0.12, 0.04, "#ffffff", "signal")), 0, 0.24, 0.15));
  return g;
}

// The dropship (S05). Presentation only — it never exists in engine state — but
// it is the first thing a player sees every session, so it gets a silhouette
// rather than a box: a swept wing, a nose, and a lit spine so it reads
// against the night ground while it is still high up.
function buildDropship() {
  const g = new THREE.Group();
  const C = body();
  // SIZED AND LIT TO READ FROM ABOVE. The first version was a 1.7-cell dark
  // grey wing with its identity strip on the UNDERSIDE — which the diorama's
  // top-down camera never sees — and against the night ground it was a smudge
  // the size of a marker. This is the first thing a player sees each session;
  // if it does not read, the whole five seconds are wasted.
  g.add(place(box(0.80, 0.38, 2.10, C.kioskRoof), 0, 0, 0));            // fuselage
  g.add(place(tilt(cone(0.38, 0.55, 8, C.kioskRoof), Math.PI / 2), 0, 0, 1.30)); // nose
  g.add(place(box(2.80, 0.12, 0.70, C.post), 0, 0.10, -0.15));          // wing
  g.add(place(tilt(box(0.34, 0.10, 0.60, C.post), 0, 0, 0.35), -1.48, 0.18, -0.15)); // winglets
  g.add(place(tilt(box(0.34, 0.10, 0.60, C.post), 0, 0, -0.35), 1.48, 0.18, -0.15));
  g.add(place(box(0.90, 0.10, 0.50, C.post), 0, 0.10, -1.05));          // tailplane
  g.add(place(tilt(box(0.06, 0.34, 0.40, C.post), 0, 0, 0.18), -0.40, 0.28, -1.02)); // twin fins
  g.add(place(tilt(box(0.06, 0.34, 0.40, C.post), 0, 0, -0.18), 0.40, 0.28, -1.02));
  g.add(place(box(0.50, 0.26, 0.55, C.visor), 0, 0.22, 0.85));          // canopy
  for (const x of [-1.15, 1.15]) {
    const pod = place(cyl(0.14, 0.17, 0.52, 8, C.bars), x, 0.14, -0.15);
    pod.rotation.x = Math.PI / 2;
    g.add(pod);
    g.add(place(torus(0.16, 0.03, 6, 10, C.visor), x, 0.14, 0.13));     // intake ring
  }
  g.add(place(box(0.05, 0.16, 0.70, C.bars), -0.30, -0.26, 0.20));      // skids
  g.add(place(box(0.05, 0.16, 0.70, C.bars), 0.30, -0.26, 0.20));
  // Identity on the SPINE, where the camera actually looks, and bright enough
  // to separate the silhouette from the ground it flies over.
  g.add(place(tintable(box(0.42, 0.10, 1.80, "#ffffff", "signal")), 0, 0.26, -0.10));
  return g;
}


// S17 ambient life: the sci-fi hover car. A low slab riding a glow, canopy
// forward, headlight cone leading — pure street theatre on the transit
// lanes. The tintable spine varies the coachwork per car.
function buildHoverCar() {
  const g = new THREE.Group();
  const C = body();
  g.add(place(box(0.34, 0.10, 0.78, C.kioskRoof), 0, 0.16, 0));           // hull
  g.add(place(tilt(cone(0.17, 0.22, 6, C.kioskRoof), Math.PI / 2), 0, 0.16, 0.48)); // nose
  g.add(place(box(0.26, 0.10, 0.26, C.visor), 0, 0.24, 0.10));            // canopy
  g.add(place(box(0.30, 0.04, 0.20, C.post), 0, 0.14, -0.42));            // tail
  g.add(place(box(0.10, 0.03, 0.55, C.bars), -0.17, 0.10, 0));            // skirts
  g.add(place(box(0.10, 0.03, 0.55, C.bars), 0.17, 0.10, 0));
  // The headlight: a translucent cone thrown forward at kerb height.
  const beam = cone(0.13, 0.75, 6, "#ffffff");
  beam.material.transparent = true; beam.material.opacity = 0.18;
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.13, 0.95);
  g.add(beam);
  g.add(place(tintable(box(0.22, 0.05, 0.60, "#ffffff", "signal")), 0, 0.235, -0.05));
  return g;
}

const BUILDERS = {
  hoverCar: buildHoverCar,
  camera: buildCamera,
  dropship: buildDropship,
  junction: buildJunction,
  agent: buildAgent,
  rival: buildRival,
  patrol: buildPatrol,
  siteCache: buildSiteCache,
  siteVault: buildSiteVault,
  siteLab: buildSiteLab,
  siteRelay: buildSiteRelay,
  siteTransit: buildSiteTransit,
  siteWarehouse: buildSiteWarehouse,
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
