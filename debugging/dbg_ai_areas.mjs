// debugging/dbg_ai_areas.mjs — AI event census per seed (kept).
//
// The M5 gate asserts a BINARY ("did any contract complete on all five pinned
// seeds"); this prints the counts behind it, which is what you actually need
// when it goes red. Usage: node debugging/dbg_ai_areas.mjs <seed> <ticks>
//
// A warning learned the hard way here: run it and CHECK THE EXIT STATUS. An
// early version of this diagnosis piped straight into awk, so a process dying
// on an import error printed nothing and read as "zero completions" — I
// measured a confident, entirely fictional baseline off it before noticing.
import { apply } from "../engine/reducer.js";
import { stepAiFirms, spawnAiFirms } from "../engine/ai_firms.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { createInitialState } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { RULES } from "../test/helpers.js";
const seed = Number(process.argv[2] ?? 1411), ticks = Number(process.argv[3] ?? 8000);
const city = generateCity(seed, 64, RULES.citygen);
let s = createInitialState({ seed, size: 64, rules: RULES, city });
spawnAiFirms(s, RULES, 3, {});
refillPool(s, RULES.contracts, RULES.detection);
rebuildOffers(s, RULES.contracts, RULES.detection);
const census = new Map();
for (let t = 0; t < ticks; t++) {
  const ai = stepAiFirms(s, RULES, apply);
  s = ai.state;
  s = apply(s, { type: CMD_ADVANCE_TICK });
  for (const e of [...ai.events, ...s.events]) census.set(e.type, (census.get(e.type) ?? 0) + 1);
}
for (const [k, v] of [...census].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k);
console.log("--- inside now:", s.agents.filter((a) => a.insideAreaId >= 0).length,
  "areas:", (s.areas ?? []).length);
for (const a of s.agents.filter((x) => x.insideAreaId >= 0)) {
  const ar = s.areas.find((z) => z.id === a.insideAreaId);
  console.log(`   agent ${a.id} at ${a.areaCol},${a.areaRow} in area site ${ar.siteId} det ${a.detection} route ${(a.route??[]).length}`);
}
console.log("--- contracts");
for (const c of s.contractPool.filter((x) => x.acceptedBy >= 0)) {
  const site = s.sites.find((z) => z.id === c.siteId);
  console.log(`   c${c.id} kind ${c.kind} stage ${c.stage} by firm ${c.acceptedBy} site ${c.siteId} type ${site?.type}`);
}
for (const a of s.agents) {
  console.log(`   agent ${a.id} state ${a.state} inside ${a.insideAreaId} at ${Math.trunc(a.x/256)},${Math.trunc(a.y/256)} area ${a.areaCol},${a.areaRow} det ${a.detection} carry ${a.carryKind}`);
}
