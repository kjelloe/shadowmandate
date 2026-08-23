// test/areas.test.js — S17 mission areas: the indoor stealth game (D63c/D64).
//
// The doctrine this file enforces is M8's, indoors: every mechanism has a
// usable gap, the fixture never covers the approach unconditionally, the
// asset (not the door) carries the 8f credential gate, and takedowns are
// bloodless and positional.

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../engine/reducer.js";
import {
  CMD_ADVANCE_TICK, CMD_MOVE, CMD_ENTER_AREA, CMD_EXIT_AREA,
  CMD_TAKEDOWN, CMD_HACK_TERMINAL,
} from "../engine/commands.js";
import {
  areaTiles, areaObjective, areaDoors, areaEntryDoors, guardRoute,
  AT_WALL, AT_DOOR, CARRY_AREA_ASSET,
} from "../engine/areas.js";
import { findPath } from "../engine/pathfind.js";
import { grantCredential } from "../engine/access.js";
import { buildView } from "../engine/view.js";
import { makeWorld, placeAgent, tickCollecting, RULES } from "./helpers.js";

const CFG = RULES.areas;
const W = CFG.width | 0, H = CFG.height | 0;

function areaMap(tiles) {
  // findPath's map contract: walls impassable. Mirror areaMapOf's shape.
  return { width: W, height: H, cells: tiles };
}

// A world with one agent standing on a site, inside that site's area.
function insideWorld({ seed = 4711, siteIdx = 0 } = {}) {
  let s = makeWorld({ seed });
  const site = s.sites[siteIdx];
  placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  s = apply(s, { type: CMD_ENTER_AREA, agentId: 0 });
  const agent = s.agents[0];
  assert.equal(agent.insideAreaId >= 0, true, "fixture: agent failed to enter");
  return { s, agent, site };
}

test("every template is playable: doors exist, objective reachable, all in bounds", () => {
  // The area RNG NaN defect produced a template with NO doors and no
  // objective — and typed-array writes with fractional indices no-op
  // silently, so nothing crashed. Assert the geometry across seeds and sites.
  for (const seed of [1000, 1411, 4711, 90210]) {
    for (const siteId of [0, 3, 7]) {
      const tiles = areaTiles(seed, siteId, CFG);
      const entries = areaEntryDoors(tiles, W, H);
      const doors = areaDoors(tiles, W, H);
      assert.equal(entries.length, 2, `seed ${seed} site ${siteId}: entry doors`);
      assert.ok(doors.length > entries.length,
        `seed ${seed} site ${siteId}: no wing doors — the objective is walled in`);
      const obj = areaObjective(seed, siteId, CFG);
      assert.ok(obj.x > 0 && obj.x < W - 1 && obj.y > 0 && obj.y < H - 1,
        `seed ${seed} site ${siteId}: objective out of bounds`);
      const path = findPath(areaMap(tiles), entries[0].x, entries[0].y, obj.x, obj.y);
      assert.ok(path.length > 0,
        `seed ${seed} site ${siteId}: no path from the entry door to the objective`);
    }
  }
});

test("the guard ring never covers an approach unconditionally (8a, indoors)", () => {
  // The first ring ran rows 7 and h-3: one cell from the wing doors, two from
  // the entry — every entrant burned within thirty ticks of the door. The
  // ring must stay outside SNEAK sight (radius − 1) of every entry door, so
  // arriving is always survivable; crossing the ring is the game.
  const sneakSight = (CFG.guardSightRadius | 0) - 1;
  for (const seed of [1000, 1411, 4711]) {
    for (const siteId of [0, 7]) {
      const tiles = areaTiles(seed, siteId, CFG);
      for (const d of areaEntryDoors(tiles, W, H)) {
        for (let gi = 0; gi < (CFG.guardsPerArea | 0); gi++) {
          for (const wp of guardRoute(seed, siteId, CFG, gi)) {
            const dist = Math.max(Math.abs(wp.x - d.x), Math.abs(wp.y - d.y));
            assert.ok(dist > sneakSight,
              `seed ${seed} site ${siteId}: waypoint ${wp.x},${wp.y} covers entry ${d.x},${d.y}`);
          }
        }
      }
    }
  }
});

test("enter places you at the entry door; exit puts you back on the street", () => {
  const { s, agent, site } = insideWorld();
  const tiles = areaTiles(s.worldSeed, site.id, CFG);
  const door = areaEntryDoors(tiles, W, H)[0];
  assert.equal(agent.areaCol, door.x);
  assert.equal(agent.areaRow, door.y);
  const out = apply(s, { type: CMD_EXIT_AREA, agentId: 0 });
  assert.equal(out.agents[0].insideAreaId, -1);
  assert.equal(Math.trunc(out.agents[0].x / 256), site.cellX, "exit must restore the street");
});

