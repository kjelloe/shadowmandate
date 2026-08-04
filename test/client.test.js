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
