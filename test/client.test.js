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
  MARKER_SHAPES, markerShape, buildingRole, siteRole,
  burnedGuidance, pinnedCells, MAX_PINS,
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

  // CONTENT references keys too. The code-only scan missed every disguise
  // name, and six of them shipped with no translation in either locale — the
  // exact failure this guard exists to prevent, hiding one directory over.
  for (const file of ["buildings/payloads.json", "buildings/disguises.json"]) {
    const raw = readFileSync(join(ROOT, "data", file), "utf8");
    for (const m of raw.matchAll(/"(?:key|greetKey|quietKey)":\s*"([a-z][\w.]*)"/g)) {
      keys.add(m[1]);
    }
  }

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

test("PLAYTEST 3: a burned operative is pointed at the NEAREST cover shop, and only then", () => {
  // kind 2 is the cover shop; kinds 0/1 are informant and market and must
  // never be offered as a re-spray.
  const burned = {
    ...VIEW,
    agents: [{ ...VIEW.agents[0], detection: 2 }],
    buildings: [
      { id: 3, kind: 1, cellX: 11, cellY: 10 },   // market NEXT DOOR — a trap answer
      { id: 4, kind: 2, cellX: 30, cellY: 10 },
      { id: 5, kind: 2, cellX: 14, cellY: 12 },   // the nearest actual shop
    ],
  };
  const g = burnedGuidance(burned);
  assert.equal(g.buildingId, 5, "guidance must pick the nearest COVER SHOP, not the nearest building");
  assert.equal(g.cellX, 14); assert.equal(g.cellY, 12);

  assert.equal(burnedGuidance(VIEW), null, "an unburned agent gets no ping");
  assert.equal(burnedGuidance({ ...burned, buildings: [] }), null,
    "no shops in view -> no ping, never a crash");
});

