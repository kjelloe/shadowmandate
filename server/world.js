// server/world.js — a hosted world: the reducer pump plus everything that
// cannot live in a pure engine (clocks, storage, AI scheduling) (S11).
//
// The server is a thin pump. It queues commands, applies them, steps the AI
// between ticks exactly where a client's commands would arrive, and broadcasts
// fog-filtered VIEWS. It never sends state.

import { apply } from "../engine/reducer.js";
import { CMD_ADVANCE_TICK, CMD_DORMANCY_TICK, CMD_EXTRACT, validate } from "../engine/commands.js";
import { createInitialState } from "../engine/state.js";
import { generateCity, findDropZones, autoSelectDropZone } from "../engine/citygen.js";
import { buildView } from "../engine/view.js";
import { hashState } from "../engine/snapshot.js";
import { refillPool, rebuildOffers } from "../engine/contracts.js";
import { spawnAiFirms, stepAiFirms } from "../engine/ai_firms.js";
import { worldNews } from "../engine/dormancy.js";
import { isSeasonOver, seasonStanding } from "../engine/season.js";

// 10 Hz. Overridable for OPS ONLY — the browser gates run slower because
// headless software rendering cannot keep up with a 10Hz diorama and every
// automated interaction then queues behind a frame. This is wall-clock pacing,
// not simulation: the reducer counts ticks and never reads a clock, so a
// different rate replays identically and changes no outcome.
export const TICK_MS = Number(process.env.TICK_MS ?? 100);

