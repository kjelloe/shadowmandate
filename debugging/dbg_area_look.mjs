// debugging/dbg_area_look.mjs — S17 AR-2: the LIVE look at the compound.
//
// A real browser against a real server: drop in, walk to the nearest site,
// enter the mission area, and SCREENSHOT it — because a green suite cannot
// tell you the game looks wrong, and the area renderer is brand new. Also
// exercises the exit flow (the button, not just the command).
//
//   node debugging/dbg_area_look.mjs          # writes debugging/area-look-*.png
//   HEADED=1 node debugging/dbg_area_look.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

const HEADED = process.env.HEADED === "1";
const PORT = Number(process.env.PROBE_PORT ?? 8991);

function startServer() {
  const proc = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64",
      LEDGER_PATH: joinPath(mkdtempSync(joinPath(tmpdir(), "sm-area-")), "ledger.json"),
      TICK_MS: "60" },   // fast ticks so the walk to the site takes seconds
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
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  return false;
}

async function main() {
  const { chromium } = await import("playwright");
  const { proc, log } = startServer();
  const failures = [];
  let browser;
  try {
    if (!await waitForHealth()) {
      console.error("server never healthy:\n" + log.join(""));
      process.exit(1);
    }
    browser = await chromium.launch({ headless: !HEADED });
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } /* SwiftShader budget: larger times out screenshots */ });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle" });

    await page.click("#drop-in");
    let deployed = false;
    for (let i = 0; i < 80 && !deployed; i++) {
      await sleep(250);
      deployed = await page.evaluate(() => window.__smDebug?.screen === "world");
    }
    if (!deployed) { failures.push("never deployed"); throw new Error("bail"); }
    await page.evaluate(() => document.getElementById("intro-dismiss")?.click());

    // Walk (hurry) to the nearest site, through the real command path.
    const site = await page.evaluate(() => {
      const v = window.__smView, a = v.agents[0];
      const ax = Math.floor(a.x / 256), ay = Math.floor(a.y / 256);
      const s = [...v.sites].sort((p, q) =>
        (Math.abs(p.cellX - ax) + Math.abs(p.cellY - ay))
        - (Math.abs(q.cellX - ax) + Math.abs(q.cellY - ay)))[0];
      window.__smSend({ type: 21, agentId: a.id, stance: 2 });
      window.__smSend({ type: 20, agentId: a.id, cellX: s.cellX, cellY: s.cellY });
      return s;
    });
    let arrived = false;
    for (let i = 0; i < 120 && !arrived; i++) {
      await sleep(250);
      arrived = await page.evaluate((s) => {
        const a = window.__smView.agents[0];
        return Math.max(Math.abs(Math.floor(a.x / 256) - s.cellX),
          Math.abs(Math.floor(a.y / 256) - s.cellY)) <= 1;
      }, site);
    }
    if (!arrived) { failures.push("never reached the site"); throw new Error("bail"); }

    // Enter. (The BEGIN button needs an accepted contract; the command is the
    // same one it sends — the button's own logic is unit-tested in models.)
    await page.evaluate(() => {
      window.__smSend({ type: 45, agentId: window.__smView.agents[0].id });
    });
    let inside = -1;
    for (let i = 0; i < 40 && inside < 0; i++) {
      await sleep(250);
      inside = await page.evaluate(() => window.__smDebug.insideAreaId);
    }
    if (inside < 0) {
      const diag = await page.evaluate(() => ({
        events: window.__smDebug.lastEvents,
        toasts: [...document.querySelectorAll('#toasts *')].map((n) => n.textContent),
        agent: window.__smView.agents[0],
      }));
      failures.push("enterArea did not land: " + JSON.stringify(diag).slice(0, 400));
    }
    const areaCount = await page.evaluate(() => window.__smDebug.areaCount);
    if (areaCount < 1) failures.push("the view carries no area block while inside");
    const areaDump = await page.evaluate(() => {
      const ar = window.__smView.areas?.[0];
      return ar ? { guards: ar.guards, terminals: ar.terminals, doors: ar.doors,
        objective: ar.objective, alarm: ar.alarmStage } : null;
    });
    console.log("AREA:", JSON.stringify(areaDump));
    await sleep(700);   // let the fade finish before the screenshot
    await page.screenshot({ path: "debugging/area-look-01.png", timeout: 30000, animations: "disabled" });

    // The EXIT button must be visible at the entry door, and must work.
    const exitVisible = await page.isVisible("#exit-area-btn");
    if (!exitVisible) failures.push("EXIT button not visible at the entry door");
    else {
      await page.evaluate(() => document.getElementById("exit-area-btn").click());
      let out = 0;
      for (let i = 0; i < 40 && out >= 0; i++) {
        await sleep(250);
        out = await page.evaluate(() => window.__smDebug.insideAreaId);
      }
      if (out >= 0) failures.push("EXIT click did not leave the compound");
    }
    await page.screenshot({ path: "debugging/area-look-02-street.png", timeout: 30000, animations: "disabled" });
    if (errors.length) failures.push("page errors: " + errors.join(" | "));
  } catch (e) {
    if (e.message !== "bail") failures.push(String(e));
  } finally {
    await browser?.close();
    proc.kill();
  }
  if (failures.length) {
    console.error("AREA LOOK FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("area look OK: entered, rendered, exited — see debugging/area-look-01.png");
}

main();
