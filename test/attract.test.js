// test/attract.test.js — the title diorama's choreography (playtest 10).
//
// The vignette is the game's elevator pitch playing on the splash: sneak,
// hide from the sweep, capture, walk the captive off. The script is pure so
// the STORY is testable without WebGL: the hide really happens while the
// cone is on the walkway, the capture really happens, and the loop seam
// does not teleport anyone mid-scene.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attractScript, stageTiles, ATTRACT_PERIOD, STAGE_W, STAGE_H,
} from "../client/js/attract.js";

test("the vignette tells the whole story: sneak, hide, capture, exit", () => {
  // Sneaking east at the start.
  const early = attractScript(2);
  assert.ok(early.agent.present && !early.agent.hidden);
  assert.ok(early.rival.present && !early.rival.captive);

  // Hidden WHILE the cone sweeps the walkway — the story's hinge. The cone
  // faces the walkway when its facing is far from its rest angle.
  const sweep = attractScript(7);
  assert.equal(sweep.agent.hidden, 1, "the operative must hide during the sweep");
  assert.ok(sweep.patrol.face < -0.5, "the cone is not on the walkway while they hide");

  // The capture: flash fires, the rival becomes a captive.
  const grab = attractScript(13.4);
  assert.ok(grab.flash > 0, "no flash at the moment of the grab");
  assert.equal(grab.rival.captive, 1);

  // The exit: both walk east together, off the stage.
  const exit = attractScript(17);
  assert.ok(exit.agent.x > 6 && exit.rival.x > exit.agent.x,
    "the captive should be walked off ahead of the operative");

  // The empty beat before the loop.
  const quiet = attractScript(21);
  assert.equal(quiet.agent.present, 0);
  assert.equal(quiet.rival.present, 0);
});

test("the loop seam is clean and every position stays on the stage", () => {
  const a = attractScript(0), b = attractScript(ATTRACT_PERIOD);
  assert.deepEqual(a, b, "t=0 and t=PERIOD must be the same frame");
  assert.deepEqual(attractScript(-3), attractScript(ATTRACT_PERIOD - 3),
    "negative time must wrap, not explode");
  for (let t = 0; t < ATTRACT_PERIOD; t += 0.25) {
    const s = attractScript(t);
    for (const actor of [s.agent, s.rival, s.patrol]) {
      assert.ok(actor.x > -2 && actor.x < STAGE_W + 3, `x ${actor.x} off the stage at t=${t}`);
      assert.ok(actor.z > 0 && actor.z < STAGE_H, `z ${actor.z} off the stage at t=${t}`);
    }
    assert.ok(s.flash >= 0 && s.flash <= 1);
  }
});

test("the stage is a street between mass — the road pass has something to dress", () => {
  const tiles = stageTiles();
  assert.equal(tiles.length, STAGE_W * STAGE_H);
  const street = [...tiles].filter((t) => t === 1).length;
  assert.equal(street, STAGE_W, "exactly one full street row");
  assert.equal([...tiles].filter((t) => t === 4).length, 5 * STAGE_W,
    "mass stands NORTH of the street only — south towers would hide the vignette from the camera");
  assert.equal([...tiles].filter((t) => t === 8).length, tiles.length - street - 5 * STAGE_W,
    "south of the street is open yard");
});
