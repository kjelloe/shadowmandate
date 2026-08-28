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

test("PLAYTEST 13: the compound camera clamps per-axis, not against one size", async () => {
  const { clampCameraRect, clampCamera } = await import("../client/js/scene.js");
  // A compound is 24x16. Clamping both axes against a single size is what the
  // square-map helper does, and on a rectangle it either crops the long axis or
  // shows void past the short one — which is the playtest-2 defect indoors.
  const w = 24, h = 16, half = 3;
  assert.deepEqual(clampCameraRect({ x: 1, y: 1 }, w, h, half, half), { x: half, y: half });
  assert.deepEqual(clampCameraRect({ x: 23, y: 15 }, w, h, half, half),
    { x: w - half, y: h - half });
  assert.deepEqual(clampCameraRect({ x: 12, y: 8 }, w, h, half, half), { x: 12, y: 8 },
    "the camera should follow freely in the middle of the compound");
  // The SHORT axis must clamp against ITS OWN size. With a half-span of 9 the
  // 16-tall compound is narrower than the view, so it centres — while the
  // 24-wide axis still clamps. Passing one size for both gets this wrong.
  const wide = clampCameraRect({ x: 2, y: 2 }, w, h, 9, 9);
  assert.equal(wide.y, h / 2, "the short axis should centre when the view is taller than it");
  assert.equal(wide.x, 9, "the long axis should still clamp");
  // And the square helper must stay exactly what it always was.
  assert.deepEqual(clampCamera({ x: 6, y: 9 }, 64, 17, 11), { x: 17, y: 11 });
});

test("PLAYTEST 13: a captured Firm is told what its options are", async () => {
  const { captureSituation } = await import("../client/js/models.js");
  const hq = { cellX: 5, cellY: 5, evacActive: 0, perimeterRadius: 4 };
  const held = { id: 1, state: 3, firmId: 0, x: 0, y: 0, detection: 0 };

  // Nothing to say while somebody is still on their feet: a captured SECOND
  // operative is a setback, not a crisis, and stealing the screen from a player
  // who is still playing would be its own defect.
  assert.equal(captureSituation({
    agents: [held, { id: 2, state: 1, firmId: 0, x: 0, y: 0, detection: 0 }],
    holdingSites: [], hq, bank: 400, bailCost: 60,
  }), null, "the overlay must not interrupt a player who still has an operative");

  // Everyone in custody: this is the "when what?" moment.
  const sit = captureSituation({
    agents: [held],
    holdingSites: [{ id: 0, cellX: 12, cellY: 9, heldOwn: [1] }],
    hq, bank: 400, bailCost: 60,
  });
  assert.ok(sit, "a Firm with everyone in custody must get the overlay");
  assert.equal(sit.heldCount, 1);
  assert.deepEqual([sit.cellX, sit.cellY], [12, 9], "it must say WHERE they are held");
  assert.equal(sit.bailCost, 60);
  assert.equal(sit.canBail, true);
  // D51: folding up with nobody left is explicitly allowed, and it is the route
  // to a fresh operative. If this ever reads false the player is stuck with no
  // move at all, which is the state the finding was reported from.
  assert.equal(sit.canPullOut, true, "D51: folding with nobody left must stay offered");

  // Broke: bail is refused by the engine (bailQuote), so the button must be
  // dead in the UI rather than a click that comes back rejected.
  const broke = captureSituation({
    agents: [held], holdingSites: [{ id: 0, cellX: 12, cellY: 9, heldOwn: [1] }],
    hq, bank: 0, bailCost: 0,
  });
  assert.equal(broke.canBail, false, "bail must not be offered to a Firm that cannot pay");
  assert.equal(broke.canPullOut, true, "a broke captured Firm must still have a way out");
});

