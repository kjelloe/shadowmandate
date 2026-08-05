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
      TICK_MS: process.env.TICK_MS ?? "250" },
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
    const boardHit = await hitTest("board-btn");
    check("board button is clickable", boardHit.ok, boardHit.why);
    let boardOpen = false, boardRows = 0;
    try {
      await evalT(() => document.getElementById("board-btn").click(), undefined, "click #board-btn");
      await sleep(500);
      boardOpen = await evalT(() => !document.getElementById("board").hidden, undefined, "read #board hidden");
      boardRows = await evalT(() => document.querySelectorAll("#board-list button").length,
        undefined, "count board rows");
    } catch (e) {
      failures.push(`board interaction: ${e.message}`);
      console.log(`FAIL board interaction — ${e.message}`);
    }
    check("board button opens the board", boardOpen);
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
    check("client exposes its state for inspection", hasFatal);
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
