// client/js/attract.js — the title diorama (playtest 10).
//
// A living splash: the dark city at street level, and a twenty-four-second
// vignette in the classic genre register — an operative sneaks the sidewalk,
// ducks behind crates while a patrol's vision cone sweeps past, closes on a
// rival and walks them off captive. Pure THEATRE: wall-clock driven, no
// server, no engine, and none of the world's honesty rules apply — but every
// colour and model comes from the same tokens and manifest as the game
// (D46), so the splash can never advertise a look the game does not have.
//
// The script is a PURE function of looped seconds, so the choreography is
// unit-testable without WebGL — the same split as models.js everywhere else.

import * as THREE from "three";
import { buildGround, buildBlocks, buildRoads, setTerrainTokens } from "./terrain3d.js";
import { buildProcedural, applyTint } from "./asset_factory.js";
import { art } from "./assets.js";

export const ATTRACT_PERIOD = 24;   // seconds per loop

// Piecewise-linear keyframing: value moves a->b across [t0, t1].
function seg(t, t0, t1, a, b) {
  if (t <= t0) return a;
  if (t >= t1) return b;
  return a + ((t - t0) / (t1 - t0)) * (b - a);
}

// The choreography. Coordinates are cells on the little stage (14 x 10, one
// east-west street across row 5, the north sidewalk at z 4.62).
//
//   0-6s   the operative sneaks east along the north sidewalk
//   4-9s   the patrol's cone sweeps toward the walkway; the operative holds
//          BEHIND the crates while it passes (hidden = the story beat)
//   9-13s  cone away; the operative closes on the rival by the doorway
//   13-14s the CAPTURE: a red flash, the rival becomes a captive
//   14-19s both walk east and exit — a capture mission, in miniature
//   19-24s empty street; the patrol keeps its watch; loop
export function attractScript(tRaw) {
  const t = ((tRaw % ATTRACT_PERIOD) + ATTRACT_PERIOD) % ATTRACT_PERIOD;
  const agent = {
    x: t < 9 ? seg(t, 0, 6, 0.4, 3.2)
      : t < 14 ? seg(t, 9, 13, 3.2, 4.9)
        : seg(t, 14, 19, 4.9, 8.5),
    z: 4.62,
    // Hidden while the cone is on the walkway: tucked at the crates.
    hidden: t >= 5 && t < 9 ? 1 : 0,
    present: t < 19 ? 1 : 0,
  };
  const rival = {
    x: t < 14 ? 5.5 : seg(t, 14, 19, 5.5, 9.2),
    z: 4.62,
    captive: t >= 13.2 ? 1 : 0,
    present: t < 19 ? 1 : 0,
  };
  // The patrol stands south of the street and SWEEPS: away, onto the
  // walkway (while the operative hides), and away again.
  const face = t < 4 ? seg(t, 0, 4, 0.5, 0.1)
    : t < 9 ? seg(t, 4, 6.5, 0.1, -1.1)          // onto the walkway
      : seg(t, 9, 12, -1.1, 0.6);                 // and off it
  const patrol = { x: 4.2, z: 5.42, face };
  // The capture flash: a fast pulse at the moment of the grab.
  const flash = t >= 13 && t < 14 ? 1 - (t - 13) : 0;
  return { agent, rival, patrol, flash };
}

// The stage: mass north and south, one street between - sidewalks, lamps
// and markings come from the same road pass the game uses.
export const STAGE_W = 14, STAGE_H = 10;
export function stageTiles() {
  const tiles = new Uint8Array(STAGE_W * STAGE_H);
  // Mass NORTH of the street only: the camera looks from the south-east, and
  // towers south of the street would stand between it and the whole vignette.
  // South is open yard — dark ground the action reads against.
  tiles.fill(8);
  for (let y = 0; y < 5; y++) for (let x = 0; x < STAGE_W; x++) tiles[y * STAGE_W + x] = 4;
  for (let x = 0; x < STAGE_W; x++) tiles[5 * STAGE_W + x] = 1;
  return tiles;
}

