// debugging/dbg_cityinfo.mjs — City Info panel, every tab, photographed (kept).
//
// A stats panel is exactly the kind of feature that renders "successfully" with
// nothing in it: every row present, every value an em-dash, every test green.
// This walks all five tabs on the splash AND in the field and prints the row
// counts before shooting, so the photographs are read against numbers.
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8997;
const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64", TICK_MS: "8",
    LEDGER_PATH: join(mkdtempSync(join(tmpdir(), "sm-city-")), "ledger.json") },
  stdio: "ignore",
});
const tabs = async (page, where) => {
  const names = await page.$$eval("#city-tabs button", (bs) => bs.map((b) => b.textContent.trim()));
  for (let i = 0; i < names.length; i++) {
    await page.evaluate((idx) => document.querySelectorAll("#city-tabs button")[idx].click(), i);
    await sleep(250);
    // Count rows in the VISIBLE pane. `#city-body li` picks up the hidden
    // board and legend panes as well, and filtering on `offsetParent` reported
    // zero for panes that were rendering perfectly — the instrument was wrong,
    // not the client. Scope the selector instead of filtering after the fact.
    const rows = await page.$$eval(
      "#city-pane-rows:not([hidden]) li, #city-pane-board:not([hidden]) li, #city-pane-legend:not([hidden]) li",
      (ls) => ls.map((l) => l.textContent.trim()));
    console.log(`  [${where}] ${names[i]}: ${rows.length} rows`);
    for (const r of rows.slice(0, 8)) console.log(`      ${r}`);
  }
};
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await sleep(1800);

  console.log("— on the SPLASH —");
  await page.click("#splash-city");
  await sleep(400);
  await tabs(page, "splash");
  await page.screenshot({ path: "debugging/cityinfo-splash.png", timeout: 60000 });
  await page.click("#cityinfo .close");

  await page.click("#drop-in");
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__smDebug?.screen === "world")) break;
    await sleep(300);
  }
  await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
  // Let the AI Firms actually DEPLOY before reading the FIRMS tab. They land on
  // their own schedule, so an early read reports an empty city truthfully and
  // proves nothing about whether the roster works.
  await sleep(6000);
  console.log("— in the FIELD (waiting for rivals to deploy) —");
  // TICK_MS is deliberately tiny for this probe: AI Firms deploy on a
  // 6000-tick gap, which at a normal probe tick is twenty-five minutes of wall
  // clock — the FIRMS tab could never be photographed with anyone in it.
  for (let i = 0; i < 90; i++) {
    const n = await page.evaluate(() => (window.__smView?.firms ?? []).length);
    if (n > 0) { console.log(`  rivals deployed: ${n}`); break; }
    await sleep(1000);
  }
  await page.click("#city-btn");
  await sleep(400);
  await tabs(page, "field");
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(250);
  await page.screenshot({ path: "debugging/cityinfo-field.png", timeout: 60000 });
  // The LEGEND on its own: it is the tallest pane and the one whose swatches
  // must actually carry the mark colours.
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("#city-tabs button")];
    (tabs.find((b) => /LEGEND|TEGN/.test(b.textContent)) ?? tabs[tabs.length - 1]).click();
  });
  await sleep(400);
  await page.screenshot({ path: "debugging/cityinfo-legend.png", timeout: 60000 });
  await browser.close();
  console.log("shots -> debugging/cityinfo-splash.png, debugging/cityinfo-field.png");
} finally { server.kill(); }
