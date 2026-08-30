// debugging/dbg_heat_spiral.mjs — why do 36% of worlds never reach tier 3?
//
// `0005-pacing` (n=300) split cleanly: 193 worlds reach tier 3, 107 never do,
// and the second group is not slower — it is more violent and far more locked
// down (2.5x the deployments, a third the completions, 1.85x the district-ticks
// spent at or above `checkpointsActiveAt`).
//
// The aggregate hid at least two failure modes: sorting the non-reachers by
// lockdown selects worlds with almost NO captures, while some healthy worlds
// have nine. So "captures cause the spiral" is already suspect, and this probe
// exists to watch the trajectory rather than the totals.
//
// The hypothesis it was built to test: `heat.tier1SuspendedAt` is 4 and
// `checkpointsActiveAt` is 4, so a district at heat 4 simultaneously turns on
// checkpoints AND withdraws every tier-1 contract. A tier-1 Firm there has no
// work at all, and nothing it can legally do lowers the heat.
//
// Usage:  node debugging/dbg_heat_spiral.mjs [ticks]
// Seeds are the real extremes from the battery, not hand-picked.

import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { createInitialState } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { refillPool, rebuildOffers, KIND_NAMES } from "../engine/contracts.js";
import { loadRuleset } from "../server/ruleset.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";

const TICKS = Number(process.argv[2] ?? 60000);
const SIZE = 64;
const AI = 3;

const RULES = await loadRuleset();
const HEAT = RULES.detection.heat;

// From `0005-pacing`: the four most locked-down worlds that never reached
// tier 3, and the four least locked-down that did.
const SPIRAL = [22509, 12919, 7165, 27989];
const HEALTHY = [31414, 38949, 17714, 35250];

function run(seed) {
  const city = generateCity(seed, SIZE, RULES.citygen);
  let s = createInitialState({ seed, size: SIZE, rules: RULES, city });
  spawnAiFirms(s, RULES, AI, {});
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);

  const totals = { burns: 0, captures: 0, completed: 0, accepted: 0, deployed: 0, raids: 0 };
  // "A well-behaved AI issues zero rejections; anything else is a bug report."
  // Reading these found three AI defects and a player-facing bug that no test
  // caught, so it is the first thing to look at, not the last.
  const rejections = new Map();
  // FULL census, not a hand-picked list. Which event separates a spiral world
  // from a healthy one is the question — choosing the events in advance would
  // answer it by assumption.
  const census = new Map();
  const samples = [];
  const every = Math.max(1, Math.trunc(TICKS / 10));

  for (let t = 0; t < TICKS; t++) {
    const ai = stepAiFirms(s, RULES, apply);
    s = ai.state;
    s = apply(s, { type: CMD_ADVANCE_TICK });
    for (const e of [...ai.events, ...s.events]) {
      census.set(e.type, (census.get(e.type) ?? 0) + 1);
      if (e.type === "agentBurned") totals.burns++;
      else if (e.type === "agentCaptured") totals.captures++;
      else if (e.type === "contractCompleted") totals.completed++;
      else if (e.type === "perimeterAlarm") totals.raids++;
      else if (e.type === "contractAccepted") totals.accepted++;
      else if (e.type === "firmDeployed") totals.deployed++;
      else if (e.type === "rejected") {
        const k = `${e.command}:${e.reason}`;
        rejections.set(k, (rejections.get(k) ?? 0) + 1);
      }
    }
    if (t % every === 0 || t === TICKS - 1) {
      const heats = s.districts.map((d) => d.heat);
      const hot = heats.filter((h) => h >= HEAT.checkpointsActiveAt).length;
      // What a TIER 1 Firm can actually see. `tier1SuspendedAt` withdraws
      // tier-1 work from a hot district, so this is the number that decides
      // whether a young Firm has anything to do.
      const pool = s.contractPool.filter((c) => c.acceptedBy < 0 && c.reservedBy < 0);
      const t1 = pool.filter((c) => c.tier === 1).length;
      const t1cool = pool.filter((c) => c.tier === 1
        && (s.districts[c.districtId]?.heat ?? 0) < HEAT.tier1SuspendedAt).length;
      samples.push({
        t, heats: heats.join("/"), hot, tiers: s.firms.filter((f) => f.isAi).map((f) => f.tierUnlocked).join(""),
        pool: pool.length, t1, t1cool,
        burns: totals.burns, caps: totals.captures, done: totals.completed,
      });
    }
  }
  return { samples, totals, rejections, census, districts: s.districts.length };
}