export function createAttract(canvas) {
  const { tokens, manifest } = art();
  setTerrainTokens(tokens.terrain);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(new THREE.Color(tokens.lighting.clear));
  const scene = new THREE.Scene();

  const L = tokens.lighting;
  const key = new THREE.DirectionalLight(new THREE.Color(L.key.color), L.key.intensity);
  key.position.set(...L.key.position);
  scene.add(key);
  scene.add(new THREE.AmbientLight(new THREE.Color(L.ambient.color), L.ambient.intensity));

  const tiles = stageTiles();
  const SEED = 20260823;
  scene.add(buildGround(tiles, STAGE_W, SEED));
  const blocks = buildBlocks(tiles, STAGE_W, SEED);
  if (blocks) scene.add(blocks);
  const roads = buildRoads(tiles, STAGE_W, SEED);
  if (roads) scene.add(roads);

  // The crates the operative hides behind — placed FOR the choreography, in
  // the clutter tokens' paint.
  const crateHex = tokens.terrain.clutter.crate;
  for (const [cx, cz, s] of [[2.9, 4.52, 2], [3.14, 4.72, 1.6]]) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.055 * s, 0.055 * s, 0.055 * s),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(crateHex) }));
    crate.position.set(cx, 0.0275 * s, cz);
    scene.add(crate);
  }

  // Theatre cheats SCALE, never colour: actors play at twice the world's
  // figure scale so the vignette reads from across the room. The game itself
  // never does this — the splash is a stage, not the world.
  const figScale = (tokens.scale?.figure ?? 1) * 2;
  const makeFigure = (key, tint) => {
    const g = buildProcedural(key);
    g.scale.setScalar(figScale);
    if (tint) applyTint(g, tint);
    scene.add(g);
    return g;
  };
  const agent = makeFigure("agent", tokens.marks.agentUnseen);
  const rival = makeFigure("rival", tokens.marks.rival);
  const patrol = makeFigure("patrol", tokens.marks.patrol);

  // The patrol's vision cone: lying flat, apex at the patrol, swinging with
  // the script's facing. The same visual grammar as the game's beams.
  const coneLen = 2.4;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, coneLen, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.marks.patrol),
      transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
    }));
  scene.add(cone);

  // The capture flash: a burn-red ring that blinks over the grab.
  const flashRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.03, 6, 18),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(tokens.marks.agentBurned),
      transparent: true, opacity: 0, depthTest: false,
    }));
  flashRing.rotation.x = -Math.PI / 2;
  flashRing.renderOrder = 5;
  scene.add(flashRing);

  // Same dimetric framing as the game, tight on the street.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const PITCH = 45 * (Math.PI / 180), AZ = 45 * (Math.PI / 180), H = 60;
  const back = H / Math.tan(PITCH);
  const target = { x: 4.6, z: 3.3 };   // the action strip, low-left, clear of the terminal
  camera.position.set(target.x + back * Math.sin(AZ), H, target.z + back * Math.cos(AZ));
  camera.lookAt(target.x, 0, target.z);

  // Accessibility: a reduced-motion browser gets one composed still of the
  // city instead of the looping vignette.
  const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  let raf = null, t0 = null;
  function frame(now) {
    raf = still ? null : requestAnimationFrame(frame);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const zoom = 6.8, halfX = zoom / 2, halfY = halfX / (w / h);
    camera.left = -halfX; camera.right = halfX;
    camera.top = halfY; camera.bottom = -halfY;
    camera.updateProjectionMatrix();

    if (t0 === null) t0 = now;
    const s = attractScript((now - t0) / 1000);
    agent.visible = !!s.agent.present;
    agent.position.set(s.agent.x, 0, s.agent.z);
    // Hiding reads as a crouch: the figure drops, tucked at the crates.
    agent.scale.setScalar(figScale * (s.agent.hidden ? 0.72 : 1));
    rival.visible = !!s.rival.present;
    rival.position.set(s.rival.x, 0, s.rival.z);
    if (s.rival.captive) rival.rotation.y = Math.PI / 2;
    patrol.position.set(s.patrol.x, 0, s.patrol.z);
    patrol.rotation.y = s.patrol.face + Math.PI;
    const fx = s.patrol.x + Math.sin(s.patrol.face + Math.PI) * coneLen / 2;
    const fz = s.patrol.z + Math.cos(s.patrol.face + Math.PI) * coneLen / 2;
    cone.position.set(fx, 0.03, fz);
    cone.rotation.set(Math.PI / 2, 0, -(s.patrol.face + Math.PI));
    flashRing.material.opacity = s.flash * 0.9;
    flashRing.position.set(s.rival.x, 0.05, s.rival.z);
    flashRing.scale.setScalar(1 + (1 - s.flash) * 1.5);
    renderer.render(scene, camera);
  }

  return {
    start() { if (raf === null) { t0 = null; raf = requestAnimationFrame(frame); } },
    // Stopped whenever the splash is hidden — the same battery rule as the
    // main diorama: no 3D frames for nobody.
    stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
  };
}
