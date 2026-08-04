// engine/snapshot.js — canonical state hashing and snapshot construction.
//
// THE PAIRED-HASH RULE: every hashed field also appears in the local copy of
// this function in test/fixture_hash.js. They must change together — the
// duplication is deliberate, so a hash change is always a conscious two-file
// act, never a side effect.
//
// Empty collections write no bytes, which is what makes a new subsystem
// hash-inert until it actually holds state.

import { createByteWriter, computeFnv1a64, hashToHex64 } from "../shared/canonical.js";

export function hashState(state) {
  const w = createByteWriter();
  w.writeU32LE(state.tick);
  w.writeU32LE(state.worldSeed);
  w.writeU32LE(state.size);
  w.writeU32LE(state.rng.a); w.writeU32LE(state.rng.b);
  w.writeU32LE(state.rng.c); w.writeU32LE(state.rng.d);

  for (const f of state.firms) {
    if (f.state === 0 && f.reputation === 0 && f.recognition === 0
        && f.cacheResources === 0 && f.isAi === 0) continue; // untouched slot
    w.writeI32LE(f.id); w.writeI32LE(f.nameId); w.writeI32LE(f.state);
    w.writeI32LE(f.hqId); w.writeI32LE(f.reputation); w.writeI32LE(f.recognition);
    w.writeI32LE(f.tierUnlocked); w.writeI32LE(f.completedThisTier ?? 0);
    w.writeI32LE(f.cacheResources);
    w.writeI32LE(f.isAi); w.writeI32LE(f.aiPersonality);
    w.writeI32LE(f.aiNextDeployTick ?? 0); w.writeI32LE(f.graceTicks);
    for (const h of (f.heatIntel ?? [])) { w.writeI32LE(h.districtId); w.writeI32LE(h.expiresTick); }
    for (const id of (f.knownRivalHqs ?? [])) w.writeI32LE(id);
    w.writeI32LE((f.upgrades ?? []).length);
  }
  for (const a of state.agents) {
    if (a.state === 0) continue; // absent slots contribute nothing
    w.writeI32LE(a.id); w.writeI32LE(a.firmId); w.writeI32LE(a.state);
    w.writeI32LE(a.x); w.writeI32LE(a.y);
    w.writeI32LE(a.targetX); w.writeI32LE(a.targetY);
    w.writeU8(a.facing); w.writeU8(a.stance); w.writeU8(a.moveProgress);
    w.writeI32LE(a.condition);
    w.writeU8(a.detection); w.writeI32LE(a.detectTimer);
    w.writeI32LE(a.carryKind); w.writeI32LE(a.carryRef);
    w.writeI32LE(a.insideBuildingId); w.writeU8(a.disguiseId ?? 0);
    w.writeI32LE(a.downTicks);
    w.writeI32LE(a.holdingSiteId); w.writeI32LE(a.vehicleId);
    for (const cid of a.contractIds) w.writeI32LE(cid);
    w.writeI32LE(a.routeIdx ?? 0);
    for (const c of (a.route ?? [])) { w.writeI32LE(c.x); w.writeI32LE(c.y); }
  }
  for (const d of state.districts) {
    w.writeI32LE(d.id); w.writeI32LE(d.trait); w.writeI32LE(d.heat);
    w.writeI32LE(d.heatTimer);
  }
  for (const s of state.sites) {
    w.writeI32LE(s.id); w.writeI32LE(s.type); w.writeI32LE(s.districtId);
    w.writeI32LE(s.cellX); w.writeI32LE(s.cellY); w.writeI32LE(s.status);
  }
  for (const b of state.buildings) {
    w.writeI32LE(b.id); w.writeI32LE(b.kind); w.writeI32LE(b.districtId);
    w.writeI32LE(b.entranceX); w.writeI32LE(b.entranceY); w.writeI32LE(b.payloadIdx);
    w.writeI32LE(b.exitX ?? -1); w.writeI32LE(b.exitY ?? -1);
  }
  for (const p of state.patrols) {
    w.writeI32LE(p.id); w.writeI32LE(p.districtId);
    w.writeI32LE(p.x); w.writeI32LE(p.y);
    w.writeI32LE(p.routeIdx); w.writeI32LE(p.alertTicks); w.writeI32LE(p.targetX);
    w.writeI32LE(p.targetY);
  }
  for (const h of state.holdingSites) {
    w.writeI32LE(h.id); w.writeI32LE(h.districtId);
    w.writeI32LE(h.cellX); w.writeI32LE(h.cellY);
    for (const id of h.heldAgentIds) w.writeI32LE(id);
  }
  for (const h of state.hqs) {
    w.writeI32LE(h.id); w.writeI32LE(h.firmId);
    w.writeI32LE(h.cellX); w.writeI32LE(h.cellY);
    w.writeI32LE(h.condition); w.writeI32LE(h.cacheResources);
    w.writeI32LE(h.evacActive); w.writeI32LE(h.evacTicks); w.writeI32LE(h.evacPaused);
    w.writeI32LE(h.alarmTicks); w.writeI32LE(h.lootTicks); w.writeI32LE(h.lootedBy);
  }
  for (const c of state.contractPool) {
    w.writeI32LE(c.id); w.writeI32LE(c.kind); w.writeI32LE(c.tier);
    w.writeI32LE(c.districtId); w.writeI32LE(c.siteId); w.writeI32LE(c.siteIdB);
    w.writeI32LE(c.reward); w.writeI32LE(c.expiresTick);
    w.writeI32LE(c.reservedBy); w.writeI32LE(c.acceptedBy); w.writeI32LE(c.stage);
    w.writeI32LE(c.stageTicks);
    w.writeI32LE(c.graceTicks ?? 0); w.writeI32LE(c.burnsTaken ?? 0);
    w.writeI32LE(c.legsDone ?? 0);
  }
  for (const o of state.offers) {
    w.writeI32LE(o.firmId);
    w.writeI32LE(o.teaserId ?? -1);
    for (const cid of o.contractIds) w.writeI32LE(cid);
  }
  for (const s of state.standoffs) {
    w.writeI32LE(s.id); w.writeI32LE(s.agentA); w.writeI32LE(s.agentB);
    w.writeI32LE(s.ticksLeft); w.writeI32LE(s.choiceA); w.writeI32LE(s.choiceB);
  }
  for (const p of state.pacts) {
    w.writeI32LE(p.firmA); w.writeI32LE(p.firmB); w.writeI32LE(p.expiresTick);
  }
  for (const v of state.vehicles) {
    w.writeI32LE(v.id); w.writeI32LE(v.kind); w.writeI32LE(v.firmId);
    w.writeI32LE(v.x); w.writeI32LE(v.y); w.writeI32LE(v.riderAgentId);
    w.writeU8(v.facing); w.writeU8(v.moveProgress);
  }
  w.writeI32LE(state.nextContractId);
  w.writeI32LE(state.nextStandoffId);

  const { hashHi, hashLo } = computeFnv1a64(w.toBytes());
  return hashToHex64(hashHi, hashLo);
}

export function createSnapshot(state, buildView) {
  const views = [];
  for (const firm of state.firms) {
    if (firm.state === 0) continue;
    views.push(buildView(state, firm.id));
  }
  return { tick: state.tick, stateHash: hashState(state), views };
}
