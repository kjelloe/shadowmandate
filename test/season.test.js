// test/season.test.js — season rotation and the D50 disclosure surface (7d).
//
// Two systems under test, and they fail in opposite directions:
//   - the season CLOCK, which must be derived from the tick rather than stored
//     alongside it, and must expire on a world nobody attended;
//   - the DISCLOSURE, which is a design promise to a player who has not joined
//     yet: "day 24 of 28, tiers 2-4" is what makes a full upgrade tree fair.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { standingRows } from "../client/js/models.js";
import { World, nextSeasonSeed } from "../server/world.js";
import { loadRuleset } from "../server/ruleset.js";
import {
  TICKS_PER_DAY, seasonDay, isSeasonOver, isEndless, seasonStanding,
} from "../engine/season.js";

const rules = loadRuleset();

function world(overrides = {}) {
  const seasonRules = { ...rules, season: { ...rules.season, ...(overrides.season ?? {}) } };
  return new World({
    id: "test", seed: 4711, size: 48, rules: seasonRules,
    ledger: null, aiCount: 3, now: () => 1_000_000,
  });
}

// ── The clock ──────────────────────────────────────────────────────────────

test("the season day is derived from the tick, not stored beside it", () => {
  assert.equal(seasonDay(0), 0);
  assert.equal(seasonDay(TICKS_PER_DAY - 1), 0);
  assert.equal(seasonDay(TICKS_PER_DAY), 1);
  assert.equal(seasonDay(27 * TICKS_PER_DAY), 27);
  // A 28-day season is 24.192M ticks — well inside i32, which matters because
  // the tick is `| 0`-ed in the reducer.
  assert.ok(28 * TICKS_PER_DAY < 0x7fffffff);
});

test("days: 0 means endless, everywhere and not as a special case", () => {
  assert.ok(isEndless({ days: 0 }));
  assert.ok(isEndless(undefined));
  assert.ok(!isEndless({ days: 28 }));
  // The self-host setting must never rotate, however old the world gets.
  assert.ok(!isSeasonOver(999 * TICKS_PER_DAY, { days: 0 }));
  assert.ok(isSeasonOver(28 * TICKS_PER_DAY, { days: 28 }));
  assert.ok(!isSeasonOver(28 * TICKS_PER_DAY - 1, { days: 28 }));
});

test("a season nobody attended still ends — the dormancy jump is checked", () => {
  // THE CASE THAT MATTERS. Dormancy adds the slept ticks in ONE jump, so a
  // world left alone across its season end would come back still running a
  // season that expired days ago. Rotation is checked on the wake path for
  // exactly this reason, and a per-tick-only check would pass every other test
  // in this file while being wrong on the live host.
  const w = world({ season: { days: 2 } });
  w.seats.set(0, { send() {}, lastSeen: 0 });
  w.sleepingSince = 0;
  w.now = () => 3 * 24 * 3600 * 1000;     // three days asleep, season is two
  const before = w.seasonNumber;
  w.wake();
  assert.equal(w.seasonNumber, before + 1, "the world woke into an expired season");
  assert.equal(w.archives.length, 1, "the expired season was not archived");
  assert.ok(w.state.tick < TICKS_PER_DAY, "the new season did not start from a fresh tick");
});

// ── Rotation ───────────────────────────────────────────────────────────────

test("rotation archives the season that was PLAYED, not the one that replaces it", () => {
  // Ordering bug this catches: archiving after the reset dumps the standings of
  // a brand-new empty world, which looks like a successful archive of nothing.
  const w = world({ season: { days: 1 } });
  w.state.firms[0].tierUnlocked = 4;
  w.state.firms[0].recognition = 250;
  w.state.tick = TICKS_PER_DAY;
  const archive = w.checkSeason();
  assert.ok(archive, "the season did not rotate at its end tick");
  assert.equal(archive.season, 1);
  assert.equal(archive.endedAtTick, TICKS_PER_DAY);
  const firm0 = archive.standings.find((s) => s.firmId === 0);
  assert.equal(firm0.tierUnlocked, 4, "the archive recorded the reset world, not the played one");
  assert.equal(firm0.recognition, 250);
});

test("a rotated world is a REAL world: new city, fresh tick, contracts on the board", () => {
  // The failure this prevents is a season 2 that exists but cannot be played —
  // an empty pool or an ungenerated city would strand every returning player.
  const w = world({ season: { days: 1 } });
  const oldSeed = w.seed;
  const oldCity = Array.from(w.state.map.cells).join(",");
  w.state.tick = TICKS_PER_DAY;
  w.checkSeason();

  assert.notEqual(w.seed, oldSeed, "season 2 reused season 1's seed");
  assert.notEqual(Array.from(w.state.map.cells).join(","), oldCity, "the city did not change");
  assert.equal(w.state.tick, 0, "the new season did not start at tick 0");
  assert.ok(w.state.contractPool.length > 0, "season 2 opened with no contracts to take");
  assert.ok(w.state.firms.length > 0, "season 2 opened with no rival Firms");
  assert.equal(w.commandLog.length, 0, "the previous season's command log survived rotation");
});