test("exit from deep inside is refused — you leave the way compounds are left", () => {
  const { s, agent } = insideWorld();
  agent.areaCol = 12; agent.areaRow = 8;
  const out = apply(s, { type: CMD_EXIT_AREA, agentId: 0 });
  assert.ok(out.events.some((e) => e.type === "rejected" && e.reason === "not_at_door"));
  assert.ok(out.agents[0].insideAreaId >= 0);
});

test("8f indoors: the ASSET is credential-gated at a secured site, the door is not", () => {
  let s = makeWorld({ seed: 4711 });
  const site = s.sites.find((x) => (x.securityTier | 0) > 0);
  assert.ok(site, "fixture: no secured site in this seed");
  placeAgent(s, { cellX: site.cellX, cellY: site.cellY });
  s = apply(s, { type: CMD_ENTER_AREA, agentId: 0 });
  assert.ok(s.agents[0].insideAreaId >= 0,
    "the door must open without a badge — surveillance needs no credential");
  // Walk onto the objective without the credential: nothing moves.
  const obj = areaObjective(s.worldSeed, site.id, CFG);
  const area = s.areas.find((a) => a.siteId === site.id);
  s.agents[0].areaCol = obj.x; s.agents[0].areaRow = obj.y - 1;
  s = apply(s, { type: CMD_MOVE, agentId: 0, cellX: obj.x, cellY: obj.y });
  for (const g of area.guards) g.downedUntil = 1_000_000;
  let run = tickCollecting(s, apply, 20);
  assert.equal(run.state.agents[0].carryKind, 0, "the asset moved without a credential");
  assert.equal(run.state.areas.find((a) => a.siteId === site.id).assetTaken, 0);
  // With the tier's credential the same step takes it.
  grantCredential(run.state, 0, site.securityTier | 0, "test");
  run.state.agents[0].areaCol = obj.x; run.state.agents[0].areaRow = obj.y - 1;
  let s2 = apply(run.state, { type: CMD_MOVE, agentId: 0, cellX: obj.x, cellY: obj.y });
  run = tickCollecting(s2, apply, 20);
  assert.ok(run.saw("areaAssetTaken"), "credentialed pickup never fired");
  assert.equal(run.state.agents[0].carryKind, CARRY_AREA_ASSET);
});

test("takedown is positional: refused face-on, lands from behind (D64)", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  const g = area.guards[0];
  agent.areaCol = 10; agent.areaRow = 8;
  g.x = 11; g.y = 8; g.facing = 2;   // facing WEST — straight at the agent
  const front = apply(s, { type: CMD_TAKEDOWN, agentId: 0 });
  assert.ok(front.events.some((e) => e.type === "rejected" && e.reason === "no_target"),
    "a takedown into the guard's face must be refused");
  g.facing = 0;   // facing EAST — the agent is behind
  const behind = apply(s, { type: CMD_TAKEDOWN, agentId: 0 });
  assert.ok(behind.events.some((e) => e.type === "guardDowned"), "flank takedown failed");
  const downed = behind.areas[0].guards[0];
  assert.ok(downed.downedUntil > behind.tick, "guard not down");
  assert.ok(downed.downedUntil <= behind.tick + (CFG.guardDownTicks | 0),
    "disable-only (D6): down is a WINDOW, not forever");
});

test("a downed guard neither sees nor moves until the window ends", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  for (const g of area.guards) g.downedUntil = 1_000_000;
  const g = area.guards[0];
  agent.areaCol = g.x; agent.areaRow = g.y + 1;   // point blank
  agent.stance = 2;                               // hurrying, in the open
  const run = tickCollecting(s, apply, 60);
  assert.ok(!run.saw("agentNoticed"), "a downed guard noticed someone");
  assert.equal(run.state.areas[0].guards[0].x, g.x, "a downed guard moved");
});

test("PvP takedown dumps the victim at the door and reopens the mission", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  // A rival agent inside, carrying the asset.
  const rival = placeAgent(s, { agentId: 1, firmId: 1, cellX: 1, cellY: 1 });
  rival.insideAreaId = area.id;
  rival.areaCol = agent.areaCol + 1; rival.areaRow = agent.areaRow;
  rival.carryKind = CARRY_AREA_ASSET; rival.carryRef = area.siteId;
  area.assetTaken = 1;
  const out = apply(s, { type: CMD_TAKEDOWN, agentId: 0 });
  assert.ok(out.events.some((e) => e.type === "agentDumped"), "no dump event");
  const v = out.agents[1];
  assert.equal(v.insideAreaId, -1, "victim must be dumped OUTSIDE");
  assert.equal(v.state, 2, "victim must be DOWNED for the street to find");
  assert.equal(v.carryKind, 0, "the asset must fall");
  assert.equal(out.areas[0].assetTaken, 0, "the mission must reopen");
  assert.ok(out.areas[0].alarmStage > 0, "sabotage must raise the area alarm");
});

