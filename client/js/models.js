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

export const STAGE_KEYS = [
  "stage.offered", "stage.travel", "stage.work", "stage.return", "stage.done", "stage.failed",
];

// What the player is currently carrying, and where it wants them to go.
export function activeRows(view) {
  return (view?.active ?? []).map((c) => ({
    id: c.id,
    kindKey: CONTRACT_KEYS[c.kind] ?? "contract.courier",
    tier: c.tier, reward: c.reward,
    stageKey: STAGE_KEYS[c.stage] ?? "stage.travel",
    atRisk: (c.graceTicks ?? 0) > 0,
    // Work-stage progress, 0..1. Every contract type now has time-on-site, so
    // without this the player stands still for up to 90 seconds with nothing
    // moving on screen — indistinguishable from a hung game.
    working: (c.stageTarget ?? 0) > 0,
    progress: (c.stageTarget ?? 0) > 0
      ? Math.max(0, Math.min(1, (c.stageTicks ?? 0) / c.stageTarget))
      : 0,
    legsDone: c.legsDone ?? 0,
  }));
}

// Which sites matter to this player right now, and why. The diorama and the
// minimap both read this so they can never disagree about what is highlighted.
export function siteRoles(view) {
  const roles = new Map();
  for (const c of view?.board?.contracts ?? []) {
    if (c.siteId >= 0) roles.set(c.siteId, "offered");
    if (c.siteIdB >= 0 && !roles.has(c.siteIdB)) roles.set(c.siteIdB, "offered");
  }
  // Active beats offered: the job you took outranks the ones you were shown.
  for (const c of view?.active ?? []) {
    if (c.siteId >= 0) roles.set(c.siteId, "active");
    if (c.siteIdB >= 0) roles.set(c.siteIdB, "active");
  }
  return roles;
}

// The single cell the player should be heading for, if any.
export function objectiveCell(view) {
  const first = (view?.active ?? [])[0];
  return objectiveFor(view, first);
}

// Direction and distance to an off-screen objective, so the player is never
// left hunting for it. Angle is screen-space radians, 0 = right.
export function objectiveBearing(view, fromCellX, fromCellY) {
  const target = objectiveCell(view);
  if (!target) return null;
  const dx = target.cellX - fromCellX;
  const dy = target.cellY - fromCellY;
  const distance = Math.abs(dx) + Math.abs(dy);
  return { dx, dy, distance, angle: Math.atan2(dy, dx), cellX: target.cellX, cellY: target.cellY };
}

// The cell an active contract currently wants the operative at — so the HUD
// can point somewhere rather than leaving them to guess.
export function objectiveFor(view, contract) {
  if (!view || !contract) return null;
  const site = (id) => view.sites?.find((s) => s.id === id) ?? null;
  if (contract.stage === 3) {
    if (contract.kind === 0 && contract.siteIdB >= 0) return site(contract.siteIdB);
    return view.hq ? { cellX: view.hq.cellX, cellY: view.hq.cellY } : null;
  }
  return site(contract.siteId);
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

// The debrief, as label/value rows the screen can print directly. Kept here so
// the payoff screen is testable without a browser.
export function debriefRows(debrief, ledger) {
  if (!debrief) return [];
  const rows = [
    ["debrief.resources", String(debrief.banked ?? 0)],
    ["debrief.contracts", String(debrief.contractsCompleted ?? 0)],
    ["debrief.recognition", String(debrief.recognition ?? 0)],
    ["debrief.hqIntact", debrief.emergency ? "common.no" : "common.yes"],
  ];
  if (ledger) {
    rows.push(["debrief.bank", String(ledger.bank ?? 0)]);
    rows.push(["board.tier", String(ledger.tierUnlocked ?? 1)]);
  }
  return rows;
}

// A reputation bar that reads at a glance: ten cells, filled proportionally.
export function reputationBar(value, max = 40) {
  const filled = Math.max(0, Math.min(10, Math.round((value / max) * 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export const TRAIT_KEYS = [
  "trait.industrial", "trait.residential", "trait.commercial",
  "trait.government", "trait.research", "trait.port",
];

// Districts ranked the way a player would choose: most work first, then
// coolest. The same ordering D37 uses for the auto-pick, so the highlighted
// zone and the top of the list agree.
export function districtChoices(districts) {
  return [...(districts ?? [])]
    .map((d) => ({
      ...d,
      traitKey: TRAIT_KEYS[d.trait] ?? "trait.industrial",
      heatKey: HEAT_KEYS[d.heatBand ?? 0],
    }))
    .sort((a, b) => (b.contracts - a.contracts) || (a.heatBand - b.heatBand) || (a.id - b.id));
}

export const BUILDING_KIND = { SAFEHOUSE: 0, MARKET: 1, COVERSHOP: 2 };

// What conversation or catalogue this building is offering right now. Mirrors
// engine/buildings.js payloadFor — an informant goes quiet in a locked-down
// district, and the client must show that rather than a dead menu.
export function payloadForBuilding(content, building, heatBand) {
  if (!content?.payloads || !building) return null;
  const { payloads } = content;
  if (building.kind === BUILDING_KIND.COVERSHOP) {
    return payloads.shops.find((s) => s.id === "covershop") ?? null;
  }
  if (building.kind === BUILDING_KIND.MARKET) {
    return payloads.shops.find((s) => s.id === "vendor") ?? null;
  }
  const dialogue = payloads.dialogues.find((d) => d.id === "informant") ?? null;
  if (!dialogue) return null;
  // heatBand 2 is lockdown (D20 fuzz bands); the informant stops talking.
  if (heatBand >= 2) {
    return { ...dialogue, quiet: true, options: [dialogue.options[dialogue.options.length - 1]] };
  }
  return dialogue;
}

// The rows an overlay renders, whether it is a conversation or a shop.
export function overlayRows(payload) {
  if (!payload) return [];
  if (payload.kind === "shop") {
    return payload.catalog.map((item, idx) => ({
      idx, key: item.key, cost: item.cost, kind: "buy",
    }));
  }
  return payload.options.map((o, idx) => ({
    idx, key: o.key, cost: o.cost ?? 0, kind: o.exit ? "leave" : "talk",
  }));
}

export function disguiseFor(content, disguiseId) {
  return content?.disguises?.disguises?.find((d) => d.id === (disguiseId | 0)) ?? null;
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
