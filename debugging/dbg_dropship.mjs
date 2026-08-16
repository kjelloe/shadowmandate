// debugging/dbg_dropship.mjs — does the dropship actually FLY in a real client?
//
// The choreography maths is unit-tested, but "the numbers are right" and "a ship
// crosses the screen" are different claims, and this project has paid for that
// difference before. Deploys, then samples the scene mid-sequence.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const PORT = 8997;
const proc = spawn(process.execPath, ["server/index.js"],
  { env: { ...process.env, PORT: String(PORT), TICK_MS: "250" }, stdio: "ignore" });
const { chromium } = await import("playwright");
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
    await sleep(200);
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.click("#drop-in");
  // Auto drop-zone resolves on its own; wait for the world screen.
  await page.waitForFunction(() => window.__smDebug?.screen === "world", { timeout: 25000 });
  // MID-SEQUENCE. The flight starts the instant the world screen appears, so a
  // screenshot taken after it is a picture of an empty sky.
  const t0 = Date.now();
  // ONE capture, at the hover: the ship is directly over the HQ there, and a
  // screenshot under SwiftShader costs about a second, so sampling twice drifts
  // clean past the moment worth looking at.
  while (Date.now() - t0 < 2300) await sleep(30);
  const d = await page.evaluate(() => window.__smDebug?.dropship ?? null);
  console.log("at capture:", d ? JSON.stringify(d) : "null");
  await page.screenshot({ path: "reports/dropship.png" });

  console.log(errs.length ? `PAGE ERRORS: ${errs.join(" | ")}` : "no page errors");
  console.log("screenshot -> reports/dropship.png");
} finally { if (browser) await browser.close(); proc.kill("SIGTERM"); }
