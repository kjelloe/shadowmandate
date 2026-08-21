// client/js/scene.js — the 2.5D diorama (S12).
//
// An orthographic camera at the classic 1993 isometric view (playtest 4): 45-degree
// azimuth so every building shows two facades and a roof, pitched at 40
// degrees, close enough to read doorways. STILL no player rotation — a fixed
// compass keeps a stealth map readable, and a player who can spin the world
// loses their sense of where the patrol was.
//
// The camera CLAMPS to the map. Without that, dropping near a corner leaves
// half the screen showing nothing — which is exactly what playtest 2 saw and
// reasonably read as "off centre".

import * as THREE from "three";
import { buildGround, buildBlocks, buildClutter, setTerrainTokens } from "./terrain3d.js";
import { siteRoles, objectiveCell, buildingRole, siteRole, burnedGuidance, pinnedCells } from "./models.js";
import { buildProcedural, applyTint } from "./asset_factory.js";
import { resolveVisual, tintFor, detectionMark } from "./asset_resolver.js";
import { art } from "./assets.js";

export const CELL = 256;   // world units per cell, matching the engine

// Engine octants are 0=E 1=NE 2=N 3=NW 4=W 5=SW 6=S 7=SE, on a grid where +x is
// east and +y is SOUTH; the diorama maps engine y onto scene +z.
//
// DERIVED, NOT GUESSED. A model's barrel points along +Z, and `rotation.y = t`
// sends +Z to (sin t, 0, cos t). Facing south (engine +y, scene +z) therefore
// needs t = 0, and each octant anticlockwise adds an eighth turn:
//
//   t = octant * PI/4 + PI/2
//
// The first version of this line was `-PI/2 + octant * PI/4` — off by PI, which
// points EVERY camera at its own back. It was checked against the eight unit
// vectors rather than eyeballed, because a camera facing exactly the wrong way
// renders perfectly and reads as a plausible piece of set dressing; the test
// below pins all eight so it cannot drift back.
export function octantToRadians(octant) {
  return (octant & 7) * (Math.PI / 4) + Math.PI / 2;
}

// The palette used to live here as literal hex, duplicated into the minimap.
// It now lives in client/assets/metadata/style_tokens.json, which is the single
// source of truth for both surfaces (D46) — test/art_pipeline.test.js fails if
// a colour creeps back into this file.

// How far from the map edge the camera TARGET must be clamped so the thing
// being followed stays on screen under a rotated view. The first cut clamped
// the whole rotated view rectangle inside the map — which near a corner
// pushed the camera 18 cells off the agent, and an off-screen operative is a
// worse failure than dark backdrop past the map edge (the void is night; the
// missing agent is a bug). A clamped target's worst per-axis offset is the
// margin itself, and rotation stretches that offset by at most
// |cos az| + |sin az| along either screen axis, so keeping
// margin * (|cos| + |sin|) inside the tighter half-extent keeps the target
// visible everywhere. Pure, because this is exactly the kind of maths that
// renders "wrong but plausibly".
export function clampMargin(halfX, halfY, pitch, azimuth) {
  const halfYg = halfY / Math.sin(pitch);
  const c = Math.abs(Math.cos(azimuth)), s = Math.abs(Math.sin(azimuth));
  return Math.min(halfX, halfYg) / (c + s);
}

