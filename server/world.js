// server/world.js — a hosted world: the reducer pump plus everything that
// cannot live in a pure engine (clocks, storage, AI scheduling) (S11).
//
// The server is a thin pump. It queues commands, applies them, steps the AI
// between ticks exactly where a client's commands would arrive, and broadcasts
// fog-filtered VIEWS. It never sends state.

import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK, CMD_DORMANCY_TICK, validate } from "../engine/commands.js";
import { createInitialState } from "../engine/state.js";
import { generateCity } from "../engine/citygen.js";
import { buildView } from "../engine/view.js";
import { hashState } from "../engine/snapshot.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";
import { worldNews } from "../engine/dormancy.js";

export const TICK_MS = 100;   // 10 Hz

export class World {
  constructor({ id, seed, size, rules, ledger, aiCount = 3, now = () => Date.now() }) {
    this.id = id;
    this.rules = rules;
    this.ledger = ledger;
    this.now = now;                       // injectable so tests never sleep
    this.state = createInitialState({
      seed, size, rules, city: generateCity(seed, size, rules.citygen),
    });
    spawnAiFirms(this.state, rules, aiCount, {});
    refillPool(this.state, rules.contracts, rules.detection);
    rebuildOffers(this.state, rules.contracts, rules.detection);

    this.queue = [];
    this.seats = new Map();               // firmId -> { send, lastSeen }
    this.commandLog = [];
    this.sleepingSince = this.now();      // empty at birth
    this.timer = null;
  }

  // ── Sleep and waking (D3/D16) ───────────────────────────────────────────
  get isEmpty() {
    return !this.state.firms.some((f) => f.state !== 0 && !f.isAi)
      && this.seats.size === 0;
  }

  wake() {
    if (this.sleepingSince === null) return 0;
    const elapsedMs = Math.max(0, this.now() - this.sleepingSince);
    this.sleepingSince = null;
    if (elapsedMs < 1000) return 0;
    // The ONE sanctioned clock entry (D16), stamped here and logged like any
    // other command so the sleep replays exactly.
    this.submit({ type: CMD_DORMANCY_TICK, elapsedMs });
    this.drain();
    return elapsedMs;
  }

  sleepIfEmpty() {
    if (this.isEmpty && this.sleepingSince === null) {
      this.sleepingSince = this.now();
      this.stop();
      return true;
    }
    return false;
  }

  // ── The pump ────────────────────────────────────────────────────────────
  submit(command) {
    if (!validate(command)) return { error: "invalid_command" };
    this.queue.push(command);
    return { queued: true };
  }

  drain() {
    const events = [];
    while (this.queue.length) {
      const command = this.queue.shift();
      this.commandLog.push(command);
      this.state = apply(this.state, command);
      for (const e of this.state.events) events.push(e);
    }
    return events;
  }

  tick() {
    const events = this.drain();
    const ai = stepAiFirms(this.state, this.rules, apply);
    this.state = ai.state;
    for (const e of ai.events) events.push(e);
    this.commandLog.push({ type: CMD_ADVANCE_TICK });
    this.state = apply(this.state, { type: CMD_ADVANCE_TICK });
    for (const e of this.state.events) events.push(e);
    this.broadcast(events);
    this.sleepIfEmpty();
    return events;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ── Seats ───────────────────────────────────────────────────────────────
  seat(firmId, send) {
    this.wake();
    this.seats.set(firmId, { send, lastSeen: this.now() });
    this.start();
    const firm = this.state.firms[firmId];
    if (firm) firm.graceTicks = 0;
  }

  unseat(firmId) {
    this.seats.delete(firmId);
    // D31: 120s of grace before the world treats them as gone. The world does
    // NOT pause — it just stops AI Firms opening a raid on an absent player.
    const firm = this.state.firms[firmId];
    if (firm) firm.graceTicks = this.rules.season.reconnectGraceTicks | 0;
    this.sleepIfEmpty();
  }

  viewFor(firmId) {
    return buildView(this.state, firmId, this.rules.detection);
  }

  broadcast(events) {
    for (const [firmId, seat] of this.seats) {
      const mine = events.filter((e) => relevantTo(e, firmId));
      try {
        seat.send({ type: "view", view: this.viewFor(firmId), events: mine });
      } catch {
        this.seats.delete(firmId);      // a dead socket is not an error here
      }
    }
  }

  briefingFor(firmId) {
    const led = this.ledger ? this.ledger.get(this.id, firmId) : null;
    return {
      worldId: this.id,
      tick: this.state.tick,
      ledger: led,
      news: worldNews(this.state, led?.lastExtractTick ?? 0, this.rules.detection),
      activeFirms: this.state.firms.filter((f) => f.state !== 0).length,
      contracts: this.state.contractPool.filter((c) => c.acceptedBy < 0).length,
    };
  }

  stateHash() { return hashState(this.state); }
}

// An event reaches a seat only if it concerns them. A rival's burn is their
// business; your own perimeter alarm is very much yours.
function relevantTo(event, firmId) {
  if (event.firmId !== undefined) return event.firmId === firmId;
  if (event.byFirmId !== undefined) return event.byFirmId === firmId;
  // World-scale events everyone may see.
  return ["heatChanged", "dormancyApplied", "pactExpired", "sitesSeeded"].includes(event.type);
}
