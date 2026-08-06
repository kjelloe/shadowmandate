// engine/raids.js — scheduled rival raids on a Field HQ (S16, M8 slice 8i, D49b).
//
// The UNCHOSEN half of D49. The owner ruled that Defend is both a contract you
// can take AND an event that happens to you, and this is the event: a rival
// Firm turns up at your HQ whether or not you took a job about it.
//
// It comes BEFORE the Defend contract (8j) on purpose. This is what makes an HQ
// a place worth defending at all — sell someone competence at a threat they
// have never felt and the contract is an abstraction. Play through two raids
// first and "guard this place" means something.
//
// The MECHANICS already existed: `stepPerimeter` in hq.js raises an alarm when
// an intruder is inside the perimeter and lets them loot the cache at the tent.
// What did not exist was intent. A raid was an accident of AI mood — an
// aggressive personality noticing a visible HQ while work was thin — so it was
// rare, unpredictable, and impossible to design around. This schedules it.
//
// TELEGRAPHED, like every other piece of opposition in S16 (D45): the raid is
// announced with a warning window before the raider is sent. A rival team that
// materialises unannounced reads as unfair; one you can hear coming is a
// decision — run home, set up, or write the cache off and keep working.
//
// HASH-INERT while nobody is being raided, like alarms and credentials.

export const RAID_WARNING = 0;    // announced, raider not yet dispatched
export const RAID_INBOUND = 1;    // raider is on its way
export const RAID_DONE = 2;       // resolved; removed next tick

const FIRM_DEPLOYED = 1;

export function raidAgainst(state, firmId) {
  return (state.raids ?? []).find(
    (r) => r.targetFirmId === firmId && r.state !== RAID_DONE) ?? null;
}

export function raidBy(state, firmId) {
  return (state.raids ?? []).find(
    (r) => r.byFirmId === firmId && r.state !== RAID_DONE) ?? null;
}

// Who can be raided right now.
//
// D31 IS LOAD-BEARING HERE: a Firm inside its disconnect grace window is off
// limits. Raiding somebody whose connection just dropped is the single most
// obviously unfair thing this system could do, and the rule already exists —
// this reads it rather than inventing a second answer.
export function raidableFirms(state) {
  const out = [];
  for (const firm of state.firms) {
    if (firm.state !== FIRM_DEPLOYED) continue;
    if ((firm.graceTicks | 0) > 0) continue;          // D31
    if (!state.hqs.some((h) => h.firmId === firm.id)) continue;
    if (raidAgainst(state, firm.id)) continue;         // already under threat
    out.push(firm);
  }
  return out;
}

// A raider must be deployed, not the target, and not already committed.
export function availableRaiders(state, targetFirmId) {
  return state.firms.filter((f) =>
    f.state === FIRM_DEPLOYED
    && f.id !== targetFirmId
    && f.isAi                       // V1: only AI Firms raid (humans in V2)
    && !raidBy(state, f.id));
}

export function scheduleRaid(state, targetFirmId, byFirmId, cfg) {
  const raid = {
    id: state.nextRaidId | 0,
    targetFirmId, byFirmId,
    state: RAID_WARNING,
    // The warning window: how long the target has between being told and the
    // raider being sent. This is the whole fairness of the mechanism.
    dispatchTick: (state.tick + (cfg.warningTicks | 0)) | 0,
    expiresTick: (state.tick + (cfg.warningTicks | 0) + (cfg.durationTicks | 0)) | 0,
  };
  state.nextRaidId = (state.nextRaidId | 0) + 1;
  state.raids.push(raid);
  state.events.push({
    type: "raidIncoming", raidId: raid.id,
    firmId: targetFirmId, byFirmId,
    dispatchTick: raid.dispatchTick,
  });
  return raid;
}

// One tick of the raid scheduler.
//
// The roll is from the seeded stream via `rollFn`, passed in rather than
// imported, so this module stays a leaf and the caller keeps ownership of the
// PRNG — the engine has exactly one seeded stream and it must not fork.
export function stepRaids(state, cfg, rollFn) {
  if (!cfg || (cfg.enabled | 0) === 0) return;
  state.raids = state.raids ?? [];

  // A raid that got what it came for is OVER. The raider took the cache and has
  // no further business standing on someone's tent; leaving it "inbound" made
  // it camp there for the whole window and re-loot every time the owner banked
  // anything — 5020 loots in one world-day, which is not a raid, it is a siege.
  for (const e of state.events) {
    if (e.type !== "cacheLooted") continue;
    const raid = state.raids.find(
      (r) => r.byFirmId === e.byFirmId && r.targetFirmId === e.firmId && r.state !== RAID_DONE);
    if (!raid) continue;
    raid.state = RAID_DONE;
    state.events.push({
      type: "raidSucceeded", raidId: raid.id,
      firmId: raid.targetFirmId, byFirmId: raid.byFirmId, amount: e.amount | 0,
    });
  }

  for (const raid of state.raids) {
    if (raid.state === RAID_WARNING && state.tick >= raid.dispatchTick) {
      raid.state = RAID_INBOUND;
      state.events.push({
        type: "raidDispatched", raidId: raid.id,
        firmId: raid.targetFirmId, byFirmId: raid.byFirmId,
      });
    }
    // A raid that never landed simply ends. Without an expiry a raider that
    // got arrested on the way would leave its target permanently "under raid",
    // and permanently un-raidable — the bug where a feature fires once and then
    // silently switches itself off forever.
    if (raid.state !== RAID_DONE && state.tick >= raid.expiresTick) {
      raid.state = RAID_DONE;
      state.events.push({
        type: "raidEnded", raidId: raid.id,
        firmId: raid.targetFirmId, byFirmId: raid.byFirmId,
      });
    }
  }
  state.raids = state.raids.filter((r) => r.state !== RAID_DONE);

  // Schedule at most one new raid per tick, on a cadence rather than every
  // tick: `everyTicks` is the heartbeat, `chancePct` the roll on it.
  if ((cfg.everyTicks | 0) <= 0) return;
  if (state.tick % (cfg.everyTicks | 0) !== 0) return;
  if (rollFn(1, 100) > (cfg.chancePct | 0)) return;

  const targets = raidableFirms(state);
  if (!targets.length) return;
  const target = targets[rollFn(0, targets.length - 1)];
  const raiders = availableRaiders(state, target.id);
  if (!raiders.length) return;
  scheduleRaid(state, target.id, raiders[rollFn(0, raiders.length - 1)].id, cfg);
}
