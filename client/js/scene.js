// client/js/scene.js — the 2.5D diorama (S12).
//
// An orthographic camera at the classic 1993 isometric view (playtest 4): 45-degree
// azimuth so every building shows two facades and a roof, pitched at 40
// degrees, close enough to read doorways.
//
// ROTATION IS QUARTER-TURNS ONLY (playtest 13, finding 3). The old rule here was
// "no player rotation at all", for a real reason — a freely spinnable world
// destroys your sense of where the patrol was. But a fixed compass also means
// the two facades pointing away from the camera are permanently unknowable, and
// a stealth game where you cannot look behind a building is hiding the board
// from the player. The compromise keeps both: FOUR discrete azimuths, all in
// the 45-degree family, so every view is the same readable two-facade read and
// the compass has four memorable states rather than a continuum.
//
// The camera CLAMPS to the map. Without that, dropping near a corner leaves
// half the screen showing nothing — which is exactly what playtest 2 saw and
// reasonably read as "off centre".
//
// MOTION IS SMOOTHED HERE, not in the engine. Snapshots arrive at 10Hz and the
// engine is cell-granular indoors, so drawing raw positions renders as the
// "completely jerky, lag skip" playtest 13 saw. Every mover is eased toward its
// reported position by `smoothTo`, and the frame loop runs on rAF instead of on
// arrival — the simulation stays exactly as discrete as it was.

import * as THREE from "three";
import { buildGround, buildBlocks, buildClutter, buildRoads, setTerrainTokens } from "./terrain3d.js";
import { buildArea, setAreaTokens } from "./area3d.js";
import { siteRoles, objectiveCell, buildingRole, siteVisual, burnedGuidance, coverShops, pinnedCells, hqInBuilding, moveTarget, walkOffset, ARRIVE_CLAMP, areaView, transitLanes, hoverCarsAt } from "./models.js";
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

// The four sanctioned camera azimuths (playtest 13, finding 3). Quarter turns
// off the base 45 degrees: every one of them shows two facades, so rotating
// never lands on the flat single-facade view that reads as a different game.
export const BASE_AZIMUTH = 45 * (Math.PI / 180);
export function azimuthFor(quarter) {
  return BASE_AZIMUTH + (((quarter % 4) + 4) % 4) * (Math.PI / 2);
}

// Screen drag -> ground displacement of the camera TARGET, so the world
// follows the cursor under a right-drag.
//
// DERIVED, NOT GUESSED (the octantToRadians lesson): with the camera behind the
// target at azimuth `az`, the ground vector pointing screen-right is
// (cos az, -sin az) and the one pointing screen-DOWN is (sin az, cos az).
// Vertical screen motion is foreshortened by the pitch, so a pixel of vertical
// drag covers 1/sin(pitch) as much ground as a horizontal one — without that
// term the world slides diagonally away from the cursor, which feels broken in
// a way that is very hard to name while playing.
export function panDelta(dxPx, dyPx, azimuth, pitch, unitsPerPixel) {
  const dx = dxPx * unitsPerPixel;
  const dy = (dyPx * unitsPerPixel) / Math.sin(pitch);
  const c = Math.cos(azimuth), s = Math.sin(azimuth);
  // Negated: dragging right must move the world right, i.e. the camera LEFT.
  return { dx: -(dx * c + dy * s), dy: -(dx * -s + dy * c) };
}

// Frame-rate independent easing. A fixed per-frame factor was fine while
// drawing happened only on a 10Hz snapshot; on rAF it would ease six times
// faster on a 60Hz screen than a 10Hz one, making the smoothing itself a
// function of the player's monitor.
export function slewAlpha(dtSeconds, tauSeconds) {
  if (!(dtSeconds > 0)) return 0;
  return 1 - Math.exp(-dtSeconds / Math.max(1e-4, tauSeconds));
}

