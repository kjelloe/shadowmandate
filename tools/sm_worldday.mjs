#!/usr/bin/env node
// tools/sm_worldday.mjs — the world-day sweep (S14). THE instrument.
//
//   node tools/sm_worldday.mjs 20                  # 20 world-days, CSV to stdout
//   SHARDS=6 SHARD=0 node tools/sm_worldday.mjs 600
//   MIRROR=1 node tools/sm_worldday.mjs 300        # mirrored world (geometry vs doctrine)
//   FIRMSWAP=1 node tools/sm_worldday.mjs 300      # personalities trade seats
//   SIZE=128 node tools/sm_worldday.mjs 100        # D26 capability battery
//   TICKS=16000 node tools/sm_worldday.mjs 50
//
// Built BEFORE the AI it measures, on purpose: an instrument written after the
// thing it judges tends to be written to agree with it.
//
// One CSV row per simulated world-day. Columns are the S14 metric set; the
// header names the ruleset era and the commit, because a number without its
// era is void (era discipline).

import { execSync } from "node:child_process";
import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK } from "../engine/commands.js";
import { createInitialState } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { mirrorState } from "../engine/mirror.js";

import { refillPool, rebuildOffers, KIND_NAMES } from "../engine/contracts.js";
import { loadRuleset } from "../server/ruleset.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";

const COUNT = Number(process.argv[2] ?? 20);
const SIZE = Number(process.env.SIZE ?? 64);
const TICKS = Number(process.env.TICKS ?? 12000);
const MIRROR = process.env.MIRROR === "1";
const FIRMSWAP = process.env.FIRMSWAP === "1";
const SHARDS = Number(process.env.SHARDS ?? 1);
const SHARD = Number(process.env.SHARD ?? 0);
const AI_COUNT = Number(process.env.AI ?? 3);

const RULES = loadRuleset();
// Instrument-side override for the patrol-density batteries. Lives HERE, not
// in the server ruleset loader: the game never reads it, only the battery
// does — and the earlier base3/base4 sweeps existed only as a hand-edited
// dirty worktree on the worker, which is how numbers stop being reproducible.
const PATROL_BASE = process.env.PATROL_BASE ? Number(process.env.PATROL_BASE) : null;
if (PATROL_BASE !== null) {
  RULES.citygen = { ...RULES.citygen,
    patrols: { ...RULES.citygen.patrols, perDistrictBase: PATROL_BASE } };
}

function commitName() {
  try {
    return execSync("git describe --always --dirty 2>/dev/null").toString().trim();
  } catch { return "nogit"; }
}

// DERIVED FROM THE ENGINE, never restated. When 8j added a sixth contract type
// this list was hardcoded to five, so `KIND[5]` was `undefined`, every Defend
// contract landed in a column that did not exist, and the battery silently
// measured 5/6 of the game while reporting a D19 verdict. An instrument that
// cannot see what it prices is worse than no instrument.
export const KIND = KIND_NAMES;

export const COLUMNS = [
  "seed", "size", "mirror", "firmswap", "ticks",
  "offered", "accepted", "completed", "failed", "expired",
  ...KIND.map((k) => `acc_${k}`),
  ...KIND.map((k) => `off_${k}`),
  ...KIND,
  "burns", "downs", "captures", "arrests", "rescues",
  "banked", "cacheLost", "raids", "raidsSucceeded",
  "deployments", "cleanExtracts", "emergencyExtracts",
  "heatMax", "heatLockdownTicks", "recognition", "tierReached",
  // D11/D19 pacing columns (slice 6e): ticks per completed contract and the
  // deployment length distribution are what the rulings are actually about.
  "avgSortieTicks", "avgDeployTicks", "deploysToTier3",
];

