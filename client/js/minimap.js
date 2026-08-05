// client/js/minimap.js — the corner radar.
//
// This is the old full-screen 2D renderer, sized down. At 160px it reads as a
// radar rather than a low-resolution world, which is what it was always better
// suited to being.

// The tile palette used to be a literal table here, hand-synced against a
// second copy in terrain3d.js. It is a style token now (D46): the radar and the
// diorama read the SAME table, so they cannot drift apart, and a Q41c look
// candidate changes both at once.
const CELL = 256;

import { siteRoles, objectiveCell, siteRole } from "./models.js";
import { mark, terrain } from "./assets.js";
import { detectionMark } from "./asset_resolver.js";

export function createMinimap(canvas) {
  const ctx = canvas.getContext("2d");
  let tiles = null, baked = null, bakedSize = 0;

  // The terrain never changes, so bake it once to an offscreen canvas and blit
  // it each frame. Re-drawing 4096 rects per tick for a 160px widget would be
  // absurd.
  function bake(size) {
    baked = document.createElement("canvas");
    baked.width = size; baked.height = size;
    const b = baked.getContext("2d");
    const T = terrain();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        b.fillStyle = T.tiles[tiles[y * size + x]] ?? T.unknown;
        b.fillRect(x, y, 1, 1);
      }
    }
    bakedSize = size;
  }

  return {
    setTiles(next, size) { tiles = next; if (tiles) bake(size); },
    hasTiles() { return tiles !== null; },
    draw(view) {
      if (!view) return;
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = terrain().backdrop;
      ctx.fillRect(0, 0, w, h);
      if (baked) ctx.drawImage(baked, 0, 0, bakedSize, bakedSize, 0, 0, w, h);
      const s = w / view.size;
      const dot = (cx, cy, colour, r = 1.6) => {
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(cx * s, cy * s, r, 0, Math.PI * 2); ctx.fill();
      };
      // Same colour language as the diorama — two views that disagree about
      // what is highlighted are worse than one view.
      const roles = siteRoles(view);
      for (const site of view.sites) {
        const role = roles.get(site.id);
        dot(site.cellX, site.cellY,
          mark(siteRole(role)),
          role ? 2.2 : 1.4);
      }
      const objective = objectiveCell(view);
      if (objective) {
        const pulse = 3 + 1.6 * Math.sin(view.tick / 4);
        ctx.strokeStyle = mark("siteActive"); ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(objective.cellX * s, objective.cellY * s, pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const p of view.patrols) dot(p.x, p.y, mark(p.alerted ? "patrolAlert" : "patrol"));
      for (const r of view.rivals) dot(r.x / CELL, r.y / CELL, mark("rival"), 2);
      if (view.hq) dot(view.hq.cellX, view.hq.cellY, mark("ownHq"), 2.4);
      for (const a of view.agents) {
        const colour = mark(detectionMark(a.detection));
        dot(a.x / CELL, a.y / CELL, colour, 2.6);
      }
    },
  };
}