// Ease a coordinate toward its reported value, but SNAP across large jumps.
// Entering a compound, exiting one, and a drop-in are all teleports; easing
// through them would draw the operative sliding across sixty cells of void.
export function smoothTo(prev, next, alpha, snap) {
  if (prev === null || prev === undefined) return next;
  if (Math.abs(next - prev) > snap) return next;
  return prev + (next - prev) * alpha;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const { tokens, manifest } = art();
  renderer.setClearColor(new THREE.Color(tokens.lighting.clear));
  setTerrainTokens(tokens.terrain);
  setAreaTokens(tokens.areaPalette);

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
  const ambient = new THREE.AmbientLight(new THREE.Color(L.ambient.color), L.ambient.intensity);
  scene.add(ambient);
  const bounce = new THREE.DirectionalLight(new THREE.Color(L.bounce.color), L.bounce.intensity);
  bounce.position.set(...L.bounce.position);
  scene.add(bounce);
  // D63a: the base tokens are the NIGHT look; lightingDay is what the cycle
  // eases toward. Both ends precomputed; the mix slews so dawn is a fade, not
  // a light switch.
  const DAY = tokens.lightingDay ?? null;
  const lightEnds = DAY ? {
    key: [new THREE.Color(L.key.color), new THREE.Color(DAY.key.color), L.key.intensity, DAY.key.intensity],
    ambient: [new THREE.Color(L.ambient.color), new THREE.Color(DAY.ambient.color), L.ambient.intensity, DAY.ambient.intensity],
    bounce: [new THREE.Color(L.bounce.color), new THREE.Color(DAY.bounce.color), L.bounce.intensity, DAY.bounce.intensity],
    clear: [new THREE.Color(L.clear), new THREE.Color(DAY.clear)],
  } : null;
  let dayMix = 0;   // 0 = night look, 1 = day look

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  let zoomCells = 3.5;         // how many cells fit across the view — the
                               // playtest-12 ruling: figures ~50px at default,
                               // the full 8x at closest zoom, buildings 4x on
                               // screen; overview is a zoom-out or the minimap
  let terrainTiles = null;     // kept for the walking-position decision (D61)
  const lane = { x: 0, z: 0 }; // the slewed lateral walk offset (D61)
  let blinkGroups = null;      // faulty street lamps (playtest 5), toggled by tick
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
  // Mission-target circles are SLIM (playtest 11): a fat ring reads as a
  // zone, a thin one as a destination.
  const haloGeo = new THREE.TorusGeometry(1.25, 0.04, 6, 24);
  const ringSlimGeo = new THREE.TorusGeometry(0.62, 0.03, 6, 18);
  let beacon = null, halo = null;
  // The destination pin (playtest 6): where your move order is actually
  // going — which, since taps snap to the nearest routable cell, is not
  // always where you tapped. A HUD affordance like the rings: depth-free,
  // token-coloured, gone the moment the operative arrives.
  const pinGeo = new THREE.ConeGeometry(0.16, 0.34, 8);
  let movePin = null, movePinRing = null;

  // Ask the resolver WHAT to show; the manifest and factory decide HOW. A role
  // the manifest does not know draws nothing and says so, rather than quietly
  // rendering as something else.
  function takeVisual(role, stateMark = null, zoomScale = 1) {
    const resolved = resolveVisual(manifest, role);
    if (resolved.kind !== "procedural") {
      if (!warned.has(role)) { warned.add(role); console.warn(`no visual for role "${role}"`); }
      return null;
    }
    let m = pool.find((x) => !x.inUse && x.role === role);
    if (!m) {
      const group = buildProcedural(resolved.key);
      if (!group) return null;
      // World scale (playtest 7, D60): figures render at a fraction of a cell
      // so the city reads 8x bigger. Class-scaled from tokens; a per-entry
      // manifest scale overrides.
      const baseScale = resolved.entry.scale ?? tokens.scale?.[resolved.entry.class] ?? 1;
      group.scale.setScalar(baseScale);
      m = { role, group, inUse: false, baseScale };
      pool.push(m);
      markers.add(group);
    }
    m.inUse = true;
    m.group.visible = true;
    // Markers that are INFORMATION (sites, the pin) shrink as you close in
    // (playtest 9: "4 times too big at max zoom"); world objects pass 1.
    m.group.scale.setScalar(m.baseScale * zoomScale);
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

  function takeRing(colour, scalar = 1, slim = false) {
    const role = slim ? "__ringSlim" : "__ring";
    let m = pool.find((x) => !x.inUse && x.role === role);
    if (!m) {
      // Rings are HUD affordances, not things in the world — and the 40-degree
      // camera lets a tower stand between you and your own operative. A HUD
      // marker a building can hide is not a HUD marker, so rings ignore depth
      // and draw after the world.
      const mesh = new THREE.Mesh(slim ? ringSlimGeo : ringGeo, new THREE.MeshLambertMaterial({
        color: colour, depthTest: false,
      }));
      mesh.renderOrder = 5;
      mesh.rotation.x = -Math.PI / 2;
      m = { role, group: mesh, inUse: false };
      pool.push(m);
      markers.add(mesh);
    }
    m.inUse = true;
    m.group.visible = true;
    m.group.material.color.set(colour);
    // Pooled rings are shared across users; the re-spray ping scales its ring
    // per frame, so every take starts from its own scalar or the pulse leaks
    // onto whatever ring happens to reuse this slot next frame. The scalar is
    // how a figure's ring follows the figure scale (D60) while cell-anchored
    // rings (HQ, pins, re-spray) stay cell-sized.
    m.group.scale.setScalar(scalar);
    return m.group;
  }

  function ensureBeacon() {
    if (beacon) return;
    beacon = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.marks.objective), transparent: true, opacity: 0.5,
    }));
    halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.marks.objective), transparent: true, opacity: 0.85,
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
      // D60 scale: the dropship carries its own manifest override — a
      // vehicle, not a person.
      dropship.scale.setScalar(resolved.entry.scale ?? tokens.scale?.[resolved.entry.class] ?? 1);
      const tint = tintFor(tokens, resolved.entry);
      if (tint) applyTint(dropship, tint);
      scene.add(dropship);
    }
    dropship.visible = true;
    // Comes in along the SCREEN horizontal — the ground direction perpendicular
    // to the view azimuth — so the wing reads broadside to a camera that never
    // rotates; the model's nose is +z, hence atan2 of the axis.
    const ax = Math.cos(drawnAzimuth), az = -Math.sin(drawnAzimuth);
    dropship.position.set(
      hqCell.x + 0.5 + ax * flight.offsetCells,
      flight.height,
      hqCell.y + 0.5 + az * flight.offsetCells);
    dropship.rotation.y = flight.offsetCells <= 0 ? Math.atan2(ax, az) : Math.atan2(-ax, -az);
  }

  function setTerrain(tiles, size, seed, districts = null) {
    if (terrain) { scene.remove(terrain); terrain = null; }
    mapSize = size;
    terrainTiles = tiles;
    terrain = new THREE.Group();
    terrain.add(buildGround(tiles, size, seed));
    const blocks = buildBlocks(tiles, size, seed, districts);
    if (blocks) terrain.add(blocks);
    const clutter = buildClutter(tiles, size, seed);
    if (clutter) terrain.add(clutter);
    const roads = buildRoads(tiles, size, seed);
    if (roads) { terrain.add(roads); blinkGroups = roads.userData.blink ?? null; }
    else blinkGroups = null;
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
  // read. The azimuth is now a quarter-turn CONTROL (playtest 13); the pitch
  // stays fixed, because pitch is the thing that makes the city read as a city.
  const PITCH = 45 * (Math.PI / 180);
  let quarter = 0;
  let azimuth = azimuthFor(quarter);
  // The slewed azimuth: a quarter turn EASES round rather than cutting, so the
  // player keeps hold of which way they were looking. Cutting was tried first
  // and every rotation read as a fresh drop-in somewhere else.
  let drawnAzimuth = azimuth;
  // Free look (playtest 13): a right-drag offset from whatever the camera would
  // otherwise follow. Non-null means the camera has stopped following.
  let pan = null;
  const HEIGHT = 90;
  // Exported so anything depth-related (fog, near/far) is derived from the
  // real distance instead of a constant somebody guessed.
  const CAMERA_DISTANCE = Math.sqrt(HEIGHT ** 2 + (HEIGHT / Math.tan(PITCH)) ** 2);

  function place(target) {
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const halfX = zoomCells / 2;
    const halfY = halfX / aspect;
    const margin = clampMargin(halfX, halfY, PITCH, drawnAzimuth);
    const c = clampCamera(target, mapSize, margin, margin);
    const back = HEIGHT / Math.tan(PITCH);
    camera.position.set(c.x + back * Math.sin(drawnAzimuth), HEIGHT, c.y + back * Math.cos(drawnAzimuth));
    camera.lookAt(c.x, 0, c.y);
    return c;
  }

  // ── Smoothing (playtest 13, finding 6: "movement was completely jerky") ────
  // One eased position per mover, keyed by a stable id. The engine still moves
  // in whole cells on a 10Hz tick; this is presentation, exactly like the walk
  // offset and the dropship — nothing here can desync anything.
  const eased = new Map();
  let frameAlpha = 1;              // recomputed per frame from real elapsed time
  const SNAP_CELLS = 4;            // beyond this it is a teleport, not a walk
  function smoothPos(key, x, z) {
    const prev = eased.get(key);
    const next = {
      x: smoothTo(prev?.x, x, frameAlpha, SNAP_CELLS),
      z: smoothTo(prev?.z, z, frameAlpha, SNAP_CELLS),
      seen: true,
    };
    eased.set(key, next);
    return next;
  }
  // Movers that vanish (a rival leaving view, a compound emptying) must not
  // keep stale entries forever, or a returning id resumes from where it was
  // last drawn — which after a sortie is a different city.
  function sweepEased() {
    for (const [k, v] of eased) {
      if (!v.seen) eased.delete(k); else v.seen = false;
    }
  }

  let lastFrameAt = 0;
  function draw(view, pinnedIds = null) {
    if (!view || !resize()) return;
    // Real elapsed time, so easing is the same speed on a 144Hz laptop and a
    // 30Hz phone. Clamped: a backgrounded tab returns with a multi-second gap,
    // and easing "the rest of the way" over one frame is the snap this exists
    // to avoid.
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const dt = lastFrameAt ? Math.min(0.25, (now - lastFrameAt) / 1000) : 0.1;
    lastFrameAt = now;
    frameAlpha = slewAlpha(dt, 0.07);
    // The quarter turn eases; going the short way round matters, or turning
    // from the last quarter to the first spins three-quarters backwards.
    const turn = slewAlpha(dt, 0.12);
    let delta = azimuth - drawnAzimuth;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    drawnAzimuth += delta * turn;

    for (const m of pool) { m.inUse = false; m.group.visible = false; }

    // Every HUD ring breathes with the zoom (playtest 8): close in they
    // shrink to neat markers, zoomed out they grow so they stay findable.
    const ringZoom = Math.max(0.4, Math.min(2, zoomCells / 12));
    // Figure rings follow the figure scale AND the zoom; defined here because
    // patrols and rivals draw before the agents do.
    const figureRing = (tokens.scale?.figure ?? 1) * 2.6
      * Math.max(0.6, Math.min(3, zoomCells / 10));
    // NPC rings are deliberately smaller than your own: findable, not
    // shouting — YOUR ring is how you find yourself.
    const npcRing = figureRing * 0.7;
    // Information markers shrink to a quarter at full close-up (playtest 9).
    const markerZoom = Math.max(0.25, Math.min(1, zoomCells / 12));

    // D63a: ease the lights toward the phase the VIEW reports (engine truth,
    // no client cycle maths). Runs before the mode branch: the compound is
    // the same night the street is having.
    if (lightEnds) {
      const target = view.night ? 0 : 1;
      // Was a flat 0.05 per snapshot; on rAF that would fade dawn six times
      // faster. Same ~2s constant, expressed in seconds.
      dayMix += (target - dayMix) * slewAlpha(dt, 2.0);
      const m = Math.max(0, Math.min(1, dayMix));
      key.color.lerpColors(lightEnds.key[0], lightEnds.key[1], m);
      key.intensity = lightEnds.key[2] + (lightEnds.key[3] - lightEnds.key[2]) * m;
      ambient.color.lerpColors(lightEnds.ambient[0], lightEnds.ambient[1], m);
      ambient.intensity = lightEnds.ambient[2] + (lightEnds.ambient[3] - lightEnds.ambient[2]) * m;
      bounce.color.lerpColors(lightEnds.bounce[0], lightEnds.bounce[1], m);
      bounce.intensity = lightEnds.bounce[2] + (lightEnds.bounce[3] - lightEnds.bounce[2]) * m;
      renderer.setClearColor(new THREE.Color().lerpColors(lightEnds.clear[0], lightEnds.clear[1], m));
    }

    // S17: inside a mission area the diorama IS the compound. The street
    // stays loaded and hidden — exit is a visibility flip, not a rebuild.
    const av = areaView(view);
    if (av) {
      drawAreaMode(av, view.tick);
      sweepEased();
      renderer.render(scene, camera);
      return;
    }
    if (areaGroup) areaGroup.visible = false;
    if (terrain) terrain.visible = true;

    const own = view.agents?.find((a) => a.state === 1) ?? view.agents?.[0];
    const follow = own
      ? { x: own.x / CELL, y: own.y / CELL }
      : view.hq ? { x: view.hq.cellX + 0.5, y: view.hq.cellY + 0.5 }
        : { x: view.size / 2, y: view.size / 2 };
    // Free look: while panned the camera holds the player's chosen ground
    // instead of the operative. The offset is stored rather than an absolute
    // position, so the view still travels with the operative — looking two
    // streets ahead should not become looking at a fixed patch of city.
    const target = pan ? { x: follow.x + pan.dx, y: follow.y + pan.dy } : follow;
    place(target);

    // Procedural visuals stand ON the ground; their own geometry carries the
    // height, so the renderer no longer guesses a lift per marker type.
    const at = (obj, cx, cy, h = 0) => { if (obj) obj.position.set(cx, h, cy); return obj; };

    // What a site MEANS to this player — the job you took, something on your
    // board, or scenery — is carried by shape and tint together (7a).
    const roles = siteRoles(view);
    for (const s of view.sites) {
      // The type picks the model, the contract state picks the tint mark.
      const sv = siteVisual(roles.get(s.id), s.type);
      at(takeVisual(sv.role, sv.mark, markerZoom), s.cellX + 0.5, s.cellY + 0.5);
    }
    for (const b of view.buildings) {
      at(takeVisual(buildingRole(b.kind)), b.cellX + 0.5, b.cellY + 0.5);
    }
    for (const h of view.holdingSites) at(takeVisual("holding"), h.cellX + 0.5, h.cellY + 0.5);
    if (view.hq) {
      // Playtest 4: the HQ lives in a building now. When its cell is a
      // building entrance the safehouse IS the structure and the tent stays
      // packed; the tent still ships for the no-safehouse fallback.
      if (!hqInBuilding(view, view.hq)) {
        at(takeVisual("ownHq"), view.hq.cellX + 0.5, view.hq.cellY + 0.5);
      }
      // The ring is the HQ's EMBLEM (playtest 3): a structure alone reads as
      // one more dark building, and a player two streets away had nothing on
      // screen that said "home". Same HUD-affordance ring as the one under
      // the operative, in the Firm's own mark.
      at(takeRing(tokens.marks.ownHq, ringZoom), view.hq.cellX + 0.5, view.hq.cellY + 0.5, 0.12);
    }
    for (const h of view.rivalHqs) {
      if (hqInBuilding(view, h)) {
        at(takeRing(tokens.marks.rivalHq, ringZoom), h.cellX + 0.5, h.cellY + 0.5, 0.12);
      } else {
        at(takeVisual("rivalHq"), h.cellX + 0.5, h.cellY + 0.5);
      }
    }
    for (const p of view.patrols) {
      // A ring under every patrol (playtest 8 review): at 1/16 scale the
      // figure is pixels tall, and a patrol you cannot see is an ambush —
      // the opposition doctrine, applied to the renderer. Same mark colours
      // the radar speaks, so the two surfaces agree.
      const role = p.alerted ? "patrolAlert" : "patrol";
      const sp = smoothPos(`patrol:${p.id}`, p.x + 0.5, p.y + 0.5);
      at(takeVisual(role), sp.x, sp.z);
      // An alerted patrol PULSES and wears a bigger ring (playtest 13, finding
      // 4: "patrols when spotted should be red-marked in game"). The tint alone
      // was doing the work, and at 1/8 figure scale a recoloured figure the
      // size of a thumbnail is not a warning.
      const ring = p.alerted
        ? npcRing * 1.55 * (1 + 0.14 * Math.sin(view.tick / 2))
        : npcRing;
      at(takeRing(tokens.marks[role], ring), sp.x, sp.z, 0.04);
    }
    // Sensor beams (S16 8c). Drawn low and thin, spanning both endpoints, so
    // the line you must not be standing in is unambiguous.
    for (const x of view.beams ?? []) {
      const mesh = takeBeam(tokens.marks[x.live ? "beamLive" : "beamDark"], x.live);
      const ax = x.cellX + 0.5, az = x.cellY + 0.5;
      const bx = x.toX + 0.5, bz = x.toY + 0.5;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      // Waist height against 1/8-scale figures — a beam over their heads
      // would read as sky decoration, not a line you must not stand in.
      mesh.position.set((ax + bx) / 2, 0.08, (az + bz) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.scale.set(len + 0.9, 0.04, 0.09);
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
    for (const r of view.rivals) {
      const sr = smoothPos(`rival:${r.id}`, r.x / CELL, r.y / CELL);
      at(takeVisual("rival"), sr.x, sr.z);
      at(takeRing(tokens.marks.rival, npcRing), sr.x, sr.z, 0.04);
    }
    // S17 ambient life: the crowd. No rings — rings are for things that
    // matter, and a bystander's whole message is that they do not.
    for (const c of view.civilians ?? []) {
      const sc = smoothPos(`civ:${c.id}`, c.x + 0.5, c.y + 0.5);
      const fig = at(takeVisual("civilian"), sc.x, sc.z);
      if (fig) fig.rotation.y = octantToRadians(c.facing);
    }
    // Hover cars: client-side theatre on the transit lanes, derived from the
    // tick so every client shows the same traffic. Lanes computed once per
    // terrain.
    if (!lanes && terrainTiles) lanes = transitLanes(terrainTiles, mapSize);
    const carCount = 2 * Math.max(1, view.districts?.length ?? 3);
    for (const car of hoverCarsAt(view.tick, lanes ?? [], carCount)) {
      const fig = at(takeVisual("hoverCar"), car.x + 0.5, car.y + 0.5);
      if (fig) fig.rotation.y = Math.atan2(car.dx, car.dy);
    }
    // The walking position (D61): slew the drawn offset toward the pure
    // decision, so kerb-hops and street crossings are visible movement. A
    // null decision means "standing — hold the position you have".
    const laneTarget = walkOffset(view, terrainTiles, mapSize, moveHint);
    if (laneTarget) {
      const laneEase = slewAlpha(dt, 1.25);
      lane.x += (laneTarget.dx - lane.x) * laneEase;
      lane.z += (laneTarget.dz - lane.z) * laneEase;
    }
    for (const a of view.agents) {
      // The agent's tint is its DETECTION state — gameplay information, so it
      // comes from the resolver rather than being decided here.
      const stateMark = detectionMark(a.detection);
      const p = smoothPos(`agent:${a.id}`, a.x / CELL + lane.x, a.y / CELL + lane.z);
      at(takeVisual("agent", stateMark), p.x, p.z);
      // The ring is how you find your own operative in a busy street. It is a
      // HUD affordance rather than a thing in the world, so it is not a
      // manifest visual.
      at(takeRing(tokens.marks[stateMark], figureRing), p.x, p.z, 0.04);
    }
    // Pinned contracts (playtest 3): a steady watched-ring at each pinned
    // objective, in the pinned mark — the pulse stays reserved for the
    // CURRENT objective below.
    for (const p of pinnedCells(view, pinnedIds)) {
      at(takeRing(tokens.marks.pinned, ringZoom, true), p.cellX + 0.5, p.cellY + 0.5, 0.12);
    }
    // Cover shops are STANDING landmarks (playtest 13, finding 1): a slim ring
    // on every one, all the time, so a player can plan a burn route before
    // being burned. Slim and steady on purpose — the fat breathing ring below
    // stays reserved for "that one, now".
    for (const shop of coverShops(view)) {
      at(takeRing(tokens.marks.coverShop, ringZoom * 0.8, true),
        shop.cellX + 0.5, shop.cellY + 0.5, 0.1);
    }
    // Burned (playtest 3): mark the nearest cover shop in the world with a
    // breathing ring in the shop's colour, matching the radar ping.
    const respray = burnedGuidance(view);
    if (respray) {
      const ring = takeRing(tokens.marks.coverShop, ringZoom);
      if (ring) {
        at(ring, respray.cellX + 0.5, respray.cellY + 0.5, 0.12);
        ring.scale.setScalar(ringZoom * (1 + 0.35 * (0.5 + 0.5 * Math.sin(view.tick / 3))));
      }
    }
    // The destination pin: a bobbing cone over the cell the move order is
    // heading for, with a small ground ring. Rendered through the ring pool's
    // rules (depth-free) so a tower can never hide where you are going.
    const dest = moveTarget(view);
    if (dest) {
      if (!movePin) {
        movePin = new THREE.Mesh(pinGeo, new THREE.MeshBasicMaterial({
          color: new THREE.Color(tokens.marks.dropZone), depthTest: false,
        }));
        movePin.renderOrder = 5;
        movePin.rotation.x = Math.PI;      // apex down
        scene.add(movePin);
        movePinRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
          color: new THREE.Color(tokens.marks.dropZone), depthTest: false,
        }));
        movePinRing.renderOrder = 5;
        movePinRing.rotation.x = -Math.PI / 2;
        scene.add(movePinRing);
      }
      const bob = 0.06 * Math.sin(view.tick / 2);
      // The pin stands on the SPOT the player tapped (playtest 11), not the
      // cell centre — the same clamp the arrival offset uses, so the pin and
      // the operative's final position agree.
      const hx = dest.cellX + 0.5 + Math.max(-ARRIVE_CLAMP, Math.min(ARRIVE_CLAMP, moveHint?.dx ?? 0));
      const hz = dest.cellY + 0.5 + Math.max(-ARRIVE_CLAMP, Math.min(ARRIVE_CLAMP, moveHint?.dz ?? 0));
      movePin.visible = true; movePinRing.visible = true;
      movePin.scale.setScalar(markerZoom);
      movePin.position.set(hx, 0.45 * markerZoom + 0.3 + bob, hz);
      movePinRing.position.set(hx, 0.1, hz);
      movePinRing.scale.setScalar(0.55 * Math.max(markerZoom, 0.4));
    } else if (movePin) {
      movePin.visible = false; movePinRing.visible = false;
    }

    // Faulty street lamps blink in two opposite phases off the world tick —
    // decorative, so it keys off the same clock as everything else animated.
    if (blinkGroups) {
      const phase = Math.floor(view.tick / 6) % 2 === 0;
      for (const p of blinkGroups.A) p.visible = phase;
      for (const p of blinkGroups.B) p.visible = !phase;
    }

    // The objective beacon, pulsing so it reads as live rather than painted on.
    const objective = objectiveCell(view);
    if (objective) {
      ensureBeacon();
      const pulse = 0.5 + 0.35 * Math.sin(view.tick / 4);
      beacon.visible = true; halo.visible = true;
      beacon.scale.set(markerZoom, 1, markerZoom);
      beacon.position.set(objective.cellX + 0.5, 4.5, objective.cellY + 0.5);
      beacon.material.opacity = 0.25 + 0.25 * pulse;
      halo.position.set(objective.cellX + 0.5, 0.08, objective.cellY + 0.5);
      halo.scale.setScalar(ringZoom * (0.85 + 0.3 * pulse));
      halo.material.opacity = 0.5 + 0.4 * pulse;
    } else if (beacon) {
      beacon.visible = false; halo.visible = false;
    }

    sweepEased();
    renderer.render(scene, camera);
  }

  // ── S17: the compound diorama ────────────────────────────────────────────
  // Built off-map so the street never shows behind it: past the map edge the
  // backdrop is the night void, which is what "elsewhere" should look like.
  const AREA_ORIGIN = { x: -60, z: -60 };
  let areaGroup = null, areaGroupId = -1;

  function drawAreaMode(av, tick) {
    const { area, self } = av;
    // Ring and marker sizes derive from the COMPOUND's own framing, not the
    // street zoom — the street's close-up factors shrank every indoor ring to
    // a speck. The fixed frame spans ~(w+h)/sqrt(2) cells, so the same
    // formulas run with that as the effective zoom.
    const areaSpan = (area.width + area.height) * Math.SQRT1_2;
    const s = {
      tick,
      ringZoom: Math.max(0.4, Math.min(2, areaSpan / 12)),
      figureRing: (tokens.scale?.figure ?? 1) * 2.6 * Math.max(0.6, Math.min(3, areaSpan / 10)),
      markerZoom: Math.max(0.25, Math.min(1, areaSpan / 12)),
    };
    s.npcRing = s.figureRing * 0.7;
    if (terrain) terrain.visible = false;
    if (movePin) { movePin.visible = false; movePinRing.visible = false; }
    if (areaGroupId !== area.id) {
      if (areaGroup) scene.remove(areaGroup);
      areaGroup = buildArea(area, AREA_ORIGIN.x, AREA_ORIGIN.z);
      areaGroupId = area.id;
      scene.add(areaGroup);
    }
    areaGroup.visible = true;

    // Frame the whole compound: the indoor game is played at one scale, so
    // the projection is fitted here rather than driven by the street zoom.
    // Under the 45-degree azimuth the compound presents its DIAGONAL to the
    // screen axes — the rotated w x h footprint needs (w+h)/sqrt(2) of screen
    // width, and the pitch then foreshortens the vertical by sin(pitch). The
    // first fit used the raw width and cropped a third of the yard.
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const needX = ((area.width + area.height) / 2) * Math.SQRT1_2 + 1.5;
    const needY = needX * Math.sin(PITCH) + 1.0;
    let halfX = needX, halfY = needX / aspect;
    if (halfY < needY) { halfY = needY; halfX = needY * aspect; }
    camera.left = -halfX; camera.right = halfX;
    camera.top = halfY; camera.bottom = -halfY;
    camera.updateProjectionMatrix();
    const cx = AREA_ORIGIN.x + area.width / 2, cz = AREA_ORIGIN.z + area.height / 2;
    const back = HEIGHT / Math.tan(PITCH);
    camera.position.set(cx + back * Math.sin(drawnAzimuth), HEIGHT, cz + back * Math.cos(drawnAzimuth));
    camera.lookAt(cx, 0, cz);

    const at = (obj, gx, gy, h = 0) => {
      if (obj) obj.position.set(AREA_ORIGIN.x + gx + 0.5, h, AREA_ORIGIN.z + gy + 0.5);
      return obj;
    };

    // Guards: role carries the state (manifest tints), ring matches the radarless
    // indoor read — same mark vocabulary as street patrols. Positions are eased
    // like everything else: indoors the engine moves in WHOLE cells every few
    // ticks, which is the harshest stepping anywhere in the game.
    for (const g of area.guards) {
      const role = g.down ? "guardDown" : g.alerted ? "guardAlert" : "guard";
      const p = smoothPos(`aguard:${area.id}:${g.id}`, g.x, g.y);
      const fig = at(takeVisual(role), p.x, p.z);
      // A downed guard lies down — the one pose change that must be legible.
      if (fig) fig.rotation.x = g.down ? -Math.PI / 2 : 0;
      at(takeRing(tokens.marks[role], s.npcRing), p.x, p.z, 0.04);
    }
    for (const t of area.terminals) at(takeVisual("terminal"), t.x, t.y);
    for (const o of area.occupants ?? []) {
      const p = smoothPos(`aocc:${area.id}:${o.id}`, o.x, o.y);
      const fig = at(takeVisual("rival"), p.x, p.z);
      if (fig) fig.rotation.x = o.state === 2 ? -Math.PI / 2 : 0;
      at(takeRing(tokens.marks.rival, s.npcRing), p.x, p.z, 0.04);
    }
    const stateMark = detectionMark(self.detection);
    const sp = smoothPos(`aself:${area.id}`, self.areaCol, self.areaRow);
    at(takeVisual("agent", stateMark), sp.x, sp.z);
    at(takeRing(tokens.marks[stateMark], s.figureRing), sp.x, sp.z, 0.04);

    // Exit affordance: a steady ring on each entry door, in the landing mark —
    // the "where you leave" colour the player already knows from drop-in.
    for (const d of area.doors ?? []) {
      at(takeRing(tokens.marks.dropZone, s.ringZoom, true), d.x, d.y, 0.08);
    }

    // The objective: the same pulsing beacon the street uses, so "go here"
    // reads identically indoors. Gone once the asset is taken — the objective
    // is the DOOR then, and the door rings are already on.
    ensureBeacon();
    if (!area.assetTaken || self.carryKind !== 7) {
      const pulse = 0.5 + 0.35 * Math.sin(s.tick / 4);
      beacon.visible = true; halo.visible = true;
      beacon.scale.set(s.markerZoom, 1, s.markerZoom);
      beacon.position.set(AREA_ORIGIN.x + area.objective.x + 0.5, 4.5, AREA_ORIGIN.z + area.objective.y + 0.5);
      beacon.material.opacity = 0.25 + 0.25 * pulse;
      halo.position.set(AREA_ORIGIN.x + area.objective.x + 0.5, 0.08, AREA_ORIGIN.z + area.objective.y + 0.5);
      halo.scale.setScalar(s.ringZoom * (0.85 + 0.3 * pulse));
      halo.material.opacity = 0.5 + 0.4 * pulse;
    } else {
      beacon.visible = false; halo.visible = false;
    }
  }

  // Screen -> AREA cell while indoors: the same ground-plane intersection,
  // shifted by the compound's origin.
  function screenToAreaCell(sx, sy) {
    const c = screenToCell(sx, sy);
    if (!c) return null;
    return { x: c.x - AREA_ORIGIN.x, y: c.y - AREA_ORIGIN.z, fx: c.fx, fz: c.fz };
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
    // fx/fz: WHERE in the cell the tap landed (playtest 9). The engine is
    // cell-granular and only ever receives the cell — the fraction feeds the
    // walking-position choice, so tapping near a kerb walks that sidewalk.
    const x = Math.floor(hit.x), y = Math.floor(hit.z);
    return { x, y, fx: hit.x - x, fz: hit.z - y };
  }

  // The lateral the player ASKED for, remembered per move order (D61).
  let moveHint = null;
  // S17: transit lanes for the hover-car theatre, computed once per terrain.
  let lanes = null;
  function setMoveHint(hint) { moveHint = hint; }

  return {
    draw, resize, setTerrain, screenToCell, screenToAreaCell, setMoveHint, drawDropship,
    cameraDistance: () => CAMERA_DISTANCE,
    hasTerrain: () => terrain !== null,
    zoomBy(f) { zoomCells = Math.max(1.5, Math.min(70, zoomCells * f)); resize(); },
    // ── The camera controls (playtest 13, finding 3) ────────────────────────
    rotateBy(steps) {
      quarter = (((quarter + steps) % 4) + 4) % 4;
      azimuth = azimuthFor(quarter);
    },
    quarter: () => quarter,
    // Screen pixels in, ground offset out. The renderer owns the projection, so
    // it owns the conversion — main.js only forwards the drag.
    panByPixels(dxPx, dyPx) {
      const w = canvas.clientWidth || 1;
      const d = panDelta(dxPx, dyPx, drawnAzimuth, PITCH, zoomCells / w);
      pan = { dx: (pan?.dx ?? 0) + d.dx, dy: (pan?.dy ?? 0) + d.dy };
    },
    recentre() { pan = null; },
    isPanned: () => pan !== null,
  };
}