export function runWorldDay(seed, { size = SIZE, ticks = TICKS, mirror = MIRROR,
  firmSwap = FIRMSWAP, aiCount = AI_COUNT } = {}) {
  const city = generateCity(seed, size, RULES.citygen);
  let s = createInitialState({ seed, size, rules: RULES, city });
  if (mirror) s = mirrorState(s);

  spawnAiFirms(s, RULES, aiCount, { swap: firmSwap });
  refillPool(s, RULES.contracts, RULES.detection);
  rebuildOffers(s, RULES.contracts, RULES.detection);

  const m = Object.fromEntries(COLUMNS.map((c) => [c, 0]));
  m.seed = seed; m.size = size;
  m.mirror = mirror ? 1 : 0; m.firmswap = firmSwap ? 1 : 0; m.ticks = ticks;
  m.offered = s.contractPool.length;

  // Pacing bookkeeping (D11/D19).
  const acceptedAt = new Map();     // contractId -> tick
  const deployedAt = new Map();     // firmId -> tick
  let sortieTicks = 0, sortieCount = 0;
  let deployTicks = 0, deployCount = 0;
  let tier3At = -1, deploysWhenTier3 = 0;

  for (let t = 0; t < ticks; t++) {
    // The AI acts BETWEEN ticks, exactly where a player's client would send
    // commands. It is a player, not a privileged subsystem.
    const ai = stepAiFirms(s, RULES, apply);
    s = ai.state;
    s = apply(s, { type: CMD_ADVANCE_TICK });
    // Sample what was actually ON the boards. Acceptance share alone cannot
    // separate preference from availability: tier gating means most Firms only
    // ever see the three tier-1 types, so a type can look dominant purely
    // because it is one of the few on offer.
    if (t % 600 === 0) {
      for (const o of s.offers ?? []) {
        for (const id of o.contractIds ?? []) {
          const c = s.contractPool.find((x) => x.id === id);
          if (c) m[`off_${KIND[c.kind]}`]++;
        }
      }
    }
    for (const e of [...ai.events, ...s.events]) {
      switch (e.type) {
        case "contractAccepted": {
          m.accepted++;
          acceptedAt.set(e.contractId, t);
          if (e.kind !== undefined) m[`acc_${KIND[e.kind]}`]++;
          break;
        }
        case "contractCompleted": {
          m.completed++; m[KIND[e.kind]]++;
          const from = acceptedAt.get(e.contractId);
          if (from !== undefined) { sortieTicks += t - from; sortieCount++; acceptedAt.delete(e.contractId); }
          break;
        }
        case "tierUnlocked":
          if (e.tier >= 3 && tier3At < 0) { tier3At = t; deploysWhenTier3 = m.deployments; }
          break;
        case "contractFailed": m.failed++; break;
        case "contractExpired": m.expired++; break;
        case "agentBurned": m.burns++; break;
        case "agentDowned": m.downs++; break;
        case "agentCaptured": m.captures++; break;
        case "agentArrested": m.arrests++; break;
        case "agentRescued": m.rescues++; break;
        case "cacheLooted": m.cacheLost += e.amount | 0; m.raidsSucceeded++; break;
        case "perimeterAlarm": m.raids++; break;
        case "firmDeployed": m.deployments++; deployedAt.set(e.firmId, t); break;
        case "firmExtracted": {
          if (e.emergency) m.emergencyExtracts++;
          else { m.cleanExtracts++; m.banked += e.banked | 0; }
          const from = deployedAt.get(e.firmId);
          if (from !== undefined) { deployTicks += t - from; deployCount++; deployedAt.delete(e.firmId); }
          break;
        }
        default: break;
      }
    }
    for (const d of s.districts) {
      if (d.heat > m.heatMax) m.heatMax = d.heat;
      if (d.heat >= RULES.detection.heat.checkpointsActiveAt) m.heatLockdownTicks++;
    }
  }

  m.avgSortieTicks = sortieCount ? Math.trunc(sortieTicks / sortieCount) : 0;
  m.avgDeployTicks = deployCount ? Math.trunc(deployTicks / deployCount) : 0;
  m.deploysToTier3 = tier3At >= 0 ? deploysWhenTier3 : 0;

  for (const f of s.firms) {
    if (f.state === 0 && f.recognition === 0) continue;
    m.recognition += f.recognition | 0;
    if (f.tierUnlocked > m.tierReached) m.tierReached = f.tierUnlocked;
  }
  return m;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // The config self-check: print what world-day 1 ACTUALLY starts with. When a
  // probe and a sweep disagree, this line is where the answer usually is.
  console.log(`# ruleset ${RULES.version} commit ${commitName()}${PATROL_BASE !== null ? ` patrolBase ${PATROL_BASE}` : ""} size ${SIZE} ` +
    `ticks ${TICKS} ai ${AI_COUNT} mirror ${MIRROR ? 1 : 0} firmswap ${FIRMSWAP ? 1 : 0}`);
  console.log(COLUMNS.join(","));
  for (let i = 0; i < COUNT; i++) {
    if (SHARDS > 1 && i % SHARDS !== SHARD) continue;
    const seed = 1000 + i * 137;
    const row = runWorldDay(seed);
    console.log(COLUMNS.map((c) => row[c]).join(","));
  }
}
