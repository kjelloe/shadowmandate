#!/usr/bin/env node
// debugging/sm_systems.mjs — WHICH SYSTEMS ACTUALLY FIRED.
//   SEED=4711 node debugging/sm_systems.mjs [ticks]
//
// A feature that silently never triggers is the failure mode unit tests cannot
// see. This prints an event census for a run so "it's implemented" and "it
// happens" stop being the same claim.

import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK, CMD_MOVE } from "../engine/commands.js";
import { makeWorld, placeAgent, quietCell, reachableDestination } from "../test/helpers.js";

const SEED = Number(process.env.SEED ?? 4711);
const TICKS = Number(process.argv[2] ?? 3000);

let s = makeWorld({ seed: SEED });
const start = quietCell(s) ?? { x: 4, y: 4 };
placeAgent(s, { agentId: 0, firmId: 0, cellX: start.x, cellY: start.y });

const census = new Map();
const record = (state) => {
  for (const e of state.events) census.set(e.type, (census.get(e.type) ?? 0) + 1);
};

// Walk the agent between district cores so it meets patrols, cover and heat.
let leg = 0;
for (let t = 0; t < TICKS; t++) {
  if (t % 400 === 0) {
    const here = {
      x: Math.floor(s.agents[0].x / 256), y: Math.floor(s.agents[0].y / 256),
    };
    const core = s.districts[leg % s.districts.length];
    leg++;
    s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: core.coreX, cellY: core.coreY });
    record(s);
  }
  s = apply(s, { type: CMD_ADVANCE_TICK });
  record(s);
}

console.log(`# systems census — seed ${SEED}, ${TICKS} ticks, ruleset ${s.rules.version}`);
const rows = [...census.entries()].sort((a, b) => b[1] - a[1]);
for (const [type, n] of rows) console.log(`${String(n).padStart(6)}  ${type}`);

// The systems M2 promises must appear at least once, or the milestone is a
// claim rather than a fact.
const REQUIRED = ["agentNoticed", "agentBurned", "heatChanged", "agentArrived"];
const missing = REQUIRED.filter((t) => !census.has(t));
console.log("");
if (missing.length) {
  console.log(`MISSING (never fired): ${missing.join(", ")}`);
  process.exit(1);
}
console.log("all required M2 systems fired");
for (const d of s.districts) console.log(`district ${d.id} trait ${d.trait} heat ${d.heat}`);