// The next season's city, derived from this one. Deterministic on purpose: a
// world is meant to be reproducible from its config, and a random seed here
// would mean season 2 could never be replayed or archived meaningfully.
export function nextSeasonSeed(seed, seasonNumber) {
  const mixed = Math.imul((seed >>> 0) ^ Math.imul(seasonNumber | 0, 0x9e3779b1), 0x85ebca6b);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

export class World {
  constructor({ id, seed, size, rules, ledger, aiCount = 3, now = () => Date.now() }) {
    this.id = id;
    this.rules = rules;
    this.ledger = ledger;
    this.now = now;                       // injectable so tests never sleep
    this.seed = seed;
    this.size = size;
    this.aiCount = aiCount;
    // Which season this world is on. Lives in the ledger rather than in engine
    // state: rotation resets the tick to zero, so "which season is this" is a
    // fact about the SERVER's history of this world, not about the simulation.
    this.seasonNumber = ledger?.seasonOf?.(id) ?? 1;
    this.buildWorld();

    this.queue = [];
    this.seats = new Map();               // firmId -> { send, lastSeen }
    this.commandLog = [];
    this.archives = [];                   // season standings dumps (S10)
    this.sleepingSince = this.now();      // empty at birth
    this.timer = null;
  }

  // A fresh city for a fresh season. Also used by the constructor, so a rotated
  // world is built by exactly the same path a new one is — a season 2 world
  // that differed from a season 1 world would be a bug nobody would find until
  // the first rotation on the live host.
  buildWorld() {
    this.state = createInitialState({
      seed: this.seed, size: this.size, rules: this.rules,
      city: generateCity(this.seed, this.size, this.rules.citygen),
    });
    spawnAiFirms(this.state, this.rules, this.aiCount, {});
    refillPool(this.state, this.rules.contracts, this.rules.detection);
    rebuildOffers(this.state, this.rules.contracts, this.rules.detection);
  }

  // ── Seasons (D15/D33/D50) ───────────────────────────────────────────────

  // What a player is shown BEFORE joining (D50): how far into the season this
  // world is, and the tier range of the Firms competing in it. A newcomer
  // meeting stronger agents is only unfair if it was unforeseeable.
  standing() {
    return {
      id: this.id,
      season: this.seasonNumber,
      seats: this.seats?.size ?? 0,
      size: this.state.map.width,
      tick: this.state.tick,
      sleeping: this.sleepingSince !== null,
      ...seasonStanding(this.state, this.rules.season),
    };
  }

  // Called from BOTH the pump and the wake path. The wake path is the one that
  // matters: dormancy adds the slept ticks in a single jump, so a world left
  // alone across its season end would otherwise come back still running a
  // season that expired days ago. A season a nobody attended must still end.
  checkSeason() {
    if (!isSeasonOver(this.state.tick, this.rules.season)) return null;
    return this.rotateSeason();
  }

  rotateSeason() {
    const closing = this.standing();
    const standings = this.state.firms.map((f) => ({
      firmId: f.id, isAi: !!f.isAi,
      tierUnlocked: f.tierUnlocked | 0,
      recognition: f.recognition | 0,
      reputation: f.reputation | 0,
      ledger: this.ledger ? this.ledger.get(this.id, f.id) : null,
    }));

    // Archive BEFORE the reset, or the standings dump records the empty world
    // it just created rather than the season that was played.
    const archive = {
      worldId: this.id, season: this.seasonNumber,
      seed: this.seed, endedAtTick: this.state.tick,
      days: closing.days, standings,
    };
    this.archives.push(archive);

    // D33: bank and tier unlocks reset with the world; recognition carries as
    // lifetime honour. D50 adds upgrades to the reset side of that line.
    if (this.ledger) this.ledger.rotateSeason(this.id);
    this.seasonNumber += 1;
    if (this.ledger?.setSeason) this.ledger.setSeason(this.id, this.seasonNumber);

    // A new seed, derived rather than random: season 2 of world "alpha" must be
    // the same city on every host that replays it, and `Math.random()` here
    // would make the world unreproducible from its config alone.
    this.seed = nextSeasonSeed(this.seed, this.seasonNumber);
    this.buildWorld();
    this.commandLog = [];
    this.queue = [];

    // Everyone seated is now standing in a world that no longer exists. Tell
    // them explicitly: a client whose agent and HQ silently vanished would look
    // exactly like a server crash.
    const opening = this.standing();
    for (const [firmId, seat] of this.seats) {
      try {
        seat.send({ type: "seasonRotated", closed: closing, opened: opening, archive });
      } catch { this.seats.delete(firmId); }
    }
    return archive;
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
    // The sleep may have carried the world straight past its season end.
    this.checkSeason();
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
    for (const e of events) {
      if (e.type === "firmExtracted") {
        this.sendDebrief(e.firmId, {
          firmId: e.firmId, banked: e.banked | 0, emergency: e.emergency | 0,
          recognition: this.state.firms[e.firmId]?.recognition | 0,
          reputationDelta: e.emergency
            ? this.rules.hq.reputation.emergencyEvac : this.rules.hq.reputation.cleanExtract,
          tierUnlocked: this.state.firms[e.firmId]?.tierUnlocked | 0,
          contractsCompleted: this.completedFor?.get(e.firmId) ?? 0,
        });
        this.completedFor?.set(e.firmId, 0);
      }
      if (e.type === "contractCompleted") {
        if (!this.completedFor) this.completedFor = new Map();
        this.completedFor.set(e.firmId, (this.completedFor.get(e.firmId) ?? 0) + 1);
      }
    }
    const ai = stepAiFirms(this.state, this.rules, apply);
    this.state = ai.state;
    for (const e of ai.events) events.push(e);
    this.commandLog.push({ type: CMD_ADVANCE_TICK });
    this.state = apply(this.state, { type: CMD_ADVANCE_TICK });
    for (const e of this.state.events) events.push(e);
    // The dropship lands by itself. `evacReady` means the hold succeeded; the
    // AI issues its own extract, but a human seat has no client code that ever
    // sent CMD_EXTRACT — the beacon hung at "ETA: 0 SECONDS" forever (playtest
    // 3). Enqueued as a real command so the log replays it; deduped because
    // evacReady re-fires every tick while the beacon stands at zero.
    for (const e of events) {
      if (e.type !== "evacReady") continue;
      const firm = this.state.firms[e.firmId];
      if (!firm || firm.isAi) continue;
      if (this.queue.some((c) => c.type === CMD_EXTRACT && c.firmId === e.firmId)) continue;
      this.queue.push({ type: CMD_EXTRACT, firmId: e.firmId });
    }
    this.broadcast(events);
    // After the broadcast: the last view of a season should be the season's
    // last view, not the empty world that replaces it.
    this.checkSeason();
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

  dropZones() {
    return findDropZones(this.state, this.rules.citygen).map((z) => ({
      cellX: z.cellX, cellY: z.cellY, districtId: z.districtId,
    }));
  }

  autoDropZone(firmId) {
    const zones = findDropZones(this.state, this.rules.citygen);
    const firm = this.state.firms[firmId];
    return autoSelectDropZone(this.state, zones, this.rules.citygen, this.rules.hq,
      firm?.tierUnlocked ?? 1);
  }

  // The terrain, sent once at drop-in time. It is static world data — the
  // client cannot derive it and re-sending it every tick would be absurd.
  clientTiles() {
    return Array.from(this.state.map.cells);
  }

  districtSummary(firmId) {
    const firm = this.state.firms[firmId];
    const tier = firm?.tierUnlocked ?? 1;
    const counts = new Map();
    for (const c of this.state.contractPool) {
      if (c.acceptedBy >= 0 || c.tier > tier) continue;
      counts.set(c.districtId, (counts.get(c.districtId) ?? 0) + 1);
    }
    const bands = this.rules.detection.heat.fuzzBands;
    return this.state.districts.map((d) => ({
      id: d.id, trait: d.trait, coreX: d.coreX, coreY: d.coreY,
      contracts: counts.get(d.id) ?? 0,
      heatBand: d.heat >= bands[1] ? 2 : d.heat >= bands[0] ? 1 : 0,
    }));
  }

  viewFor(firmId) {
    return buildView(this.state, firmId, this.rules.detection);
  }

  // A debrief is the payoff beat the whole session builds toward (S05). It is
  // delivered directly to the extracting seat, because by the time it exists
  // that Firm has no agent and no HQ, so nothing else would carry it.
  sendDebrief(firmId, debrief) {
    const seat = this.seats.get(firmId);
    if (!seat) return;
    const led = this.ledger ? this.ledger.applyDebrief(this.id, debrief, this.state.tick) : null;
    try {
      seat.send({ type: "debrief", debrief, ledger: led });
    } catch { this.seats.delete(firmId); }
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
      // D50: the briefing is read on the splash screen BEFORE dropping in,
      // which makes it the right carrier for the disclosure. A player deciding
      // whether to join should not have to go and find a server list.
      standing: this.standing(),
    };
  }

  stateHash() { return hashState(this.state); }
}

// An event reaches a seat only if it concerns them. A rival's burn is their
// business; your own perimeter alarm is very much yours.
function relevantTo(event, firmId) {
  // A rejection belongs to whoever caused it. Without this the player pressed
  // a button, nothing happened, and nothing said why (playtest 1).
  if (event.type === "rejected") return true;
  if (event.firmId !== undefined) return event.firmId === firmId;
  if (event.byFirmId !== undefined) return event.byFirmId === firmId;
  // World-scale events everyone may see.
  return ["heatChanged", "dormancyApplied", "pactExpired", "sitesSeeded"].includes(event.type);
}
