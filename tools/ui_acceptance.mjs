// tools/ui_acceptance.mjs — the buttons must DO things (S12 gate, 7h).
//
// client_smoke.mjs proves the page loads and the world ticks. This proves the
// controls are wired: that a real click reaches a real handler and changes
// observable state. Playtest 5 shipped a contract button that could never be
// clicked — the list rebuilt at 10Hz and destroyed its own button between
// mousedown and mouseup, so nothing happened and nothing errored. A green suite
// cannot see that. This can.
//
//   node tools/ui_acceptance.mjs           # needs playwright
//   HEADED=1 node tools/ui_acceptance.mjs  # watch it
//
// Exit 0 = all pass · 1 = failures listed · 2 = playwright missing.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

const HEADED = process.env.HEADED === "1";
const PORT = Number(process.env.UI_PORT ?? 8978);

function startServer() {
  const proc = spawn(process.execPath, ["server/index.js"], {
    // TICK_MS: headless SwiftShader cannot render a 10Hz diorama and service
    // automation at the same time, so every interaction queues behind a frame
    // and the gate takes minutes. Slowing wall-clock pacing changes no
    // simulation outcome (the reducer counts ticks, it never reads a clock) and
    // still reproduces the defects this gate exists for — a list that rebuilds
    // per view update rebuilds at any rate.
    env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64",
      TICK_MS: process.env.TICK_MS ?? "250",
      // A THROWAWAY ledger: this gate buys things through the real socket
      // (playtest 6), and against the shared reports/ledger.json every run
      // would debit the same persisted firm until the gate went red from
      // accumulated poverty.
      LEDGER_PATH: joinPath(mkdtempSync(joinPath(tmpdir(), "sm-uigate-")), "ledger.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  proc.stdout.on("data", (d) => log.push(String(d)));
  proc.stderr.on("data", (d) => log.push(String(d)));
  return { proc, log };
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return true; } catch { /* not up */ }
    await sleep(500);
  }
  return false;
}

async function main() {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { console.error("playwright not installed: npm i -D playwright"); process.exit(2); }

  const { proc, log } = startServer();
  const failures = [];
  const check = (name, ok, detail = "") => {
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  };
  let browser;

  try {
    if (!await waitForHealth()) { console.error("server never healthy:\n" + log.join("")); process.exit(1); }
    const url = `http://127.0.0.1:${PORT}`;
    browser = await chromium.launch({ headless: !HEADED });
    // Keep frames cheap: headless SwiftShader runs rAF unthrottled and a busy
    // scene starves the click queue. Harness artefact, not a client bug.
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
    page.setDefaultTimeout(8000);

    // Every page.evaluate gets a deadline. Without one, a control that wedges
    // the page hangs the whole gate with no output at all — which is strictly
    // worse than a failing gate, because a hang looks like an infrastructure
    // problem rather than the bug it is.
    const evalT = async (fn, arg, label = "evaluate", ms = 20000) => {
      let timer;
      try {
        return await Promise.race([
          page.evaluate(fn, arg),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`TIMED OUT after ${ms}ms: ${label}`)), ms); }),
        ]);
      } finally { clearTimeout(timer); }
    };

    // HIT TEST and DISPATCH are deliberately separate. Playwright's .click()
    // couples them, so a starved click queue looks identical to a buried
    // button. Separated, the layout question is a pure query that cannot time
    // out, and the handler question is answered by firing it directly.
    const hitTest = (id) => page.evaluate((elId) => {
      const el = document.getElementById(elId);
      if (!el) return { ok: false, why: "missing" };
      if (el.hidden || el.offsetParent === null) return { ok: false, why: "hidden" };
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { ok: false, why: "zero-size" };
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const covered = !(hit === el || el.contains(hit) || hit?.contains(el));
      return covered ? { ok: false, why: `covered by ${hit?.id || hit?.tagName}` } : { ok: true };
    }, id);

    await page.goto(url, { waitUntil: "networkidle" });

    // --- drop in -----------------------------------------------------------
    const dropHit = await hitTest("drop-in");
    check("drop-in button is clickable (not buried)", dropHit.ok, dropHit.why);
    await page.click("#drop-in");
    let deployed = false;
    for (let i = 0; i < 60 && !deployed; i++) {
      await sleep(500);
      deployed = await page.evaluate(() => window.__smDebug?.screen === "world");
    }
    check("drop-in reaches the world screen", deployed);
    if (!deployed) throw new Error("cannot test HUD controls without deploying");

    // --- first-deployment intro (playtest 3) -------------------------------
    // A fresh browser context IS a first deployment, so the guided overlay
    // must appear — and its dismiss must actually dismiss, or every control
    // below is buried under it and the whole HUD is unusable for a new player.
    const introShown = await page.evaluate(() => !document.getElementById("intro").hidden);
    check("first deployment shows the intro overlay", introShown);
    if (introShown) {
      await evalT(() => document.getElementById("intro-dismiss").click(), undefined, "dismiss intro");
      await sleep(300);
      const gone = await page.evaluate(() =>
        document.getElementById("intro").hidden && !!localStorage.getItem("sm_intro_seen"));
      check("dismissing the intro hides it and remembers", gone);
    }

    // --- enter and LEAVE the HQ building (playtest 5) ----------------------
    // The drop lands on the HQ safehouse door, so GO INSIDE is live at spawn —
    // and the overlay's Leave button must actually EXIT the building. Before
    // this check, the close button only hid the panel while the agent stayed
    // inside engine-side, and a market (no dialogue rows) was a building you
    // could never leave. No unit test can see that; only this flow can.
    const enterVisible = await page.evaluate(() => !document.getElementById("enter-btn").hidden);
    check("GO INSIDE is offered on the HQ door at spawn", enterVisible);

    // S17: the four indoor controls exist and stay HIDDEN on the street with
    // no workable contract — a BEGIN button that shows at spawn would be a
    // dead control, and a missing one would be the whole indoor game
    // unreachable. (The full enter/exit flow runs in dbg_area_look.mjs; this
    // is the DOM contract.)
    const areaButtons = await page.evaluate(() =>
      ["begin-btn", "exit-area-btn", "takedown-btn", "hack-btn"].map((id) => {
        const el = document.getElementById(id);
        return { id, exists: !!el, hidden: el ? el.hidden : null };
      }));
    check("the four mission-area buttons exist and are hidden at spawn",
      areaButtons.every((b) => b.exists && b.hidden), JSON.stringify(areaButtons));
    if (enterVisible) {
      await evalT(() => document.getElementById("enter-btn").click(), undefined, "click enter");
      let inside = false;
      for (let i = 0; i < 20 && !inside; i++) {
        await sleep(300);
        inside = await page.evaluate(() => !document.getElementById("building").hidden);
      }
      check("entering opens the building overlay", inside);
      if (inside) {
        // BUY something through the real socket (playtest 6): the unit tests
        // passed `bank` on the command by hand, so the server's injection —
        // keyed on a field the client never sends — was broken while every
        // test was green. Only this path exercises the truth. Row 2 is heat
        // intel (30), which always succeeds; row 1 (reveal rival) can
        // legitimately fail with nobody deployed.
        const bankBefore = await page.evaluate(() =>
          Number(document.getElementById("bank").textContent.replace(/\D+/g, "")));
        await evalT(() => document.querySelector(
          "#building-options li:nth-child(2) button").click(), undefined, "click buy");
        let bankAfter = bankBefore;
        for (let i = 0; i < 20 && bankAfter === bankBefore; i++) {
          await sleep(300);
          bankAfter = await page.evaluate(() =>
            Number(document.getElementById("bank").textContent.replace(/\D+/g, "")));
        }
        check("buying heat intel actually debits the visible bank", bankAfter < bankBefore,
          `bank stayed at ${bankBefore} — the purchase was refused or free`);
        await evalT(() => document.querySelector("#building .close").click(), undefined, "click leave");
        let out = false;
        for (let i = 0; i < 20 && !out; i++) {
          await sleep(300);
          out = await page.evaluate(() => document.getElementById("building").hidden);
        }
        check("the overlay's Leave actually exits the building", out,
          "the panel stayed up — the agent is still inside engine-side");
      }
    }

    // --- stance ------------------------------------------------------------
    // The stance buttons must change the stance the SERVER agrees we have, not
    // merely the button's own styling.
    const stanceBefore = await page.evaluate(() => window.__smDebug.agent?.stance);
    const stanceBtns = await page.evaluate(() =>
      [...document.querySelectorAll("#stance button")].map((b) => b.dataset.stance ?? b.textContent.trim()));
    check("stance selector has buttons", stanceBtns.length >= 2, JSON.stringify(stanceBtns));
    const changed = await (async () => {
      for (const idx of [0, 1, 2]) {
        const clicked = await page.evaluate((i) => {
          const b = document.querySelectorAll("#stance button")[i];
          if (!b) return false;
          b.click();
          return true;
        }, idx);
        if (!clicked) continue;
        for (let i = 0; i < 20; i++) {
          await sleep(500);
          const now = await page.evaluate(() => window.__smDebug.agent?.stance);
          if (now !== stanceBefore) return true;
        }
      }
      return false;
    })();
    check("a stance button changes the agent's stance server-side", changed,
      `stance stayed ${stanceBefore}`);

    // --- mission board -----------------------------------------------------
    // The board folded into City Info as its DEFAULT tab (owner-ruled
    // 2026-08-29), so reaching it is one press of CITY INFO rather than of a
    // board button. The checks below are unchanged in substance: the pane must
    // open, offer contracts, survive fifteen ticks under the cursor, and accept
    // one. That third check is the playtest-5 defect, and folding a live button
    // list into a tabbed panel is exactly the kind of change that could bring
    // it back — the pane is shown and hidden rather than rebuilt for that
    // reason, and this is what proves it.
    const boardHit = await hitTest("city-btn");
    check("city info button is clickable", boardHit.ok, boardHit.why);
    let boardOpen = false, boardRows = 0;
    try {
      await evalT(() => document.getElementById("city-btn").click(), undefined, "click #city-btn");
      await sleep(500);
      boardOpen = await evalT(() => !document.getElementById("cityinfo").hidden
        && !document.getElementById("city-pane-board").hidden,
      undefined, "read the board pane");
      boardRows = await evalT(() => document.querySelectorAll("#board-list button").length,
        undefined, "count board rows");
    } catch (e) {
      failures.push(`board interaction: ${e.message}`);
      console.log(`FAIL board interaction — ${e.message}`);
    }
    check("city info opens on the board tab", boardOpen);
    check("board offers contracts (D18: five)", boardRows > 0, `${boardRows} rows`);

    // THE PLAYTEST-5 REGRESSION. A contract row must survive long enough to be
    // clicked: hit-test it, wait several 10Hz ticks, then confirm the SAME
    // element is still in the document. A list rebuilt every tick fails here.
    if (boardRows > 0) {
      const firstTick = await evalT(() => window.__smDebug.tick, undefined, "tick before survival");
      const rowHandle = await evalT(() => {
        const first = document.querySelector("#board-list button");
        if (!first) return false;
        window.__smRowUnderTest = first;   // hold a reference across ticks
        return true;
      }, undefined, "capture row");
      let ticksSeen = 0;
      while (ticksSeen < 15) {
        await sleep(500);
        ticksSeen = (await evalT(() => window.__smDebug.tick, undefined, "tick poll")) - firstTick;
      }
      const survives = await evalT(() => ({
        ok: !!window.__smRowUnderTest && document.contains(window.__smRowUnderTest),
        why: "the row was replaced mid-interaction — the list is rebuilding per tick",
      }), undefined, "row survival");
      if (!rowHandle) survives.ok = false;
      check("a contract row outlives 15 world ticks (playtest-5 defect)", survives.ok, survives.why);

      const activeBefore = await evalT(() => window.__smDebug.activeCount, undefined, "read activeCount");
      await evalT(() => document.querySelector("#board-list button")?.click(), undefined, "click contract row");
      let accepted = false;
      for (let i = 0; i < 25 && !accepted; i++) {
        await sleep(500);
        accepted = await page.evaluate((b) => window.__smDebug.activeCount > b, activeBefore);
      }
      check("clicking a contract actually accepts it", accepted,
        `active count stayed at ${activeBefore}`);
    }

    // --- objective ---------------------------------------------------------
    const objective = await evalT(() => {
      const el = document.getElementById("objective");
      return { hidden: el.hidden, text: el.textContent.trim() };
    });
    check("accepting a contract reveals the objective", !objective.hidden && objective.text.length > 0,
      JSON.stringify(objective));

    // --- no silent failures ------------------------------------------------
    // fatal() must put errors ON THE PAGE. An error bar that only exists in the
    // console is the "silent client" this project has already paid for.
    const hasFatal = await page.evaluate(() => typeof window.__smDebug === "object");
    // The mission banner (playtest 7): with a contract just accepted, the
    // top-centre banner must say WHAT the mission is. A player should never
    // have to open the board to remember what they are doing.
    const banner = await page.evaluate(() => ({
      hidden: document.getElementById("mission-banner").hidden,
      kind: document.getElementById("mission-kind").textContent,
      stage: document.getElementById("mission-stage").textContent,
    }));
    check("the mission banner names the accepted mission", !banner.hidden && banner.kind.length > 0,
      JSON.stringify(banner));

    check("client exposes its state for inspection", hasFatal);

    // --- City Info renders TEXT, not placeholders -------------------------
    // `t()` fills a missing arg with an EMPTY STRING, so a dropped
    // interpolation leaves a HOLE rather than a visible "{0}" — the season
    // splash shipped exactly that as "DAY  OF ....... 0 / 28" with every unit
    // test on the data passing, because the data was right.
    //
    // Checked on the FIRM tab's rank row specifically, rather than by scanning
    // every row for double spaces. That scan was tried and was useless twice
    // over: it false-positived on a legitimately double-spaced board label, and
    // it read the wrong pane. A guard aimed at the one row that actually
    // interpolates is worth more than a broad one that cries wolf.
    const rankRow = await evalT(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      // ENSURE open, never toggle: the board check above leaves City Info
      // open, so a blind click closed it — and `renderCityInfo` early-returns
      // on a hidden panel, leaving the previous pane's contents in place. The
      // symptom was "visible but empty", which reads like a render bug.
      const panel = document.getElementById("cityinfo");
      if (panel.hidden) document.getElementById("city-btn").click();
      await wait(120);
      const tabs = [...document.querySelectorAll("#city-tabs button")];
      const firmTab = tabs.find((b) => /FIRM|FIRMA/i.test(b.textContent.trim()));
      if (!firmTab) return { error: "no FIRM tab" };
      firmTab.click();
      await wait(200);
      const host = document.getElementById("city-pane-rows");
      const rows = [...host.querySelectorAll("li")].map((li) => li.textContent);
      document.getElementById("city-btn").click();     // leave it as we found it
      return { hidden: host.hidden, rows };
    }, undefined, "read the FIRM tab", 30000);

    check("the FIRM tab renders rows", !rankRow.error && !rankRow.hidden
      && (rankRow.rows ?? []).length >= 5, JSON.stringify(rankRow).slice(0, 160));
    if (rankRow.rows?.length) {
      // "3 of 5 Firms deployed" — both numbers, or the interpolation was lost.
      const rank = rankRow.rows[rankRow.rows.length - 1];
      check("the standing row keeps its interpolated numbers",
        /\d+/.test(rank) && !/\{\d+\}/.test(rank) && !/\s{2,}/.test(rank.trim()), rank);
    }

  } catch (e) {
    failures.push(`harness: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    proc.kill("SIGTERM");
  }

  if (failures.length) {
    console.error("\nUI ACCEPTANCE FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nui acceptance OK: every checked control is reachable and does what it claims");
}

main().catch((e) => { console.error(e); process.exit(1); });
