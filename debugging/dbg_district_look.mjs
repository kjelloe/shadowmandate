// debugging/dbg_district_look.mjs — drop into the COMMERCIAL district (zone
// picker, by label) and photograph the DC-2 look: neon signage against the
// window field. Uses the __smFreeze probe seam — SwiftShader cannot
// screenshot a live diorama since the decor pass grew.
process.chdir("/home/kjelloe/GIT/shadowmandate");
const { spawn } = await import("node:child_process");
const { setTimeout: sleep } = await import("node:timers/promises");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const PORT = 8996;
const proc = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64",
    LEDGER_PATH: join(mkdtempSync(join(tmpdir(), "sm-dc2-")), "ledger.json"), TICK_MS: "120" },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await sleep(250); }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle" });
  await page.click("#drop-in");
  // The zone picker: choose the COMMERCIAL district by its label.
  await page.waitForSelector("#zone-districts li", { timeout: 8000 });
  await page.evaluate(() => {
    const lis = [...document.querySelectorAll("#zone-districts li")];
    const li = lis.find((el) => el.textContent.includes("Commercial"));
    (li ?? lis[0]).click();
  });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await page.evaluate(() => window.__smDebug?.screen === "world")) break;
  }
  await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
  // Step off the HQ roof and down the street so facades face the camera.
  await page.evaluate(() => {
    const a = window.__smView.agents[0];
    const ax = Math.floor(a.x / 256), ay = Math.floor(a.y / 256);
    window.__smSend({ type: 20, agentId: a.id, cellX: ax + 5, cellY: ay + 3 });
  });
  await sleep(9000);
  for (let i = 0; i < 3; i++) await page.evaluate(() => document.getElementById("zoom-out").click());
  await sleep(1200);
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(400);
  await page.screenshot({ path: "debugging/street-life-01.png", timeout: 30000, animations: "disabled" });
  await browser.close();
  console.log("commercial-core shot -> debugging/street-life-01.png");
} finally { proc.kill(); }
