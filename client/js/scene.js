// client/js/scene.js — the 2.5D diorama (S12).
//
// A lightly tilted, mostly orthographic camera: the "tabletop" look the design
// asks for. No rotation in the first slice — a fixed compass keeps a stealth
// map readable, and a player who can spin the world loses their sense of where
// the patrol was.
//
// The camera CLAMPS to the map. Without that, dropping near a corner leaves
// half the screen showing nothing — which is exactly what playtest 2 saw and
// reasonably read as "off centre".

import * as THREE from "three";
import { buildGround, buildBlocks } from "./terrain3d.js";

export const CELL = 256;   // world units per cell, matching the engine

// Marker palette, shared with the minimap so the two agree.
export const MARK = {
  site: 0xD9A441, informant: 0x3E8E8C, market: 0x8A867E, coverShop: 0xB5613C,
  holding: 0x7A4A3A, patrol: 0x8A867E, patrolAlert: 0xC2452F, rival: 0xB5613C,
  ownHq: 0x3E8E8C, rivalHq: 0xB5613C,
  agentUnseen: 0xE8E6E0, agentNoticed: 0xD9A441, agentBurned: 0xC2452F,
};

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
  renderer.setClearColor(0x0F1114);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0F1114, 40, 110);

  // Light from the north-west, low: long shadows read as evening, and the
  // painted low-poly look wants shape more than brightness.
  const key = new THREE.DirectionalLight(0xFFF2DC, 1.15);
  key.position.set(-40, 60, -30);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x4A5566, 0.75));
  const bounce = new THREE.DirectionalLight(0x3E8E8C, 0.28);
  bounce.position.set(30, 20, 40);
  scene.add(bounce);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  let zoomCells = 34;          // how many cells fit across the view
  let mapSize = 64;
  let terrain = null;
  const markers = new THREE.Group();
  scene.add(markers);

  // A small pool of reusable meshes: markers change every tick and allocating
  // per frame would make the GC the bottleneck.
  const pool = [];
  const sphere = new THREE.SphereGeometry(0.34, 10, 8);
  const ring = new THREE.TorusGeometry(0.62, 0.07, 6, 18);
  const boxGeo = new THREE.BoxGeometry(1.6, 0.5, 1.6);

  function takeMarker(kind, colour) {
    let m = pool.find((x) => !x.inUse && x.kind === kind);
    if (!m) {
      const geo = kind === "ring" ? ring : kind === "box" ? boxGeo : sphere;
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colour }));
      if (kind === "ring") mesh.rotation.x = -Math.PI / 2;
      m = { kind, mesh, inUse: false };
      pool.push(m);
      markers.add(mesh);
    }
    m.inUse = true;
    m.mesh.visible = true;
    m.mesh.material.color.setHex(colour);
    return m.mesh;
  }

  function setTerrain(tiles, size, seed) {
    if (terrain) { scene.remove(terrain); terrain = null; }
    mapSize = size;
    terrain = new THREE.Group();
    terrain.add(buildGround(tiles, size, seed));
    const blocks = buildBlocks(tiles, size, seed);
    if (blocks) terrain.add(blocks);
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

  // The tilt. Orthographic + a modest pitch is what gives the diorama its
  // tabletop feel without the parallax that makes a top-down map hard to read.
  const PITCH = 52 * (Math.PI / 180);
  const HEIGHT = 90;

  function place(target) {
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const halfX = zoomCells / 2;
    const halfY = halfX / aspect;
    const c = clampCamera(target, mapSize, halfX, halfY / Math.sin(PITCH));
    camera.position.set(c.x, HEIGHT, c.y + HEIGHT / Math.tan(PITCH));
    camera.lookAt(c.x, 0, c.y);
    return c;
  }

  function draw(view) {
    if (!view || !resize()) return;
    for (const m of pool) { m.inUse = false; m.mesh.visible = false; }

    const own = view.agents?.find((a) => a.state === 1) ?? view.agents?.[0];
    const target = own
      ? { x: own.x / CELL, y: own.y / CELL }
      : view.hq ? { x: view.hq.cellX + 0.5, y: view.hq.cellY + 0.5 }
        : { x: view.size / 2, y: view.size / 2 };
    place(target);

    const at = (mesh, cx, cy, h = 0.35) => mesh.position.set(cx, h, cy);

    for (const s of view.sites) at(takeMarker("dot", MARK.site), s.cellX + 0.5, s.cellY + 0.5, 0.5);
    for (const b of view.buildings) {
      const colour = b.kind === 0 ? MARK.informant : b.kind === 1 ? MARK.market : MARK.coverShop;
      at(takeMarker("dot", colour), b.cellX + 0.5, b.cellY + 0.5, 0.5);
    }
    for (const h of view.holdingSites) at(takeMarker("dot", MARK.holding), h.cellX + 0.5, h.cellY + 0.5, 0.5);
    if (view.hq) at(takeMarker("box", MARK.ownHq), view.hq.cellX + 0.5, view.hq.cellY + 0.5, 0.25);
    for (const h of view.rivalHqs) at(takeMarker("box", MARK.rivalHq), h.cellX + 0.5, h.cellY + 0.5, 0.25);
    for (const p of view.patrols) {
      at(takeMarker("dot", p.alerted ? MARK.patrolAlert : MARK.patrol), p.x + 0.5, p.y + 0.5, 0.5);
    }
    for (const r of view.rivals) at(takeMarker("dot", MARK.rival), r.x / CELL, r.y / CELL, 0.5);
    for (const a of view.agents) {
      const colour = a.detection === 2 ? MARK.agentBurned
        : a.detection === 1 ? MARK.agentNoticed : MARK.agentUnseen;
      at(takeMarker("dot", colour), a.x / CELL, a.y / CELL, 0.55);
      // The ring is how you find your own operative in a busy street.
      at(takeMarker("ring", colour), a.x / CELL, a.y / CELL, 0.12);
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
    draw, resize, setTerrain, screenToCell,
    hasTerrain: () => terrain !== null,
    zoomBy(f) { zoomCells = Math.max(14, Math.min(70, zoomCells * f)); resize(); },
  };
}
