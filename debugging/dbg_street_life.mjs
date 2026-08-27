// debugging/dbg_street_life.mjs — S17 ambient life: look at the CROWD live.
// A real server + browser: drop in, walk toward a district core, wait for a
// hover car to glide into frame, screenshot. The fog is honest, so expect
// zero civilians in view until the walk nears a core - the crowd lives where
// districts centre, not at the drop zones.
process.chdir("/home/kjelloe/GIT/shadowmandate");
const { spawn } = await import("node:child_process");
const { setTimeout: sleep } = await import("node:timers/promises");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const PORT = 8993;
const proc = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64",
    LEDGER_PATH: join(mkdtempSync(join(tmpdir(), "sm-life-")), "ledger.json"), TICK_MS: "40" },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await sleep(250); }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle" });
  await page.click("#drop-in");
  for (let i = 0; i < 60; i++) { await sleep(250); if (await page.evaluate(() => window.__smDebug?.screen === "world")) break; }
  await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
  // Walk to the transit avenue (x=57 on this seed) so the traffic is in frame.
  await page.evaluate(() => {
    const a = window.__smView.agents[0];
    window.__smSend({ type: 21, agentId: a.id, stance: 2 });
    window.__smSend({ type: 20, agentId: a.id, cellX: 37, cellY: 30 });
  });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    const st = await page.evaluate(() => {
      const a = window.__smView.agents[0];
      return { x: Math.floor(a.x / 256), y: Math.floor(a.y / 256),
        civs: (window.__smView.civilians ?? []).length };
    });
    if (i % 12 === 0) console.log("walk:", JSON.stringify(st));
    if (Math.abs(st.x - 37) + Math.abs(st.y - 30) <= 4) break;
  }
  for (let i = 0; i < 4; i++) await page.evaluate(() => document.getElementById("zoom-out").click());
  // Wait for a hover car to glide into frame before shooting.
  for (let i = 0; i < 120; i++) {
    const near = await page.evaluate(async () => {
      const m = await import("./js/models.js");
      const v = window.__smView;
      const tiles = window.__smTiles;
      if (!tiles) return false;
      const lanes = m.transitLanes(tiles, v.size);
      const a = v.agents[0];
      const ax = Math.floor(a.x / 256), ay = Math.floor(a.y / 256);
      return m.hoverCarsAt(v.tick, lanes, 6).some((c) =>
        Math.abs(c.x - ax) < 7 && Math.abs(c.y - ay) < 5);
    });
    if (near) break;
    await sleep(300);
  }
  await sleep(200);
  await page.evaluate(() => window.__smFreeze?.(true));   // quiet thread for the shot
  await sleep(300);
  await page.screenshot({ path: "debugging/street-life-01.png", timeout: 30000, animations: "disabled" });
  await browser.close();
  console.log("shot -> debugging/street-life-01.png");
} finally { proc.kill(); }
