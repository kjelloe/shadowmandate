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

  // ── SP-1: the cyberpunk grade (tokens.splash; ref cyperpunk-example.png) ──
  // Three depth layers behind the stage: a vertical haze gradient sky, a FAR
  // skyline washed toward the glow, a NEAR skyline darker and sharper. Both
  // silhouettes are canvas-painted textures — towers with pinprick windows —
  // because at splash distance a skyline IS a texture, not geometry.
  const SP = tokens.splash;
  const skylineTexture = (hex, seedBase, litDensity) => {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 160;
    const g = c.getContext("2d");
    // Deterministic little LCG so the skyline is the same every load.
    let r = seedBase >>> 0;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    g.fillStyle = hex;
    let x = 0;
    while (x < c.width) {
      const w = 18 + Math.trunc(rnd() * 40);
      const h = 40 + Math.trunc(rnd() * 110);
      g.fillRect(x, c.height - h, w, h);
      // Rooftop masts on a few towers — the reference's antenna line.
      if (rnd() < 0.3) g.fillRect(x + w / 2, c.height - h - 14, 2, 14);
      // Lit windows: two temperatures, warm dominant (the game's own rule).
      for (let wy = c.height - h + 4; wy < c.height - 6; wy += 7) {
        for (let wx = x + 3; wx < x + w - 3; wx += 6) {
          if (rnd() < litDensity) {
            g.fillStyle = rnd() < 0.7 ? SP.windowWarm : SP.windowCool;
            g.globalAlpha = 0.5 + rnd() * 0.5;
            g.fillRect(wx, wy, 2, 3);
            g.globalAlpha = 1;
            g.fillStyle = hex;
          }
        }
      }
      x += w + 2 + Math.trunc(rnd() * 10);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;   // crisp pixel windows, per the ref
    return tex;
  };
  const layer = (tex, w, h, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false }));
    m.position.set(4.6, y, z);
    scene.add(m);
    return m;
  };
  // The sky: a tall gradient quad, magenta glow pooling at the horizon.
  {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, SP.skyTop);
    grad.addColorStop(0.72, SP.skyGlow);
    grad.addColorStop(1, SP.skyGlow);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    layer(new THREE.CanvasTexture(c), 60, 26, 6, -12);
  }
  layer(skylineTexture(SP.skylineFar, 0xfa7, 0.5), 44, 9.6, 3.4, -8);
  layer(skylineTexture(SP.skylineNear, 0xb33, 0.35), 34, 7.2, 2.4, -4.5);

  // Haze: real fog, its range DERIVED from the layout (camera z 9.2, near
  // skyline z -4.5 => distances ~5..14) — the fog-bug lesson says never
  // guess these numbers against an unknown camera distance.
  scene.fog = new THREE.Fog(new THREE.Color(SP.hazeFog), 6, 17);

  // The magenta rim light from behind the mass: what separates dark towers
  // from a dark sky in the reference.
  const rim = new THREE.DirectionalLight(new THREE.Color(SP.rim), 0.55);
  rim.position.set(2, 6, -10);
  scene.add(rim);
  // A faint magenta FILL from the camera side: the near mass read as a
  // featureless black wall without it — the reference's towers are dark,
  // never void.
  const fill = new THREE.DirectionalLight(new THREE.Color(SP.skyGlow), 0.22);
  fill.position.set(5, 3, 12);
  scene.add(fill);

  const tiles = stageTiles();
  const SEED = 20260823;
  scene.add(buildGround(tiles, STAGE_W, SEED));
  const blocks = buildBlocks(tiles, STAGE_W, SEED);
  if (blocks) scene.add(blocks);
  const roads = buildRoads(tiles, STAGE_W, SEED);
  if (roads) scene.add(roads);

  // Neon signage on the north facades (the mass front sits at z = 5): two
  // vertical sign strips, one marquee, in the reference's proportions —
  // pink dominant, cyan second, amber sparse. Emissive-flat quads; the
  // flicker runs in the frame loop off wall-clock, like everything else on
  // this stage.
  const neonSigns = [];
  const sign = (hex, wq, hq, x, y, phase) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wq, hq),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex), transparent: true, opacity: 0.92, fog: false,
      }));
    m.position.set(x, y, 5.015);
    m.userData.phase = phase;
    scene.add(m);
    neonSigns.push(m);
    // The glow halo: a bigger, fainter twin right behind.
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(wq * 1.9, hq * 1.35),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex), transparent: true, opacity: 0.22, fog: false,
      }));
    halo.position.set(x, y, 5.008);
    scene.add(halo);
  };
  // Placed at the FRAME EDGES: the splash terminal owns the centre of the
  // screen, and a sign behind frosted glass is a sign that does not exist.
  sign(tokens.splash.neonPink, 0.26, 1.7, 1.0, 1.75, 0.0);
  sign(tokens.splash.neonCyan, 0.22, 1.25, 8.25, 1.6, 1.7);
  sign(tokens.splash.neonPink, 1.25, 0.3, 1.05, 2.85, 3.1);
  sign(tokens.splash.neonAmber, 0.62, 0.24, 8.2, 0.7, 4.6);

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

  // SP-1: STREET LEVEL. The game plays dimetric; the splash stands on the
  // pavement like the reference — a low perspective camera looking north
  // across the street at the lit mass, skyline and haze stacked behind.
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
  camera.position.set(4.6, 1.05, 10.6);
  camera.lookAt(4.6, 1.7, 0.0);

  // Accessibility: a reduced-motion browser gets one composed still of the
  // city instead of the looping vignette.
  const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  let raf = null, t0 = null;
  function frame(now) {
    raf = still ? null : requestAnimationFrame(frame);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Neon flicker: mostly steady, one sign stuttering at a time — the
    // faulty-lamp register the streets already speak.
    for (const m of neonSigns) {
      const tt = now / 1000 + m.userData.phase;
      const stutter = Math.sin(tt * 13) > 0.92 && Math.sin(tt * 0.7) > 0.3;
      m.material.opacity = stutter ? 0.35 : 0.92;
    }

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
