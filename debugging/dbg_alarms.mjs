// debugging/dbg_alarms.mjs — does the 8a alarm actually FIRE in a live world?
//
// A feature that is implemented but never triggers is the failure mode unit
// tests structurally cannot see. 8a raises alarms only from burns, so if the AI
// rarely burns near a site the whole mechanism could ship dead.
//
//   node debugging/dbg_alarms.mjs [seeds] [ticks]

import { createInitialState } from "../engine/state.js";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";
import { loadRuleset } from "../server/ruleset.js";

const RULES = loadRuleset();
const SEEDS = Number(process.argv[2] ?? 6);
const TICKS = Number(process.argv[3] ?? 12000);

console.log("seed,burns,alarmRaised,alarmEscalated,alarmEased,alarmCleared,maxStage,peakLive");
let totals = { burns: 0, raised: 0, esc: 0, eased: 0, cleared: 0, maxStage: 0 };

for (let i = 0; i < SEEDS; i++) {
  const seed = 1000 + i * 137;
  const city = generateCity(seed, 64, RULES.citygen);
  let s = createInitialState({ seed, size: 64, rules: RULES, city });
  spawnAiFirms(s, RULES, 3, {});
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);

  const c = { burns: 0, raised: 0, esc: 0, eased: 0, cleared: 0 };
  let maxStage = 0, peakLive = 0;
  for (let t = 0; t < TICKS; t++) {
    const ai = stepAiFirms(s, RULES, apply);
    s = ai.state;
    s = apply(s, { type: CMD_ADVANCE_TICK });
    for (const e of s.events) {
      if (e.type === "agentBurned") c.burns++;
      if (e.type === "alarmRaised") c.raised++;
      if (e.type === "alarmEscalated") c.esc++;
      if (e.type === "alarmEased") c.eased++;
      if (e.type === "alarmCleared") c.cleared++;
      if (e.stage > maxStage) maxStage = e.stage;
    }
    if (s.alarms.length > peakLive) peakLive = s.alarms.length;
  }
  console.log(`${seed},${c.burns},${c.raised},${c.esc},${c.eased},${c.cleared},${maxStage},${peakLive}`);
  totals.burns += c.burns; totals.raised += c.raised; totals.esc += c.esc;
  totals.eased += c.eased; totals.cleared += c.cleared;
  totals.maxStage = Math.max(totals.maxStage, maxStage);
}

console.log(`\nTOTAL burns=${totals.burns} raised=${totals.raised} escalated=${totals.esc} `
  + `eased=${totals.eased} cleared=${totals.cleared} maxStageSeen=${totals.maxStage}`);
if (totals.raised === 0) {
  console.log("\nALARM NEVER FIRED. The mechanism is shipped dead: either burns never "
    + "happen near a site, or the trigger is wrong.");
  process.exit(1);
}
