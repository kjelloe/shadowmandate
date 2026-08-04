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
import { refillPool, rebuildOffers } from "../engine/contracts.js";
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

function commitName() {
  try {
    return execSync("git describe --always --dirty 2>/dev/null").toString().trim();
  } catch { return "nogit"; }
}

export const COLUMNS = [
  "seed", "size", "mirror", "firmswap", "ticks",
  "offered", "accepted", "completed", "failed", "expired",
  "courier", "surveillance", "extraction", "sabotage", "acquisition",
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

  const KIND = ["courier", "surveillance", "extraction", "sabotage", "acquisition"];
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
    for (const e of [...ai.events, ...s.events]) {
      switch (e.type) {
        case "contractAccepted": m.accepted++; acceptedAt.set(e.contractId, t); break;
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
  console.log(`# ruleset ${RULES.version} commit ${commitName()} size ${SIZE} ` +
    `ticks ${TICKS} ai ${AI_COUNT} mirror ${MIRROR ? 1 : 0} firmswap ${FIRMSWAP ? 1 : 0}`);
  console.log(COLUMNS.join(","));
  for (let i = 0; i < COUNT; i++) {
    if (SHARDS > 1 && i % SHARDS !== SHARD) continue;
    const seed = 1000 + i * 137;
    const row = runWorldDay(seed);
    console.log(COLUMNS.map((c) => row[c]).join(","));
  }
}