test("the terminal suppresses the alarm and blinds the guards for a window", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  area.alarmStage = 2;
  area.guards[0].alertTicks = 50;
  const term = area.terminals[0];
  agent.areaCol = term.x; agent.areaRow = term.y;
  const out = apply(s, { type: CMD_HACK_TERMINAL, agentId: 0 });
  assert.ok(out.events.some((e) => e.type === "areaSuppressed"));
  assert.equal(out.areas[0].alarmStage, 0);
  assert.equal(out.areas[0].guards[0].alertTicks, 0);
  assert.ok(out.areas[0].suppressedUntil > out.tick);
  // While suppressed, a tripped alarm does not restage.
  const during = tickCollecting(out, apply, 5);
  assert.equal(during.state.areas[0].alarmStage, 0);
});

test("night shortens guard sight indoors exactly as it does outside (D63a)", () => {
  // Same geometry, two clocks: a distance the day guard sees and the night
  // guard cannot. Behavioural, like the street daynight test — asserting the
  // multiplication would pass even if nobody called it.
  const dn = RULES.season.dayNight;
  const dayR = CFG.guardSightRadius | 0;
  const nightR = Math.trunc((dayR * dn.nightSightPct) / 100);
  const dist = nightR + 1;   // seen by day, dark at night
  const run = (tick) => {
    const { s, agent } = insideWorld();
    s.tick = tick;
    const area = s.areas[0];
    for (const g of area.guards.slice(1)) g.downedUntil = 1_000_000;
    const g = area.guards[0];
    g.x = 12; g.y = 8;
    agent.areaCol = 12 - dist; agent.areaRow = 8;
    agent.stance = 1;   // upright: stance shaves nothing extra off sneak's -1
    return tickCollecting(s, apply, 3);
  };
  assert.ok(run(0).saw("agentNoticed"), "day guard missed at a distance day sight covers");
  assert.ok(!run(dn.dayTicks + 10).saw("agentNoticed"),
    "night guard saw through the dark — the night factor is not reaching stepGuards");
});

test("an alerted compound keeps breathing while empty — bail out and it cools", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  area.alarmStage = 1;
  const out = apply(s, { type: CMD_EXIT_AREA, agentId: 0 });
  assert.equal(out.agents[0].insideAreaId, -1);
  const cooled = tickCollecting(out, apply, (CFG.alarmStageTicks | 0) + 10);
  assert.equal(cooled.state.areas[0].alarmStage, 0,
    "the alarm froze the moment the compound emptied — exit-and-cool is dead");
});

test("converging guards stop a cell short — nobody stands on the agent", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  for (const g of area.guards.slice(1)) g.downedUntil = 1_000_000;
  const g = area.guards[0];
  g.x = 10; g.y = 8;
  agent.areaCol = 12; agent.areaRow = 8;
  agent.stance = 2;   // hurrying in the open: get seen, stay seen
  const run = tickCollecting(s, apply, 400);
  const after = run.state.areas[0].guards[0];
  const d = Math.max(Math.abs(after.x - run.state.agents[0].areaCol),
    Math.abs(after.y - run.state.agents[0].areaRow));
  assert.ok(d >= 1, "guard stacked onto the agent's cell");
  assert.ok(run.saw("agentBurned"), "point-blank staring never burned — the ladder is dead");
});

test("the area view sends the now, never the schedule (D45)", () => {
  const { s, agent } = insideWorld();
  const area = s.areas[0];
  area.guards[0].downedUntil = s.tick + 500;
  const rival = placeAgent(s, { agentId: 1, firmId: 1, cellX: 1, cellY: 1 });
  rival.insideAreaId = area.id;
  rival.areaCol = 12; rival.areaRow = 12;

  const view = buildView(s, 0, RULES.detection);
  assert.equal(view.areas.length, 1, "the compound you are in must be in your view");
  const av = view.areas[0];
  const g = av.guards[0];
  assert.deepEqual(Object.keys(g).sort(), ["alerted", "down", "facing", "id", "x", "y"],
    "a guard crosses the wire as position + facing + booleans, NOTHING else");
  assert.equal(g.down, 1, "the downed guard must read as down");
  assert.ok(!("downedUntil" in g) && !("wp" in g) && !("cool" in g),
    "timestamps and waypoints are the schedule — never send them");
  assert.ok(av.occupants.some((o) => o.firmId === 1),
    "a rival in the same compound is visible — no fog indoors");
  assert.ok(!("suppressedUntil" in av), "suppression is a boolean, not a countdown");

  // A firm with nobody inside sees NO interior at all.
  const outsideView = buildView(s, 2, RULES.detection);
  assert.equal((outsideView.areas ?? []).length, 0,
    "a compound leaks its interior to a firm with nobody inside");
});