test("PLAYTEST 3: pinned contracts resolve to their CURRENT objective, capped and stale-proof", () => {
  const view = {
    ...VIEW,
    sites: [{ id: 7, cellX: 20, cellY: 21 }, { id: 8, cellX: 40, cellY: 41 }],
    active: [
      { id: 1, kind: 1, stage: 1, siteId: 7 },
      { id: 2, kind: 1, stage: 3, siteId: 8 },              // return leg -> the HQ
      { id: 3, kind: 1, stage: 1, siteId: 8 },
      { id: 4, kind: 1, stage: 1, siteId: 7 },
    ],
  };
  const pins = pinnedCells(view, new Set([1, 2]));
  assert.deepEqual(pins.map((p) => p.id), [1, 2]);
  assert.deepEqual(pins[0], { id: 1, cellX: 20, cellY: 21 });
  assert.deepEqual(pins[1], { id: 2, cellX: 10, cellY: 10 },
    "a stage-3 pin must follow the contract home, not point at the finished site");

  assert.equal(pinnedCells(view, new Set([1, 2, 3, 4])).length, MAX_PINS, "pins cap at three");
  assert.deepEqual(pinnedCells(view, new Set([99])), [], "a stale id resolves to nothing");
  assert.deepEqual(pinnedCells(view, null), [], "no pin set -> empty, never a crash");
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

test("PLAYTEST 5: interactive lists must not rebuild every tick", () => {
  // The board was wiped and rebuilt at 10Hz, so a button was destroyed between
  // mousedown and mouseup and the click NEVER completed. Anything a player
  // clicks has to outlive the click.
  const src = readFileSync(join(JS_DIR, "main.js"), "utf8");
  assert.ok(/boardSignature/.test(src),
    "renderBoard has no change check — it will rebuild the list every tick");
  const fn = src.slice(src.indexOf("function renderBoard"), src.indexOf("function renderStandoff"));
  assert.ok(/if \(signature === boardSignature\) return;/.test(fn),
    "renderBoard must bail out when the rows have not changed");
  const wipeAt = fn.indexOf('list.textContent = ""');
  const guardAt = fn.indexOf("boardSignature) return");
  assert.ok(guardAt >= 0 && guardAt < wipeAt,
    "the change check must come BEFORE the list is wiped");
});

// ── Objective marking (owner request, 2026-08-05) ─────────────────────────

test("sites are colour-coded by what they mean to this player", async () => {
  const { siteRoles } = await import("../client/js/models.js");
  const view = {
    board: { contracts: [{ id: 1, siteId: 10, siteIdB: -1 }], teaser: null },
    active: [{ id: 2, siteId: 20, siteIdB: 21 }],
  };
  const roles = siteRoles(view);
  assert.equal(roles.get(10), "offered");
  assert.equal(roles.get(20), "active");
  assert.equal(roles.get(21), "active", "a courier destination is part of the job");
  assert.equal(roles.get(99), undefined, "an unrelated site should be scenery");
});

test("an active contract outranks an offered one at the same site", async () => {
  const { siteRoles } = await import("../client/js/models.js");
  const roles = siteRoles({
    board: { contracts: [{ id: 1, siteId: 7, siteIdB: -1 }] },
    active: [{ id: 2, siteId: 7, siteIdB: -1 }],
  });
  assert.equal(roles.get(7), "active", "the job you took must win");
});

test("the objective bearing points the right way and reports distance", async () => {
  const { objectiveBearing } = await import("../client/js/models.js");
  const view = {
    active: [{ id: 1, kind: 1, siteId: 5, siteIdB: -1, stage: 1 }],
    sites: [{ id: 5, cellX: 30, cellY: 10 }],
    hq: { cellX: 2, cellY: 2 },
  };
  const east = objectiveBearing(view, 10, 10);
  assert.equal(east.distance, 20);
  assert.ok(Math.abs(east.angle) < 0.01, "due east should be angle 0");

  const south = objectiveBearing({ ...view, sites: [{ id: 5, cellX: 10, cellY: 30 }] }, 10, 10);
  assert.ok(Math.abs(south.angle - Math.PI / 2) < 0.01, "due south should be +PI/2");

  assert.equal(objectiveBearing({ active: [], sites: [] }, 0, 0), null,
    "no contract means no pointer");
});

test("the objective follows the contract stage to its destination", async () => {
  const { objectiveCell } = await import("../client/js/models.js");
  const base = {
    sites: [{ id: 5, cellX: 30, cellY: 10 }, { id: 6, cellX: 40, cellY: 40 }],
    hq: { cellX: 2, cellY: 2 },
  };
  // Travelling: head for the pickup.
  assert.equal(objectiveCell({ ...base, active: [{ kind: 0, siteId: 5, siteIdB: 6, stage: 1 }] }).cellX, 30);
  // Carrying a courier package: head for the drop.
  assert.equal(objectiveCell({ ...base, active: [{ kind: 0, siteId: 5, siteIdB: 6, stage: 3 }] }).cellX, 40);
  // Carrying anything else home: head for the HQ.
  assert.equal(objectiveCell({ ...base, active: [{ kind: 2, siteId: 5, siteIdB: -1, stage: 3 }] }).cellX, 2);
});

test("the debrief prints the numbers that make an extraction feel like one", async () => {
  const { debriefRows, reputationBar } = await import("../client/js/models.js");
  const rows = debriefRows(
    { banked: 480, contractsCompleted: 3, recognition: 240, emergency: 0, reputationDelta: 4 },
    { bank: 1200, tierUnlocked: 2, reputation: 20 });
  const keys = rows.map((r) => r[0]);
  for (const expected of ["debrief.resources", "debrief.contracts", "debrief.recognition",
    "debrief.hqIntact", "debrief.bank"]) {
    assert.ok(keys.includes(expected), `debrief is missing ${expected}`);
  }
  assert.deepEqual(rows.find((r) => r[0] === "debrief.hqIntact")[1], "common.yes");

  const emergency = debriefRows({ banked: 0, emergency: 1 }, null);
  assert.equal(emergency.find((r) => r[0] === "debrief.hqIntact")[1], "common.no",
    "an emergency evac must not claim the HQ survived");

  assert.equal(reputationBar(0).replace(/░/g, "").length, 0);
  assert.equal(reputationBar(40).replace(/█/g, "").length, 0);
  assert.equal(reputationBar(20).length, 10, "the bar is always ten cells wide");
});

// ── Building overlays ─────────────────────────────────────────────────────

const CONTENT = JSON.parse(readFileSync(join(ROOT, "data/buildings/payloads.json"), "utf8"));
const DISGUISES = JSON.parse(readFileSync(join(ROOT, "data/buildings/disguises.json"), "utf8"));

test("the overlay resolves the right content for each building kind", async () => {
  const { payloadForBuilding, overlayRows, BUILDING_KIND } = await import("../client/js/models.js");
  const content = { payloads: CONTENT, disguises: DISGUISES };

  const informant = payloadForBuilding(content, { kind: BUILDING_KIND.SAFEHOUSE }, 0);
  assert.equal(informant.kind, "dialogue");
  assert.ok(overlayRows(informant).length > 1, "a calm informant should have things to say");

  const market = payloadForBuilding(content, { kind: BUILDING_KIND.MARKET }, 0);
  assert.equal(market.kind, "shop");
  assert.ok(overlayRows(market).every((r) => r.kind === "buy"));

  const cover = payloadForBuilding(content, { kind: BUILDING_KIND.COVERSHOP }, 0);
  assert.equal(cover.id, "covershop");
});

test("the informant visibly goes quiet in a lockdown, not just silently", async () => {
  const { payloadForBuilding, overlayRows, BUILDING_KIND } = await import("../client/js/models.js");
  const content = { payloads: CONTENT, disguises: DISGUISES };
  const hot = payloadForBuilding(content, { kind: BUILDING_KIND.SAFEHOUSE }, 2);
  assert.ok(hot.quiet, "the informant kept talking through a lockdown");
  const rows = overlayRows(hot);
  assert.equal(rows.length, 1, "only leaving should remain");
  assert.equal(rows[0].kind, "leave");
});

test("every disguise the engine can assign has a portrait the client can show", async () => {
  const { disguiseFor } = await import("../client/js/models.js");
  const content = { payloads: CONTENT, disguises: DISGUISES };
  for (let id = 0; id < DISGUISES.disguises.length; id++) {
    const d = disguiseFor(content, id);
    assert.ok(d, `no disguise entry for id ${id}`);
    assert.ok(d.key in EN, `disguise ${id} has no i18n name`);
  }
});

test("the overlay does not rebuild under the player's cursor", () => {
  // Same trap that made the contract button unclickable at 10Hz.
  const src = readFileSync(join(JS_DIR, "main.js"), "utf8");
  const fn = src.slice(src.indexOf("function renderBuilding"), src.indexOf("function renderStandoff"));
  assert.ok(/buildingSignature/.test(fn), "renderBuilding has no change check");
  const guard = fn.indexOf("=== buildingSignature) return");
  const wipe = fn.indexOf('list.textContent = ""');
  assert.ok(guard >= 0 && guard < wipe, "the change check must precede the rebuild");
});

test("the drop-zone screen ranks districts by work, then by how hot they are", async () => {
  const { districtChoices } = await import("../client/js/models.js");
  const ranked = districtChoices([
    { id: 0, trait: 0, contracts: 2, heatBand: 0 },
    { id: 1, trait: 1, contracts: 7, heatBand: 2 },
    { id: 2, trait: 2, contracts: 7, heatBand: 0 },
  ]);
  assert.equal(ranked[0].id, 2, "most work and coolest should lead");
  assert.equal(ranked[1].id, 1, "equal work, hotter, comes second");
  assert.equal(ranked[2].id, 0, "least work last");
  for (const d of ranked) {
    assert.ok(d.traitKey in EN, `trait key ${d.traitKey} is not translated`);
    assert.ok(d.heatKey in EN, `heat key ${d.heatKey} is not translated`);
  }
});

// S15 asks for silhouette readability. Until the 7a art pass every marker
// except the Field HQ was the same sphere, separated only by colour — which
// fails at a glance and fails completely for a colourblind player. The shape
// DECISION is pure, so it is testable even though the renderer is not.
test("every marker role has a silhouette, and they are not all the same", () => {
  const roles = Object.keys(MARKER_SHAPES);
  for (const role of roles) {
    assert.ok(markerShape(role), `role ${role} has no shape`);
  }
  assert.equal(markerShape("no-such-role"), null,
    "an unknown role must return null, not silently fall back to a sphere");

  // The point of the pass: the things a player must tell apart in a busy
  // street must not share a silhouette.
  const distinct = new Set([
    markerShape("agent"), markerShape("patrol"),
    markerShape("siteActive"), markerShape("ownHq"), markerShape("informant"),
  ]);
  assert.ok(distinct.size >= 4,
    `own agent, patrol, objective, HQ and informant should be distinguishable by shape alone, got ${[...distinct].join("/")}`);

  // A patrol is a thing that is LOOKING; it should not look like a person.
  assert.notEqual(markerShape("patrol"), markerShape("agent"));
  assert.equal(buildingRole(0), "informant");
  assert.equal(siteRole("active"), "siteActive");
  assert.equal(siteRole(undefined), "siteScenery");
});
