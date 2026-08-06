// debugging/dbg_raids.mjs — do scheduled raids (8i) actually LAND?
//
// The world-day sweep reports perimeterAlarm as "raids" and cacheLooted as
// "raidsSucceeded", and the latter read 0 across every seed. A 0% is a bug
// report, not a balance reading, so this traces the whole lifecycle.

import { createInitialState } from "../engine/state.js";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";
import { loadRuleset } from "../server/ruleset.js";

const RULES = loadRuleset();
const SEEDS = Number(process.argv[2] ?? 4);
const TICKS = Number(process.argv[3] ?? 12000);

console.log("seed,incoming,dispatched,ended,arrived,perimeterAlarm,looted,maxHqCache");
for (let i = 0; i < SEEDS; i++) {
  const seed = 1000 + i * 137;
  let s = createInitialState({ seed, size: 64, rules: RULES, city: generateCity(seed, 64, RULES.citygen) });
  spawnAiFirms(s, RULES, 3, {});
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);

  const c = { incoming: 0, dispatched: 0, ended: 0, arrived: 0, alarm: 0, looted: 0 };
  let maxCache = 0;
  for (let t = 0; t < TICKS; t++) {
    const ai = stepAiFirms(s, RULES, apply);
    s = ai.state;
    for (const e of ai.events) if (e.reason === "raid_arrived") c.arrived++;
    s = apply(s, { type: CMD_ADVANCE_TICK });
    for (const e of s.events) {
      if (e.type === "raidIncoming") c.incoming++;
      if (e.type === "raidDispatched") c.dispatched++;
      if (e.type === "raidEnded") c.ended++;
      if (e.type === "perimeterAlarm") c.alarm++;
      if (e.type === "cacheLooted") c.looted++;
    }
    for (const h of s.hqs) if (h.cacheResources > maxCache) maxCache = h.cacheResources;
  }
  console.log(`${seed},${c.incoming},${c.dispatched},${c.ended},${c.arrived},${c.alarm},${c.looted},${maxCache}`);
}
