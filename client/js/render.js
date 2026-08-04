// client/js/render.js — the world view.
//
// STAGING DECISION (2026-08-05): this is a 2D top-down canvas, not the
// three.js 2.5D diorama S12 specifies. The renderer is strictly
// non-authoritative and every model module is renderer-agnostic, so swapping it
// is contained — and a playable view now is worth more than a pretty one later,
// because it lets the loop be FELT before art is committed to. The diorama is
// still the target; this is not a decision to skip it.

const TILE = {
  0: "#2A2E26", 1: "#3B3F46", 2: "#24272C", 3: "#454B54", 4: "#171A1F",
  5: "#6A5B3E", 6: "#4A5566", 7: "#7A4A3A", 8: "#33352C", 9: "#2E2A24", 10: "#1B2A33",
};
const CELL = 256;

export function createRenderer(canvas, cityTiles) {
  const ctx = canvas.getContext("2d");
  const camera = { x: 0, y: 0, zoom: 12 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const worldToScreen = (wx, wy) => ({
    x: (wx - camera.x) / CELL * camera.zoom + canvas.clientWidth / 2,
    y: (wy - camera.y) / CELL * camera.zoom + canvas.clientHeight / 2,
  });

  const screenToCell = (sx, sy) => ({
    x: Math.floor((((sx - canvas.clientWidth / 2) / camera.zoom) * CELL + camera.x) / CELL),
    y: Math.floor((((sy - canvas.clientHeight / 2) / camera.zoom) * CELL + camera.y) / CELL),
  });

  function draw(view) {
    if (!view) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.fillStyle = "#0F1114";
    ctx.fillRect(0, 0, w, h);

    const own = view.agents.find((a) => a.state === 1) ?? view.agents[0];
    if (own) { camera.x = own.x; camera.y = own.y; }
    else if (view.hq) { camera.x = view.hq.cellX * CELL; camera.y = view.hq.cellY * CELL; }

    // Terrain. Only what fits on screen — a 128-world is 16k cells.
    const z = camera.zoom;
    const halfW = Math.ceil(w / z / 2) + 2, halfH = Math.ceil(h / z / 2) + 2;
    const cx = Math.floor(camera.x / CELL), cy = Math.floor(camera.y / CELL);
    for (let y = cy - halfH; y <= cy + halfH; y++) {
      for (let x = cx - halfW; x <= cx + halfW; x++) {
        if (x < 0 || y < 0 || x >= view.size || y >= view.size) continue;
        const t = cityTiles ? cityTiles[y * view.size + x] : 0;
        ctx.fillStyle = TILE[t] ?? "#222";
        const p = worldToScreen(x * CELL, y * CELL);
        ctx.fillRect(p.x, p.y, z + 1, z + 1);
      }
    }

    const dot = (wx, wy, colour, r, label) => {
      const p = worldToScreen(wx, wy);
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (label && z > 9) {
        ctx.fillStyle = "#E8E6E0"; ctx.font = "10px ui-monospace";
        ctx.fillText(label, p.x + r + 3, p.y + 3);
      }
    };

    for (const s of view.sites) dot(s.cellX * CELL + 128, s.cellY * CELL + 128, "#D9A441", 4);
    for (const b of view.buildings) {
      dot(b.cellX * CELL + 128, b.cellY * CELL + 128,
        b.kind === 0 ? "#3E8E8C" : b.kind === 1 ? "#8A867E" : "#B5613C", 3);
    }
    for (const hs of view.holdingSites) dot(hs.cellX * CELL + 128, hs.cellY * CELL + 128, "#7A4A3A", 4);
    if (view.hq) {
      const p = worldToScreen(view.hq.cellX * CELL, view.hq.cellY * CELL);
      ctx.strokeStyle = "#3E8E8C"; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - z, p.y - z, z * 3, z * 3);
    }
    for (const h of view.rivalHqs) {
      const p = worldToScreen(h.cellX * CELL, h.cellY * CELL);
      ctx.strokeStyle = "#B5613C"; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - z, p.y - z, z * 3, z * 3);
    }
    for (const p of view.patrols) {
      dot(p.x * CELL + 128, p.y * CELL + 128, p.alerted ? "#C2452F" : "#8A867E", 5);
    }
    for (const r of view.rivals) dot(r.x, r.y, "#B5613C", 5);
    for (const a of view.agents) {
      const colour = a.detection === 2 ? "#C2452F" : a.detection === 1 ? "#D9A441" : "#E8E6E0";
      dot(a.x, a.y, colour, 6);
    }
  }

  return {
    draw, resize, screenToCell,
    zoomBy(f) { camera.zoom = Math.max(5, Math.min(28, camera.zoom * f)); },
  };
}
