// client/js/render.js — the world view.
//
// STAGING DECISION (2026-08-05): this is a 2D top-down canvas, not the
// three.js 2.5D diorama S12 specifies. The renderer is strictly
// non-authoritative and every model module is renderer-agnostic, so swapping it
// is contained. The diorama is still the target.

const TILE = {
  0: "#2A2E26", 1: "#3B3F46", 2: "#24272C", 3: "#454B54", 4: "#171A1F",
  5: "#6A5B3E", 6: "#4A5566", 7: "#7A4A3A", 8: "#33352C", 9: "#2E2A24", 10: "#1B2A33",
};
export const CELL = 256;

// The projection, extracted as a PURE function so it can be unit-tested.
// A wrong camera is invisible in a screenshot until you know what to look for —
// "content starts at the middle of the screen" turned out to mean "camera is at
// 0,0", which is a fact worth asserting rather than squinting at.
export function project(worldX, worldY, camera, viewport) {
  return {
    x: ((worldX - camera.x) / CELL) * camera.zoom + viewport.width / 2,
    y: ((worldY - camera.y) / CELL) * camera.zoom + viewport.height / 2,
  };
}

export function unproject(screenX, screenY, camera, viewport) {
  return {
    x: Math.floor((((screenX - viewport.width / 2) / camera.zoom) * CELL + camera.x) / CELL),
    y: Math.floor((((screenY - viewport.height / 2) / camera.zoom) * CELL + camera.y) / CELL),
  };
}

// Where the camera belongs. Own agent first, then the HQ, then the middle of
// the map — never 0,0, which drew the whole city into a corner of the screen.
export function cameraTarget(view) {
  const own = view.agents?.find((a) => a.state === 1) ?? view.agents?.[0];
  if (own) return { x: own.x, y: own.y };
  if (view.hq) return { x: view.hq.cellX * CELL + CELL / 2, y: view.hq.cellY * CELL + CELL / 2 };
  return { x: (view.size * CELL) / 2, y: (view.size * CELL) / 2 };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const camera = { x: 0, y: 0, zoom: 12 };
  let tiles = null;
  let lastW = -1, lastH = -1;

  // Self-healing size. The renderer is created while the world screen is still
  // hidden, so at that moment the canvas is 0x0 and any size captured then is
  // garbage. Checking each frame costs nothing and removes a whole class of
  // "only broken on first load" bugs.
  function syncSize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === lastW && h === lastH) return w > 0 && h > 0;
    lastW = w; lastH = h;
    if (w === 0 || h === 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  window.addEventListener("resize", syncSize);

  function draw(view) {
    if (!view || !syncSize()) return;
    const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    const target = cameraTarget(view);
    camera.x = target.x; camera.y = target.y;

    ctx.fillStyle = "#0F1114";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const z = camera.zoom;
    const halfW = Math.ceil(viewport.width / z / 2) + 2;
    const halfH = Math.ceil(viewport.height / z / 2) + 2;
    const cx = Math.floor(camera.x / CELL), cy = Math.floor(camera.y / CELL);
    for (let y = cy - halfH; y <= cy + halfH; y++) {
      for (let x = cx - halfW; x <= cx + halfW; x++) {
        if (x < 0 || y < 0 || x >= view.size || y >= view.size) continue;
        const t = tiles ? tiles[y * view.size + x] : 0;
        ctx.fillStyle = TILE[t] ?? "#222";
        const p = project(x * CELL, y * CELL, camera, viewport);
        ctx.fillRect(p.x, p.y, z + 1, z + 1);
      }
    }

    const dot = (wx, wy, colour, r) => {
      const p = project(wx, wy, camera, viewport);
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    };
    const box = (cellX, cellY, colour) => {
      const p = project(cellX * CELL, cellY * CELL, camera, viewport);
      ctx.strokeStyle = colour; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - z / 2, p.y - z / 2, z * 2, z * 2);
    };

    for (const s of view.sites) dot(s.cellX * CELL + 128, s.cellY * CELL + 128, "#D9A441", 4);
    for (const b of view.buildings) {
      dot(b.cellX * CELL + 128, b.cellY * CELL + 128,
        b.kind === 0 ? "#3E8E8C" : b.kind === 1 ? "#8A867E" : "#B5613C", 3);
    }
    for (const h of view.holdingSites) dot(h.cellX * CELL + 128, h.cellY * CELL + 128, "#7A4A3A", 4);
    if (view.hq) box(view.hq.cellX, view.hq.cellY, "#3E8E8C");
    for (const h of view.rivalHqs) box(h.cellX, h.cellY, "#B5613C");
    for (const p of view.patrols) {
      dot(p.x * CELL + 128, p.y * CELL + 128, p.alerted ? "#C2452F" : "#8A867E", 5);
    }
    for (const r of view.rivals) dot(r.x, r.y, "#B5613C", 5);
    for (const a of view.agents) {
      const colour = a.detection === 2 ? "#C2452F" : a.detection === 1 ? "#D9A441" : "#E8E6E0";
      dot(a.x, a.y, colour, 6);
      // A ring, so your operative is findable at a glance among the markers.
      const p = project(a.x, a.y, camera, viewport);
      ctx.strokeStyle = colour; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.stroke();
    }
  }

  return {
    draw,
    resize: syncSize,
    setTiles(next) { tiles = next; },
    hasTiles() { return tiles !== null; },
    screenToCell(sx, sy) {
      return unproject(sx, sy, camera, { width: canvas.clientWidth, height: canvas.clientHeight });
    },
    zoomBy(f) { camera.zoom = Math.max(5, Math.min(28, camera.zoom * f)); },
  };
}
