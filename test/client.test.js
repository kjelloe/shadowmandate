// test/client.test.js — M7 client guards (S12, S13).
//
// There is no browser in this suite, so these test what CAN be tested without
// one: that every client file parses, that the pure view-models behave, and
// that every i18n key the client references actually exists in BOTH catalogs.
// The last one is the guard that matters — a missing key is invisible until a
// Norwegian speaker opens the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ownAgent, heatDisplay, districtUnder, boardRows, evacDisplay, toastsFor,
  STANCES, DETECTION_KEYS, HEAT_KEYS, CONTRACT_KEYS,
} from "../client/js/models.js";

const ROOT = new URL("..", import.meta.url).pathname;
const JS_DIR = join(ROOT, "client", "js");
const EN = JSON.parse(readFileSync(join(ROOT, "client/i18n/en.json"), "utf8"));
const NO = JSON.parse(readFileSync(join(ROOT, "client/i18n/no.json"), "utf8"));

test("every client module parses", () => {
  for (const file of readdirSync(JS_DIR).filter((f) => f.endsWith(".js"))) {
    assert.doesNotThrow(
      () => execFileSync("node", ["--check", join(JS_DIR, file)], { stdio: "pipe" }),
      `${file} does not parse`);
  }
});

test("every i18n key the client uses exists in BOTH catalogs", () => {
  // A missing key shows the raw key on screen rather than blank (by design in
  // i18n.js) — but only if someone looks. This is that someone.
  const keys = new Set();
  for (const file of readdirSync(JS_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(JS_DIR, file), "utf8");
    for (const m of src.matchAll(/\bt\(\s*"([a-z][\w.]*)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/key:\s*"([a-z][\w.]*)"/g)) keys.add(m[1]);
  }
  const html = readFileSync(join(ROOT, "client/index.html"), "utf8");
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);

  assert.ok(keys.size > 15, `only found ${keys.size} keys — the scan is not working`);
  const missingEn = [...keys].filter((k) => !(k in EN));
  const missingNo = [...keys].filter((k) => !(k in NO));
  assert.deepEqual(missingEn, [], `client uses keys absent from en.json: ${missingEn}`);
  assert.deepEqual(missingNo, [], `client uses keys absent from no.json: ${missingNo}`);
});

test("the model constants line up with the catalogs", () => {
  for (const key of [...DETECTION_KEYS, ...HEAT_KEYS, ...CONTRACT_KEYS,
    ...STANCES.map((s) => s.key)]) {
    assert.ok(key in EN, `constant references missing key '${key}'`);
  }
});

// ── Pure view-models ──────────────────────────────────────────────────────

const VIEW = {
  size: 64,
  agents: [{ id: 0, state: 1, x: 2560, y: 2560, stance: 1, detection: 1, condition: 100 }],
  districts: [
    { id: 0, trait: 1, coreX: 10, coreY: 10, heatBand: 1, heat: -1 },
    { id: 1, trait: 2, coreX: 50, coreY: 50, heatBand: 2, heat: 4 },
  ],
  hq: { cellX: 10, cellY: 10, cacheResources: 120, evacActive: 0, evacTicks: 0, evacPaused: 0 },
  board: {
    contracts: [
      { id: 1, kind: 0, tier: 1, reward: 80, acceptedByMe: 0 },
      { id: 2, kind: 3, tier: 2, reward: 120, acceptedByMe: 1 },
    ],
    teaser: { id: 9, kind: 4, tier: 3, reward: 300, locked: 1 },
  },
  standoff: null, rivals: [], rivalHqs: [], patrols: [], sites: [],
  buildings: [], holdingSites: [], pacts: [],
};

test("ownAgent finds the active operative", () => {
  assert.equal(ownAgent(VIEW).id, 0);
  assert.equal(ownAgent(null), null);
  assert.equal(ownAgent({ agents: [] }), null);
});

test("D20: heat display hides the exact number unless intel was bought", () => {
  assert.deepEqual(heatDisplay(VIEW, 0), { band: 1, exact: null });
  assert.deepEqual(heatDisplay(VIEW, 1), { band: 2, exact: 4 });
});

test("districtUnder picks the nearest core", () => {
  assert.equal(districtUnder(VIEW, 11, 11).id, 0);
  assert.equal(districtUnder(VIEW, 49, 49).id, 1);
});

test("D29: the board renders the teaser row, marked locked and last", () => {
  const rows = boardRows(VIEW);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.locked).length, 1);
  assert.ok(rows[rows.length - 1].locked, "the teaser should sort last");
  assert.ok(rows[1].accepted, "an accepted contract should be marked");
});

