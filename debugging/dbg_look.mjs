// debugging/dbg_look.mjs — drop in and photograph the live look (kept: playtest 3 art pass).
// Drop in and photograph the new look, twice: wide and street level.
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8991;
// TICK_MS for the same reason the gates use it: SwiftShader cannot render a
// 10Hz 1280x800 diorama and service automation at once, and the detail pass
// made frames heavier. A still photograph does not care about pacing.
const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64", TICK_MS: "250",
    LEDGER_PATH: joinPath(mkdtempSync(joinPath(tmpdir(), "sm-look-")), "ledger.json") },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await sleep(1500);
  await page.click("#drop-in");
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__smDebug?.screen === "world")) break;
    await sleep(300);
  }
  await sleep(2500);
  // Freeze before every capture. Since the frame loop moved to rAF (PT13-A) the
  // diorama redraws as fast as SwiftShader will allow, which starves the
  // automation thread and times the screenshot out. Freezing holds the last
  // drawn frame, which is exactly what a photograph wants.
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(300);
  await page.screenshot({ path: "reports/look_intro.png", timeout: 90000 });   // intro overlay up
  await page.evaluate(() => window.__smFreeze?.(false));
  await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
  await sleep(6500);                                            // dropship gone, world settled
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(300);
  await page.screenshot({ path: "reports/look_world.png", timeout: 90000 });
  await browser.close();
  console.log("shots -> reports/look_intro.png, reports/look_world.png");
} finally { server.kill(); }