test("the new season's seed is derived, never random — a world must be reproducible", () => {
  assert.equal(nextSeasonSeed(4711, 2), nextSeasonSeed(4711, 2));
  assert.notEqual(nextSeasonSeed(4711, 2), nextSeasonSeed(4711, 3));
  assert.ok(nextSeasonSeed(0xffffffff, 9) >= 0, "seed derivation went negative");
});

test("everyone seated is TOLD the season rotated", () => {
  // A client whose agent and HQ silently vanished looks exactly like a server
  // crash. This project has already paid for one silent client failure.
  const sent = [];
  const w = world({ season: { days: 1 } });
  w.seats.set(0, { send: (m) => sent.push(m), lastSeen: 0 });
  w.state.tick = TICKS_PER_DAY;
  w.checkSeason();
  const msg = sent.find((m) => m.type === "seasonRotated");
  assert.ok(msg, "a seated player was not told their world had reset");
  assert.equal(msg.closed.season, 1);
  assert.equal(msg.opened.season, 2);
  assert.equal(msg.opened.day, 0);
});

test("an endless world never rotates, however long it runs", () => {
  const w = world({ season: { days: 0 } });
  w.state.tick = 400 * TICKS_PER_DAY;
  assert.equal(w.checkSeason(), null);
  assert.equal(w.seasonNumber, 1);
  assert.equal(w.archives.length, 0);
});

// ── The disclosure surface (D50) ───────────────────────────────────────────

test("a world discloses its age and the tier range a newcomer would face", () => {
  const w = world({ season: { days: 28 } });
  w.state.firms[0].tierUnlocked = 1;
  w.state.firms[1].tierUnlocked = 4;
  w.state.firms[2].tierUnlocked = 2;
  w.state.tick = 24 * TICKS_PER_DAY;

  const s = w.standing();
  assert.equal(s.day, 24);
  assert.equal(s.days, 28);
  assert.equal(s.daysRemaining, 4);
  assert.equal(s.tierLow, 1);
  assert.equal(s.tierHigh, 4, "the toughest Firm in the world was not disclosed");
  assert.equal(s.season, 1);
  assert.equal(s.endless, false);
  // Every disclosed field must actually hold a value: JSON.stringify drops
  // `undefined` silently, so a mistyped field name reaches the wire as a key
  // that simply is not there — and the caller reads it as "not disclosed"
  // rather than as a bug. `size` was exactly this (state.map.width, not .size).
  for (const [k, v] of Object.entries(s)) {
    if (k === "daysRemaining") continue;      // legitimately null when endless
    assert.notEqual(v, undefined, `standing.${k} is undefined and would vanish from the JSON`);
  }
  assert.equal(s.size, 48);
});

test("the tier range counts AI Firms — they are the opposition too", () => {
  // Reporting only human tiers would describe a world that is mostly AI as
  // empty of strong opponents, which is the precise misinformation D50 exists
  // to prevent.
  const w = world();
  for (const f of w.state.firms) f.tierUnlocked = 1;
  const ai = w.state.firms.find((f) => f.isAi);
  assert.ok(ai, "no AI Firm to test with");
  ai.tierUnlocked = 5;
  assert.equal(w.standing().tierHigh, 5, "an AI Firm's tier was hidden from the disclosure");
});

test("an endless world discloses itself honestly rather than claiming a deadline", () => {
  const w = world({ season: { days: 0 } });
  w.state.tick = 90 * TICKS_PER_DAY;
  const s = w.standing();
  assert.equal(s.endless, true);
  assert.equal(s.days, 0);
  assert.equal(s.daysRemaining, null, "an endless world must not report days remaining");
  assert.equal(s.day, 90, "an endless world still has an age, and a newcomer should see it");
});

test("seasonStanding needs no world object — it is pure over state", () => {
  const w = world();
  const s = seasonStanding(w.state, { days: 28 });
  assert.equal(s.day, 0);
  assert.equal(s.firms, w.state.firms.length);
});

// ── The disclosure actually reaching the player ────────────────────────────
// A standing the server computes and the client never shows is not disclosure.

test("the briefing carries the standing — it is read BEFORE dropping in", () => {
  const w = world();
  const b = w.briefingFor(0);
  assert.ok(b.standing, "the splash screen has nothing to disclose");
  assert.equal(typeof b.standing.day, "number");
  assert.equal(typeof b.standing.tierHigh, "number");
});

