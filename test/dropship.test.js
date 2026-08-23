// test/dropship.test.js — the dropship choreography (S05, acceptance criterion 1).
//
// Presentation only: the dropship never exists in engine state, and the server
// has already placed the HQ before the sequence begins. That is exactly why the
// interesting assertions are about SAFETY — it must be interruptible, skippable
// and finite — rather than about visuals, which a test cannot judge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dropshipFlight, DROPSHIP_MS } from "../client/js/models.js";

test("the sequence is finite and ENDS", () => {
  // A choreography that never returns null leaves a dropship parked over the
  // city forever, and the caller has no other signal to clear it by.
  assert.ok(dropshipFlight(0, 1));
  assert.ok(dropshipFlight(DROPSHIP_MS - 1, 1));
  assert.equal(dropshipFlight(DROPSHIP_MS, 1), null, "the sequence never finishes");
  assert.equal(dropshipFlight(DROPSHIP_MS * 10, 1), null);
});

test("negative or nonsense elapsed draws nothing rather than throwing", () => {
  // The clock is a wall clock the client owns; a tab that slept can hand this
  // anything at all, and a render path must not throw on it.
  assert.equal(dropshipFlight(-1, 1), null);
  assert.equal(dropshipFlight(NaN, 1), null);
  assert.equal(dropshipFlight(undefined, 1), null);
});

test("it runs in, holds, and climbs out — in that order", () => {
  const phases = [];
  for (let t = 0; t < DROPSHIP_MS; t += 100) {
    const p = dropshipFlight(t, 1).phase;
    if (phases[phases.length - 1] !== p) phases.push(p);
  }
  assert.deepEqual(phases, ["inbound", "hover", "outbound"],
    "the beats are out of order, or one never happens");
});

test("it approaches from far out and leaves the way it came", () => {
  const start = dropshipFlight(0, 1);
  const mid = dropshipFlight(DROPSHIP_MS / 2, 1);
  const end = dropshipFlight(DROPSHIP_MS - 1, 1);
  // Retuned for the street-level camera (playtest 8): the approach shrank
  // from 26 cells to 8 so the flight happens ON SCREEN — at the old distance
  // the whole sequence played outside the visible frame and the drop read as
  // the agent popping into existence.
  assert.ok(start.offsetCells <= -6, "it starts on top of the HQ instead of approaching");
  assert.equal(Math.round(mid.offsetCells), 0, "it never actually arrives");
  assert.ok(end.offsetCells >= 6, "it never leaves");
  assert.ok(start.height > mid.height, "it does not descend on the way in");
  assert.ok(end.height > mid.height, "it does not climb on the way out");
});

test("the HQ appears at the hover, not at the start", () => {
  // The one thing the choreography actually gates. Revealing the HQ at t=0
  // would make the whole sequence decorative; revealing it at the end would
  // leave the player staring at empty ground for five seconds.
  assert.equal(dropshipFlight(0, 1).hqVisible, false);
  assert.equal(dropshipFlight(DROPSHIP_MS * 0.45, 1).hqVisible, false);
  assert.equal(dropshipFlight(DROPSHIP_MS * 0.55, 1).hqVisible, true);
  assert.equal(dropshipFlight(DROPSHIP_MS - 1, 1).hqVisible, true);
});

test("outbound is the mirror: the HQ goes away at the hover", () => {
  assert.equal(dropshipFlight(0, -1).hqVisible, true);
  assert.equal(dropshipFlight(DROPSHIP_MS - 1, -1).hqVisible, false);
  // ...and it leaves on the opposite side, so a drop and a pickup do not look
  // like the same shot played twice.
  assert.ok(dropshipFlight(0, -1).offsetCells > 0);
  assert.ok(dropshipFlight(0, 1).offsetCells < 0);
});

test("the pinned duration is ~5s, as the design doc specifies", () => {
  assert.ok(DROPSHIP_MS >= 4000 && DROPSHIP_MS <= 6000,
    `the sequence is ${DROPSHIP_MS}ms; S05 pins it at about five seconds`);
});

test("the sequence is driven by a WALL CLOCK, never by the tick", () => {
  // Structural, and it matters: tying presentation to the simulation tick would
  // make the animation speed up or stall with the world's pacing, and the
  // browser gates deliberately run the world at TICK_MS=250.
  const main = readFileSync(new URL("../client/js/main.js", import.meta.url), "utf8");
  const call = main.slice(main.indexOf("dropshipFlight("), main.indexOf("dropshipFlight(") + 120);
  assert.ok(call.includes("Date.now()"),
    "the dropship is driven by something other than a wall clock");
  assert.ok(!call.includes("view.tick"), "the dropship is driven by the simulation tick");
});
