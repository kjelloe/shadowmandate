// client/js/portraits.js — procedural feature-layer portraits (S15, D47).
//
// THE POINT. The owner's requirement was comic: "chat portraits where the agent
// now has a big moustache or completely different glasses, big pink instead of
// agent lean black". That is a COMBINATORIAL requirement, not an illustrative
// one — the joke is that it is *the same person*, visibly, wearing one absurd
// thing. A fixed set of drawn images cannot express "same face, different
// glasses"; it can only express "six unrelated pictures".
//
// So a portrait is a stack of layers, and a D38 disguise is a DIFF on that
// stack. That makes the Cover Shop legible too: you can see exactly what you
// paid for, because everything else stayed put.
//
// The layer composition is pure and node-testable. Only `drawPortrait` needs a
// canvas, which keeps the part that carries the design promise — "these two
// disguises differ in exactly one layer" — under test.

// Base stack, in paint order. Every portrait has these.
const BASE_LAYERS = ["backdrop", "collar", "head", "ear", "hair", "brow", "eyes", "nose", "mouth"];

// What each disguise CHANGES. Anything not named here is inherited from the
// base, which is what makes the person recognisably the same person.
const DISGUISE_DIFF = {
  0: { name: "none", set: { eyes: "glassesLean" } },
  1: { name: "moustache", set: { moustache: "enormous" } },
  2: { name: "pinkGlasses", set: { eyes: "glassesBig", eyesColor: "hotPink" } },
  3: { name: "courier", set: { vest: "hiVis", prop: "clipboard" } },
  4: { name: "tourist", set: { hat: "sun", shirt: "loud", prop: "camera" } },
  5: { name: "executive", set: { collar: "suit", shirt: "shirtTie", fit: "oneSizeWrong" } },
};

// Paint order for the optional layers a disguise can add.
const OVERLAY_ORDER = ["shirt", "vest", "moustache", "hat", "prop"];

export function disguiseCount() {
  return Object.keys(DISGUISE_DIFF).length;
}

// The layer stack for a given disguise. Pure: no canvas, no DOM.
export function portraitLayers(disguiseId = 0) {
  const diff = DISGUISE_DIFF[disguiseId] ?? DISGUISE_DIFF[0];
  const set = { ...(DISGUISE_DIFF[0].set), ...diff.set };
  const layers = BASE_LAYERS.map((id) => ({ id, variant: set[id] ?? "default" }));
  for (const id of OVERLAY_ORDER) {
    if (set[id]) layers.push({ id, variant: set[id] });
  }
  return {
    disguiseId,
    name: diff.name,
    layers,
    // Exposed so a test — and the Cover Shop UI — can say WHAT changed, rather
    // than just showing a different picture.
    changed: Object.keys(diff.set),
  };
}

// Which layers differ between two disguises. This is the design promise made
// checkable: "same agent, one absurd difference".
export function layerDiff(a, b) {
  const la = portraitLayers(a).layers;
  const lb = portraitLayers(b).layers;
  const key = (l) => `${l.id}:${l.variant}`;
  const sa = new Set(la.map(key));
  const sb = new Set(lb.map(key));
  const out = new Set();
  for (const l of la) if (!sb.has(key(l))) out.add(l.id);
  for (const l of lb) if (!sa.has(key(l))) out.add(l.id);
  return [...out];
}

// ── Drawing ────────────────────────────────────────────────────────────────
// Everything below needs a 2D context. Deliberately dumb shapes: this is a
// chat portrait at ~96px, not a character sheet.

const PALETTE = {
  backdrop: "#22262B", skin: "#C9A98B", skinShade: "#A8886B",
  hair: "#2A2622", collar: "#2E3238", suit: "#1C1F24",
  frameLean: "#141619", hotPink: "#E45FA0", lens: "#8FA7C4",
  hiVis: "#D9E04A", loud: "#4AB3A0", shirtTie: "#E8E6E0",
  prop: "#8A867E", mouth: "#7A4A3A",
};

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

