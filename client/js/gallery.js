// client/js/gallery.js — the asset gallery (S15, slice 7a-3).
//
// Renders every procedural visual through the REAL factory and the real
// lighting, and every portrait through the real draw routines. Two purposes:
// reviewing art without playing, and giving the owner something concrete to
// answer Q41c against — because "what should this look like" is not a question
// anyone can answer from a token file.
//
// It fails LOUDLY on screen. A gallery that renders nothing looks identical to
// a gallery of black assets, and this project has already paid for that
// ambiguity once with the fog bug.

import * as THREE from "three";
import { buildProcedural, applyTint, countTriangles, setStyleTokens } from "./asset_factory.js";
import { manifestEntry, resolveVisual, tintFor, detectionMark } from "./asset_resolver.js";
import { portraitLayers, layerDiff, disguiseCount, drawPortrait } from "./portraits.js";

const fail = (where, err) => {
  document.getElementById("err").textContent += `${where}: ${err?.message ?? err}\n`;
  console.error(where, err);
};

// Same role list the pipeline test walks, so the gallery cannot quietly show
// fewer things than the game can draw.
const ROLES = [
  "agent", "rival", "patrol", "patrolAlert",
  "siteScenery", "siteOffered", "siteActive",
  "informant", "market", "coverShop", "holding", "ownHq", "rivalHq",
];

async function main() {
  const [tokens, manifest] = await Promise.all([
    fetch("assets/metadata/style_tokens.json").then((r) => r.json()),
    fetch("assets/metadata/asset_manifest.json").then((r) => r.json()),
  ]);
  setStyleTokens(tokens);

  // ── The 3D stage ─────────────────────────────────────────────────────────
  const canvas = document.getElementById("stage");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new THREE.Color(tokens.lighting.clear));

  const scene = new THREE.Scene();
  const L = tokens.lighting;
  const key = new THREE.DirectionalLight(new THREE.Color(L.key.color), L.key.intensity);
  key.position.set(...L.key.position);
  scene.add(key);
  scene.add(new THREE.AmbientLight(new THREE.Color(L.ambient.color), L.ambient.intensity));
  const bounce = new THREE.DirectionalLight(new THREE.Color(L.bounce.color), L.bounce.intensity);
  bounce.position.set(...L.bounce.position);
  scene.add(bounce);

  // A ground plane so the figures are not floating in a void — they are read
  // standing on a street in the game, and judging them any other way is
  // judging something the player never sees.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 12),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(tokens.body.plinth), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const labels = document.getElementById("stage-labels");
  const COLS = 7, SPACING = 1.9;
  ROLES.forEach((role, i) => {
    try {
      const resolved = resolveVisual(manifest, role);
      if (resolved.kind !== "procedural") throw new Error(`unresolved: ${resolved.kind}`);
      const group = buildProcedural(resolved.key);
      const tint = tintFor(tokens, resolved.entry, detectionMark(0));
      if (tint) applyTint(group, tint);
      const col = i % COLS, row = Math.floor(i / COLS);
      group.position.set((col - (COLS - 1) / 2) * SPACING, 0, (row - 0.5) * 2.4);
      scene.add(group);

      const li = document.createElement("li");
      li.textContent = `${role} · ${countTriangles(group)} tris`;
      labels.appendChild(li);
    } catch (err) {
      fail(`role ${role}`, err);
    }
  });

  // The diorama's own camera angle. Reviewing art from an angle the player
  // never uses is how art gets approved and then looks wrong in game.
  const aspect = canvas.width / canvas.height;
  const halfX = 7.6, halfY = halfX / aspect;
  const camera = new THREE.OrthographicCamera(-halfX, halfX, halfY, -halfY, 0.1, 200);
  const PITCH = 52 * (Math.PI / 180), HEIGHT = 9;
  camera.position.set(0, HEIGHT, HEIGHT / Math.tan(PITCH) + 1.2);
  camera.lookAt(0, 0.4, 0.6);
  renderer.render(scene, camera);

  // ── Portraits ────────────────────────────────────────────────────────────
  const list = document.getElementById("portraits");
  for (let id = 0; id < disguiseCount(); id++) {
    try {
      const li = document.createElement("li");
      const c = document.createElement("canvas");
      c.width = 96; c.height = 96;
      drawPortrait(c.getContext("2d"), id, 96);
      const info = portraitLayers(id);
      const diff = id === 0 ? "the house look" : `changes: ${layerDiff(0, id).join(", ")}`;
      li.appendChild(c);
      const name = document.createElement("div");
      name.textContent = info.name;
      const d = document.createElement("div");
      d.className = "diff";
      d.textContent = diff;
      li.append(name, d);
      list.appendChild(li);
    } catch (err) {
      fail(`portrait ${id}`, err);
    }
  }

  // ── Firm palettes ────────────────────────────────────────────────────────
  const firms = document.getElementById("firms");
  for (const f of tokens.firms) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${f.name}</strong> · symbol: ${f.symbol}<br>`;
    for (const slot of ["primary", "accent", "trim"]) {
      const s = document.createElement("span");
      s.className = "swatch";
      s.style.background = f[slot];
      li.appendChild(s);
      li.appendChild(document.createTextNode(`${slot} `));
    }
    firms.appendChild(li);
  }

  document.body.dataset.galleryReady = "1";
}

main().catch((e) => fail("gallery", e));
