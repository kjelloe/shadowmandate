// client/js/minimap.js — the corner radar.
//
// This is the old full-screen 2D renderer, sized down. At 160px it reads as a
// radar rather than a low-resolution world, which is what it was always better
// suited to being.

const TILE = {
  0: "#2A2E26", 1: "#3B3F46", 2: "#24272C", 3: "#454B54", 4: "#171A1F",
  5: "#6A5B3E", 6: "#4A5566", 7: "#7A4A3A", 8: "#33352C", 9: "#2E2A24", 10: "#1B2A33",
};
const CELL = 256;

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
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        b.fillStyle = TILE[tiles[y * size + x]] ?? "#222";
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
      ctx.fillStyle = "#0F1114";
      ctx.fillRect(0, 0, w, h);
      if (baked) ctx.drawImage(baked, 0, 0, bakedSize, bakedSize, 0, 0, w, h);
      const s = w / view.size;
      const dot = (cx, cy, colour, r = 1.6) => {
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(cx * s, cy * s, r, 0, Math.PI * 2); ctx.fill();
      };
      for (const site of view.sites) dot(site.cellX, site.cellY, "#D9A441");
      for (const p of view.patrols) dot(p.x, p.y, p.alerted ? "#C2452F" : "#8A867E");
      for (const r of view.rivals) dot(r.x / CELL, r.y / CELL, "#B5613C", 2);
      if (view.hq) dot(view.hq.cellX, view.hq.cellY, "#3E8E8C", 2.4);
      for (const a of view.agents) {
        const colour = a.detection === 2 ? "#C2452F" : a.detection === 1 ? "#D9A441" : "#E8E6E0";
        dot(a.x / CELL, a.y / CELL, colour, 2.6);
      }
    },
  };
}
