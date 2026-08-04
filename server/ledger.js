// server/ledger.js — the world ledger (D3, D7, D32, D33).
//
// What survives an extraction: reputation, tier unlocks, banked resources and
// lifetime recognition, keyed per (world, Firm). This is I/O, so it lives in
// server/ — the reducer receives a ledger as drop-in input and never reads
// storage itself.
//
// Identity is per-SERVER (D32): one token and one recovery code cover all of a
// player's Firms across that server's worlds.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export function emptyLedger(worldId, firmId) {
  return {
    worldId, firmId,
    reputation: 0,
    recognition: 0,        // lifetime honor — carries across seasons (D33)
    tierUnlocked: 1,
    bank: 0,
    contractsCompleted: 0,
    heldAgentIds: [],
    lastExtractTick: 0,
    seasonsPlayed: 0,
  };
}

export class LedgerStore {
  constructor(path) {
    this.path = path;
    this.data = { firms: {}, tokens: {} };
    this.load();
  }

  load() {
    if (!existsSync(this.path)) return;
    try {
      this.data = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (err) {
      // A corrupt ledger must be loud, not silently replaced with an empty one:
      // silently starting fresh would erase every player's progression.
      throw new Error(`ledger at ${this.path} is unreadable: ${err.message}`);
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    // Write-then-rename: a crash mid-write must never truncate the ledger.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  key(worldId, firmId) { return `${worldId}:${firmId}`; }

  get(worldId, firmId) {
    return this.data.firms[this.key(worldId, firmId)] ?? emptyLedger(worldId, firmId);
  }

  // Written only on extraction and bail (S10). The debrief is the engine's
  // account of what happened; the ledger is what we keep of it.
  applyDebrief(worldId, debrief, tick) {
    const led = this.get(worldId, debrief.firmId);
    led.bank += debrief.banked | 0;
    led.reputation += debrief.reputationDelta | 0;
    led.recognition = Math.max(led.recognition, debrief.recognition | 0);
    led.tierUnlocked = Math.max(led.tierUnlocked, debrief.tierUnlocked | 0);
    led.contractsCompleted += debrief.contractsCompleted | 0;
    led.lastExtractTick = tick | 0;
    this.data.firms[this.key(worldId, debrief.firmId)] = led;
    this.save();
    return led;
  }

  spendBank(worldId, firmId, amount) {
    const led = this.get(worldId, firmId);
    if (led.bank < amount) return false;
    led.bank -= amount;
    this.data.firms[this.key(worldId, firmId)] = led;
    this.save();
    return true;
  }

  // Season rotation (D33): the world's numbers reset; lifetime honor carries.
  rotateSeason(worldId) {
    for (const [key, led] of Object.entries(this.data.firms)) {
      if (!key.startsWith(`${worldId}:`)) continue;
      led.bank = 0;
      led.tierUnlocked = 1;
      led.reputation = 0;
      led.seasonsPlayed = (led.seasonsPlayed | 0) + 1;
      // recognition and contractsCompleted deliberately survive.
    }
    this.save();
  }

  // Identity (D10/D32): a browser token plus a human-typeable recovery code.
  registerToken(token, recoveryHash, firmId) {
    this.data.tokens[token] = { recoveryHash, firmId };
    this.save();
  }

  firmForToken(token) {
    return this.data.tokens[token]?.firmId ?? null;
  }

  firmForRecovery(recoveryHash) {
    for (const entry of Object.values(this.data.tokens)) {
      if (entry.recoveryHash === recoveryHash) return entry.firmId;
    }
    return null;
  }
}