test("PLAYTEST 13: the quoted bail price is the price actually charged", async () => {
  // The two-readers rule with money attached. If the overlay computed its own
  // price the failure is silent and horrible: the button says one number, the
  // command charges another or refuses, and nothing on screen explains it.
  const { bailQuote, payBail } = await import("../engine/combat.js");
  const cfg = { bail: { pctOfBankTier1: 15, pctPerTier: 10 } };
  const firm = { id: 0, tierUnlocked: 2 };
  const bank = 400;
  const quote = bailQuote(firm, cfg, bank);
  assert.equal(quote.pct, 25, "tier 2 is 15 + 10");
  assert.equal(quote.cost, 100);

  // The reducer path must arrive at the same number, through the real function.
  const state = {
    tick: 0, events: [], holdingSites: [{ id: 0, heldAgentIds: [7] }],
    agents: [], firms: [firm],
  };
  const agent = { id: 7, firmId: 0, state: 3, holdingSiteId: 0, condition: 1, x: 0, y: 0 };
  const res = payBail(state, firm, agent, cfg, { conditionMax: 100 }, bank,
    { cellX: 4, cellY: 4 });
  assert.equal(res.error, undefined, `payBail refused: ${res.error}`);
  assert.equal(res.cost, quote.cost, "the charged price differs from the quoted price");
  const paid = state.events.find((e) => e.type === "bailPaid");
  assert.equal(paid.cost, quote.cost);
  assert.equal(paid.pct, quote.pct);
});

test("PLAYTEST 13: re-spray shops are landmarks, not a burned-only emergency ping", async () => {
  const { coverShops, burnedGuidance } = await import("../client/js/models.js");
  const view = {
    agents: [{ id: 1, state: 1, firmId: 0, x: 10 * 256, y: 10 * 256, detection: 0 }],
    buildings: [
      { id: 1, kind: 0, cellX: 4, cellY: 4 },     // informant
      { id: 2, kind: 2, cellX: 12, cellY: 10 },   // cover shop
      { id: 3, kind: 1, cellX: 6, cellY: 9 },     // market
      { id: 4, kind: 2, cellX: 30, cellY: 30 },   // a second, far cover shop
    ],
  };
  const shops = coverShops(view);
  assert.equal(shops.length, 2, "both cover shops should be landmarks");
  assert.deepEqual(shops.map((s) => s.id).sort(), [2, 4]);
  // The whole point of the finding: they are on the map while UNSEEN. The old
  // behaviour showed nothing until you were already burned — the one moment you
  // have no time left to plan a route to one.
  assert.equal(burnedGuidance(view), null, "guidance is a burned-only signal by design");
  assert.ok(shops.length > 0, "landmarks must not depend on detection state");

  // ...and the urgent pulse still resolves to the NEAREST when burned, so the
  // two signals stay distinct rather than one replacing the other.
  view.agents[0].detection = 2;
  assert.equal(burnedGuidance(view).buildingId, 2);
  assert.equal(coverShops(view).length, 2, "landmarks are unchanged by being burned");
});

test("PLAYTEST 13: an alerted patrol is louder than a recoloured dot", async () => {
  // Finding 4 wanted red-marked patrols "for caution". The colour was already
  // there; what was missing is that a 1.6px dot changing hue is not something a
  // player notices. Both surfaces must scale the marker, not just tint it — so
  // the guard reads the SOURCE of both and requires the alerted branch to be a
  // different size, which is the part a colour-only regression would drop.
  const src = {
    minimap: readFileSync(join(JS_DIR, "minimap.js"), "utf8"),
    scene: readFileSync(join(JS_DIR, "scene.js"), "utf8"),
  };
  for (const [name, text] of Object.entries(src)) {
    // Strip comments first — this guard has been fooled by prose twice before
    // (the dependency guard matched a phrase in a comment, the CSS guard matched
    // the rule written inside the comment explaining the bug).
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const idx = code.indexOf("patrolAlert");
    assert.ok(idx >= 0, `${name} does not mark alerted patrols at all`);
    // A pulse: the alerted branch must consult the tick. A steady marker is
    // legitimate design elsewhere, but here it was the reported defect.
    const region = code.slice(Math.max(0, idx - 400), idx + 400);
    assert.ok(/tick/.test(region),
      `${name}: the alerted-patrol marker does not pulse — it is a static recolour`);
  }
});

test("PLAYTEST 13: the camera rotates in quarter turns, all of them two-facade", async () => {
  const { azimuthFor, BASE_AZIMUTH } = await import("../client/js/scene.js");
  const quarter = Math.PI / 2;
  assert.equal(azimuthFor(0), BASE_AZIMUTH);
  for (let q = 0; q < 4; q++) {
    // Every sanctioned azimuth must land on an ODD multiple of 45 degrees: those
    // are precisely the views that show two facades. An even multiple would put
    // the camera square-on to the grid, which reads as a completely different
    // game, and is the thing "no rotation" was protecting against.
    const eighths = azimuthFor(q) / (Math.PI / 4);
    assert.ok(Math.abs(eighths - Math.round(eighths)) < 1e-9, "not an eighth turn");
    assert.equal(Math.round(eighths) % 2, 1, `quarter ${q} is square-on to the grid`);
  }
  // Wrapping in both directions, so a rotate-left from the base does not walk
  // off into negative azimuths the clamp maths was never checked against.
  assert.ok(Math.abs(azimuthFor(4) - azimuthFor(0)) < 1e-9, "did not wrap forwards");
  assert.ok(Math.abs(azimuthFor(-1) - azimuthFor(3)) < 1e-9, "did not wrap backwards");
  assert.ok(Math.abs(azimuthFor(1) - azimuthFor(0) - quarter) < 1e-9, "a step is not a quarter turn");
});

