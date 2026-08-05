// client/js/main.js — the thin DOM layer. All logic lives in models.js and the
// engine; this file only wires elements to a session (S12).

import { loadLocale, t, applyStatic } from "./i18n.js";
import { createRemoteSession } from "./session.js";
import { createRenderer } from "./render.js";
import {
  STANCES, DETECTION_KEYS, DETECTION_CLASS, HEAT_KEYS, HEAT_CLASS,
  ownAgent, heatDisplay, districtUnder, boardRows, evacDisplay, toastsFor,
} from "./models.js";

const $ = (sel) => document.querySelector(sel);
const show = (id) => {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
};

await loadLocale();
applyStatic();
$("#drop-in").textContent = t("splash.dropIn");

const session = createRemoteSession({
  url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
});

let renderer = null;
let cityTiles = null;
let lastStance = 1;

function splashText(b) {
  const pad = (label, value) => `${label.padEnd(24, ".")} ${value}`;
  return [
    t("splash.title"), t("splash.terminal"), "",
    pad(t("splash.world"), b?.worldId ?? "—"),
    pad(t("splash.activeFirms"), b?.activeFirms ?? 0),
    pad(t("splash.contracts"), b?.contracts ?? 0),
    pad(t("splash.yourFirm"), session.firmId ?? "—"),
    pad(t("splash.fieldStatus"), t("splash.undeployed")),
  ].join("\n");
}

session.onChange((s, events) => {
  if (!s.view) return;
  if ((events ?? []).some((e) => e.type === "dropZonesReady")) showZonePicker();
  for (const e of events ?? []) {
    if (e.type === "rejected") addToast(`${e.command}: ${e.reason}`, true);
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
  if (deployed && $("#world").hidden) { show("world"); renderer?.resize(); }
  paint(s, events ?? []);
});

function paint(s, events) {
  const view = s.view;
  if (!renderer) renderer = createRenderer($("#view"), cityTiles);
  renderer.draw(view);

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

  renderStances();
  renderBoard(view);
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

function renderBoard(view) {
  const list = $("#board-list");
  list.textContent = "";
  for (const row of boardRows(view)) {
    const li = document.createElement("li");
    if (row.locked) li.className = "locked";
    const label = document.createElement("span");
    label.textContent = `${t("board.tier")} ${row.tier}  ${t(row.kindKey)}`;
    const right = document.createElement("span");
    right.textContent = `+${row.reward}`;
    li.append(label, right);
    if (!row.locked && !row.accepted) {
      const take = document.createElement("button");
      take.textContent = t("board.select");
      take.addEventListener("click", () => {
        const a = ownAgent(session.view);
        if (a) session.send({ type: 40, agentId: a.id, contractId: row.id });
      });
      li.appendChild(take);
    }
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
  const rect = ev.target.getBoundingClientRect();
  const cell = renderer.screenToCell(ev.clientX - rect.left, ev.clientY - rect.top);
  const now = Date.now();
  const isDouble = now - lastTap < 300;
  lastTap = now;
  if (isDouble) session.send({ type: 21, agentId: agent.id, stance: 2 });
  session.send({ type: 20, agentId: agent.id, cellX: cell.x, cellY: cell.y });
});

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
  ctx.fillStyle = "#0F1114";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (session.tiles) {
    const TILE = { 0:"#2A2E26",1:"#3B3F46",2:"#24272C",3:"#454B54",4:"#171A1F",
      5:"#6A5B3E",6:"#4A5566",7:"#7A4A3A",8:"#33352C",9:"#2E2A24",10:"#1B2A33" };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = TILE[session.tiles[y * size + x]] ?? "#222";
        ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
      }
    }
  }
  for (const z of session.dropZones ?? []) {
    ctx.fillStyle = "rgba(62,142,140,.75)";
    ctx.fillRect(z.cellX * px - 1, z.cellY * px - 1, px + 2, px + 2);
  }
  if (session.autoZone) {
    ctx.strokeStyle = "#D9A441"; ctx.lineWidth = 2;
    ctx.strokeRect(session.autoZone.cellX * px - 3, session.autoZone.cellY * px - 3, px + 6, px + 6);
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
$("#board-btn").addEventListener("click", () => { $("#board").hidden = !$("#board").hidden; });
$("#evac-btn").addEventListener("click", () => session.send({ type: 11, firmId: session.firmId }));
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
  b.addEventListener("click", () => { b.closest(".overlay").hidden = true; });
}
show("splash");
$("#splash-terminal").textContent = splashText(null);
