// client/js/area3d.js — the compound diorama (S17 mission areas).
//
// Like terrain3d, this file owns GEOMETRY only: every colour arrives through
// setAreaTokens from style_tokens.json (areaPalette). One build per area id;
// the mutable things — guards, occupants, the terminal, the objective — are
// drawn by scene.js through the same manifest-driven visual pool the street
// uses, so this file never learns what a guard looks like.

import * as THREE from "three";

// Raw /255, deliberately NOT THREE.Color(hex): colour management would
// sRGB-decode the palette and darken the floor about fivefold — the same
// trap the street tiles document. setRGB writes the floats straight through.
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const flat = (hex) =>
  new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...hexRgb(hex)) });

let P = null;
export function setAreaTokens(palette) { P = palette; }

const AT_WALL = 4, AT_COVER = 8;

// Merge one horizontal quad per cell into a single geometry per colour —
// 384 cells as 384 meshes would be 384 draw calls on SwiftShader.
function mergedFloor(cells, w, h, ox, oz) {
  const buckets = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = P.tiles[String(cells[y * w + x])] ?? P.tiles["0"];
      if (!buckets.has(hex)) buckets.set(hex, []);
      const p = buckets.get(hex);
      const x0 = ox + x, z0 = oz + y, x1 = x0 + 1, z1 = z0 + 1;
      p.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
    }
  }
  const group = new THREE.Group();
  for (const [hex, positions] of buckets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    group.add(new THREE.Mesh(geo, flat(hex)));
  }
  return group;
}

// Boxes for walls and crates, merged per material the same way.
function mergedBoxes(cellsAt, size, height, hex, ox, oz) {
  if (!cellsAt.length) return null;
  const positions = [];
  const half = size / 2;
  for (const { x, y } of cellsAt) {
    const cx = ox + x + 0.5, cz = oz + y + 0.5;
    const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
    const y0 = 0, y1 = height;
    // Top and the four sides; no bottom (never visible from an ortho tilt).
    positions.push(
      x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0,   // top
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y0, z1, x1, y1, z1, x0, y1, z1,   // south
      x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y0, z0, x0, y1, z0, x1, y1, z0,   // north
      x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z0, x1, y1, z1,   // east
      x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y0, z0, x0, y1, z1, x0, y1, z0,   // west
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, flat(hex));
}

// The whole static compound as one group, its (0,0) cell at world (ox, oz).
export function buildArea(areaStatic, ox, oz) {
  const { tiles, width: w, height: h } = areaStatic;
  const g = new THREE.Group();
  g.add(mergedFloor(tiles, w, h, ox, oz));
  const walls = [], crates = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      if (t === AT_WALL) walls.push({ x, y });
      else if (t === AT_COVER) crates.push({ x, y });
    }
  }
  const wallMesh = mergedBoxes(walls, 1.0, 1.1, P.wallTop, ox, oz);
  if (wallMesh) g.add(wallMesh);
  // Crates sit at shoulder height on a figure: cover you crouch behind,
  // not architecture.
  const crateMesh = mergedBoxes(crates, 0.72, 0.5, P.crate, ox, oz);
  if (crateMesh) g.add(crateMesh);
  return g;
}
