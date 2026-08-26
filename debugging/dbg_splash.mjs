// debugging/dbg_splash.mjs — photograph the SPLASH (kept probe).
// Real server + browser, throwaway ledger (the old version spawned a server
// with NO LEDGER_PATH — harmless pre-deployment, but the rule is the rule),
// screenshot to debugging/splash-look-01.png. SwiftShader budget: 640x360.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 8994;
const proc = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64",
    LEDGER_PATH: join(mkdtempSync(join(tmpdir(), "sm-splash-")), "ledger.json"), TICK_MS: "250" },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await sleep(250); }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle" });
  await sleep(2500);   // let the vignette settle a couple of seconds in
  await page.screenshot({ path: "debugging/splash-look-01.png", timeout: 30000, animations: "disabled" });
  await browser.close();
  console.log("shot -> debugging/splash-look-01.png");
} finally { proc.kill(); }
