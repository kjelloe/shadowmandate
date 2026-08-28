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
  "contract.sabotage", "contract.acquisition", "contract.defend",
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

// PLAYTEST 3 (finding 4): a burned operative must be TOLD where the re-spray
// is, not left to remember which building was the cover shop. Pure decision:
// burned -> the nearest cover shop by walking distance; any other state ->
// null. The minimap and the diorama both draw exactly what this returns, so
// the ping and the in-world target can never point at different shops.
export function burnedGuidance(view) {
  const agent = ownAgent(view);
  if (!agent || agent.detection !== 2) return null;
  const hx = Math.floor(agent.x / 256), hy = Math.floor(agent.y / 256);
  let best = null, bestD = Infinity;
  for (const b of view?.buildings ?? []) {
    if (buildingRole(b.kind) !== "coverShop") continue;
    const d = Math.abs(b.cellX - hx) + Math.abs(b.cellY - hy);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best) return null;
  return { buildingId: best.id, cellX: best.cellX, cellY: best.cellY, distance: bestD };
}

// PLAYTEST 13 (finding 2): "Agent captured. When what?" — the honest answer was
// nothing. The operative vanished into a Holding Site, the HUD kept rendering a
// world with no one in it, and every option the game actually offers lived
// somewhere the player had no reason to look. Not one line of this is a new
// mechanic: bail (CMD_PAY_BAIL) and the D51 fold-with-nobody-left have both
// existed for months and neither was ever mentioned on screen.
//
// `heldOwn` on each holding site is likewise not new — the view has carried
// "your people are in THAT building" since M4 and no surface read it.
export function captureSituation(view) {
  if (!view) return null;
  const held = (view.agents ?? []).filter((a) => a.state === 3);
  if (!held.length) return null;
  // Still have someone on their feet? Then this is a setback, not a crisis —
  // the overlay is for the moment the sortie has stopped, and stealing the
  // screen from a player who is still playing would be its own defect.
  const active = (view.agents ?? []).some((a) => a.state === 1);
  if (active) return null;
  const site = (view.holdingSites ?? []).find((h) => (h.heldOwn ?? []).length > 0) ?? null;
  const cost = view.bailCost | 0;
  return {
    heldCount: held.length,
    cellX: site?.cellX ?? -1,
    cellY: site?.cellY ?? -1,
    bailCost: cost,
    // The engine's own affordability rule (combat.js bailQuote): a zero cost is
    // refused, which is what a broke Firm gets.
    canBail: cost > 0 && cost <= (view.bank ?? 0),
    // Q48: BRING IN ANOTHER AGENT, without leaving the field. Costs standing
    // and keeps the cache at risk; folding banks the cache and ends the sortie.
    // That is the whole choice, and it is why both are offered side by side.
    canRedrop: !!view.hq && !view.hq.evacActive && (view.redropCost | 0) > 0,
    redropCost: view.redropCost | 0,
    // D51: folding up with everyone in custody is explicitly allowed, and the
    // prisoner becomes a recovery job waiting on the next drop-in — the same
    // job a redrop puts on the board immediately.
    canPullOut: !!view.hq && !view.hq.evacActive,
    evacRunning: !!view.hq?.evacActive,
  };
}

// PLAYTEST 13 (finding 1): "shouldn't re-spray shops be visible on the map as a
// place of interest all the time?" They should. Until now a cover shop appeared
// on the radar ONLY while you were burned — which is the one moment you have no
// time to plan a route to one. A shop is civic infrastructure: everybody knows
// where it is, the whole building list already crosses the wire unfiltered, and
// hiding it taught the player nothing except that the radar is unreliable.
//
// `burnedGuidance` above stays exactly as it was and keeps its pulse: the
// standing marks say "these exist", the pulse says "go to THAT one, now".
export function coverShops(view) {
  return (view?.buildings ?? [])
    .filter((b) => buildingRole(b.kind) === "coverShop")
    .map((b) => ({ id: b.id, cellX: b.cellX, cellY: b.cellY }));
}