test("the splash discloses season, day and tier range", () => {
  const rows = standingRows({ season: 2, day: 24, days: 28, endless: false, tierLow: 1, tierHigh: 4 });
  const keys = rows.map(([k]) => k);
  assert.deepEqual(keys, ["splash.season", "splash.day", "splash.rivalTiers"]);
  assert.equal(rows[1][1], "24 / 28");
  assert.equal(rows[2][1], "1–4");
});

test("a world with no tier spread says one tier, not a fake range", () => {
  const rows = standingRows({ season: 1, day: 0, days: 28, endless: false, tierLow: 2, tierHigh: 2 });
  assert.equal(rows.find(([k]) => k === "splash.rivalTiers")[1], "2");
});

test("an empty world withholds the tier range rather than claiming 0–0", () => {
  // "RIVAL TIERS 0-0" reads as a claim about the opposition. Absence of a
  // claim is the honest rendering of absence of Firms.
  const rows = standingRows({ season: 1, day: 0, days: 28, endless: false, tierLow: 0, tierHigh: 0 });
  assert.ok(!rows.some(([k]) => k === "splash.rivalTiers"));
});

test("an endless world uses the endless value, never a deadline", () => {
  const rows = standingRows({ season: 1, day: 90, days: 0, endless: true, tierLow: 1, tierHigh: 3 });
  const day = rows.find(([k]) => k === "splash.day");
  assert.ok(day, "an endless world stopped reporting its age");
  assert.equal(day[1], "splash.dayEndless", "the endless world did not use the endless wording");
  assert.equal(day[2], 90, "the endless day row lost the day number it interpolates");
  // "90 / 0" would advertise a season end that does not exist.
  assert.ok(!String(day[1]).includes("/"), "an endless world advertised a deadline");
});

test("the disclosure RENDERS as readable text, in both catalogs", () => {
  // The bug this exists for: the first version used the interpolated catalog
  // entry "DAY {0} OF {1}" as a LABEL, so the splash rendered
  //   DAY  OF ................ 0/28
  // with both slots empty. Every unit test passed — the DATA was right and the
  // TEXT was gibberish. Only opening the live page showed it, so the rendering
  // step is now asserted here rather than trusted.
  const render = (catalog, rows) => rows.map(([k, v, ...args]) => {
    const tr = (key, ...a) => (catalog[key] ?? key)
      .replace(/\{(\d+)\}/g, (_, i) => a[Number(i)] ?? "");
    return `${tr(k)}: ${tr(v, ...args)}`;
  });

  for (const loc of ["en", "no"]) {
    const catalog = JSON.parse(
      readFileSync(new URL(`../client/i18n/${loc}.json`, import.meta.url), "utf8"));

    const fixed = render(catalog,
      standingRows({ season: 1, day: 24, days: 28, endless: false, tierLow: 1, tierHigh: 4 }));
    const endless = render(catalog,
      standingRows({ season: 1, day: 90, days: 0, endless: true, tierLow: 1, tierHigh: 1 }));

    for (const line of [...fixed, ...endless]) {
      // An empty interpolation slot leaves a double space or a dangling
      // separator — exactly how the original defect looked on screen.
      assert.ok(!/\s{2,}/.test(line), `${loc}: "${line}" has an empty slot`);
      assert.ok(!/:\s*$/.test(line), `${loc}: "${line}" rendered an empty value`);
      assert.ok(!/\{\d+\}/.test(line), `${loc}: "${line}" left an untouched placeholder`);
    }
    assert.ok(fixed.some((l) => l.includes("24") && l.includes("28")),
      `${loc}: the day row lost its numbers`);
    assert.ok(endless.some((l) => l.includes("90")),
      `${loc}: an endless world stopped reporting its age`);
  }
});

test("no standing discloses nothing, rather than throwing on the splash screen", () => {
  // The splash renders before the first briefing arrives.
  assert.deepEqual(standingRows(null), []);
  assert.deepEqual(standingRows(undefined), []);
});

test("the client is TOLD about a rotation before its view is cleared", () => {
  // The ordering bug this catches is specific and silent: main.js opens with
  // `if (!s.view) return`, and a rotation deliberately nulls the view — so
  // handling the event after that guard drops the one message that explains
  // why the player's world vanished.
  const main = readFileSync(new URL("../client/js/main.js", import.meta.url), "utf8");
  const guard = main.indexOf("if (!s.view) return;");
  const handler = main.indexOf('e.type === "seasonRotated"');
  assert.ok(handler > 0, "main.js never handles a season rotation");
  assert.ok(handler < guard,
    "the rotation is handled after the no-view guard, so the player is never told");
});
