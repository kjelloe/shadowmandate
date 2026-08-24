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
    w.writeI32LE(a.insideAreaId); w.writeI32LE(a.areaCol); w.writeI32LE(a.areaRow);
    w.writeI32LE(a.areaCool);
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
    w.writeI32LE(s.securityTier ?? 0);
  }
  for (const b of state.buildings) {
    w.writeI32LE(b.id); w.writeI32LE(b.kind); w.writeI32LE(b.districtId);
    w.writeI32LE(b.entranceX); w.writeI32LE(b.entranceY); w.writeI32LE(b.payloadIdx);
    w.writeI32LE(b.exitX ?? -1); w.writeI32LE(b.exitY ?? -1);
  }
  // S16 cameras (8b). Static after generation except `disabledUntil`, which a
  // junction box (8d) will move — so the whole definition is written, not just
  // the mutable field: a camera whose arc silently differed between two hosts
  // would desync what each of them thinks can be seen.
  for (const c of (state.cameras ?? [])) {
    w.writeI32LE(c.id); w.writeI32LE(c.siteId);
    w.writeI32LE(c.cellX); w.writeI32LE(c.cellY);
    w.writeI32LE(c.baseFacing); w.writeI32LE(c.span); w.writeI32LE(c.arc);
    w.writeI32LE(c.range); w.writeI32LE(c.dwellTicks); w.writeI32LE(c.phase);
    w.writeI32LE(c.disabledUntil);
  }
  // S16 sensor beams (8c). Whole definition written for the same reason as a
  // camera's: two hosts that disagreed about a beam's cycle would disagree about
  // when it is safe to cross.
  for (const x of (state.beams ?? [])) {
    w.writeI32LE(x.id); w.writeI32LE(x.siteId);
    w.writeI32LE(x.cellX); w.writeI32LE(x.cellY);
    w.writeI32LE(x.toX); w.writeI32LE(x.toY);
    w.writeI32LE(x.onTicks); w.writeI32LE(x.offTicks); w.writeI32LE(x.phase);
    w.writeI32LE(x.disabledUntil);
  }
  for (const j of (state.junctions ?? [])) {
    w.writeI32LE(j.id); w.writeI32LE(j.siteId);
    w.writeI32LE(j.cellX); w.writeI32LE(j.cellY); w.writeI32LE(j.cutUntil);
  }
  for (const p of state.patrols) {
    w.writeI32LE(p.id); w.writeI32LE(p.districtId);
    w.writeI32LE(p.x); w.writeI32LE(p.y);
    w.writeI32LE(p.routeIdx); w.writeI32LE(p.alertTicks); w.writeI32LE(p.targetX);
    w.writeI32LE(p.stunnedUntil ?? 0);
    w.writeI32LE(p.targetY);
  }
  for (const c of (state.civilians ?? [])) {
    w.writeI32LE(c.id); w.writeI32LE(c.districtId);
    w.writeI32LE(c.x); w.writeI32LE(c.y);
    w.writeI32LE(c.targetX); w.writeI32LE(c.targetY);
    w.writeI32LE(c.wander); w.writeI32LE(c.fleeTicks); w.writeI32LE(c.facing);
  }
  for (const h of state.holdingSites) {
    w.writeI32LE(h.id); w.writeI32LE(h.districtId);
    w.writeI32LE(h.cellX); w.writeI32LE(h.cellY);
    for (const id of h.heldAgentIds) w.writeI32LE(id);
  }
  for (const h of state.hqs) {
    w.writeI32LE(h.id); w.writeI32LE(h.firmId);
    w.writeI32LE(h.cellX); w.writeI32LE(h.cellY);
    w.writeI32LE(h.buildingId);
    w.writeI32LE(h.condition); w.writeI32LE(h.cacheResources);
    w.writeI32LE(h.evacActive); w.writeI32LE(h.evacTicks); w.writeI32LE(h.evacPaused);
    w.writeI32LE(h.alarmTicks); w.writeI32LE(h.lootTicks); w.writeI32LE(h.lootedBy);
  }
  for (const ar of state.areas ?? []) {
    w.writeI32LE(ar.id); w.writeI32LE(ar.siteId);
    w.writeI32LE(ar.alarmStage); w.writeI32LE(ar.alarmTicks);
    w.writeI32LE(ar.suppressedUntil); w.writeI32LE(ar.assetTaken);
    for (const g of ar.guards) {
      w.writeI32LE(g.id); w.writeI32LE(g.x); w.writeI32LE(g.y);
      w.writeI32LE(g.wp); w.writeU8(g.facing); w.writeI32LE(g.cool);
      w.writeI32LE(g.alertTicks); w.writeI32LE(g.downedUntil);
      w.writeI32LE(g.targetX); w.writeI32LE(g.targetY);
    }
    for (const tm of ar.terminals) {
      w.writeI32LE(tm.id); w.writeI32LE(tm.x); w.writeI32LE(tm.y);
    }
  }
  for (const c of state.contractPool) {
    w.writeI32LE(c.id); w.writeI32LE(c.kind); w.writeI32LE(c.tier);
    w.writeI32LE(c.districtId); w.writeI32LE(c.siteId); w.writeI32LE(c.siteIdB);
    w.writeI32LE(c.reward); w.writeI32LE(c.expiresTick);
    w.writeI32LE(c.reservedBy); w.writeI32LE(c.acceptedBy); w.writeI32LE(c.stage);
    w.writeI32LE(c.stageTicks);
    w.writeI32LE(c.graceTicks ?? 0); w.writeI32LE(c.burnsTaken ?? 0);
    w.writeI32LE(c.legsDone ?? 0);
    // S16 8g. Length-prefixed so two contracts with different contender sets
    // can never hash the same, and hash-inert for the ordinary case where both
    // lists are empty.
    w.writeI32LE(c.contested ?? 0);
    w.writeI32LE((c.contenders ?? []).length);
    for (const f of (c.contenders ?? [])) w.writeI32LE(f);
    w.writeI32LE((c.contestedBy ?? []).length);
    for (const f of (c.contestedBy ?? [])) w.writeI32LE(f);
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
  // S16 alarms. Hash-INERT while empty, which is the whole reason they live in
  // their own collection: a world with nothing wrong hashes exactly as it did
  // before site security existed, so no fixture re-pin and no era bump.
  for (const a of (state.alarms ?? [])) {
    w.writeI32LE(a.siteId); w.writeI32LE(a.stage);
    w.writeI32LE(a.ticks); w.writeI32LE(a.calm);
  }
  for (const c of (state.credentials ?? [])) {
    w.writeI32LE(c.agentId); w.writeI32LE(c.tier);
  }
  for (const r of (state.raids ?? [])) {
    w.writeI32LE(r.id); w.writeI32LE(r.targetFirmId); w.writeI32LE(r.byFirmId);
    w.writeI32LE(r.state); w.writeI32LE(r.dispatchTick); w.writeI32LE(r.expiresTick);
    w.writeI32LE(r.targetKind ?? 0); w.writeI32LE(r.targetSiteId ?? -1);
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
