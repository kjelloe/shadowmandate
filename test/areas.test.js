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
  areaGridFor, areaTemplateFor, buildAreaGrid,
  AREA_WAREHOUSE, AREA_OFFICE, AREA_INDUSTRIAL, AREA_TRANSIT,
  AT_WALL, AT_DOOR, AT_COVER, CARRY_AREA_ASSET,
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

const TEMPLATES = [AREA_WAREHOUSE, AREA_OFFICE, AREA_INDUSTRIAL, AREA_TRANSIT];

test("every template is playable: doors exist, objective reachable, all in bounds", () => {
  // The area RNG NaN defect produced a template with NO doors and no
  // objective — and typed-array writes with fractional indices no-op
  // silently, so nothing crashed. Assert the geometry across seeds and sites.
  //
  // This test has been called "every template" since D63c while only ever
  // exercising ONE. With four real floor plans (playtest 13, finding 6) it now
  // means what it says: a plan that walls its own objective in is a contract
  // that cannot be completed anywhere in the world, and it must be impossible
  // to ship one.
  for (const seed of [1000, 1411, 4711, 90210]) {
    for (const siteId of [0, 3, 7]) {
      for (const template of TEMPLATES) {
        const where = `seed ${seed} site ${siteId} template ${template}`;
        const { tiles, objective: obj } = buildAreaGrid(seed, siteId, CFG, template);
        const entries = areaEntryDoors(tiles, W, H);
        const doors = areaDoors(tiles, W, H);
        assert.equal(entries.length, 2, `${where}: entry doors`);
        assert.ok(doors.length > entries.length,
          `${where}: no interior doors — the objective is walled in`);
        assert.ok(obj.x > 0 && obj.x < W - 1 && obj.y > 0 && obj.y < H - 1,
          `${where}: objective out of bounds`);
        assert.notEqual(tiles[obj.y * W + obj.x], AT_WALL, `${where}: objective is a wall`);
        const path = findPath(areaMap(tiles), entries[0].x, entries[0].y, obj.x, obj.y);
        assert.ok(path.length > 0, `${where}: no path from the entry door to the objective`);
      }
    }
  }
});

test("PLAYTEST 13: the four plans are actually DIFFERENT buildings", () => {
  // A template set that quietly collapses to one plan passes every playability
  // check above and delivers nothing — "a feature can silently do nothing" is
  // this project's signature failure, and four names over one floor plan is
  // exactly that shape. Compare the grids.
  const seed = 4711, siteId = 0;
  const grids = TEMPLATES.map((t) => buildAreaGrid(seed, siteId, CFG, t).tiles);
  for (let i = 0; i < grids.length; i++) {
    for (let j = i + 1; j < grids.length; j++) {
      let same = 0;
      for (let k = 0; k < grids[i].length; k++) if (grids[i][k] === grids[j][k]) same++;
      const pct = (same / grids[i].length) * 100;
      assert.ok(pct < 85,
        `templates ${i} and ${j} are ${pct.toFixed(1)}% identical — they are the same building`);
    }
  }
  // Each plan must carry BOTH structure and cover: an interior with no walls is
  // a field, and one with no cover is a corridor you cannot survive.
  TEMPLATES.forEach((t, i) => {
    const tiles = buildAreaGrid(seed, siteId, CFG, t).tiles;
    const walls = [...tiles].filter((c) => c === AT_WALL).length;
    const cover = [...tiles].filter((c) => c === AT_COVER).length;
    const perimeter = 2 * (W + H) - 4;
    assert.ok(walls > perimeter + 12, `template ${i} has no interior structure (${walls} walls)`);
    assert.ok(cover >= 6, `template ${i} has no cover to break sight behind (${cover})`);
  });
});

