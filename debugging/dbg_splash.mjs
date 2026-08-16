import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const PORT = 8995;
const proc = spawn(process.execPath, ["server/index.js"],
  { env: { ...process.env, PORT: String(PORT), TICK_MS: "250", SEASON_DAYS: "0" }, stdio: "ignore" });
const { chromium } = await import("playwright");
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
    await sleep(200);
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#splash-terminal")?.textContent?.includes("SEASON"),
    { timeout: 15000 }).catch(() => errs.push("SEASON never appeared on the splash"));
  console.log("---- SPLASH AS THE PLAYER SEES IT ----");
  console.log(await page.textContent("#splash-terminal"));
  console.log("--------------------------------------");
  if (errs.length) console.log("PAGE ERRORS:", errs);
} finally { if (browser) await browser.close(); proc.kill("SIGTERM"); }
