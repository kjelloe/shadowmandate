// client/js/main.js — the thin DOM layer. All logic lives in models.js and the
// engine; this file only wires elements to a session (S12).

import { loadLocale, t, applyStatic } from "./i18n.js";
import { loadArt, terrain, mark } from "./assets.js";
import { drawPortrait, portraitLayers } from "./portraits.js";
import { createRemoteSession } from "./session.js";
import { createScene } from "./scene.js";
import { createMinimap } from "./minimap.js";
import {
  STANCES, DETECTION_KEYS, DETECTION_CLASS, HEAT_KEYS, HEAT_CLASS,
  ownAgent, heatDisplay, districtUnder, boardRows, activeRows, objectiveFor,
  objectiveBearing, evacDisplay, toastsFor, debriefRows, reputationBar,
  payloadForBuilding, overlayRows, disguiseFor, districtChoices, standingRows, missionBanner,
  journalLine, gameClock, evacAvailable, SPOKEN_LINES,
  cuttableJunction, liftableGuard, dropshipFlight, DROPSHIP_MS, MAX_PINS,
  beginMission, areaView, areaActions,
  HEAT_CLASS as HEAT_CLASSES,
} from "./models.js";

import { createAttract } from "./attract.js";

const $ = (sel) => document.querySelector(sel);

