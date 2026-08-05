import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const PORT = 8979;
const proc = spawn(process.execPath, ["server/index.js"],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const { chromium } = await import("playwright");
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await sleep(200); }
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle" });
await page.click("#drop-in");
for (let i = 0; i < 60; i++) { await sleep(250); if (await page.evaluate(() => window.__smDebug?.screen === "world")) break; }
console.log("deployed");

const timed = async (label, fn) => {
  const t0 = Date.now();
  try {
    const r = await Promise.race([page.evaluate(fn),
      new Promise((_, j) => setTimeout(() => j(new Error("timeout")), 6000))]);
    console.log(`  ${label}: ${Date.now() - t0}ms ->`, JSON.stringify(r));
  } catch (e) { console.log(`  ${label}: ${Date.now() - t0}ms -> ${e.message}`); }
};

await timed("read board hidden", () => document.getElementById("board").hidden);
await timed("count board rows BEFORE showing", () => document.querySelectorAll("#board-list button").length);
await timed("set hidden=false directly", () => { document.getElementById("board").hidden = false; return "set"; });
await sleep(1000);
await timed("count board rows AFTER showing", () => document.querySelectorAll("#board-list button").length);
await timed("read board hidden again", () => document.getElementById("board").hidden);
await b.close(); proc.kill("SIGTERM");