const DRAW = {
  backdrop: (ctx, S) => rect(ctx, 0, 0, S, S, PALETTE.backdrop),
  collar: (ctx, S, v) => {
    rect(ctx, S * 0.18, S * 0.78, S * 0.64, S * 0.22, v === "suit" ? PALETTE.suit : PALETTE.collar);
  },
  head: (ctx, S) => ellipse(ctx, S * 0.5, S * 0.48, S * 0.26, S * 0.30, PALETTE.skin),
  ear: (ctx, S) => {
    ellipse(ctx, S * 0.23, S * 0.50, S * 0.045, S * 0.07, PALETTE.skinShade);
    ellipse(ctx, S * 0.77, S * 0.50, S * 0.045, S * 0.07, PALETTE.skinShade);
  },
  hair: (ctx, S) => {
    ctx.beginPath();
    ctx.ellipse(S * 0.5, S * 0.34, S * 0.27, S * 0.17, 0, Math.PI, 0);
    ctx.fillStyle = PALETTE.hair;
    ctx.fill();
  },
  brow: (ctx, S) => {
    rect(ctx, S * 0.34, S * 0.42, S * 0.12, S * 0.022, PALETTE.hair);
    rect(ctx, S * 0.54, S * 0.42, S * 0.12, S * 0.022, PALETTE.hair);
  },
  eyes: (ctx, S, v, opts) => {
    const frame = opts?.eyesColor === "hotPink" ? PALETTE.hotPink : PALETTE.frameLean;
    if (v === "glassesBig") {
      // The joke: enormous frames, same face underneath.
      ctx.lineWidth = S * 0.030; ctx.strokeStyle = frame;
      for (const cx of [0.37, 0.63]) {
        ctx.beginPath(); ctx.ellipse(S * cx, S * 0.50, S * 0.115, S * 0.095, 0, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.lens; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
        ctx.stroke();
      }
      rect(ctx, S * 0.47, S * 0.49, S * 0.06, S * 0.02, frame);
    } else {
      ellipse(ctx, S * 0.40, S * 0.50, S * 0.028, S * 0.030, "#1B1E22");
      ellipse(ctx, S * 0.60, S * 0.50, S * 0.028, S * 0.030, "#1B1E22");
      if (v === "glassesLean") {
        ctx.lineWidth = S * 0.016; ctx.strokeStyle = frame;
        for (const cx of [0.40, 0.60]) {
          ctx.beginPath(); ctx.rect(S * (cx - 0.075), S * 0.465, S * 0.15, S * 0.075); ctx.stroke();
        }
        rect(ctx, S * 0.475, S * 0.495, S * 0.05, S * 0.014, frame);
      }
    }
  },
  nose: (ctx, S) => ellipse(ctx, S * 0.5, S * 0.585, S * 0.030, S * 0.042, PALETTE.skinShade),
  mouth: (ctx, S) => rect(ctx, S * 0.44, S * 0.665, S * 0.12, S * 0.020, PALETTE.mouth),
  moustache: (ctx, S) => {
    // "An enormous moustache and nothing else changed."
    ctx.beginPath();
    ctx.ellipse(S * 0.5, S * 0.645, S * 0.155, S * 0.055, 0, Math.PI, 0);
    ctx.fillStyle = PALETTE.hair; ctx.fill();
    rect(ctx, S * 0.345, S * 0.640, S * 0.31, S * 0.030, PALETTE.hair);
  },
  hat: (ctx, S) => {
    rect(ctx, S * 0.20, S * 0.30, S * 0.60, S * 0.035, PALETTE.loud);
    ctx.beginPath();
    ctx.ellipse(S * 0.5, S * 0.30, S * 0.20, S * 0.12, 0, Math.PI, 0);
    ctx.fillStyle = PALETTE.loud; ctx.fill();
  },
  shirt: (ctx, S, v) => rect(ctx, S * 0.18, S * 0.78, S * 0.64, S * 0.22,
    v === "shirtTie" ? PALETTE.shirtTie : PALETTE.loud),
  vest: (ctx, S) => {
    rect(ctx, S * 0.18, S * 0.80, S * 0.64, S * 0.20, PALETTE.hiVis);
    rect(ctx, S * 0.44, S * 0.80, S * 0.12, S * 0.20, "#2E3238");
  },
  prop: (ctx, S, v) => {
    if (v === "clipboard") rect(ctx, S * 0.70, S * 0.72, S * 0.18, S * 0.24, PALETTE.prop);
    else rect(ctx, S * 0.68, S * 0.76, S * 0.20, S * 0.14, PALETTE.prop);
  },
};

export function drawPortrait(ctx, disguiseId, size) {
  const { layers } = portraitLayers(disguiseId);
  const opts = Object.fromEntries(
    Object.entries({ ...(DISGUISE_DIFF[0].set), ...(DISGUISE_DIFF[disguiseId]?.set ?? {}) }));
  ctx.clearRect(0, 0, size, size);
  for (const layer of layers) {
    const fn = DRAW[layer.id];
    if (fn) fn(ctx, size, layer.variant, opts);
  }
  return layers.length;
}

// Which layer ids have a draw routine — so a test can prove no layer is
// silently skipped, which would show as "the disguise did nothing".
export function drawableLayers() {
  return Object.keys(DRAW);
}