const out = [];
function report(label, seeds) {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  for (const seed of seeds) {
    const { samples, totals, rejections, census, districts } = run(seed);
    console.log(`\nseed ${seed}  (${districts} districts, ${TICKS} ticks)`);
    console.log(`   tick   heat/district   hot  firmTiers  pool  t1  t1cool  burns caps done`);
    for (const r of samples) {
      console.log(`  ${String(r.t).padStart(6)}   ${r.heats.padEnd(14)}${String(r.hot).padStart(3)}`
        + `  ${r.tiers.padStart(8)}  ${String(r.pool).padStart(4)}${String(r.t1).padStart(4)}`
        + `${String(r.t1cool).padStart(8)}${String(r.burns).padStart(7)}${String(r.caps).padStart(5)}`
        + `${String(r.done).padStart(5)}`);
    }
    console.log(`  totals: deployed=${totals.deployed} accepted=${totals.accepted} `
      + `completed=${totals.completed} burns=${totals.burns} captures=${totals.captures} `
      + `raids=${totals.raids}`);
    out.push([seed, census]);
    const rj = [...rejections.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  rejections: ${rj.length ? rj.slice(0, 6).map(([k, v]) => `${k}=${v}`).join("  ") : "none"}`);
  }
}

console.log(`# heat spiral probe — heat.max=${HEAT.max} decayTicks=${HEAT.decayTicks} `
  + `checkpointsActiveAt=${HEAT.checkpointsActiveAt} tier1SuspendedAt=${HEAT.tier1SuspendedAt}`);
console.log(`# t1     = unaccepted tier-1 contracts in the pool`);
console.log(`# t1cool = those of them in a district below tier1SuspendedAt — what a`);
console.log(`#          tier-1 Firm can ACTUALLY take. If this pins to 0, a young Firm`);
console.log(`#          has no legal work and nothing it can do lowers the heat.`);

report("SPIRAL — never reached tier 3, most locked-down in the battery", SPIRAL);
report("HEALTHY — reached tier 3, least locked-down in the battery", HEALTHY);

// The diff is the finding. Sum each group and show, per event type, how a
// spiral world differs from a healthy one — proportionally, so a rare event
// that TRIPLES is not hidden behind a common one that moves 10%.
const half = out.length / 2;
const sum = (rows) => {
  const m = new Map();
  for (const [, c] of rows) for (const [k, v] of c) m.set(k, (m.get(k) ?? 0) + v);
  return m;
};
const sp = sum(out.slice(0, half)), he = sum(out.slice(half));
const keys = [...new Set([...sp.keys(), ...he.keys()])];
console.log(`\n${"=".repeat(78)}\nEVENT CENSUS — spiral vs healthy (${half} seeds each)\n${"=".repeat(78)}`);
console.log(`${"event".padEnd(26)}${"spiral".padStart(9)}${"healthy".padStart(9)}${"ratio".padStart(10)}`);
const rows = keys.map((k) => {
  const a = sp.get(k) ?? 0, b = he.get(k) ?? 0;
  return { k, a, b, r: b === 0 ? (a === 0 ? 1 : Infinity) : a / b };
}).filter((r) => r.a + r.b >= 4).sort((x, y) => y.r - x.r);
for (const r of rows) {
  const flag = r.r >= 2 ? "  <-- spiral" : (r.r <= 0.5 ? "  <-- healthy" : "");
  console.log(`${r.k.padEnd(26)}${String(r.a).padStart(9)}${String(r.b).padStart(9)}`
    + `${(r.r === Infinity ? "inf" : r.r.toFixed(2)).padStart(10)}${flag}`);
}