// Surface failures ON THE PAGE. A silent client cost three playtest rounds of
// guesswork — an empty canvas looks identical whether the renderer crashed,
// the data never arrived, or everything drew in the fog colour.
function fatal(where, err) {
  const msg = `${where}: ${err?.message ?? err}`;
  console.error(msg, err);
  let bar = document.getElementById("errbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "errbar";
    document.body.appendChild(bar);
  }
  bar.textContent = msg;
  bar.hidden = false;
}
window.addEventListener("error", (e) => fatal("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => fatal("promise", e.reason));
const show = (id) => {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  // The title diorama runs ONLY while the splash is up — the same battery
  // rule that stopped the main diorama drawing behind hidden screens.
  if (id === "splash") attract?.start(); else attract?.stop();
};

await loadLocale();
// Art metadata before any renderer exists: createScene() reads style tokens,
// and a scene built without them would fall back to grey and look "fine",
// which is the kind of silent wrongness this project has paid for before.
await loadArt();
applyStatic();
$("#drop-in").textContent = t("splash.dropIn");

const session = createRemoteSession({
  url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
});

let renderer = null;
let minimap = null;
let lastStance = 1;

function splashText(b) {
  const pad = (label, value) => `${label.padEnd(24, ".")} ${value}`;
  return [
    // The title itself is the #wordmark element now (playtest 10 ruling);
    // the terminal keeps the boot line and the numbers.
    t("splash.terminal"), "",
    // A fresh identity just got its recovery code — this is a NEW director,
    // and the splash should say hello before it says numbers (playtest 3).
    ...(session.recoveryCode ? [t("splash.welcome"), ""] : []),
    pad(t("splash.world"), b?.worldId ?? "—"),
    ...standingRows(b?.standing).map(([k, v, ...a]) => pad(t(k), t(v, ...a))),
    pad(t("splash.activeFirms"), b?.activeFirms ?? 0),
    pad(t("splash.contracts"), b?.contracts ?? 0),
    pad(t("splash.yourFirm"), session.firmId ?? "—"),
    // Your money, before you commit to a drop (playtest 9): the bank rides on
    // the view from the welcome, so it is known before any deployment.
    pad(t("splash.bank"), session.view?.bank ?? 0),
    pad(t("splash.fieldStatus"), t("splash.undeployed")),
  ].join("\n");
}

session.onChange((s, events) => {
  // BEFORE the no-view guard, and that ordering is the whole point: a rotation
  // deliberately clears the view, so handling it after `if (!s.view) return`
  // would drop the one message that explains why everything vanished.
  const rotated = (events ?? []).find((e) => e.type === "seasonRotated");
  if (rotated) { showSeasonRotated(rotated); return; }
  if (!s.view) return;
  if ((events ?? []).some((e) => e.type === "dropZonesReady")) showZonePicker();
  if ((events ?? []).some((e) => e.type === "debriefReady")) { showDebrief(s); return; }
  for (const e of events ?? []) {
    // The journal (playtest 12): every event with a line gets a timestamped
    // entry — mission taken/completed/failed, what the informant said, burns,
    // evac beats. Session-scoped, capped, rendered on demand.
    const line = journalLine(e);
    if (line) {
      journal.push({ tick: s.view.tick, ...line });
      if (journal.length > 250) journal.shift();
      // A purchase's spoken line ALSO answers in the dialogue, so success
      // reads in character exactly like refusal does.
      if (line.spoken) dialogResponse = { key: line.key, until: Date.now() + 6000 };
    }
    if (e.type === "rejected") {
      // A refused purchase is the NPC saying no (playtest 8): it answers IN
      // the dialogue, in character — the technical toast is for everything
      // that has no face to speak through.
      if (e.command === "dialogueChoice" || e.command === "buyItem") {
        dialogResponse = {
          key: DIALOG_RESPONSES[e.reason] ?? "dialog.respond.refuse",
          until: Date.now() + 5000,
        };
      } else {
        addToast(`${e.command}: ${e.reason}`, true);
      }
    }
    if (e.type === "serverError") addToast(e.reason, true);
  }
  if ($("#splash").hidden === false) {
    $("#splash-terminal").textContent = splashText(s.briefing);
    if (s.recoveryCode) {
      const el = $("#recovery");
      el.hidden = false;
      el.textContent = `${t("recovery.title")}: ${s.recoveryCode} — ${t("recovery.note")}`;
    }
  }
  const deployed = s.view.agents.some((a) => a.state !== 0);
  if (deployed && $("#world").hidden) {
    show("world");
    renderer?.resize();
    // First sight of the world this session: fly the ship in.
    if (!flightSeen) { flightSeen = true; startDropship(1); }
    // First deployment EVER on this browser: the guided overlay (playtest 3).
    // localStorage rather than the ledger, because the thing being taught is
    // this client's controls, not this Firm's history.
    if (!localStorage.getItem("sm_intro_seen")) $("#intro").hidden = false;
  }
  if (!deployed) flightSeen = false;
  paint(s, events ?? []);
  // Test-only observation surface. The browser gates (tools/client_smoke.mjs,
  // tools/ui_acceptance.mjs) need to assert on what the client actually
  // received, not merely on what it painted — "the tick advanced" and "the
  // stance the SERVER agrees I have" are not readable from the DOM. Read-only
  // and derived; nothing here is an input path, so it cannot become a cheat
  // surface. The sibling project carries the same hook for the same reason.
  window.__smDebug = {
    tick: s.view.tick,
    firmId: session.firmId ?? null,
    agent: ownAgent(s.view) ?? null,
    screen: ["splash", "dropzone", "debrief", "world"].find((id) => !$(`#${id}`).hidden) ?? null,
    openOverlays: ["board", "standoff", "building", "evac"].filter((id) => !$(`#${id}`).hidden),
    boardCount: (s.view.board?.contracts ?? []).length,
    activeCount: (s.view.active ?? []).length,
    lastEvents: (events ?? []).map((e) => e.type),
    // S05 choreography, exposed for the same reason as everything else here:
    // "the maths is right" and "a ship crossed the screen" are different
    // claims, and only the browser can answer the second.
    dropship: flightStartedAt === null ? null
      : (dropshipFlight(Date.now() - flightStartedAt, flightDir) ?? null),
    // S17 probes: is the operative indoors, and is the compound in the view.
    insideAreaId: ownAgent(s.view)?.insideAreaId ?? -1,
    areaCount: s.view.areas?.length ?? 0,
  };
  // Probe seams (S17 gate): the view is already the player's own data and the
  // socket is already theirs — a probe driving commands through the real
  // session exercises exactly what a devtools user could.
  window.__smView = s.view;
  window.__smSend = (cmd) => session.send(cmd);
});

// S05: the dropship sequence, owned by the client and driven by a wall clock.
// `startedAt` is null when nothing is playing. Presentation only — the HQ is
// already placed server-side before this begins, which is exactly why the
// choreography can be skipped or interrupted without desyncing anything.
let flightStartedAt = null, flightDir = 1, flightSeen = false;
function startDropship(dir) {
  flightStartedAt = Date.now();
  flightDir = dir;
}

function paint(s, events) {
  const view = s.view;
  if (!renderer) renderer = createScene($("#view"));
  if (!minimap) minimap = createMinimap($("#minimap"));
  // Terrain arrives once, with the welcome (and again with the drop-zone
  // reply). Build the mesh the first time it turns up.
  try {
    if (session.tiles && !renderer.hasTerrain()) {
      renderer.setTerrain(session.tiles, view.size, view.worldSeed ?? 1, session.districtMap);
      minimap.setTiles(session.tiles, view.size);
    }
    // Only draw the diorama when it is on screen. Until now it rendered at
    // 10Hz behind the splash and drop-zone screens, where it is completely
    // invisible — a full 3D frame, ten times a second, for nobody. Found by
    // tools/ui_acceptance.mjs, where every page interaction was taking seconds
    // under software rendering; it costs real devices battery rather than
    // seconds, which is why it went unnoticed.
    if (!$("#world").hidden) {
      renderer.draw(view, pinned);
      // The dropship rides on top of the drawn frame. A null flight hides it,
      // so an interrupted or finished sequence needs no extra bookkeeping.
      const flight = flightStartedAt === null
        ? null : dropshipFlight(Date.now() - flightStartedAt, flightDir);
      if (flightStartedAt !== null && !flight) flightStartedAt = null;
      renderer.drawDropship(flight, view.hq ? { x: view.hq.cellX, y: view.hq.cellY } : null);
      minimap.draw(view, pinned);
    }
  } catch (err) {
    fatal("render", err);
  }

  const agent = ownAgent(view);
  if (agent) {
    lastStance = agent.stance;
    const d = agent.detection ?? 0;
    const det = $("#detection");
    det.textContent = t(DETECTION_KEYS[d]);
    det.className = `pill ${DETECTION_CLASS[d]}`;

    const cell = { x: Math.floor(agent.x / 256), y: Math.floor(agent.y / 256) };
    const district = districtUnder(view, cell.x, cell.y);
    if (district) {
      const { band, exact } = heatDisplay(view, district.id);
      const el = $("#heat");
      el.textContent = exact === null ? t(HEAT_KEYS[band]) : `${t(HEAT_KEYS[band])} ${exact}`;
      el.className = `pill ${HEAT_CLASS[band]}`;
    }
  }
  $("#cache").textContent = `${t("hud.cache")} ${view.hq?.cacheResources ?? 0}`;
  // The bank is what the shops and the informant charge against (D30). A
  // player who cannot see it reads "cannot afford" as "the game is broken"
  // (playtest 5).
  $("#bank").textContent = `${t("hud.bank")} ${view.bank ?? 0}`;
  // D63a: which half of the light cycle we are in — night is when the
  // watchers see 30% shorter, so the phase is tactical information.
  $("#phase").textContent = t(view.night ? "hud.phase.night" : "hud.phase.day");
  $("#phase").className = view.night ? "pill night" : "pill";

  renderStances();
  renderBoard(view);
  renderBanner(view, events);
  renderJournal();
  // EVAC is offered only where the reducer would accept it (playtest 12).
  $("#evac-btn").hidden = !evacAvailable(view);
  renderActive(view);
  renderArea(view);
  renderObjectiveArrow(view);
  renderBuilding(view);
  renderJunction(view);
  renderLift(view);
  renderStandoff(view);
  renderEvac(view);
  for (const toast of toastsFor(events)) addToast(t(toast.key), toast.alarm);
}

function renderStances() {
  const host = $("#stance");
  if (!host.children.length) {
    for (const st of STANCES) {
      const b = document.createElement("button");
      b.textContent = t(st.key);
      b.addEventListener("click", () => {
        const a = ownAgent(session.view);
        if (a) session.send({ type: 21, agentId: a.id, stance: st.id });
      });
      host.appendChild(b);
    }
  }
  [...host.children].forEach((b, i) => b.setAttribute("aria-pressed", String(i === lastStance)));
}

// THE 10Hz REBUILD BUG (playtest 5): this used to wipe and rebuild the list on
// every tick. A click needs mousedown AND mouseup on the SAME element, and the
// button was being destroyed and replaced between them — so pressing "accept"
// did nothing, forever, with no error. Anything the player clicks must survive
// long enough to be clicked: re-render ONLY when the content actually changes.
let boardSignature = "";

// The NPC's refusal lines (playtest 8): reducer reject reasons that have an
// in-character voice. Anything unmapped gets the generic brush-off.
const DIALOG_RESPONSES = {
  nothing_to_reveal: "dialog.respond.nothingToReveal",
  cannot_afford: "dialog.respond.cannotAfford",
  already_owned: "dialog.respond.alreadyOwned",
};
let dialogResponse = null;

// The mission banner (playtest 7): what am I doing RIGHT NOW, top-centre —
// mission type, current stage, work progress. Completion and failure are
// EVENTS, not state (a finished contract leaves the active list the same
// tick), so they flash for a few seconds before the banner moves on to the
// next job or hides.
let bannerFlash = null;
function renderBanner(view, events) {
  for (const e of events ?? []) {
    if (e.type === "contractCompleted") {
      bannerFlash = { key: "banner.complete", cls: "good", until: Date.now() + 4000 };
    } else if (e.type === "contractFailed" || e.type === "contractExpired") {
      bannerFlash = { key: "banner.failed", cls: "bad", until: Date.now() + 4000 };
    }
  }
  const el = $("#mission-banner");
  if (bannerFlash) {
    if (Date.now() < bannerFlash.until) {
      el.hidden = false;
      el.className = bannerFlash.cls;
      $("#mission-kind").textContent = t(bannerFlash.key);
      $("#mission-stage").textContent = "";
      return;
    }
    bannerFlash = null;
  }
  const b = missionBanner(view);
  if (!b) { el.hidden = true; el.className = ""; return; }
  el.hidden = false;
  el.className = b.atRisk ? "bad" : "";
  $("#mission-kind").textContent = t(b.kindKey);
  const pct = b.progress !== null ? ` ${Math.round(b.progress * 100)}%` : "";
  const more = b.others > 0 ? ` (+${b.others})` : "";
  $("#mission-stage").textContent = `${t(b.stageKey)}${pct}${more}`;
}

// ── The journal overlay (playtest 12) ──────────────────────────────────────
const journal = [];
let journalRendered = -1;
function renderJournal() {
  const panel = $("#journal");
  if (panel.hidden || journalRendered === journal.length) return;
  journalRendered = journal.length;
  const list = $("#journal-list");
  list.textContent = "";
  for (const entry of [...journal].reverse()) {
    const li = document.createElement("li");
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = gameClock(entry.tick).label;
    const what = document.createElement("span");
    what.textContent = t(entry.key, ...(entry.args ?? []).map((a) =>
      typeof a === "string" && a.includes(".") ? t(a) : a));
    li.append(when, what);
    list.appendChild(li);
  }
}

function renderBoard(view) {
  const rows = boardRows(view);
  const signature = rows.map((r) => `${r.id}:${r.tier}:${r.reward}:${r.accepted}:${r.locked}`).join("|");
  if (signature === boardSignature) return;
  boardSignature = signature;

  const list = $("#board-list");
  list.textContent = "";
  for (const row of rows) {
    const li = document.createElement("li");
    if (row.locked) li.className = "locked";
    const label = document.createElement("span");
    label.textContent = `${t("board.tier")} ${row.tier}  ${t(row.kindKey)}`;
    const right = document.createElement("span");
    right.textContent = `+${row.reward}`;
    li.append(label, right);
    if (row.accepted) {
      const mark = document.createElement("span");
      mark.textContent = t("board.accepted");
      li.appendChild(mark);
    } else if (!row.locked) {
      const take = document.createElement("button");
      take.textContent = t("board.accept");
      take.addEventListener("click", () => {
        const a = ownAgent(session.view);
        if (a) session.send({ type: 40, agentId: a.id, contractId: row.id });
      });
      li.appendChild(take);
    }
    list.appendChild(li);
  }
}

// Pinned contract ids (playtest 3): session-local, cleared with each debrief.
// A stale id simply stops resolving in pinnedCells, so nothing here has to
// chase contract lifecycles.
const pinned = new Set();

let activeSignature = "";
const progressBars = new Map();   // contractId -> the fill element
function renderActive(view) {
  const rows = activeRows(view);
  const signature = rows.map((r) => `${r.id}:${r.stageKey}:${r.atRisk}:${pinned.has(r.id) ? 1 : 0}`).join("|");
  if (signature !== activeSignature) {
    activeSignature = signature;
    const list = $("#active-list");
    list.textContent = "";
    if (!rows.length) {
      const li = document.createElement("li");
      li.textContent = t("board.none");
      list.appendChild(li);
    }
    progressBars.clear();
    for (const row of rows) {
      const li = document.createElement("li");
      if (row.atRisk) li.className = "at-risk";
      const label = document.createElement("span");
      label.textContent = `${t(row.kindKey)} — ${t(row.stageKey)}`;
      const right = document.createElement("span");
      right.textContent = `+${row.reward}`;
      li.append(label, right);
      // Pin toggle (playtest 3): tracked contracts carry an extra ring on the
      // radar and in the world, up to MAX_PINS at once.
      const pin = document.createElement("button");
      pin.className = "pin";
      pin.textContent = t(pinned.has(row.id) ? "board.unpin" : "board.pin");
      pin.addEventListener("click", () => {
        if (pinned.has(row.id)) pinned.delete(row.id);
        else if (pinned.size < MAX_PINS) pinned.add(row.id);
        activeSignature = "";   // membership is in the signature; force redraw
      });
      li.appendChild(pin);
      if (row.working) {
        // Built ONCE here and only its width mutated below. Putting progress in
        // the signature above would rebuild this list ten times a second, which
        // is the defect that made the contract button unclickable in playtest 5.
        const track = document.createElement("span");
        track.className = "prog";
        const fill = document.createElement("i");
        track.appendChild(fill);
        li.appendChild(track);
        progressBars.set(row.id, fill);
      }
      list.appendChild(li);
    }
  }

  // Per-tick, structure untouched.
  for (const row of rows) {
    const fill = progressBars.get(row.id);
    if (fill) fill.style.width = `${Math.round(row.progress * 100)}%`;
  }

  // Point at the current objective, so an accepted contract is not a mystery.
  const el = $("#objective");
  const first = (view.active ?? [])[0];
  const target = objectiveFor(view, first);
  if (!first || !target) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `${t("hud.objective")} ${target.cellX},${target.cellY}`;
}

// The edge pointer. The beacon handles "where is it" when the objective is on
// screen; this handles the much more common case where it is not.
// The payoff. Without this an extraction — the thing the whole deployment is
// aimed at — looked exactly like the game freezing.
// A season ended while this player was in the world (D33). Reuses the debrief
// terminal deliberately: it is already the screen that means "your sortie is
// over, here is what it came to", and a season ending is the largest version of
// that. Sending them back to the splash silently would be indistinguishable
// from a crash.
function showSeasonRotated(e) {
  const lines = [
    t("season.rotated", e.closed.season), "",
    t("season.carried"), "",
    ...standingRows(e.opened).map(([k, v, ...a]) => `${t(k).padEnd(26, ".")} ${t(v, ...a)}`),
  ];
  $("#debrief-terminal").textContent = lines.join("\n");
  // The renderer is holding geometry for a city that no longer exists.
  boardSignature = ""; activeSignature = "";
  show("debrief");
}

function showDebrief(s) {
  const d = s.debrief;
  const ledger = s.briefing?.ledger ?? null;
  const pad = (label, value) => `${t(label).padEnd(26, ".")} ${value}`;
  const lines = [
    t(d.emergency ? "evac.emergency" : "debrief.title"), "",
    ...debriefRows(d, ledger).map(([k, v]) =>
      pad(k, v.startsWith("common.") ? t(v) : v)),
    "",
    `${t("debrief.reputation")}  ${reputationBar(ledger?.reputation ?? 0)}  ` +
      `${d.reputationDelta >= 0 ? "+" : ""}${d.reputationDelta}`,
  ];
  $("#debrief-terminal").textContent = lines.join("\n");
  pinned.clear();   // the contracts these ids named left with the sortie
  show("debrief");
}

$("#debrief-return").addEventListener("click", () => {
  session.debrief = null;
  boardSignature = ""; activeSignature = "";
  $("#splash-terminal").textContent = splashText(session.briefing);
  show("splash");
});

function renderObjectiveArrow(view) {
  const el = $("#objective-arrow");
  const agent = ownAgent(view);
  if (!agent) { el.hidden = true; return; }
  const here = { x: Math.floor(agent.x / 256), y: Math.floor(agent.y / 256) };
  const bearing = objectiveBearing(view, here.x, here.y);
  if (!bearing || bearing.distance <= 6) { el.hidden = true; return; }

  el.hidden = false;
  const w = window.innerWidth, h = window.innerHeight;
  const radius = Math.min(w, h) * 0.34;
  const arrow = el.querySelector("span");
  arrow.style.transform = `translate(${Math.cos(bearing.angle) * radius}px, ` +
    `${Math.sin(bearing.angle) * radius}px) rotate(${bearing.angle}rad)`;

  let label = document.getElementById("objective-distance");
  if (!label) {
    label = document.createElement("div");
    label.id = "objective-distance";
    el.appendChild(label);
  }
  label.textContent = String(bearing.distance);
  label.style.left = `${Math.cos(bearing.angle) * (radius - 26)}px`;
  label.style.top = `${Math.sin(bearing.angle) * (radius - 26)}px`;
}

// Portrait glyphs stand in until there is art. The point of the cover shop is
// that you can SEE what you paid for, so a placeholder that changes with the
// disguise is worth more than a blank square.

let buildingSignature = "";
// S16 8d. The counter-play needs a control or it does not exist for a player:
// the mechanism was fully testable and completely unreachable until this.
function renderJunction(view) {
  const btn = $("#cut-btn");
  const j = cuttableJunction(view);
  btn.hidden = !j;
  btn.dataset.junctionId = j ? String(j.id) : "";
}

// S16 8k. The third credential source was written, tested, and unreachable —
// no command and no control. Both halves exist now.
function renderLift(view) {
  const btn = $("#lift-btn");
  const g = liftableGuard(view);
  btn.hidden = !g;
  btn.dataset.patrolId = g ? String(g.id) : "";
}

// S17 mission areas. The BEGIN button is the threshold; inside, the three
// indoor actions appear by adjacency (the same decisions the models file
// tests headlessly). The canvas fades briefly on the mode flip so entering
// reads as going somewhere, not as the map glitching.
let wasInsideArea = false;
function renderArea(view) {
  const begin = beginMission(view);
  const btn = $("#begin-btn");
  btn.hidden = !begin;
  if (begin) btn.textContent = t(begin.labelKey);

  const inside = !!areaView(view);
  if (inside !== wasInsideArea) {
    wasInsideArea = inside;
    const canvas = $("#view");
    canvas.classList.remove("area-fade");
    void canvas.offsetWidth;               // restart the animation
    canvas.classList.add("area-fade");
  }
  // The street chrome makes no sense indoors: the radar shows a city you are
  // not standing in, and the compound has no board to walk to.
  $("#minimap").style.display = inside ? "none" : "";
  const acts = areaActions(view);
  $("#exit-area-btn").hidden = !acts.exit;
  $("#takedown-btn").hidden = !acts.takedown;
  $("#hack-btn").hidden = !acts.hack;
}

function renderBuilding(view) {
  // The "go inside" button appears only when standing on a door.
  const enter = $("#enter-btn");
  enter.hidden = !view.atDoor || !!view.inside || !!areaView(view);

  const panel = $("#building");
  if (!view.inside) {
    panel.hidden = true;
    buildingSignature = "";
    dialogResponse = null;
    return;
  }
  const agent = ownAgent(view);
  const district = view.districts.find((d) => d.id === view.inside.districtId);
  const payload = payloadForBuilding(session.content, view.inside, district?.heatBand ?? 0);
  const rows = overlayRows(payload);
  // The bank is part of the signature: affordability greys rows, so a balance
  // change must re-render the list (and only then — see boardSignature).
  const signature = `${view.inside.id}:${payload?.quiet ? 1 : 0}:${rows.length}:${agent?.disguiseId ?? 0}:${view.bank ?? 0}`;
  panel.hidden = false;
  // The greeting line doubles as the NPC's mouth (playtest 8): for a few
  // seconds after a refusal it carries the in-character answer, then falls
  // back to the greeting. Runs every frame, BEFORE the rebuild early-return,
  // because the response must appear without the list rebuilding.
  $("#building-greet").textContent =
    dialogResponse && Date.now() < dialogResponse.until
      ? t(dialogResponse.key)
      : (payload ? t(payload.quiet ? payload.quietKey : payload.greetKey) : "");
  if (dialogResponse && Date.now() >= dialogResponse.until) dialogResponse = null;
  if (signature === buildingSignature) return;    // do not rebuild under the cursor
  buildingSignature = signature;

  // D47: the portrait is composed from feature layers, so a disguise is a DIFF
  // on the stack rather than a different picture. That is what makes the Cover
  // Shop legible — the moustache changes and the person does not.
  const disguiseId = agent?.disguiseId ?? 0;
  const disguise = disguiseFor(session.content, disguiseId);
  const canvas = $("#portrait");
  try {
    drawPortrait(canvas.getContext("2d"), disguiseId, canvas.width);
  } catch (err) {
    fatal("portrait", err);
  }
  canvas.title = disguise ? t(disguise.key) : "";
  $("#building-title").textContent = t(
    view.inside.kind === 0 ? "building.informant"
      : view.inside.kind === 1 ? "building.market" : "building.coverShop");

  const list = $("#building-options");
  list.textContent = "";
  for (const row of rows) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = t(row.key);
    li.appendChild(label);
    if (row.cost > 0) {
      const cost = document.createElement("span");
      cost.className = "cost";
      cost.textContent = `${row.cost}`;
      li.appendChild(cost);
    }
    const go = document.createElement("button");
    go.textContent = t(row.kind === "buy" ? "board.accept" : "common.confirm");
    // A row the bank cannot cover is visibly out of reach, not a button that
    // silently does nothing (playtest 5: every refusal read as a dead click).
    if ((row.cost ?? 0) > (view.bank ?? 0)) {
      go.disabled = true;
      li.classList.add("unaffordable");
    }
    go.addEventListener("click", () => {
      const a = ownAgent(session.view);
      if (!a) return;
      if (row.kind === "buy") session.send({ type: 37, agentId: a.id, itemIdx: row.idx });
      else session.send({ type: 36, agentId: a.id, optionIdx: row.idx });
    });
    li.appendChild(go);
    list.appendChild(li);
  }
}

function renderStandoff(view) {
  const panel = $("#standoff");
  if (!view.standoff) { panel.hidden = true; return; }
  panel.hidden = false;
  $("#standoff-who").textContent =
    `FIRM ${view.standoff.rivalFirmId} — ${t("debrief.reputation")} ${view.standoff.rivalReputation}`;
  const pct = Math.max(0, Math.min(100, (view.standoff.ticksLeft / 100) * 100));
  $("#standoff-timer span").style.width = `${pct}%`;
}

function renderEvac(view) {
  const panel = $("#evac");
  const evac = evacDisplay(view);
  if (!evac) { panel.hidden = true; return; }
  panel.hidden = false;
  $("#evac-eta").textContent = t("evac.eta", evac.seconds);
  $("#evac-note").textContent = evac.emergency ? t("evac.emergency")
    : evac.paused ? t("evac.paused") : t("evac.hold");
}

function addToast(text, alarm) {
  const el = document.createElement("div");
  el.className = `toast${alarm ? " alarm" : ""}`;
  el.textContent = text;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Input: tap to move, double-tap to hurry (S12 touch model) ─────────────
let lastTap = 0;
$("#view").addEventListener("pointerdown", (ev) => {
  const agent = ownAgent(session.view);
  if (!agent || !renderer) return;
  // Two fingers down is the start of a pinch, never a move order.
  if (pinch.size >= 1 && ev.pointerType === "touch") { pinch.set(ev.pointerId, ev); return; }
  if (ev.pointerType === "touch") pinch.set(ev.pointerId, ev);
  const rect = ev.target.getBoundingClientRect();
  const cell = renderer.screenToCell(ev.clientX - rect.left, ev.clientY - rect.top);
  if (!cell) return;
  const now = Date.now();
  const isDouble = now - lastTap < 300;
  lastTap = now;
  if (isDouble) session.send({ type: 21, agentId: agent.id, stance: 2 });
  // S17: indoors the tap is an AREA cell — same command, compound
  // coordinates, and no kerb-lane hint (a compound has no kerbs).
  if (areaView(session.view)) {
    const ac = renderer.screenToAreaCell(ev.clientX - rect.left, ev.clientY - rect.top);
    if (ac) session.send({ type: 20, agentId: agent.id, cellX: ac.x, cellY: ac.y });
    return;
  }
  // The tap's sub-cell position picks the walking position (playtest 9):
  // tap by the kerb and the operative takes that sidewalk. The engine still
  // receives only the cell — it is cell-granular by doctrine.
  renderer.setMoveHint({ dx: cell.fx - 0.5, dz: cell.fz - 0.5 });
  session.send({ type: 20, agentId: agent.id, cellX: cell.x, cellY: cell.y });
});

// ── Zoom (playtest 6): wheel on desktop, pinch on touch, buttons for both ──
// The renderer clamps the range; this file only feeds it factors.
$("#view").addEventListener("wheel", (ev) => {
  if (!renderer) return;
  ev.preventDefault();
  renderer.zoomBy(ev.deltaY > 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
$("#zoom-in").addEventListener("click", () => renderer?.zoomBy(1 / 1.25));
$("#zoom-out").addEventListener("click", () => renderer?.zoomBy(1.25));

const pinch = new Map();
let pinchDist = 0;
$("#view").addEventListener("pointermove", (ev) => {
  if (!pinch.has(ev.pointerId)) return;
  pinch.set(ev.pointerId, ev);
  if (pinch.size === 2 && renderer) {
    const [a, b] = [...pinch.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchDist > 0 && d > 0) renderer.zoomBy(pinchDist / d);
    pinchDist = d;
  }
});
for (const type of ["pointerup", "pointercancel", "pointerout"]) {
  $("#view").addEventListener(type, (ev) => {
    pinch.delete(ev.pointerId);
    if (pinch.size < 2) pinchDist = 0;
  });
}

// The drop-in flow. The first build sent cellX:-1 straight to the engine,
// which is always "unlandable" — the button did nothing and said nothing
// (playtest 1). Now: ask for zones, let the player choose, auto-pick on the
// 15-second timeout exactly as the design describes.
let zoneTimer = null;
$("#drop-in").addEventListener("click", () => {
  session.requestDropZones();
  show("dropzone");
});

function deployAt(zone) {
  if (!zone) return;
  clearInterval(zoneTimer);
  session.send({ type: 10, firmId: session.firmId, cellX: zone.cellX, cellY: zone.cellY });
}

function showZonePicker() {
  const canvas = $("#zone-map");
  const ctx = canvas.getContext("2d");
  const size = session.view?.size ?? 64;
  const px = canvas.width / size;
  // This is the THIRD surface that draws the world's tiles, and it kept its own
  // copy of the palette until 8d — the 7a-4 guard scanned scene.js, minimap.js
  // and terrain3d.js and never looked here. Same lesson, one file wider: a
  // guard only protects what it reads.
  const T = terrain();
  ctx.fillStyle = T.backdrop;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (session.tiles) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = T.tiles[session.tiles[y * size + x]] ?? T.unknown;
        ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
      }
    }
  }
  for (const z of session.dropZones ?? []) {
    ctx.fillStyle = mark("dropZone");
    ctx.fillRect(z.cellX * px - 1, z.cellY * px - 1, px + 2, px + 2);
  }
  if (session.autoZone) {
    ctx.strokeStyle = mark("dropZoneAuto"); ctx.lineWidth = 2;
    ctx.strokeRect(session.autoZone.cellX * px - 3, session.autoZone.cellY * px - 3, px + 6, px + 6);
  }
  // WHERE A DROP ACTUALLY LANDS (playtest 10, closing the D56 honesty gap):
  // the HQ emblem at each district pick's predicted safehouse, straight from
  // the engine's own landing rule server-side. The picker stops lying.
  const drawLanding = (lx, ly) => {
    ctx.strokeStyle = mark("ownHq"); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lx * px + px / 2, ly * px + px / 2, Math.max(4, px), 0, Math.PI * 2);
    ctx.stroke();
  };
  for (const p of session.zonePicks ?? []) drawLanding(p.landingX, p.landingY);
  if (session.autoLanding) drawLanding(session.autoLanding.cellX, session.autoLanding.cellY);

  // The district list: choosing between 240 identical squares is not a choice.
  const list = $("#zone-districts");
  list.textContent = "";
  for (const d of districtChoices(session.zoneDistricts)) {
    const li = document.createElement("li");
    if (session.autoZone && d.id === session.autoZone.districtId) li.className = "recommended";
    const left = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = t(d.traitKey);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${d.contracts} ${t("dropzone.contracts")}`;
    left.append(name, meta);
    const right = document.createElement("span");
    right.className = HEAT_CLASSES[d.heatBand ?? 0];
    right.textContent = t(d.heatKey);
    li.append(left, right);
    li.addEventListener("click", () => {
      // Deploy with the SERVER'S pick for the district, so the landing the
      // picker showed is the landing the drop performs — the shown emblem is
      // a promise, not an estimate.
      const pick = (session.zonePicks ?? []).find((p) => p.districtId === d.id);
      const inDistrict = (session.dropZones ?? []).filter((z) => z.districtId === d.id);
      deployAt(pick ?? inDistrict[Math.floor(inDistrict.length / 2)] ?? session.autoZone);
    });
    list.appendChild(li);
  }

  let left = 15;
  const hint = $("#zone-hint");
  hint.textContent = `${t("dropzone.auto")} (${left})`;
  clearInterval(zoneTimer);
  zoneTimer = setInterval(() => {
    left -= 1;
    hint.textContent = `${t("dropzone.auto")} (${left})`;
    if (left <= 0) deployAt(session.autoZone ?? (session.dropZones ?? [])[0]);
  }, 1000);
}

$("#zone-map").addEventListener("pointerdown", (ev) => {
  const canvas = $("#zone-map");
  const rect = canvas.getBoundingClientRect();
  const size = session.view?.size ?? 64;
  const cx = Math.floor((ev.clientX - rect.left) / rect.width * size);
  const cy = Math.floor((ev.clientY - rect.top) / rect.height * size);
  // Snap to the nearest offered zone: a pixel-perfect tap on a 64-grid scaled
  // into a phone screen is not a reasonable thing to ask of anyone.
  let best = null, bestD = Infinity;
  for (const z of session.dropZones ?? []) {
    const d = Math.abs(z.cellX - cx) + Math.abs(z.cellY - cy);
    if (d < bestD) { bestD = d; best = z; }
  }
  if (best && bestD <= 6) deployAt(best);
});
$("#lift-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  const id = Number($("#lift-btn").dataset.patrolId);
  if (a && Number.isInteger(id)) session.send({ type: 44, agentId: a.id, patrolId: id });
});

$("#cut-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  const id = Number($("#cut-btn").dataset.junctionId);
  if (a && Number.isInteger(id)) session.send({ type: 43, agentId: a.id, junctionId: id });
});

$("#enter-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  if (a) session.send({ type: 34, agentId: a.id });
});
$("#board-btn").addEventListener("click", () => { $("#board").hidden = !$("#board").hidden; });
$("#evac-btn").addEventListener("click", () => session.send({ type: 11, firmId: session.firmId }));
// S17: the four indoor commands. BEGIN is the enter command wearing the
// contract's name; the rest are the compound verbs.
$("#begin-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  if (a) session.send({ type: 45, agentId: a.id });
});
$("#exit-area-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  if (a) session.send({ type: 46, agentId: a.id });
});
$("#takedown-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  if (a) session.send({ type: 47, agentId: a.id });
});
$("#hack-btn").addEventListener("click", () => {
  const a = ownAgent(session.view);
  if (a) session.send({ type: 48, agentId: a.id });
});
$("#journal-btn").addEventListener("click", () => {
  const panel = $("#journal");
  panel.hidden = !panel.hidden;
  journalRendered = -1;
  renderJournal();
});
$("#intro-dismiss").addEventListener("click", () => {
  $("#intro").hidden = true;
  localStorage.setItem("sm_intro_seen", "1");
});
for (const b of document.querySelectorAll("#standoff [data-choice]")) {
  b.addEventListener("click", () => {
    const a = ownAgent(session.view);
    if (a && session.view.standoff) {
      session.send({ type: 50, agentId: a.id, standoffId: session.view.standoff.id,
        choice: Number(b.dataset.choice) });
    }
  });
}
for (const b of document.querySelectorAll(".overlay .close")) {
  // The building overlay's Leave is a REAL action, not a dismissal: the agent
  // is inside engine-side, and merely hiding the panel left them trapped in a
  // building with no way out (renderBuilding re-shows it every tick while
  // view.inside is set — the button was a no-op that flickered). It sends
  // exitBuilding; the panel hides itself when the view agrees you are out.
  if (b.closest("#building")) continue;
  b.addEventListener("click", () => { b.closest(".overlay").hidden = true; });
}
$("#building .close").addEventListener("click", () => {
  const a = ownAgent(session.view);
  if (a) session.send({ type: 35, agentId: a.id });
});
// The title diorama (playtest 10): built after loadArt so it has tokens, and
// wrapped in try — a broken splash decoration must never block DROP IN.
let attract = null;
try {
  attract = createAttract($("#attract"));
} catch (err) {
  fatal("attract", err);
}
show("splash");
$("#splash-terminal").textContent = splashText(null);