test("PLAYTEST 13: a right-drag moves the world WITH the cursor, at every azimuth", async () => {
  const { panDelta, azimuthFor } = await import("../client/js/scene.js");
  const pitch = Math.PI / 4, upp = 0.01;
  for (let q = 0; q < 4; q++) {
    const az = azimuthFor(q);
    // Drag right by 100px: the camera target must move so that ground which was
    // off the LEFT edge comes into view — i.e. the target moves screen-left.
    // Projecting the target displacement back onto the screen-right axis is the
    // only check that cannot pass by accident: a sign error, a swapped axis and
    // a missing pitch term all fail it, and all three of them render plausibly.
    const right = { x: Math.cos(az), y: -Math.sin(az) };
    const d = panDelta(100, 0, az, pitch, upp);
    const alongRight = d.dx * right.x + d.dy * right.y;
    assert.ok(alongRight < -0.5, `quarter ${q}: drag-right did not move the view left (${alongRight})`);
    // ...and the same drag must have NO component along the screen-vertical.
    const down = { x: Math.sin(az), y: Math.cos(az) };
    const alongDown = d.dx * down.x + d.dy * down.y;
    assert.ok(Math.abs(alongDown) < 1e-9, `quarter ${q}: a horizontal drag slid the view vertically`);

    // Vertical drag is foreshortened by the pitch: at 45 degrees a pixel of
    // vertical drag must cover MORE ground than a horizontal one, or the world
    // lags behind the cursor on the diagonal.
    const v = panDelta(0, 100, az, pitch, upp);
    const vAlongDown = v.dx * down.x + v.dy * down.y;
    assert.ok(Math.abs(vAlongDown) > Math.abs(alongRight) * 1.3,
      `quarter ${q}: the pitch foreshortening term is missing`);
  }
});