test("PLAYTEST 13: no guard waypoint is a wall, a sealed room, or the objective", () => {
  // THREE defects, all introduced the moment there was more than one floor plan
  // for the ring to be drawn around, and all three cost pinned seeds in the M5
  // gate. The ring's geometry was safe against ONE hand-checked layout; nothing
  // asserted it stayed safe against any other.
  //
  //  1. A waypoint inside a WALL parks the guard forever — the route advances
  //     only on arrival. The office plan put 25% of its waypoints inside the
  //     objective room's north wall.
  //  2. A waypoint in a SEALED room parks it just as permanently. Legalising
  //     against "not a wall" alone moved waypoints inside cellular rooms.
  //  3. A waypoint within sight of the OBJECTIVE is the 8a camera-on-the-site
  //     defect indoors: surveillance needs an unseen hold there, so the
  //     contract becomes impossible at every site using that plan. Snapping
  //     naively put office waypoints at Chebyshev 1 of the objective.
  const sight = CFG.guardSightRadius | 0;
  for (const seed of [1000, 1411, 4711, 90210, 2026]) {
    for (const siteId of [0, 3, 7, 11]) {
      for (const template of TEMPLATES) {
        const grid = buildAreaGrid(seed, siteId, CFG, template);
        const where = `seed ${seed} site ${siteId} template ${template}`;
        for (let gi = 0; gi < (CFG.guardsPerArea | 0); gi++) {
          for (const wp of guardRoute(seed, siteId, CFG, gi, grid)) {
            const i = wp.y * W + wp.x;
            assert.notEqual(grid.tiles[i], AT_WALL, `${where} guard ${gi}: waypoint in a wall`);
            assert.equal(grid.open[i], 1,
              `${where} guard ${gi}: waypoint ${wp.x},${wp.y} is sealed off — the guard parks there`);
            const d = Math.max(Math.abs(wp.x - grid.objective.x), Math.abs(wp.y - grid.objective.y));
            assert.ok(d > sight,
              `${where} guard ${gi}: waypoint ${wp.x},${wp.y} sits ${d} from the objective — it covers the work`);
          }
        }
        // The objective must itself be on the connected floor. `passable` and
        // `reachable` are different claims and only one of them is playable.
        assert.equal(grid.open[grid.objective.y * W + grid.objective.x], 1,
          `${where}: the objective is walled off from the entry`);
        // NO SEALED POCKETS ANYWHERE. Every floor cell must be reachable from
        // the entry strip — a pocket of floor nothing can walk to is somewhere
        // a guard waypoint or a terminal can land and never be used, and it
        // reads to a player as a room whose door the game forgot. This is the
        // assertion that gives `grid.open` teeth: the waypoint checks above pass
        // on today's plans whether reachability is enforced or not, so without
        // this the machinery would be guarding nothing it could prove.
        let sealed = 0;
        for (let i = 0; i < grid.tiles.length; i++) {
          if (grid.tiles[i] !== AT_WALL && !grid.open[i]) sealed++;
        }
        assert.equal(sealed, 0, `${where}: ${sealed} floor cells are sealed off from the entry`);
      }
    }
  }
});

test("PLAYTEST 13: the objective room has two ways in", () => {
  // "Every mechanism must have a usable gap" (S16 8b) is a rule about floor
  // plans too. A room with one door is a choke a single guard seals by standing
  // in it, and it is the room holding the thing the contract is about. Adding
  // the second door is what took the M5 gate's last red seed green.
  for (const seed of [1000, 1411, 4711, 90210, 2026]) {
    for (const siteId of [0, 3, 7]) {
      for (const template of TEMPLATES) {
        const { tiles, objective } = buildAreaGrid(seed, siteId, CFG, template);
        // Flood the objective's ROOM — treating doors as boundaries — then count
        // the doors touching it. Walking outward from the objective in four
        // directions was the first attempt and it measured door ALIGNMENT, not
        // doors: it only ever found an exit that happened to share the
        // objective's own row or column, and reported a two-door room as having
        // none. Measure the thing, not a proxy for it.
        const room = new Set([objective.y * W + objective.x]);
        const stack = [objective];
        while (stack.length) {
          const c = stack.pop();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = c.x + dx, y = c.y + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const i = y * W + x;
            if (room.has(i)) continue;
            const cell = tiles[i];
            if (cell === AT_WALL || cell === AT_DOOR) continue;
            room.add(i);
            stack.push({ x, y });
          }
        }
        let ways = 0;
        for (const i of room) {
          const x = i % W, y = (i / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (tiles[ny * W + nx] === AT_DOOR) ways++;
          }
        }
        assert.ok(ways >= 2,
          `seed ${seed} site ${siteId} template ${template}: the objective room has ${ways} way(s) in`);
      }
    }
  }
});

test("PLAYTEST 13: the plan is derived from the SITE, and every reader agrees", () => {
  // The bug this makes impossible: the client drawing an office while the
  // reducer paths through a warehouse. Both would look completely correct on
  // their own, and the player would walk into walls that are not on screen.
  const s = makeWorld({ seed: 4711 });
  const seen = new Set();
  for (const site of s.sites) seen.add(areaTemplateFor(s, site.id));
  assert.ok(seen.size >= 2,
    `a whole city produced only template(s) ${[...seen]} — site type is not reaching the plan`);

  // The single entry point and the raw builder must agree for every site.
  for (const site of s.sites.slice(0, 12)) {
    const viaState = areaGridFor(s, site.id, CFG);
    const direct = buildAreaGrid(s.worldSeed, site.id, CFG, areaTemplateFor(s, site.id));
    assert.deepEqual(viaState.objective, direct.objective, `site ${site.id}: objectives disagree`);
    assert.deepEqual([...viaState.tiles], [...direct.tiles], `site ${site.id}: grids disagree`);
  }

  // And a caller who forgets the template must be stopped loudly rather than
  // silently handed a warehouse.
  assert.throws(() => buildAreaGrid(4711, 0, CFG), /no template/);
});

test("the guard ring never covers an approach unconditionally (8a, indoors)", () => {
  // The first ring ran rows 7 and h-3: one cell from the wing doors, two from
  // the entry — every entrant burned within thirty ticks of the door. The
  // ring must stay outside SNEAK sight (radius − 1) of every entry door, so
  // arriving is always survivable; crossing the ring is the game.
  const sneakSight = (CFG.guardSightRadius | 0) - 1;
  for (const seed of [1000, 1411, 4711]) {
    for (const siteId of [0, 7]) {
      const tiles = areaTiles(seed, siteId, CFG, AREA_WAREHOUSE);
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
  const tiles = areaGridFor(s, site.id, CFG).tiles;
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
  const obj = areaGridFor(s, site.id, CFG).objective;
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
