// tools/mobile_check.mjs — the touch model, measured (S12, slice 7b).
//
// S12 pins a mobile contract: the same client gated on (pointer: coarse), tap
// targets >= 44px, pinch zoom, a persistent stance selector. None of that was
// ever verified — it was CSS written in good faith and never loaded on a narrow
// viewport. This measures it instead, on two real phone-sized viewports with
// touch emulation on.
//
//   node tools/mobile_check.mjs           # needs playwright
//   HEADED=1 node tools/mobile_check.mjs
//
// Exit 0 = all pass · 1 = failures listed · 2 = playwright missing.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

const HEADED = process.env.HEADED === "1";
const PORT = Number(process.env.MOBILE_PORT ?? 8981);
const TAP_MIN = 44;          // S12: >= 44px on coarse pointers

// Two shapes worth caring about: a common modern phone, and a small cheap one.
// The small one is where layout breaks, and it is also the device most likely
// to be compositing in software.
const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "small-360x640", width: 360, height: 640 },
];

function startServer() {
  const proc = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64",
      LEDGER_PATH: joinPath(mkdtempSync(joinPath(tmpdir(), "sm-mobile-")), "ledger.json"),
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
    await sleep(200);
  }
  return false;
}

async function main() {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { console.error("playwright not installed: npm i -D playwright"); process.exit(2); }

  const { proc, log } = startServer();
  const failures = [];
  let browser;

  try {
    if (!await waitForHealth()) { console.error("server never healthy:\n" + log.join("")); process.exit(1); }
    const url = `http://127.0.0.1:${PORT}`;
    browser = await chromium.launch({ headless: !HEADED });

    for (const vp of VIEWPORTS) {
      console.log(`\n--- ${vp.name} ---`);
      const check = (name, ok, detail = "") => {
        if (!ok) failures.push(`[${vp.name}] ${name}${detail ? ` — ${detail}` : ""}`);
        console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
      };

      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => failures.push(`[${vp.name}] pageerror: ${e.message}`));
      page.setDefaultTimeout(15000);
      await page.goto(url, { waitUntil: "networkidle" });

      // A page that scrolls sideways on a phone is broken, full stop.
      const overflowSplash = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      check("splash does not scroll horizontally", overflowSplash.scrollW <= overflowSplash.clientW + 1,
        JSON.stringify(overflowSplash));

      // Every visible control must be thumb-sized BEFORE we go anywhere.
      const smallOnSplash = await page.evaluate((min) => {
        const out = [];
        for (const el of document.querySelectorAll("button, [role=button], li[data-zone]")) {
          if (el.offsetParent === null) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.height < min || r.width < min) {
            out.push(`${el.id || el.className || el.tagName}=${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return out;
      }, TAP_MIN);
      check(`splash tap targets >= ${TAP_MIN}px`, smallOnSplash.length === 0, smallOnSplash.join(", "));

      // Drop in and check the world HUD, which is the screen that actually has
      // to survive a small viewport.
      await page.tap("#drop-in");
      let deployed = false;
      for (let i = 0; i < 60 && !deployed; i++) {
        await sleep(500);
        deployed = await page.evaluate(() => window.__smDebug?.screen === "world");
      }
      check("drop-in works by TAP (not just click)", deployed);

      if (deployed) {
        const overflowWorld = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        check("world does not scroll horizontally",
          overflowWorld.scrollW <= overflowWorld.clientW + 1, JSON.stringify(overflowWorld));

        const smallInWorld = await page.evaluate((min) => {
          const out = [];
          for (const el of document.querySelectorAll("#hud button, #stance button, #hud [role=button]")) {
            if (el.offsetParent === null) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.height < min || r.width < min) {
              out.push(`${el.id || el.textContent.trim().slice(0, 12)}=${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          return out;
        }, TAP_MIN);
        check(`HUD tap targets >= ${TAP_MIN}px`, smallInWorld.length === 0, smallInWorld.join(", "));

        // The minimap must not eat the screen on a small device.
        const mini = await page.evaluate(() => {
          const el = document.getElementById("minimap");
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
        });
        const miniFrac = (mini.w * mini.h) / (mini.vw * mini.vh);
        check("minimap takes less than a quarter of the screen", miniFrac < 0.25,
          `${Math.round(mini.w)}x${Math.round(mini.h)} = ${Math.round(miniFrac * 100)}% of viewport`);

        // Nothing in the HUD may sit off-screen where a thumb cannot reach it.
        const offscreen = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll("#hud-left, #hud-right, #stance, #board-btn, #minimap")) {
            if (el.offsetParent === null) continue;
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1
              || r.left < -1 || r.top < -1) {
              out.push(`${el.id}=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
            }
          }
          return out;
        });
        check("no HUD element sits off-screen", offscreen.length === 0,
          `${offscreen.join(" ")} (viewport ${vp.width}x${vp.height})`);

        // The board is the overlay a player opens most; it must fit and scroll
        // internally rather than pushing the page sideways.
        await page.evaluate(() => document.getElementById("board-btn")?.click());
        await sleep(800);
        const board = await page.evaluate(() => {
          const el = document.getElementById("board");
          if (el.hidden) return null;
          const r = el.getBoundingClientRect();
          return {
            left: r.left, right: r.right, top: r.top, bottom: r.bottom,
            vw: window.innerWidth, vh: window.innerHeight,
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
          };
        });
        check("board overlay opens", board !== null);
        if (board) {
          check("board overlay fits the viewport horizontally",
            board.left >= -1 && board.right <= board.vw + 1,
            `left=${Math.round(board.left)} right=${Math.round(board.right)} vw=${board.vw}`);
          check("open board does not cause horizontal scroll",
            board.scrollW <= board.clientW + 1, `${board.scrollW} > ${board.clientW}`);
          const rowsSmall = await page.evaluate((min) => {
            const out = [];
            for (const el of document.querySelectorAll("#board-list button")) {
              const r = el.getBoundingClientRect();
              if (r.height < min) out.push(`row=${Math.round(r.width)}x${Math.round(r.height)}`);
            }
            return out;
          }, TAP_MIN);
          check(`board rows >= ${TAP_MIN}px tall`, rowsSmall.length === 0, rowsSmall.join(", "));
        }
      }
      await ctx.close();
    }
  } catch (e) {
    failures.push(`harness: ${e.message.split("\n")[0]}`);
  } finally {
    if (browser) await browser.close();
    proc.kill("SIGTERM");
  }

  if (failures.length) {
    console.error("\nMOBILE CHECK FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nmobile check OK: both viewports fit, tap targets are thumb-sized, overlays reachable");
}

main().catch((e) => { console.error(e); process.exit(1); });