test("PLAYTEST 13: smoothing is frame-rate independent and snaps across teleports", async () => {
  const { slewAlpha, smoothTo } = await import("../client/js/scene.js");
  // Same wall-clock, different frame rates: one 100ms step and ten 10ms steps
  // must land in the same place, or the easing speed becomes a property of the
  // player's monitor. This is the whole reason the alpha is exponential.
  const tau = 0.07;
  let slow = smoothTo(0, 10, slewAlpha(0.1, tau), 4);
  let fast = 0;
  for (let i = 0; i < 10; i++) fast = smoothTo(fast, 10, slewAlpha(0.01, tau), 4);
  assert.ok(Math.abs(slow - fast) < 0.01, `frame rate changed the easing (${slow} vs ${fast})`);

  // A first sighting takes the reported position exactly — easing in from zero
  // would fly every new figure in from the map origin.
  assert.equal(smoothTo(undefined, 7, 0.5, 4), 7);
  // A teleport (entering a compound is a 60-cell jump) snaps rather than
  // sliding the operative across the void.
  assert.equal(smoothTo(0, 60, 0.5, 4), 60);
  // ...but an ordinary step eases.
  assert.ok(smoothTo(0, 1, 0.5, 4) < 1);
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
  // Playtest 5: no leave ROW anywhere — leaving is the overlay's own Leave
  // button. A quiet informant has nothing to SELL — but the safehouse keeps
  // sheltering (WD-2): exactly the wait-for-dark option survives, because
  // the cubby's own rule says a lockdown is when you need somewhere to hide,
  // and two shelters must not contradict each other.
  const rows = overlayRows(hot);
  assert.equal(rows.length, 1, "only the shelter should survive the quiet");
  const survivor = hot.options[rows[0].idx];
  assert.equal(survivor.effect?.type, "waitForDark",
    "the survivor must be the wait, never a paid intel row");
  assert.ok(!overlayRows(payloadForBuilding(content, { kind: BUILDING_KIND.SAFEHOUSE }, 0))
    .some((r) => r.kind === "leave"),
    "a leave row crept back into the dialogue — the overlay button is the ONLY leave");
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

test("the HQ tent stays packed when the HQ lives in a building (playtest 4)", async () => {
  const { hqInBuilding } = await import("../client/js/models.js");
  const view = { buildings: [{ id: 3, kind: 0, cellX: 10, cellY: 12 }] };
  assert.ok(hqInBuilding(view, { cellX: 10, cellY: 12 }),
    "an HQ on a building entrance must report in-building, or the tent draws through the safehouse");
  assert.ok(!hqInBuilding(view, { cellX: 11, cellY: 12 }),
    "an HQ one cell off the door is a tent, not a building");
  assert.ok(!hqInBuilding({ buildings: [] }, { cellX: 10, cellY: 12 }),
    "no buildings in the world means the tent fallback");
  assert.ok(!hqInBuilding(view, null), "a missing HQ is never in a building");
});

test("site visuals are typed, and the type order mirrors the engine (playtest 5)", async () => {
  const { siteVisual, SITE_TYPE_ROLES } = await import("../client/js/models.js");
  const engine = await import("../engine/citygen.js");
  // The deliberate-duplicate guard: the client cannot import the engine at
  // runtime, so this test is what keeps the two orders in step.
  assert.equal(SITE_TYPE_ROLES.length, engine.SITE_TYPE_COUNT);
  assert.equal(SITE_TYPE_ROLES[engine.SITE_CACHE], "siteCache");
  assert.equal(SITE_TYPE_ROLES[engine.SITE_VAULT], "siteVault");
  assert.equal(SITE_TYPE_ROLES[engine.SITE_LAB], "siteLab");
  assert.equal(SITE_TYPE_ROLES[engine.SITE_RELAY], "siteRelay");
  assert.equal(SITE_TYPE_ROLES[engine.SITE_TRANSIT_HUB], "siteTransit");
  assert.equal(SITE_TYPE_ROLES[engine.SITE_WAREHOUSE], "siteWarehouse");

  assert.deepEqual(siteVisual("active", engine.SITE_VAULT),
    { role: "siteVault", mark: "siteActive" });
  assert.deepEqual(siteVisual("offered", engine.SITE_RELAY),
    { role: "siteRelay", mark: "siteOffered" });
  assert.deepEqual(siteVisual(undefined, engine.SITE_LAB),
    { role: "siteLab", mark: "site" });
  assert.equal(siteVisual(undefined, 99).role, "siteCache",
    "an unknown type must fall back to a valid model, never to nothing");
});

test("the destination pin means a LIVE move order (playtest 6)", async () => {
  const { moveTarget } = await import("../client/js/models.js");
  const moving = {
    agents: [{ id: 0, state: 1, x: 10 * 256 + 128, y: 10 * 256 + 128,
      targetX: 14 * 256 + 128, targetY: 12 * 256 + 128 }],
  };
  assert.deepEqual(moveTarget(moving), { cellX: 14, cellY: 12 });
  const arrived = {
    agents: [{ id: 0, state: 1, x: 14 * 256 + 128, y: 14 * 256 + 128,
      targetX: 14 * 256 + 128, targetY: 14 * 256 + 128 }],
  };
  assert.equal(moveTarget(arrived), null,
    "a pin that lingers after arrival reads as an order the game is ignoring");
  assert.equal(moveTarget({ agents: [] }), null);
  assert.equal(moveTarget(null), null);
  // An old server without targetX must not draw a pin at 0,0.
  assert.equal(moveTarget({ agents: [{ id: 0, state: 1, x: 100, y: 100 }] }), null);
});

test("the mission banner is the first active job, and silent when idle (playtest 7)", async () => {
  const { missionBanner } = await import("../client/js/models.js");
  const view = {
    active: [
      { id: 1, kind: 1, tier: 1, reward: 90, stage: 2, stageTicks: 30, stageTarget: 60, graceTicks: 0 },
      { id: 2, kind: 0, tier: 1, reward: 40, stage: 1, graceTicks: 0 },
    ],
  };
  const b = missionBanner(view);
  assert.equal(b.kindKey, "contract.surveillance");
  assert.equal(b.stageKey, "stage.work");
  assert.ok(b.progress > 0.4 && b.progress < 0.6, "work progress must ride the banner");
  assert.equal(b.others, 1, "the banner should admit there is another job queued");
  assert.equal(missionBanner({ active: [] }), null, "no active job, no banner");
  assert.equal(missionBanner(null), null);
  const risky = missionBanner({ active: [{ id: 3, kind: 0, stage: 1, graceTicks: 40 }] });
  assert.ok(risky.atRisk, "a contract in its capture grace must read as at risk");
});

test("D61: the four walking positions pick the one nearest the line to the destination", async () => {
  const { walkOffset, WALK_POSITIONS } = await import("../client/js/models.js");
  const size = 8;
  const tiles = new Uint8Array(size * size);
  for (let x = 0; x < size; x++) tiles[3 * size + x] = 1;   // an E-W street row
  tiles[3 * size + 5] = 6;                                   // with a transit cell
  const view = (ax, ay, tx, ty) => ({
    agents: [{ id: 0, state: 1, x: ax * 256 + 128, y: ay * 256 + 128,
      targetX: tx * 256 + 128, targetY: ty * 256 + 128 }],
  });

  // EN ROUTE (far from the destination): the SENSIBLE side — the right-hand
  // sidewalk of the travel direction, like a pedestrian (playtest 10 ruling).
  assert.deepEqual(walkOffset(view(2, 3, 6, 0), tiles, size), { dx: 0, dz: 0.4 },
    "walking east takes the south kerb — the right hand of travel");
  assert.deepEqual(walkOffset(view(6, 3, 2, 0), tiles, size), { dx: 0, dz: -0.4 },
    "walking west takes the north kerb");
  // A hint does NOT override the sensible side while still en route…
  assert.deepEqual(walkOffset(view(2, 3, 6, 7), tiles, size, { dx: 0.1, dz: -0.45 }),
    { dx: 0, dz: 0.4 }, "the tapped kerb must wait for the final stretch");
  // …but on the FINAL stretch (within two cells) the tap is the TRUTH
  // (playtest 11): the operative walks to the EXACT spot, both axes, clamped
  // inside the cell — no lane snapping on arrival.
  assert.deepEqual(walkOffset(view(4, 3, 5, 3), tiles, size, { dx: 0.2, dz: -0.45 }),
    { dx: 0.2, dz: -0.42 }, "arrival must honour the exact tapped point");
  assert.deepEqual(walkOffset(view(4, 3, 5, 3), tiles, size, { dx: 0, dz: 0.12 }),
    { dx: 0, dz: 0.12 }, "a tap near the centre ends near the centre — exactly there");
  // Exact arrival works OFF the road too: tapping into a plaza corner walks
  // to that corner.
  const plaza = new Uint8Array(size * size); plaza.fill(3);
  assert.deepEqual(walkOffset(view(4, 2, 5, 2), plaza, size, { dx: -0.3, dz: 0.3 }),
    { dx: -0.3, dz: 0.3 }, "exact arrival must not require a road tile");
  // Off the road: no offset. Standing (no order): hold (null).
  assert.deepEqual(walkOffset(view(2, 1, 6, 0), tiles, size), { dx: 0, dz: 0 });
  const standing = { agents: [{ id: 0, state: 1, x: 2 * 256 + 128, y: 3 * 256 + 128,
    targetX: 2 * 256 + 128, targetY: 3 * 256 + 128 }] };
  assert.equal(walkOffset(standing, tiles, size), null,
    "standing still must HOLD the current position, not snap to centre");
});

test("the journal maps events to timestamped lines (playtest 12)", async () => {
  const { journalLine, gameClock, TICKS_PER_DAY, SPOKEN_LINES } = await import("../client/js/models.js");
  const engine = await import("../engine/season.js");
  // The deliberate duplicate: the client's day length mirrors the engine's.
  assert.equal(TICKS_PER_DAY, engine.TICKS_PER_DAY);

  const clock = gameClock(TICKS_PER_DAY + Math.trunc(TICKS_PER_DAY / 2));
  assert.equal(clock.day, 2);
  assert.equal(clock.label, "D2 12:00", "half a day in must read noon");

  assert.deepEqual(journalLine({ type: "contractAccepted", kind: 2 }),
    { key: "journal.accepted", args: ["contract.extraction"] });
  assert.deepEqual(journalLine({ type: "contractCompleted", kind: 1, reward: 90 }),
    { key: "journal.completed", args: ["contract.surveillance", 90] });
  // The transcript half: what the informant SAID is what the journal keeps.
  const said = journalLine({ type: "dialogueChosen", optionKey: "dialog.informant.askHeat" });
  assert.equal(said.key, SPOKEN_LINES["dialog.informant.askHeat"]);
  assert.ok(said.spoken, "spoken lines must flag themselves so the dialogue answers too");
  assert.equal(journalLine({ type: "heatChanged" }), null, "noise events stay out of the log");
});

test("EVAC is offered only where the reducer would accept it (playtest 12)", async () => {
  const { evacAvailable } = await import("../client/js/models.js");
  const hq = { cellX: 10, cellY: 10, perimeterRadius: 4, evacActive: 0 };
  const at = (x, y) => ({ hq, agents: [{ id: 0, state: 1, x: x * 256 + 128, y: y * 256 + 128 }] });
  assert.ok(evacAvailable(at(10, 10)), "at the HQ door");
  assert.ok(evacAvailable(at(12, 12)), "inside the perimeter");
  assert.ok(!evacAvailable(at(20, 10)), "ten cells out is not the perimeter");
  assert.ok(evacAvailable({ hq: { ...hq, evacActive: 1 }, agents: [{ id: 0, state: 1, x: 0, y: 0 }] }),
    "a RUNNING evac stays visible for cancel wherever you are");
  assert.ok(evacAvailable({ hq, agents: [] }),
    "D51: with nobody in the field, folding is allowed from anywhere");
  assert.ok(!evacAvailable({ hq: null, agents: [] }), "no HQ, no evac");
});

test("S17: BEGIN appears only at the site of a workable area contract", async () => {
  const { beginMission } = await import("../client/js/models.js");
  const base = {
    agents: [{ id: 0, state: 1, x: 10 * 256 + 128, y: 10 * 256 + 128,
      insideAreaId: -1, insideBuildingId: -1 }],
    sites: [{ id: 7, cellX: 10, cellY: 10 }],
    active: [{ id: 1, kind: 2, stage: 2, siteId: 7, recovery: 0 }],
  };
  assert.equal(beginMission(base).labelKey, "area.beginExtraction");
  assert.equal(beginMission({ ...base,
    active: [{ id: 1, kind: 1, stage: 2, siteId: 7, recovery: 0 }] }).labelKey,
  "area.beginSurveillance");
  // Not at the site, wrong stage, recovery, courier kind, already inside: no button.
  assert.equal(beginMission({ ...base,
    agents: [{ ...base.agents[0], x: 20 * 256 }] }), null, "must be at the site");
  assert.equal(beginMission({ ...base,
    active: [{ ...base.active[0], stage: 1 }] }), null, "must be at the work stage");
  assert.equal(beginMission({ ...base,
    active: [{ ...base.active[0], recovery: 1 }] }), null, "recovery stays a street job");
  assert.equal(beginMission({ ...base,
    active: [{ ...base.active[0], kind: 0 }] }), null, "courier has no inside");
  assert.equal(beginMission({ ...base,
    agents: [{ ...base.agents[0], insideAreaId: 3 }] }), null, "already inside");
});

test("S17: area actions are adjacency decisions", async () => {
  const { areaActions, areaView } = await import("../client/js/models.js");
  const view = {
    agents: [{ id: 0, state: 1, x: 0, y: 0, insideAreaId: 5, areaCol: 10, areaRow: 8 }],
    areas: [{ id: 5, doors: [{ x: 10, y: 9 }], terminals: [{ x: 3, y: 12 }],
      guards: [{ x: 11, y: 8, down: 0 }], occupants: [] }],
  };
  assert.ok(areaView(view), "agent inside must resolve their area");
  const acts = areaActions(view);
  assert.equal(acts.exit, true, "door adjacent");
  assert.equal(acts.takedown, true, "guard adjacent");
  assert.equal(acts.hack, false, "terminal far away");
  // A downed guard is not a takedown target; a rival occupant is.
  view.areas[0].guards[0].down = 1;
  assert.equal(areaActions(view).takedown, false);
  view.areas[0].occupants = [{ x: 9, y: 8, state: 1 }];
  assert.equal(areaActions(view).takedown, true);
  // On the street there are no indoor actions.
  view.agents[0].insideAreaId = -1;
  assert.deepEqual(areaActions(view), { exit: false, takedown: false, hack: false });
});

test("S17: transit lanes and hover cars stay on the avenue", async () => {
  const { transitLanes, hoverCarsAt } = await import("../client/js/models.js");
  // A toy map: one horizontal transit avenue at y=2, one vertical at x=5.
  const size = 24;
  const tiles = new Uint8Array(size * size);
  for (let x = 0; x < size; x++) tiles[2 * size + x] = 6;
  for (let y = 0; y < size; y++) tiles[y * size + 5] = 6;
  const lanes = transitLanes(tiles, size);
  assert.equal(lanes.length, 2, "two avenues, two lanes");
  // Every car, over a long window, sits ON a transit tile and inside the map.
  for (let tick = 0; tick < 4000; tick += 7) {
    for (const car of hoverCarsAt(tick, lanes, 6)) {
      const x = Math.round(car.x), y = Math.round(car.y);
      assert.ok(x >= 0 && y >= 0 && x < size && y < size, `car off-map at ${x},${y}`);
      assert.equal(tiles[y * size + x], 6, `car off the avenue at ${x},${y} (tick ${tick})`);
    }
  }
  // The traffic MOVES: the same car index is elsewhere later.
  const a = hoverCarsAt(0, lanes, 2), b = hoverCarsAt(40, lanes, 2);
  assert.ok(JSON.stringify(a) !== JSON.stringify(b), "traffic is frozen");
  // No lanes, no cars — never a crash.
  assert.deepEqual(hoverCarsAt(100, [], 6), []);
});

test("every dialogue option in the CONTENT has a spoken response line", async () => {
  // Found in the S17 sweep: choosing "wait until nightfall" spoke the REFUSE
  // line, because SPOKEN_LINES is a hand-kept map and the new option was not
  // in it — a yes that sounded like a no. Derive the requirement from the
  // content itself so the next option cannot repeat it.
  const { SPOKEN_LINES } = await import("../client/js/models.js");
  const payloads = JSON.parse(readFileSync(
    join(ROOT, "data/buildings/payloads.json"), "utf8"));
  for (const d of payloads.dialogues) {
    for (const o of d.options) {
      assert.ok(SPOKEN_LINES[o.key],
        `dialogue option "${o.key}" has no SPOKEN_LINES entry — choosing it speaks the refuse line`);
      assert.ok(EN[SPOKEN_LINES[o.key]] && NO[SPOKEN_LINES[o.key]],
        `response key "${SPOKEN_LINES[o.key]}" missing from a catalog`);
    }
  }
});

test("the journal covers the indoor game and the waiting actions (playtest 12)", async () => {
  const { journalLine } = await import("../client/js/models.js");
  // Every event a player would ask "when did that happen?" about must map.
  const covered = [
    "areaEntered", "areaExited", "areaAssetTaken", "assetExtracted",
    "areaAlarm", "areaSuppressed", "guardDowned", "agentDumped",
    "waitingForDark", "waitedForDark", "contractContested", "contractLost",
  ];
  for (const type of covered) {
    const line = journalLine({ type });
    assert.ok(line, `event "${type}" writes nothing to the journal`);
    assert.ok(EN[line.key] && NO[line.key], `journal key "${line.key}" missing from a catalog`);
  }
  assert.deepEqual(journalLine({ type: "surveillancePass", pass: 2, of: 3 }),
    { key: "journal.surveillancePass", args: [2, 3] });
});

test("OB-1: the banner says the next INPUT for an area contract", async () => {
  const { missionBanner } = await import("../client/js/models.js");
  const base = {
    agents: [{ id: 0, state: 1, x: 20 * 256, y: 20 * 256, insideAreaId: -1, insideBuildingId: -1 }],
    sites: [{ id: 7, cellX: 10, cellY: 10 }],
    active: [{ id: 1, kind: 2, stage: 2, siteId: 7, recovery: 0, tier: 1, reward: 100 }],
  };
  assert.equal(missionBanner(base).hintKey, "banner.goBegin",
    "traveling to an area contract must say GO");
  const there = { ...base,
    agents: [{ ...base.agents[0], x: 10 * 256 + 128, y: 10 * 256 + 128 }] };
  assert.equal(missionBanner(there).hintKey, "banner.pressBegin",
    "standing at the site must say PRESS BEGIN");
  const inside = { ...base, agents: [{ ...base.agents[0], insideAreaId: 3 }] };
  assert.equal(missionBanner(inside).hintKey, null, "inside, the hint is done");
  const courier = { ...base,
    active: [{ ...base.active[0], kind: 0 }] };
  assert.equal(missionBanner(courier).hintKey, null, "a courier has no BEGIN");
  for (const key of ["banner.goBegin", "banner.pressBegin"]) {
    assert.ok(EN[key] && NO[key], `${key} missing from a catalog`);
  }
});

test("DC-2: neon and pipes are EMITTED for the districts that own them", async () => {
  const t3 = await import("../client/js/terrain3d.js");
  const { generateCity } = await import("../engine/citygen.js");
  const { RULES } = await import("./helpers.js");
  const tokens = JSON.parse(readFileSync(
    join(ROOT, "client/assets/metadata/style_tokens.json"), "utf8"));
  t3.setTerrainTokens(tokens.terrain);
  const city = generateCity(4711, 64, RULES.citygen);
  const districts = { owner: Array.from(city.districtOwner),
    traits: city.districts.map((d) => d.trait) };
  const { decor } = t3.blockMassing(Array.from(city.map.cells), 64, 4711, districts);
  const neon = decor.filter((d) => d.kind === "neon");
  const pipes = decor.filter((d) => d.kind === "pipes");
  // Emission, not intent: a decor kind the massing never pushes is a feature
  // that silently does nothing (this project's signature failure).
  assert.ok(neon.length > 20, `only ${neon.length} neon signs emitted`);
  assert.ok(pipes.length > 5, `only ${pipes.length} pipe runs emitted`);
  // Ownership: pipes belong to industrial; neon never grows on government.
  assert.ok(pipes.every((d) => d.style === "industrial"), "pipes crept off the works");
  assert.ok(neon.every((d) => d.style !== "government"),
    "government facades must stay dark — no neon token, no neon");
  // Determinism: same inputs, same signs.
  const again = t3.blockMassing(Array.from(city.map.cells), 64, 4711, districts);
  assert.equal(again.decor.filter((d) => d.kind === "neon").length, neon.length);
});

test("PLAYTEST 13: the works smoke, and residential ground grows parks", async () => {
  // Finding 7: "industrial area, i.e. piping with smoke coming out; residential
  // areas should have some parks." Emission, not intent — the same guard DC-2
  // gets, for the same reason: a decor kind nothing ever pushes is a feature
  // that silently does nothing.
  const t3 = await import("../client/js/terrain3d.js");
  const { generateCity } = await import("../engine/citygen.js");
  const { RULES } = await import("./helpers.js");
  const tokens = JSON.parse(readFileSync(
    join(ROOT, "client/assets/metadata/style_tokens.json"), "utf8"));
  t3.setTerrainTokens(tokens.terrain);

  let smokeSeen = 0, parkSeen = 0, seedsWithParks = 0;
  for (const seed of [4711, 1000, 1411]) {
    const city = generateCity(seed, 64, RULES.citygen);
    const districts = { owner: Array.from(city.districtOwner),
      traits: city.districts.map((d) => d.trait) };
    const cells = Array.from(city.map.cells);
    const { decor } = t3.blockMassing(cells, 64, seed, districts);
    const smoke = decor.filter((d) => d.kind === "smoke");
    smokeSeen += smoke.length;
    // A plume must sit ON a stack: smoke over open ground is weather, not a
    // works, and it is emitted with the stack precisely so it cannot drift off.
    assert.ok(smoke.every((d) => d.style === "industrial"),
      `seed ${seed}: smoke rose off a non-industrial block`);
    assert.ok(smoke.every((d) => d.top > 1.5),
      `seed ${seed}: a plume started below stack height`);

    const parks = t3.parkPlacements(cells, 64, seed, districts);
    parkSeen += parks.length;
    if (parks.length) seedsWithParks++;
    // Parks belong on OPEN and YARD ground in residential districts, and
    // nowhere else. A tree on a road cell is a prop standing in the playfield.
    for (const p of parks) {
      assert.ok(t3.PARK_TILES.includes(cells[p.y * 64 + p.x]),
        `seed ${seed}: park on tile ${cells[p.y * 64 + p.x]} at ${p.x},${p.y}`);
      assert.ok(p.trees.length >= 2, `seed ${seed}: a park with ${p.trees.length} tree(s)`);
      for (const t of p.trees) {
        assert.ok(Math.abs(t.dx) < 0.5 && Math.abs(t.dz) < 0.5,
          `seed ${seed}: a tree wandered out of its own cell`);
      }
    }
  }
  assert.ok(smokeSeen > 0, "no chimney anywhere in three cities is smoking");
  assert.ok(parkSeen > 0, "no residential ground anywhere grew a park");
  assert.equal(seedsWithParks, 3, "some cities got no parks at all");

  // No districts, no parks — rather than trees scattered over the whole city
  // because the district map had not arrived yet.
  const bare = generateCity(4711, 64, RULES.citygen);
  assert.deepEqual(t3.parkPlacements(Array.from(bare.map.cells), 64, 4711, null), []);
});
