// engine/dormancy.js — the dormancy transition (S10, D3, D16).
//
// A world sleeps when no Firm is deployed. On the next drop-in the server
// issues ONE command — `dormancyTick(elapsedMs)` — and this applies everything
// that "happened" while nobody was watching.
//
// THE CLOCK RULE: `elapsedMs` is the ONLY wall-clock value that ever enters the
// simulation, stamped by the server onto the command. It is in the command log
// like any other input, so a replay reproduces the sleep exactly. Free-running
// catch-up ticks would have been simpler and would have made replays
// irreproducible and the cost of a long sleep unbounded.
//
// D16 SCOPE: heat decay and contract refresh, and NOTHING else. Rival Firms do
// not act while the world is empty — no simulated contract history, no
// reputation drift. What you come back to is a city that cooled off and
// re-advertised its work, not a story that happened without you.

import { refillPool, reapContracts, STAGE_FAILED } from "./contracts.js";

export const TICKS_PER_SECOND = 10;

// Elapsed real time converted to sim ticks, saturating rather than overflowing.
//
// DO NOT `| 0` THE MILLISECONDS. i32 tops out at 2_147_483_647 ms ≈ 24.8 days,
// and a season is 28 days (D15) — so a world left alone for a few weeks wrapped
// NEGATIVE and woke as though no time had passed at all: heat frozen where the
// last player left it, expired contracts still on the board. Truncate to an
// integer without narrowing, then clamp the TICK count, which is the value that
// actually has to stay i32-safe.
export function elapsedTicks(elapsedMs) {
  const ms = Math.max(0, Math.trunc(Number(elapsedMs) || 0));
  const ticks = Math.trunc(ms / 1000) * TICKS_PER_SECOND;
  return Math.min(ticks, 0x3fffffff);
}

export function applyDormancy(state, elapsedMs, detCfg, contractCfg) {
  const ticks = elapsedTicks(elapsedMs);
  if (ticks <= 0) {
    state.events.push({ type: "dormancyNoop" });
    return;
  }

  // ── Heat decay ──
  // Applied as arithmetic, not by simulating each decay window in a loop: the
  // cost of waking a world must not scale with how long it slept.
  const decayTicks = Math.max(1, detCfg.heat.decayTicks | 0);
  const cooled = [];
  for (const d of state.districts) {
    if (d.heat <= 0) { d.heatTimer = 0; continue; }
    const before = d.heat;
    const total = (d.heatTimer | 0) + ticks;
    const steps = Math.trunc(total / decayTicks);
    d.heat = Math.max(0, d.heat - steps);
    d.heatTimer = d.heat > 0 ? (total % decayTicks) : 0;
    if (d.heat !== before) cooled.push({ districtId: d.id, from: before, to: d.heat });
  }

  // ── Contract refresh ──
  // Timed contracts that would have run out while the world slept are expired;
  // the pool is then topped back up so a returning player finds fresh work.
  let expired = 0;
  for (const contract of state.contractPool) {
    if (contract.acceptedBy >= 0) continue;          // nobody was here to hold one
    if (contract.expiresTick <= 0) continue;         // open-ended contracts persist
    if (state.tick + ticks >= contract.expiresTick) {
      contract.stage = STAGE_FAILED;
      expired++;
    }
  }
  reapContracts(state);

  // Advance the clock BEFORE regenerating, so new contracts get expiry windows
  // measured from the world you are actually walking back into.
  state.tick = (state.tick + ticks) | 0;
  refillPool(state, contractCfg, detCfg);

  state.events.push({
    type: "dormancyApplied",
    ticks, expired, cooled: cooled.length,
    poolSize: state.contractPool.length,
  });
  for (const c of cooled) {
    state.events.push({ type: "heatChanged", districtId: c.districtId, heat: c.to, delta: c.to - c.from });
  }
}

// The return-visit briefing: what changed since this Firm last extracted.
// Composed from the ledger's last-seen tick plus the world's own state — it is
// a report, not a simulation, so it costs nothing to produce.
export function worldNews(state, sinceTick, detCfg, limit = 5) {
  const news = [];
  for (const d of state.districts) {
    if (d.heat >= detCfg.heat.checkpointsActiveAt) {
      news.push({ kind: "lockdown", districtId: d.id, heat: d.heat });
    } else if (d.heat >= detCfg.heat.extraPatrolsAt) {
      news.push({ kind: "tense", districtId: d.id, heat: d.heat });
    }
  }
  const deployed = state.firms.filter((f) => f.state !== 0 && f.isAi).length;
  if (deployed > 0) news.push({ kind: "rivalsActive", count: deployed });
  const fresh = state.contractPool.filter((c) => c.acceptedBy < 0).length;
  news.push({ kind: "contractsAvailable", count: fresh });
  return news.slice(0, limit);
}
