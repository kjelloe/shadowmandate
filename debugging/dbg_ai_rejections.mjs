// debugging/dbg_ai_rejections.mjs — count the AI's rejected commands (kept:
// playtest 4, the HQ-in-building slice).
//
//   SEED=4711 node debugging/dbg_ai_rejections.mjs [ticks]
//
// A well-behaved AI issues ZERO rejections; anything else is a bug report
// (the M5 lesson — move:no_route and activateEvac:not_at_hq counts found
// three AI defects and a player-facing bug no test caught). Run it whenever
// a rule the AI must follow changes: a landing rule the AI does not know is
// a rule nobody follows.

import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { createInitialState } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";
import { RULES } from "../test/helpers.js";

const SEED = Number(process.env.SEED ?? 4711);
const TICKS = Number(process.argv[2] ?? 12000);
const SIZE = Number(process.env.SIZE ?? 64);

const city = generateCity(SEED, SIZE, RULES.citygen);
let s = createInitialState({ seed: SEED, size: SIZE, rules: RULES, city });
spawnAiFirms(s, RULES, 3, { swap: false });
refillPool(s, RULES.contracts, RULES.detection);
rebuildOffers(s, RULES.contracts, RULES.detection);

const counts = new Map();
for (let t = 0; t < TICKS; t++) {
  const ai = stepAiFirms(s, RULES, apply);
  s = ai.state;
  for (const e of ai.events) {
    if (e.type !== "rejected") continue;
    const key = `${e.command ?? e.commandType ?? "?"}:${e.reason ?? "?"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  s = apply(s, { type: CMD_ADVANCE_TICK });
}

console.log(`# AI rejections — seed ${SEED}, ${TICKS} ticks, size ${SIZE}`);
if (!counts.size) {
  console.log("none — the AI issued zero rejected commands");
} else {
  for (const [key, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(6)}  ${key}`);
  }
  process.exitCode = 1;
}
