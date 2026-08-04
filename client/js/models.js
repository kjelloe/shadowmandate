// client/js/models.js — pure view-model helpers (S12).
//
// Kept free of the DOM so they can be unit-tested without a browser. The thin
// DOM layer in main.js reads these; nothing here touches an element.

export const STANCES = [
  { id: 0, key: "hud.stance.sneak" },
  { id: 1, key: "hud.stance.move" },
  { id: 2, key: "hud.stance.hurry" },
];

export const DETECTION_KEYS = ["hud.detection.unseen", "hud.detection.noticed", "hud.detection.burned"];
export const DETECTION_CLASS = ["unseen", "noticed", "burned"];
export const HEAT_KEYS = ["hud.heat.calm", "hud.heat.tense", "hud.heat.lockdown"];
export const HEAT_CLASS = ["calm", "tense", "lockdown"];
export const CONTRACT_KEYS = [
  "contract.courier", "contract.surveillance", "contract.extraction",
  "contract.sabotage", "contract.acquisition",
];

export function ownAgent(view) {
  if (!view) return null;
  return view.agents.find((a) => a.state === 1) ?? view.agents[0] ?? null;
}

// D20: the band is what a player normally sees; the exact number appears only
// when they have bought intel, and then it is worth showing prominently.
export function heatDisplay(view, districtId) {
  const d = view?.districts?.find((x) => x.id === districtId);
  if (!d) return { band: 0, exact: null };
  return { band: d.heatBand, exact: d.heat >= 0 ? d.heat : null };
}

export function districtUnder(view, cellX, cellY) {
  if (!view?.districts?.length) return null;
  let best = null, bestD = Infinity;
  for (const d of view.districts) {
    const dist = Math.abs(d.coreX - cellX) + Math.abs(d.coreY - cellY);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

// The board as rows the UI can render directly, teaser included and marked.
export function boardRows(view) {
  if (!view?.board) return [];
  const rows = view.board.contracts.map((c) => ({
    id: c.id, kindKey: CONTRACT_KEYS[c.kind] ?? "contract.courier",
    tier: c.tier, reward: c.reward, accepted: !!c.acceptedByMe, locked: false,
  }));
  if (view.board.teaser) {
    rows.push({
      id: view.board.teaser.id, kindKey: CONTRACT_KEYS[view.board.teaser.kind],
      tier: view.board.teaser.tier, reward: view.board.teaser.reward,
      accepted: false, locked: true,
    });
  }
  return rows;
}

export function evacDisplay(view) {
  const hq = view?.hq;
  if (!hq || !hq.evacActive) return null;
  return {
    seconds: Math.max(0, Math.ceil(hq.evacTicks / 10)),
    paused: !!hq.evacPaused,
    emergency: hq.evacActive === 2,
  };
}

// Events worth interrupting the player for. Everything else is noise.
const TOASTS = {
  perimeterAlarm: { key: "alarm.perimeter", alarm: true },
  agentBurned: { key: "alarm.burned", alarm: true },
  agentCaptured: { key: "alarm.captured", alarm: true },
  contractCompleted: { key: "debrief.contracts" },
  tierUnlocked: { key: "board.tier" },
  cacheLooted: { key: "alarm.perimeter", alarm: true },
  coverBought: { key: "shop.newFace" },
};

export function toastsFor(events) {
  return events.map((e) => TOASTS[e.type] && { ...TOASTS[e.type], event: e })
    .filter(Boolean);
}