// Clamp so the visible frustum stays inside the map when the map is larger
// than the view, and centre it when it is smaller.
export function clampCamera(target, size, halfSpanX, halfSpanY) {
  const clampAxis = (v, half) => {
    if (size <= half * 2) return size / 2;
    return Math.min(size - half, Math.max(half, v));
  };
  return { x: clampAxis(target.x, halfSpanX), y: clampAxis(target.y, halfSpanY) };
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const { tokens, manifest } = art();
  renderer.setClearColor(new THREE.Color(tokens.lighting.clear));
  setTerrainTokens(tokens.terrain);

  const scene = new THREE.Scene();
  // NO FOG. The first version set Fog(colour, 40, 110) — but an orthographic
  // camera pitched from 90 units up sits well over 110 units from the
  // ground, so EVERY fragment fell beyond fog.far and rendered as 100% fog
  // colour. Fog colour equalled clear colour, so the scene drew perfectly and
  // was completely invisible: an empty-looking canvas with no error anywhere.
  // If depth cueing is wanted later, derive the range from CAMERA_DISTANCE
  // below rather than guessing constants.

  // Light from the north-west, low: long shadows read as evening, and the
  // painted low-poly look wants shape more than brightness.
  const L = tokens.lighting;
  const key = new THREE.DirectionalLight(new THREE.Color(L.key.color), L.key.intensity);
  key.position.set(...L.key.position);
  scene.add(key);
  scene.add(new THREE.AmbientLight(new THREE.Color(L.ambient.color), L.ambient.intensity));
  const bounce = new THREE.DirectionalLight(new THREE.Color(L.bounce.color), L.bounce.intensity);
  bounce.position.set(...L.bounce.position);
  scene.add(bounce);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  let zoomCells = 26;          // how many cells fit across the view — pulled
                               // in for playtest 4: a city only reads as a
                               // city when you are close enough to see facades
  let mapSize = 64;
  let terrain = null;
  const markers = new THREE.Group();
  scene.add(markers);

  // A pool of reusable procedural groups, keyed by visual role: markers change
  // every tick and allocating per frame would make the GC the bottleneck.
  const pool = [];
  // One geometry per silhouette, shared by every marker of that shape. Kept
  // low-poly on purpose: these are read at a glance from a tilted camera, and
  // the client must stay cheap enough for a phone.
  // The one piece of geometry that is not a manifest visual: the ring under
  // your own operative, which is a HUD affordance rather than a thing in the
  // world — it is how you find yourself in a busy street.
  const ringGeo = new THREE.TorusGeometry(0.62, 0.07, 6, 18);
  const warned = new Set();
  // The objective beacon: a tall thin column you can see over building mass,
  // which is the whole point — an objective you can only see when you are
  // already standing on it is not a marker.
  const beamGeo = new THREE.CylinderGeometry(0.16, 0.16, 9, 8);
  const haloGeo = new THREE.TorusGeometry(1.25, 0.1, 6, 24);
  let beacon = null, halo = null;

  // Ask the resolver WHAT to show; the manifest and factory decide HOW. A role
  // the manifest does not know draws nothing and says so, rather than quietly
  // rendering as something else.
  function takeVisual(role, stateMark = null) {
    const resolved = resolveVisual(manifest, role);
    if (resolved.kind !== "procedural") {
      if (!warned.has(role)) { warned.add(role); console.warn(`no visual for role "${role}"`); }
      return null;
    }
    let m = pool.find((x) => !x.inUse && x.role === role);
    if (!m) {
      const group = buildProcedural(resolved.key);
      if (!group) return null;
      m = { role, group, inUse: false };
      pool.push(m);
      markers.add(group);
    }
    m.inUse = true;
    m.group.visible = true;
    const tint = tintFor(tokens, resolved.entry, stateMark);
    if (tint) applyTint(m.group, tint);
    return m.group;
  }

  // A beam is a variable-length line rather than a fixed model, so it is drawn
  // from a shared unit box rather than through the manifest — but its COLOURS
  // still come from tokens, like everything else (D46). Live and dark are
  // wildly different on purpose: this is the one mechanic whose whole
  // counter-play is reading the state at a glance and moving.
  const beamGeoUnit = new THREE.BoxGeometry(1, 1, 1);
  function takeBeam(colour, live) {
    let m = pool.find((x) => !x.inUse && x.role === "__beam");
    if (!m) {
      const mesh = new THREE.Mesh(beamGeoUnit, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.85,
      }));
      m = { role: "__beam", group: mesh, inUse: false };
      pool.push(m);
      markers.add(mesh);
    }
    m.inUse = true;
    m.group.visible = true;
    m.group.material.color.set(colour);
    // A dark beam stays visible but recedes: you must still be able to SEE
    // where the line is in order to plan a crossing through its gap.
    m.group.material.opacity = live ? 0.85 : 0.25;
    return m.group;
  }

  function takeRing(colour) {
    let m = pool.find((x) => !x.inUse && x.role === "__ring");
    if (!m) {
      // Rings are HUD affordances, not things in the world — and the 40-degree
      // camera lets a tower stand between you and your own operative. A HUD
      // marker a building can hide is not a HUD marker, so rings ignore depth
      // and draw after the world.
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshLambertMaterial({
        color: colour, depthTest: false,
      }));
      mesh.renderOrder = 5;
      mesh.rotation.x = -Math.PI / 2;
      m = { role: "__ring", group: mesh, inUse: false };
      pool.push(m);
      markers.add(mesh);
    }
    m.inUse = true;
    m.group.visible = true;
    m.group.material.color.set(colour);
    // Pooled rings are shared across users; the re-spray ping scales its ring
    // per frame, so every take starts from neutral or the pulse leaks onto
    // whatever ring happens to reuse this slot next frame.
    m.group.scale.setScalar(1);
    return m.group;
  }

  function ensureBeacon() {
    if (beacon) return;
    beacon = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.marks.siteActive), transparent: true, opacity: 0.5,
    }));
    halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.marks.siteActive), transparent: true, opacity: 0.85,
    }));
    halo.rotation.x = -Math.PI / 2;
    scene.add(beacon); scene.add(halo);
  }

  // S05 dropship choreography. Presentation only: it is driven by a wall clock
  // the caller owns, never by the tick, because it is not simulation and must
  // not depend on the world's pacing.
  let dropship = null;
  function drawDropship(flight, hqCell) {
    if (!flight || !hqCell) {
      if (dropship) dropship.visible = false;
      return;
    }
    if (!dropship) {
      const resolved = resolveVisual(manifest, "dropship");
      if (resolved.kind !== "procedural") return;
      dropship = buildProcedural(resolved.key);
      if (!dropship) return;
      const tint = tintFor(tokens, resolved.entry);
      if (tint) applyTint(dropship, tint);
      scene.add(dropship);
    }
    dropship.visible = true;
    // Comes in along the SCREEN horizontal — the ground direction perpendicular
    // to the view azimuth — so the wing reads broadside to a camera that never
    // rotates; the model's nose is +z, hence atan2 of the axis.
    const ax = Math.cos(AZIMUTH), az = -Math.sin(AZIMUTH);
    dropship.position.set(
      hqCell.x + 0.5 + ax * flight.offsetCells,
      flight.height,
      hqCell.y + 0.5 + az * flight.offsetCells);
    dropship.rotation.y = flight.offsetCells <= 0 ? Math.atan2(ax, az) : Math.atan2(-ax, -az);
  }

  function setTerrain(tiles, size, seed) {
    if (terrain) { scene.remove(terrain); terrain = null; }
    mapSize = size;
    terrain = new THREE.Group();
    terrain.add(buildGround(tiles, size, seed));
    const blocks = buildBlocks(tiles, size, seed);
    if (blocks) terrain.add(blocks);
    const clutter = buildClutter(tiles, size, seed);
    if (clutter) terrain.add(clutter);
    scene.add(terrain);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const halfX = zoomCells / 2;
    const halfY = halfX / aspect;
    camera.left = -halfX; camera.right = halfX;
    camera.top = halfY; camera.bottom = -halfY;
    camera.updateProjectionMatrix();
    return true;
  }

  // The tilt (playtest 4: "the city does not look like a city"). Pitch 45
  // rather than the old 52 — low enough that facades carry the frame instead
  // of roofs, high enough that the streets the player actually taps stay
  // visible between the towers (40 was tried and buried them) — and a
  // 45-degree azimuth so every building shows two faces, the classic genre
  // read. The azimuth is a constant, not a control: the compass stays fixed
  // on purpose (see the header note).
  const PITCH = 45 * (Math.PI / 180);
  const AZIMUTH = 45 * (Math.PI / 180);
  const HEIGHT = 90;
  // Exported so anything depth-related (fog, near/far) is derived from the
  // real distance instead of a constant somebody guessed.
  const CAMERA_DISTANCE = Math.sqrt(HEIGHT ** 2 + (HEIGHT / Math.tan(PITCH)) ** 2);

  function place(target) {
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const halfX = zoomCells / 2;
    const halfY = halfX / aspect;
    const margin = clampMargin(halfX, halfY, PITCH, AZIMUTH);
    const c = clampCamera(target, mapSize, margin, margin);
    const back = HEIGHT / Math.tan(PITCH);
    camera.position.set(c.x + back * Math.sin(AZIMUTH), HEIGHT, c.y + back * Math.cos(AZIMUTH));
    camera.lookAt(c.x, 0, c.y);
    return c;
  }

  function draw(view, pinnedIds = null) {
    if (!view || !resize()) return;
      for (const m of pool) { m.inUse = false; m.group.visible = false; }

    const own = view.agents?.find((a) => a.state === 1) ?? view.agents?.[0];
    const target = own
      ? { x: own.x / CELL, y: own.y / CELL }
      : view.hq ? { x: view.hq.cellX + 0.5, y: view.hq.cellY + 0.5 }
        : { x: view.size / 2, y: view.size / 2 };
    place(target);

    // Procedural visuals stand ON the ground; their own geometry carries the
    // height, so the renderer no longer guesses a lift per marker type.
    const at = (obj, cx, cy, h = 0) => { if (obj) obj.position.set(cx, h, cy); return obj; };

    // What a site MEANS to this player — the job you took, something on your
    // board, or scenery — is carried by shape and tint together (7a).
    const roles = siteRoles(view);
    for (const s of view.sites) {
      at(takeVisual(siteRole(roles.get(s.id))), s.cellX + 0.5, s.cellY + 0.5);
    }
    for (const b of view.buildings) {
      at(takeVisual(buildingRole(b.kind)), b.cellX + 0.5, b.cellY + 0.5);
    }
    for (const h of view.holdingSites) at(takeVisual("holding"), h.cellX + 0.5, h.cellY + 0.5);
    if (view.hq) {
      at(takeVisual("ownHq"), view.hq.cellX + 0.5, view.hq.cellY + 0.5);
      // The ring under the tent is the HQ's EMBLEM (playtest 3): the tent
      // model alone read as one more dark structure, and a player two streets
      // away had nothing on screen that said "home". Same HUD-affordance ring
      // as the one under the operative, in the Firm's own mark.
      at(takeRing(tokens.marks.ownHq), view.hq.cellX + 0.5, view.hq.cellY + 0.5, 0.12);
    }
    for (const h of view.rivalHqs) at(takeVisual("rivalHq"), h.cellX + 0.5, h.cellY + 0.5);
    for (const p of view.patrols) {
      at(takeVisual(p.alerted ? "patrolAlert" : "patrol"), p.x + 0.5, p.y + 0.5);
    }
    // Sensor beams (S16 8c). Drawn low and thin, spanning both endpoints, so
    // the line you must not be standing in is unambiguous.
    for (const x of view.beams ?? []) {
      const mesh = takeBeam(tokens.marks[x.live ? "beamLive" : "beamDark"], x.live);
      const ax = x.cellX + 0.5, az = x.cellY + 0.5;
      const bx = x.toX + 0.5, bz = x.toY + 0.5;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      mesh.position.set((ax + bx) / 2, 0.16, (az + bz) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.scale.set(len + 0.9, 0.06, 0.14);
    }
    for (const j of view.junctions ?? []) {
      at(takeVisual(j.cut ? "junctionCut" : "junction"), j.cellX + 0.5, j.cellY + 0.5);
    }
    // Cameras (S16 8b). The FACING is the whole point: a camera you can see but
    // cannot read the direction of is still an ambush, and D45 requires the
    // challenge to be legible in the world. The model's barrel points along +Z,
    // so the group is turned to the octant the server reports.
    for (const c of view.cameras ?? []) {
      const obj = takeVisual(c.disabled ? "cameraDisabled" : "camera");
      if (!obj) continue;
      at(obj, c.cellX + 0.5, c.cellY + 0.5);
      obj.rotation.y = octantToRadians(c.facing);
    }
    for (const r of view.rivals) at(takeVisual("rival"), r.x / CELL, r.y / CELL);
    for (const a of view.agents) {
      // The agent's tint is its DETECTION state — gameplay information, so it
      // comes from the resolver rather than being decided here.
      const stateMark = detectionMark(a.detection);
      at(takeVisual("agent", stateMark), a.x / CELL, a.y / CELL);
      // The ring is how you find your own operative in a busy street. It is a
      // HUD affordance rather than a thing in the world, so it is not a
      // manifest visual.
      at(takeRing(tokens.marks[stateMark]), a.x / CELL, a.y / CELL, 0.12);
    }
    // Pinned contracts (playtest 3): a steady watched-ring at each pinned
    // objective, in the pinned mark — the pulse stays reserved for the
    // CURRENT objective below.
    for (const p of pinnedCells(view, pinnedIds)) {
      at(takeRing(tokens.marks.pinned), p.cellX + 0.5, p.cellY + 0.5, 0.12);
    }
    // Burned (playtest 3): mark the nearest cover shop in the world with a
    // breathing ring in the shop's colour, matching the radar ping.
    const respray = burnedGuidance(view);
    if (respray) {
      const ring = takeRing(tokens.marks.coverShop);
      if (ring) {
        at(ring, respray.cellX + 0.5, respray.cellY + 0.5, 0.12);
        ring.scale.setScalar(1 + 0.35 * (0.5 + 0.5 * Math.sin(view.tick / 3)));
      }
    }
    // The objective beacon, pulsing so it reads as live rather than painted on.
    const objective = objectiveCell(view);
    if (objective) {
      ensureBeacon();
      const pulse = 0.5 + 0.35 * Math.sin(view.tick / 4);
      beacon.visible = true; halo.visible = true;
      beacon.position.set(objective.cellX + 0.5, 4.5, objective.cellY + 0.5);
      beacon.material.opacity = 0.25 + 0.25 * pulse;
      halo.position.set(objective.cellX + 0.5, 0.08, objective.cellY + 0.5);
      halo.scale.setScalar(0.85 + 0.3 * pulse);
      halo.material.opacity = 0.5 + 0.4 * pulse;
    } else if (beacon) {
      beacon.visible = false; halo.visible = false;
    }

    renderer.render(scene, camera);
  }

  // Screen -> cell, by intersecting the ground plane. Tap-to-move needs this
  // to be right or the game feels broken in the most basic way.
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function screenToCell(sx, sy) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ndc = new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return { x: Math.floor(hit.x), y: Math.floor(hit.z) };
  }

  return {
    draw, resize, setTerrain, screenToCell, drawDropship,
    cameraDistance: () => CAMERA_DISTANCE,
    hasTerrain: () => terrain !== null,
    zoomBy(f) { zoomCells = Math.max(14, Math.min(70, zoomCells * f)); resize(); },
  };
}
