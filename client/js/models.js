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
  // S16 (M8). Every security event a player can be affected by must SAY so:
  // a facility that quietly decides to escalate while you work is the
  // invisible difficulty D45 forbids.
  beamTripped: { key: "toast.beamTripped", alarm: true },
  alarmRaised: { key: "toast.alarmRaised", alarm: true },
  alarmEscalated: { key: "toast.alarmEscalated", alarm: true },
  junctionCut: { key: "toast.junctionCut" },
};

export function toastsFor(events) {
  return events.map((e) => TOASTS[e.type] && { ...TOASTS[e.type], event: e })
    .filter(Boolean);
}


// Marker silhouettes. S15 asks for silhouette readability, and until now every
// marker except the Field HQ was the same sphere, separated only by colour —
// which fails at a glance, fails in a busy street, and fails entirely for a
// colourblind player. Shape carries the meaning; colour reinforces it.
//
// Pure and exported so it can be tested without a WebGL context: the renderer
// is untestable headlessly, but the DECISION about what shape a thing gets is
// not, and that is where the mistakes live.
export const MARKER_SHAPES = {
  siteScenery: "oct",       // a place something could happen
  siteOffered: "oct",
  siteActive: "oct",
  informant: "cyl",         // people you talk to stand upright
  market: "box",            // premises
  coverShop: "cone",
  holding: "box",
  patrol: "cone",           // pointed: something that is looking
  patrolAlert: "cone",
  rival: "sphere",
  ownHq: "box",
  rivalHq: "box",
  agent: "sphere",
};

// Every marker role must resolve to a shape. A missing role silently falling
// back to a sphere is exactly the bug this table exists to prevent.
export function markerShape(role) {
  return MARKER_SHAPES[role] ?? null;
}

export function buildingRole(kind) {
  return kind === 0 ? "informant" : kind === 1 ? "market" : "coverShop";
}

export function siteRole(role) {
  return role === "active" ? "siteActive" : role === "offered" ? "siteOffered" : "siteScenery";
}

// D50's disclosure, as a view-model decision so it is testable without a DOM.
// A newcomer meeting Firms four tiers above them is only unfair if it was
// unforeseeable, so "DAY 24 OF 28" and "RIVAL TIERS 1–4" belong on the screen
// that has the drop-in button on it — not in a server list nobody visits.
//
// Returns [labelKey, value, ...args] rows. The caller renders each as
// `t(labelKey)` and `t(value, ...args)` — and because `t` returns its key
// unchanged when the catalog has no such entry, a plain value like "0 / 28"
// passes straight through while "splash.dayEndless" gets translated. That is
// what keeps every visible word in the catalog (S13) without forcing a second
// row shape for the one row that needs interpolation.
//
// Learned the hard way: the first version used the interpolated key
// "DAY {0} OF {1}" as the LABEL, so the splash rendered "DAY  OF ..... 0/28"
// with both slots empty. It was correct data and unreadable text, and no unit
// test would ever have noticed — only looking at the live screen did.
export function standingRows(standing) {
  if (!standing) return [];
  const rows = [["splash.season", `${standing.season | 0}`]];
  rows.push(standing.endless
    ? ["splash.day", "splash.dayEndless", standing.day | 0]
    : ["splash.day", `${standing.day | 0} / ${standing.days | 0}`]);
  // A world with no Firms in it yet has no tier range, and printing "0–0"
  // would read as a claim about the opposition rather than as its absence.
  if ((standing.tierHigh | 0) > 0) {
    rows.push(["splash.rivalTiers",
      standing.tierLow === standing.tierHigh
        ? `${standing.tierLow}`
        : `${standing.tierLow}–${standing.tierHigh}`]);
  }
  return rows;
}

// S16 8d: the junction the operative could cut right now, or null.
//
// A view-model decision so the RULE is unit-tested even though the button is
// not, and so the client and the engine cannot disagree about what "at the box"
// means — the engine refuses a cut beyond Manhattan distance 1, and a button
// that offers what the server will refuse is worse than no button.
export function cuttableJunction(view) {
  const agent = ownAgent(view);
  if (!agent) return null;
  const cx = Math.floor(agent.x / 256), cy = Math.floor(agent.y / 256);
  for (const j of view.junctions ?? []) {
    if (j.cut) continue;
    if (Math.abs(j.cellX - cx) + Math.abs(j.cellY - cy) <= 1) return j;
  }
  return null;
}
