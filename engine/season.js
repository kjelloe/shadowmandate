// engine/season.js — where a world is in its season (S10, D15/D33/D50).
//
// DERIVED, NEVER STORED. Everything here is a pure function of `state.tick` and
// the ruleset, so the season adds no positional state, no copyState entry, no
// snapshot field and no mirror declaration — and cannot drift out of step with
// the tick it is supposed to describe. The alternative, a `seasonDay` counter
// advanced alongside the tick, would have been a second source of truth for one
// fact, which is the defect this project keeps finding in its own art pipeline.
//
// This works because `state.tick` is REAL-TIME anchored: `applyDormancy` adds
// the slept ticks (`state.tick + ticks`), so a world that nobody visits for a
// week still ages a week. A season measured in awake ticks would never end on a
// quiet world, which is exactly backwards — a neglected season should expire.
//
// The SEASON NUMBER is deliberately not here. Rotation resets the world and its
// tick to zero, so "which season is this" is server bookkeeping (the ledger),
// not a property of the simulation.

export const TICKS_PER_DAY = 864000;      // 86400 s * 10 Hz

// Day 0 is the first day. A 28-day season runs day 0 through day 27.
export function seasonDay(tick) {
  return Math.trunc(Math.max(0, tick | 0) / TICKS_PER_DAY);
}

// `days: 0` means never rotate — the self-host setting (S10). Treated as an
// endless season everywhere rather than as a special case at each call site.
export function isEndless(cfg) {
  return !cfg || (cfg.days | 0) <= 0;
}

export function seasonEndTick(cfg) {
  return isEndless(cfg) ? Infinity : (cfg.days | 0) * TICKS_PER_DAY;
}

export function isSeasonOver(tick, cfg) {
  return tick >= seasonEndTick(cfg);
}

// The disclosure surface D50 requires: what a player is shown BEFORE joining.
// A newcomer meeting stronger agents is only unfair if it was unforeseeable.
export function seasonStanding(state, cfg) {
  const day = seasonDay(state.tick);
  const days = isEndless(cfg) ? 0 : (cfg.days | 0);
  // Tier range across the Firms actually competing, AI included — an AI rival
  // at tier 4 is exactly as much of a problem for a newcomer as a human one,
  // and reporting only human tiers would understate a world that is mostly AI.
  const tiers = state.firms.map((f) => f.tierUnlocked | 0).filter((t) => t > 0);
  return {
    day,
    days,                                  // 0 = endless
    endless: isEndless(cfg),
    daysRemaining: isEndless(cfg) ? null : Math.max(0, days - day),
    tierLow: tiers.length ? Math.min(...tiers) : 0,
    tierHigh: tiers.length ? Math.max(...tiers) : 0,
    firms: state.firms.length,
  };
}

// ── The light cycle (D63a) ────────────────────────────────────────────────
// Derived from the tick like everything calendar-shaped here — never stored,
// so the four-places rule and dormancy jumps need no special handling. The
// cycle is COMPRESSED game time (see data/season.json note): a deployment
// must see both phases or waiting for dark can never be a decision.
export function lightPhase(tick, dn) {
  if (!dn) return { night: 0, phaseMille: 0 };
  const day = Math.max(1, dn.dayTicks | 0);
  const nightLen = Math.max(1, dn.nightTicks | 0);
  const pos = ((tick | 0) % (day + nightLen) + (day + nightLen)) % (day + nightLen);
  return pos < day
    ? { night: 0, phaseMille: Math.trunc((pos * 1000) / day) }
    : { night: 1, phaseMille: Math.trunc(((pos - day) * 1000) / nightLen) };
}

// How long until the dark, in ticks: 0 when it is already night. The AI's
// wait-for-night decision and any future countdown both read THIS, so
// nobody re-derives the cycle arithmetic and gets the wrap wrong.
export function ticksUntilNight(tick, dn) {
  const phase = lightPhase(tick, dn);
  if (!dn || phase.night) return 0;
  const day = Math.max(1, dn.dayTicks | 0);
  const cycle = day + Math.max(1, dn.nightTicks | 0);
  const pos = ((tick | 0) % cycle + cycle) % cycle;
  return day - pos;
}

// The watcher-side sight percentage for this tick: 100 by day, the ruled
// nightSightPct after dark. ONE home — detection and cameras both read this,
// so the two watcher classes can never disagree about what night means.
export function sightPctAt(tick, dn) {
  if (!dn) return 100;
  return lightPhase(tick, dn).night ? (dn.nightSightPct | 0) || 100 : 100;
}