test("the evac panel shows seconds, and distinguishes paused from emergency", () => {
  assert.equal(evacDisplay(VIEW), null);
  const running = { hq: { evacActive: 1, evacTicks: 255, evacPaused: 0 } };
  assert.deepEqual(evacDisplay(running), { seconds: 26, paused: false, emergency: false });
  const paused = { hq: { evacActive: 1, evacTicks: 100, evacPaused: 1 } };
  assert.equal(evacDisplay(paused).paused, true);
  const emergency = { hq: { evacActive: 2, evacTicks: 600, evacPaused: 0 } };
  assert.equal(evacDisplay(emergency).emergency, true);
});

test("only events worth interrupting a player become toasts", () => {
  const toasts = toastsFor([
    { type: "perimeterAlarm" }, { type: "agentBurned" },
    { type: "agentArrived" }, { type: "stanceChanged" }, { type: "heatChanged" },
  ]);
  assert.equal(toasts.length, 2, "routine events should not interrupt");
  assert.ok(toasts.every((x) => x.alarm), "both of these are alarms");
});

test("the client never hard-codes a visible string", () => {
  // Every user-facing string must come from a catalog. This catches the
  // "just for now" literal that ships and is never translated.
  const offenders = [];
  for (const file of readdirSync(JS_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(JS_DIR, file), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      const code = line.split("//")[0];
      // textContent assigned a literal — quoted OR a template. The first
      // version of this guard only checked quotes and sailed past a real
      // English sentence in a backtick template, which is exactly the kind of
      // "just for now" string that ships untranslated.
      // A template COMPOSED from t(...) is fine — that is how a label with a
      // number is built. What is not fine is prose sitting in the source.
      const composedFromCatalog = /\bt\(/.test(code);
      const literalQuoted = /\.textContent\s*=\s*["'][A-Za-z][^"']{3,}["']/.test(code);
      const proseInTemplate = /\.textContent\s*=\s*`[^`]*[A-Za-z]{4,}\s+[A-Za-z]{3,}/.test(code);
      if (!composedFromCatalog && (literalQuoted || proseInTemplate)) {
        offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `hard-coded UI text:\n${offenders.join("\n")}`);
});

// ── Playtest-1 regressions ────────────────────────────────────────────────

test("PLAYTEST 1: [hidden] must beat the .screen display rule", () => {
  // The bug that made the first playtest unplayable. `.screen { display: flex }`
  // is a class rule and outranks the user-agent's `[hidden] { display: none }`,
  // so nothing ever hid: every screen stacked and the world painted over the
  // splash the player had just clicked. Cheap to reintroduce, so: guarded.
  // Strip comments first. The first version of this test matched the
  // `[hidden] { display: none }` written inside the comment that EXPLAINS the
  // bug, and reported the real rule as missing — the same comment-matching
  // mistake the dependency guard made in M5. Guards must read code, not prose.
  const css = readFileSync(join(ROOT, "client/style.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const hiddenRule = css.match(/\[hidden\]\s*\{[^}]*\}/);
  assert.ok(hiddenRule, "no [hidden] rule at all — screens will not hide");
  assert.ok(/display:\s*none\s*!important/.test(hiddenRule[0]),
    "the [hidden] rule must be !important to beat .screen/.overlay display rules");
  const hiddenAt = css.indexOf("[hidden]");
  const screenAt = css.indexOf(".screen {");
  assert.ok(hiddenAt < screenAt || /!important/.test(hiddenRule[0]),
    "[hidden] must win against .screen");
});

test("PLAYTEST 1: the drop-in button never sends an impossible cell", () => {
  // The first build sent cellX:-1, which the engine always rejects as
  // "unlandable" — so the only button on the splash screen did nothing at all.
  const src = readFileSync(join(JS_DIR, "main.js"), "utf8");
  assert.ok(!/type:\s*10[^}]*cellX:\s*-1/.test(src),
    "drop-in still sends cellX:-1, which is always unlandable");
  assert.ok(/requestDropZones\(\)/.test(src),
    "drop-in should ask the server for real zones");
});

// ── Playtest 2: the camera ────────────────────────────────────────────────

test("PLAYTEST 2: the camera centres on the operative, never on 0,0", async () => {
  // "Content starts at the middle of the screen and runs off the edge" is what
  // a camera at 0,0 looks like. Asserted rather than eyeballed from here on.
  const { project, cameraTarget, CELL } = await import("../client/js/render.js");
  const viewport = { width: 1000, height: 600 };
  const camera = { x: 0, y: 0, zoom: 12 };

  const deployed = {
    size: 64, hq: { cellX: 6, cellY: 9 },
    agents: [{ id: 0, state: 1, x: 30 * CELL + 128, y: 20 * CELL + 128 }],
  };
  const target = cameraTarget(deployed);
  assert.equal(target.x, 30 * CELL + 128, "the camera did not follow the agent");
  Object.assign(camera, target);
  const onScreen = project(target.x, target.y, camera, viewport);
  assert.equal(onScreen.x, viewport.width / 2, "the operative is not horizontally centred");
  assert.equal(onScreen.y, viewport.height / 2, "the operative is not vertically centred");
});

test("PLAYTEST 2: with no agent the camera falls back to the HQ, then the map", async () => {
  const { cameraTarget, CELL } = await import("../client/js/render.js");
  const atHq = cameraTarget({ size: 64, agents: [], hq: { cellX: 10, cellY: 10 } });
  assert.equal(atHq.x, 10 * CELL + CELL / 2, "should centre on the HQ");

  const empty = cameraTarget({ size: 64, agents: [], hq: null });
  assert.equal(empty.x, (64 * CELL) / 2, "an undeployed world should centre the map");
  assert.notEqual(empty.x, 0, "0,0 draws the city into a corner — the playtest-1 symptom");
});

test("PLAYTEST 2: project and unproject are inverses", async () => {
  const { project, unproject, CELL } = await import("../client/js/render.js");
  const camera = { x: 20 * CELL, y: 14 * CELL, zoom: 12 };
  const viewport = { width: 800, height: 500 };
  for (const [cx, cy] of [[20, 14], [25, 9], [3, 40]]) {
    const p = project(cx * CELL + 128, cy * CELL + 128, camera, viewport);
    const back = unproject(p.x, p.y, camera, viewport);
    assert.deepEqual(back, { x: cx, y: cy }, `round trip failed for ${cx},${cy}`);
  }
});

test("PLAYTEST 2: the renderer receives the terrain it is given", () => {
  // The tiles variable was declared and never assigned, so the city rendered
  // in one flat colour. Both the diorama and the minimap must be handed the
  // terrain explicitly, after it arrives.
  const src = readFileSync(join(JS_DIR, "main.js"), "utf8");
  assert.ok(/renderer\.setTerrain\(/.test(src), "main.js never hands terrain to the diorama");
  assert.ok(/minimap\.setTiles\(/.test(src), "main.js never hands terrain to the minimap");
  assert.ok(!/create(Scene|Minimap)\([^)]*tiles/i.test(src),
    "terrain must not be captured at construction — it arrives later");
});

test("the 2.5D camera clamps to the map instead of showing the void", async () => {
  // Playtest 2: dropping at cell (6,9) — a map corner — left 40% of the screen
  // black. That was not an offset camera; it was the camera honestly showing
  // the outside of the world. It now clamps.
  const { clampCamera } = await import("../client/js/scene.js");
  const size = 64, halfX = 17, halfY = 11;
  const corner = clampCamera({ x: 6, y: 9 }, size, halfX, halfY);
  assert.equal(corner.x, halfX, "the camera did not clamp on the west edge");
  assert.equal(corner.y, halfY, "the camera did not clamp on the north edge");

  const middle = clampCamera({ x: 32, y: 32 }, size, halfX, halfY);
  assert.deepEqual(middle, { x: 32, y: 32 }, "the camera should follow freely inland");

  const far = clampCamera({ x: 63, y: 63 }, size, halfX, halfY);
  assert.equal(far.x, size - halfX, "the camera did not clamp on the east edge");

  // A map smaller than the view is centred, not clamped to a corner.
  const tiny = clampCamera({ x: 2, y: 2 }, 10, halfX, halfY);
  assert.deepEqual(tiny, { x: 5, y: 5 }, "a small map should centre");
});

test("PLAYTEST 3: nothing may fog the diorama out of existence", async () => {
  // The bug that made the canvas look empty with no error at all: fog.far was
  // 110 while the orthographic camera sits ~114 units from the ground, so every
  // fragment rendered as 100% fog colour — which was also the clear colour.
  const src = readFileSync(join(JS_DIR, "scene.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const fog = code.match(/new THREE\.Fog\w*\(([^)]*)\)/);
  if (fog) {
    const nums = fog[1].split(",").slice(1).map((n) => Number(n.trim()));
    const far = Math.max(...nums.filter(Number.isFinite));
    const PITCH = 52 * (Math.PI / 180), HEIGHT = 90;
    const distance = Math.sqrt(HEIGHT ** 2 + (HEIGHT / Math.tan(PITCH)) ** 2);
    assert.ok(far > distance * 1.25,
      `fog.far (${far}) is inside the camera distance (${distance.toFixed(1)}) — ` +
      "the whole scene will render as fog colour and look like an empty canvas");
  }
});

test("PLAYTEST 3: the client reports failures on the page", () => {
  // Three rounds were lost to a client that failed silently.
  const src = readFileSync(join(JS_DIR, "main.js"), "utf8");
  assert.ok(/addEventListener\("error"/.test(src), "no window error handler");
  assert.ok(/unhandledrejection/.test(src), "unhandled promise rejections are swallowed");
  assert.ok(/catch \(err\)/.test(src), "the render path has no try/catch");
});