// PLAYTEST 3 (finding 2): pin up to three ACCEPTED contracts so their targets
// carry an extra ring on the radar and in the world. Resolution goes through
// objectiveFor, so a pinned ring follows the contract to its return leg
// rather than pointing at a site the player is already done with. Stale ids
// (completed, expired, abandoned) simply stop resolving — no cleanup pass.
export const MAX_PINS = 3;
export function pinnedCells(view, pinnedIds) {
  if (!view || !pinnedIds) return [];
  const out = [];
  for (const c of view.active ?? []) {
    if (!pinnedIds.has(c.id)) continue;
    const cell = objectiveFor(view, c);
    if (cell) out.push({ id: c.id, cellX: cell.cellX, cellY: cell.cellY });
    if (out.length >= MAX_PINS) break;
  }
  return out;
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

export const BUILDING_KIND = { SAFEHOUSE: 0, MARKET: 1, COVERSHOP: 2, CUBBY: 3 };

// What conversation or catalogue this building is offering right now. Mirrors
// engine/buildings.js payloadFor — an informant goes quiet in a locked-down
// district, and the client must show that rather than a dead menu.
export function payloadForBuilding(content, building, heatBand) {
  if (!content?.payloads || !building) return null;
  const { payloads } = content;
  if (building.kind === BUILDING_KIND.COVERSHOP) {
    return payloads.shops.find((s) => s.id === "covershop") ?? null;
  }
  // S09/Q45: the cubby — no person, no heat gate (a lockdown is exactly when
  // you want a hole to hide in). Mirrors engine payloadFor.
  if (building.kind === BUILDING_KIND.CUBBY) {
    return payloads.dialogues.find((d) => d.id === "cubby") ?? null;
  }
  if (building.kind === BUILDING_KIND.MARKET) {
    return payloads.shops.find((s) => s.id === "vendor") ?? null;
  }
  const dialogue = payloads.dialogues.find((d) => d.id === "informant") ?? null;
  if (!dialogue) return null;
  // heatBand 2 is lockdown (D20 fuzz bands); the informant stops talking —
  // but the safehouse keeps sheltering: the wait-for-dark option survives
  // the quiet (WD-2), matching engine payloadFor.
  if (heatBand >= 2) {
    return { ...dialogue, quiet: true,
      options: dialogue.options.filter((o) => o.effect?.type === "waitForDark") };
  }
  return dialogue;
}

// The rows an overlay renders, whether it is a conversation or a shop.
// No "leave" rows: leaving is the overlay's own Leave button (playtest 5 —
// two Leave controls that did different things, and the dialogue one won).
export function overlayRows(payload, night = false) {
  if (!payload) return [];
  if (payload.kind === "shop") {
    return payload.catalog.map((item, idx) => ({
      idx, key: item.key, cost: item.cost, kind: "buy",
    }));
  }
  // dayOnly options (S09 wait-for-dark) vanish after nightfall — cosmetic
  // here; the ENGINE gate in applyEffect is the rule's single home, and a
  // client that shows the row anyway just earns the rejection toast.
  return payload.options
    .map((o, idx) => ({ idx, key: o.key, cost: o.cost ?? 0, kind: "talk", dayOnly: !!o.dayOnly }))
    .filter((r) => !(night && r.dayOnly));
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
  // S16 8i. A raid you are not told about is exactly the unfairness the
  // warning window exists to prevent.
  raidIncoming: { key: "toast.raidIncoming", alarm: true },
  raidDispatched: { key: "toast.raidDispatched", alarm: true },
  contractContested: { key: "toast.contractContested", alarm: true },
  contractLost: { key: "toast.contractLost", alarm: true },
  accessDenied: { key: "toast.accessDenied" },
  defenceBreached: { key: "toast.defenceBreached", alarm: true },
  credentialGained: { key: "toast.credentialGained" },
  // S17 mission areas: the indoor events a player must be TOLD about.
  areaAlarm: { key: "toast.areaAlarm", alarm: true },
  areaSuppressed: { key: "toast.areaSuppressed" },
  guardDowned: { key: "toast.guardDowned" },
  agentDumped: { key: "toast.agentDumped", alarm: true },
  areaAssetTaken: { key: "toast.areaAssetTaken" },
  // S09/Q45 wait-for-dark.
  waitingForDark: { key: "toast.waitingForDark" },
  waitedForDark: { key: "toast.waitedForDark" },
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
  return kind === 0 ? "informant" : kind === 1 ? "market"
    : kind === BUILDING_KIND.CUBBY ? "cubby" : "coverShop";
}

export function siteRole(role) {
  return role === "active" ? "siteActive" : role === "offered" ? "siteOffered" : "siteScenery";
}

// The engine's SITE_* order (citygen.js), as a DELIBERATE mirror — the client
// cannot import the engine, so a guard test keeps the two lists in step (the
// same pattern as terrain3d's TRAIT_STYLES).
export const SITE_TYPE_ROLES = ["siteCache", "siteVault", "siteLab", "siteRelay", "siteTransit", "siteWarehouse"];

// What the diorama draws for a site (playtest 5): the TYPE picks the model —
// a vault reads as a vault before you read any label — and the contract state
// picks the mark the tint slot takes. The radar keeps the state-role language
// (siteRole above); this is the 3D half of the same decision.
export function siteVisual(state, type) {
  return {
    role: SITE_TYPE_ROLES[type] ?? SITE_TYPE_ROLES[0],
    mark: state === "active" ? "siteActive" : state === "offered" ? "siteOffered" : "site",
  };
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

// S16 8k: the disabled guard whose badge the operative could take, or null.
// Same shape and the same reasoning as `cuttableJunction` — the engine refuses
// beyond Manhattan 1, and a button that offers what the server will refuse is
// worse than no button.
export function liftableGuard(view) {
  const agent = ownAgent(view);
  if (!agent) return null;
  const cx = Math.floor(agent.x / 256), cy = Math.floor(agent.y / 256);
  for (const p of view.patrols ?? []) {
    if (!p.disabled) continue;
    if (Math.abs(p.x - cx) + Math.abs(p.y - cy) <= 1) return p;
  }
  return null;
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

// Playtest 4: the Field HQ establishes INSIDE a building — the engine snaps
// the drop to a safehouse door. When an HQ cell is a building entrance, the
// building itself is the structure, so the client keeps the tent packed and
// marks home with the emblem ring alone. A view-model decision (pure, unit-
// tested) because a tent drawn through a safehouse reads as a glitch, and the
// client must agree with the engine about what "in a building" means.
export function hqInBuilding(view, hq) {
  return !!hq
    && (view.buildings ?? []).some((b) => b.cellX === hq.cellX && b.cellY === hq.cellY);
}

// The mission banner (playtest 7): what am I doing RIGHT NOW, top-centre.
// The first active contract carries it — the one the objective pill, beacon
// and edge arrow already point at, so every "current mission" surface agrees.
// Null when nothing is active (the completion flash is the caller's, because
// "finished" is an EVENT and this function only sees state).
export function missionBanner(view) {
  const rows = activeRows(view);
  if (!rows.length) return null;
  const r = rows[0];
  // OB-1: the indoor game must be DISCOVERABLE. For an area contract at its
  // work stage, the banner says the next verb outright — "get to the site
  // and BEGIN" while outside, and once BEGIN is available it says press it.
  // Without this a new player stands on the site waiting for a timer that
  // no longer exists.
  const c = (view?.active ?? [])[0];
  let hintKey = null;
  if (c && (c.kind === 1 || c.kind === 2) && c.stage === 2 && !c.recovery
    && Array.isArray(view?.agents)) {
    const a = ownAgent(view);
    if (a && a.insideAreaId < 0) {
      hintKey = beginMission(view) ? "banner.pressBegin" : "banner.goBegin";
    }
  }
  return {
    kindKey: r.kindKey,
    stageKey: r.stageKey,
    hintKey,
    progress: r.working ? r.progress : null,
    atRisk: r.atRisk,
    others: rows.length - 1,
  };
}

// Where the operative is HEADING, as a cell — or null when they are already
// there (playtest 6). Pure, so "the pin means a live move order" is a tested
// promise rather than renderer behaviour: a pin that lingers after arrival
// reads as an order the game is ignoring.
export function moveTarget(view) {
  const a = ownAgent(view);
  if (!a || a.targetX === undefined) return null;
  const cellX = Math.floor(a.targetX / 256), cellY = Math.floor(a.targetY / 256);
  if (cellX === Math.floor(a.x / 256) && cellY === Math.floor(a.y / 256)) return null;
  return { cellX, cellY };
}

// ── The four walking positions (playtest 8, D61) ───────────────────────────
// On a road, the agent renders at one of four lateral positions — left
// sidewalk, left lane, right lane, right sidewalk — whichever lies NEAREST
// the straight line toward the destination (the owner's rule). Pure decision;
// the scene slews the drawn offset toward it, so stepping off a kerb and
// crossing to the far sidewalk is something you literally watch happen.
//
// HONESTY: this is a render offset, always inside the agent's own simulated
// cell (max 0.4 of a half-cell). Gameplay is cell-granular — detection,
// beams and arrests read cells — so the figure never leaves the cell the
// engine says it is in.
export const WALK_POSITIONS = [-0.4, -0.15, 0.15, 0.4];

// `hint` is where IN the cell the player's tap landed ({dx, dz} from the
// cell centre, playtest 9): tapping beside a kerb walks that sidewalk, the
// whole way. Without a hint (or an old client) the line-to-destination rule
// decides. Either way the offset snaps to one of the four positions.
// How far off the cell centre the drawn figure may stand (playtest 11): far
// enough to reach the spot the player tapped, never outside the cell.
export const ARRIVE_CLAMP = 0.42;
const inCell = (v) => Math.max(-ARRIVE_CLAMP, Math.min(ARRIVE_CLAMP, v));

export function walkOffset(view, tiles, size, hint = null) {
  const a = ownAgent(view);
  if (!a || !tiles) return { dx: 0, dz: 0 };
  const cellX = Math.floor(a.x / 256), cellY = Math.floor(a.y / 256);
  const dest = moveTarget(view);
  // On the FINAL stretch the tap is the truth (playtest 11): the operative
  // walks to the EXACT spot the player pointed at — both axes, any tile —
  // clamped inside the destination cell so the engine's cell-granular story
  // still holds.
  if (dest && hint
    && Math.abs(dest.cellX - cellX) + Math.abs(dest.cellY - cellY) <= 2) {
    return { dx: inCell(hint.dx), dz: inCell(hint.dz) };
  }
  const t = tiles[cellY * size + cellX];
  if (t !== 1 && t !== 6) return { dx: 0, dz: 0 };
  const road = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const n = tiles[y * size + x];
    return n === 1 || n === 6;
  };
  const ew = road(cellX - 1, cellY) || road(cellX + 1, cellY);
  const ns = road(cellX, cellY - 1) || road(cellX, cellY + 1);
  if (ew === ns) return { dx: 0, dz: 0 };        // intersection or orphan cell
  if (!dest) return null;                         // standing: hold position
  // The SENSIBLE side (playtest 10 ruling): en route, walk the right-hand
  // sidewalk of the travel direction like a pedestrian — through turns, the
  // side swaps with the heading.
  const nearDest = Math.abs(dest.cellX - cellX) + Math.abs(dest.cellY - cellY) <= 2;
  let perp;
  if (nearDest) {
    perp = ew ? (dest.cellY + 0.5) - (a.y / 256)
              : (dest.cellX + 0.5) - (a.x / 256);
  } else {
    const along = ew ? Math.sign(dest.cellX + 0.5 - a.x / 256)
                     : Math.sign(dest.cellY + 0.5 - a.y / 256);
    // Right hand of travel: east -> south kerb, west -> north; south -> west
    // kerb, north -> east.
    perp = ew ? along * 0.4 : -along * 0.4;
  }
  const clamped = Math.max(-0.4, Math.min(0.4, perp));
  const snapped = WALK_POSITIONS.reduce((best, p) =>
    Math.abs(p - clamped) < Math.abs(best - clamped) ? p : best);
  return ew ? { dx: 0, dz: snapped } : { dx: snapped, dz: 0 };
}

// EVAC is offered only where the server would accept it (playtest 12): a
// button that offers what the reducer refuses is worse than no button. The
// D51 exception stands — with no operative in the field, folding is allowed
// from anywhere.
export function evacAvailable(view) {
  const hq = view?.hq;
  if (!hq) return false;
  if (hq.evacActive) return true;                 // cancel/status stays visible
  const a = ownAgent(view);
  if (!a) return true;                            // D51: fold with nobody left
  const r = hq.perimeterRadius ?? 4;
  return Math.abs(Math.floor(a.x / 256) - hq.cellX)
    + Math.abs(Math.floor(a.y / 256) - hq.cellY) <= r;
}

// ── The journal (playtest 12) ──────────────────────────────────────────────
// "What was said, at what day/time; when missions were undertaken and
// completed or failed." Pure event->line mapping so the journal's CONTENT is
// unit-tested; main.js only accumulates and renders.

// Mirrors engine/season.js TICKS_PER_DAY (the client cannot import the
// engine; a guard test keeps the two in step).
export const TICKS_PER_DAY = 864000;
export function gameClock(tick) {
  const t = Math.max(0, tick | 0);
  const day = Math.trunc(t / TICKS_PER_DAY) + 1;
  const frac = (t % TICKS_PER_DAY) / TICKS_PER_DAY;
  const mins = Math.trunc(frac * 24 * 60);
  const hh = String(Math.trunc(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return { day, hh, mm, label: `D${day} ${hh}:${mm}` };
}

// What the informant/vendor SAID for a given purchase — the same lines the
// dialogue shows, so the journal is a transcript, not a paraphrase.
export const SPOKEN_LINES = {
  "dialog.informant.askRival": "dialog.respond.rival",
  "dialog.informant.askHeat": "dialog.respond.heat",
  "dialog.informant.askCredential": "dialog.respond.credential",
  // S09 wait-for-dark. Without these the fallback spoke the REFUSE line the
  // moment you chose to wait — a yes that sounded like a no.
  "dialog.safehouse.waitDark": "dialog.respond.waitDark",
  "dialog.cubby.hide": "dialog.respond.cubbyHide",
};

export function journalLine(e) {
  const kind = (k) => CONTRACT_KEYS[k] ?? "contract.courier";
  switch (e.type) {
    case "firmDeployed": return { key: "journal.deployed", args: [] };
    case "contractAccepted": return { key: "journal.accepted", args: [kind(e.kind)] };
    case "contractCompleted": return { key: "journal.completed", args: [kind(e.kind), e.reward ?? 0] };
    case "contractFailed": return { key: "journal.failed", args: [e.reason ?? ""] };
    case "contractExpired": return { key: "journal.expired", args: [] };
    case "agentBurned": return { key: "journal.burned", args: [] };
    case "agentCaptured": return { key: "journal.captured", args: [] };
    case "agentArrested": return { key: "journal.arrested", args: [] };
    case "agentDowned": return { key: "journal.downed", args: [] };
    case "evacStarted": return { key: "journal.evacStarted", args: [] };
    case "evacReady": return { key: "journal.evacReady", args: [] };
    case "evacCancelled": return { key: "journal.evacCancelled", args: [] };
    case "firmExtracted": return { key: "journal.extracted", args: [e.banked ?? 0] };
    case "perimeterAlarm": return { key: "journal.perimeterAlarm", args: [] };
    case "cacheLooted": return { key: "journal.cacheLooted", args: [e.amount ?? 0] };
    case "rivalHqRevealed": return { key: "journal.rivalRevealed", args: [] };
    case "bailPaid": return { key: "journal.bailPaid", args: [e.cost ?? 0] };
    case "coverBought": return { key: "journal.coverBought", args: [e.cost ?? 0] };
    case "itemBought": return { key: "journal.itemBought", args: [e.itemKey ?? "", e.cost ?? 0] };
    // The transcript half: record the RESPONSE line the NPC spoke.
    case "dialogueChosen":
      return { key: SPOKEN_LINES[e.optionKey] ?? "dialog.respond.refuse", args: [], spoken: true };
    // S17 mission areas — the indoor story belongs in the log too.
    case "areaEntered": return { key: "journal.areaEntered", args: [] };
    case "areaExited": return { key: "journal.areaExited", args: [] };
    case "areaAssetTaken": return { key: "journal.areaAssetTaken", args: [] };
    case "assetExtracted": return { key: "journal.assetExtracted", args: [] };
    case "surveillancePass":
      return { key: "journal.surveillancePass", args: [e.pass ?? 1, e.of ?? 1] };
    case "areaAlarm": return { key: "journal.areaAlarm", args: [e.stage ?? 1] };
    case "areaSuppressed": return { key: "journal.areaSuppressed", args: [] };
    case "guardDowned": return { key: "journal.guardDowned", args: [] };
    case "agentDumped": return { key: "journal.agentDumped", args: [] };
    // S09 waiting for dark.
    case "waitingForDark": return { key: "journal.waitingForDark", args: [] };
    case "waitedForDark": return { key: "journal.waitedForDark", args: [] };
    // S16 contested work (a pre-existing gap found in the same sweep).
    case "contractContested": return { key: "journal.contested", args: [] };
    case "contractLost": return { key: "journal.contractLost", args: [] };
    default: return null;
  }
}

// ── Dropship choreography (S05) ────────────────────────────────────────────
//
// Presentation only: the dropship never exists in engine state, and the server
// has already placed the HQ by the time this plays. It is pure theatre — but it
// is the first thing a player sees every session, and the design doc pins it at
// ~5 seconds with a scripted path, a door, and the HQ crate deploying.
//
// The MATHS lives here rather than in the renderer for the usual reason: the
// decision (where is it, what phase, has the HQ appeared yet) is testable
// without a WebGL context, and the renderer is not.
export const DROPSHIP_MS = 5000;

// Where the ship is, and what the scene should show, `elapsed` ms into the
// sequence. Returns null when there is nothing to draw, so the caller has one
// thing to check rather than a phase enum plus a validity flag.
//
// `dir` is +1 inbound (arrive, drop, leave) and -1 outbound (arrive, collect,
// leave) — the same path, with the HQ appearing at the midpoint on the way in
// and disappearing on the way out.
export function dropshipFlight(elapsed, dir = 1, cfg = {}) {
  const total = cfg.durationMs ?? DROPSHIP_MS;
  if (!(elapsed >= 0) || elapsed >= total) return null;
  const t = elapsed / total;                      // 0..1
  // Retuned for the street-level camera (playtest 8): at 26 cells out and 14
  // high the whole flight happened OFF SCREEN and the drop read as the agent
  // popping into existence. Now the ship crosses the visible frame.
  const approach = cfg.approachCells ?? 8;        // how far out it starts
  const cruise = cfg.cruiseHeight ?? 3.5;         // and how high

  // Three beats: run in (0-0.4), hold and drop (0.4-0.6), climb out (0.6-1).
  // Held at the HQ for a fifth of the sequence so the crate has a moment that
  // reads as an event rather than a frame.
  const phase = t < 0.4 ? "inbound" : t < 0.6 ? "hover" : "outbound";
  let along;                                      // -1 = far out, 0 = overhead
  let height;
  if (phase === "inbound") {
    const k = t / 0.4;
    along = -(1 - k);
    height = cruise * (1 - 0.75 * k);
  } else if (phase === "hover") {
    along = 0;
    height = cruise * 0.25;
  } else {
    const k = (t - 0.6) / 0.4;
    along = k;
    height = cruise * (0.25 + 0.75 * k);
  }

  return {
    phase,
    // Offset from the HQ, in cells, along the approach axis.
    offsetCells: along * approach * (dir >= 0 ? 1 : -1),
    height,
    // The HQ is revealed at the hover on the way in, and hidden at it on the
    // way out. This is the one thing the choreography actually gates.
    hqVisible: dir >= 0 ? t >= 0.5 : t < 0.5,
  };
}

// ── S17 mission areas: the client-side decisions ───────────────────────────
// The same gates the AI uses, phrased for buttons. Kind indices are wire
// vocabulary (like CONTRACT_KEYS above): 1 surveillance, 2 extraction.

const AREA_KINDS = [1, 2];

// The BEGIN button: at the site of an accepted, non-recovery surveillance or
// extraction contract that has reached its work stage, and not already inside.
export function beginMission(view) {
  const a = ownAgent(view);
  if (!a || a.state !== 1 || a.insideAreaId >= 0 || a.insideBuildingId >= 0) return null;
  const ax = Math.floor(a.x / 256), ay = Math.floor(a.y / 256);
  for (const c of view?.active ?? []) {
    if (!AREA_KINDS.includes(c.kind) || c.stage !== 2 || c.recovery) continue;
    const site = (view.sites ?? []).find((s) => s.id === c.siteId);
    if (!site) continue;
    if (Math.max(Math.abs(site.cellX - ax), Math.abs(site.cellY - ay)) <= 1) {
      return {
        contractId: c.id, kind: c.kind,
        labelKey: c.kind === 1 ? "area.beginSurveillance" : "area.beginExtraction",
      };
    }
  }
  return null;
}

// The area your agent is standing in, with the agent — or null on the street.
export function areaView(view) {
  const a = ownAgent(view);
  if (!a || a.insideAreaId < 0) return null;
  const area = (view?.areas ?? []).find((x) => x.id === a.insideAreaId);
  return area ? { area, self: a } : null;
}

// Which of the indoor actions are in reach RIGHT NOW. Adjacency only — the
// flank rule stays the reducer's secret; a refused takedown is a rejection
// toast, which is honest ("you were seen coming").
export function areaActions(view) {
  const av = areaView(view);
  if (!av) return { exit: false, takedown: false, hack: false };
  const { area, self } = av;
  const near = (x, y) =>
    Math.max(Math.abs(x - self.areaCol), Math.abs(y - self.areaRow)) <= 1;
  return {
    exit: (area.doors ?? []).some((d) => near(d.x, d.y)),
    takedown: (area.guards ?? []).some((g) => !g.down && near(g.x, g.y))
      || (area.occupants ?? []).some((o) => o.state === 1 && near(o.x, o.y)),
    hack: (area.terminals ?? []).some((t) => near(t.x, t.y)),
  };
}

// ── S17 ambient life: hover-car theatre (pure, testable) ───────────────────
// Cars are CLIENT-side decoration on the transit lanes — they react to
// nothing, so unlike civilians they earn no engine state. Everything about
// them derives from (tiles, tick), so every reload shows the same traffic.

const T_TRANSIT_TILE = 6;

// Maximal straight runs of transit lane, both axes, long enough to be worth
// driving. Cheap enough to run once per terrain load.
export function transitLanes(tiles, size, minLen = 12) {
  const lanes = [];
  const at = (x, y) => tiles[y * size + x];
  for (let y = 0; y < size; y++) {
    let run = 0;
    for (let x = 0; x <= size; x++) {
      if (x < size && at(x, y) === T_TRANSIT_TILE) { run += 1; continue; }
      if (run >= minLen) lanes.push({ x: x - run, y, dx: 1, dy: 0, len: run });
      run = 0;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 0;
    for (let y = 0; y <= size; y++) {
      if (y < size && at(x, y) === T_TRANSIT_TILE) { run += 1; continue; }
      if (run >= minLen) lanes.push({ x, y: y - run, dx: 0, dy: 1, len: run });
      run = 0;
    }
  }
  return lanes;
}

// Where every car is RIGHT NOW. Cars ride a lane end to end, vanish off the
// edge for a gap, and come back — the wrap is the respawn. Odd cars drive
// the other way so a two-lane avenue reads as two-way traffic.
export function hoverCarsAt(tick, lanes, count) {
  const out = [];
  if (!lanes?.length || count <= 0) return out;
  const SPEED = 0.12, GAP = 18;
  for (let i = 0; i < count; i++) {
    const lane = lanes[i % lanes.length];
    const period = lane.len + GAP;
    const phase = (i * 7919) % period;
    const t = (tick * SPEED + phase) % period;
    if (t >= lane.len) continue;   // in the gap: off the map edge
    const dir = i % 2 === 0 ? 1 : -1;
    // Clamped to the run: the fractional param can poke one cell past either
    // end, and a car one cell off a map-edge avenue is a car in the void.
    const d = Math.max(0, Math.min(lane.len - 1, dir > 0 ? t : lane.len - 1 - t));
    out.push({
      x: lane.x + lane.dx * d, y: lane.y + lane.dy * d,
      dx: lane.dx * dir, dy: lane.dy * dir,
    });
  }
  return out;
}
