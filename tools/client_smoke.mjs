// tools/client_smoke.mjs — can a REAL browser load the client without errors,
// drop in, and see the world tick? (S12 gate, milestone 7h.)
//
// This catches what node tests structurally cannot: load order, DOM wiring,
// module-graph 404s, CSS that beats [hidden], a renderer that throws, an
// importmap that does not resolve. Every one of the five playtest defects in
// this project was invisible to a green suite and obvious within ten seconds of
// a real page load — that gap is what this file exists to close.
//
//   node tools/client_smoke.mjs           # needs playwright
//   HEADED=1 node tools/client_smoke.mjs  # watch it
//
// Exit 0 = healthy · 1 = FAILURES (listed) · 2 = playwright not installed.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const HEADED = process.env.HEADED === "1";
const PORT = Number(process.env.SMOKE_PORT ?? 8977);

// The server is a plain `node server/index.js`, so run it as one rather than
// importing it — that is also what the deploy does, so the gate exercises the
// real entry point.
function startServer() {
  const proc = spawn(process.execPath, ["server/index.js"], {
    // TICK_MS: headless SwiftShader cannot render a 10Hz diorama and service
    // automation at the same time, so every interaction queues behind a frame
    // and the gate takes minutes. Slowing wall-clock pacing changes no
    // simulation outcome (the reducer counts ticks, it never reads a clock) and
    // still reproduces the defects this gate exists for — a list that rebuilds
    // per view update rebuilds at any rate.
    env: { ...process.env, PORT: String(PORT), SEED: "4711",
      // D26: the render path must handle 128 as well as the 64 default.
      //   SIZE=128 node tools/client_smoke.mjs
      SIZE: process.env.SIZE ?? "64",
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
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  return false;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright not installed: npm i -D playwright");
    process.exit(2);
  }

  const { proc, log } = startServer();
  const failures = [];
  let browser;
  try {
    if (!await waitForHealth()) {
      console.error("server never became healthy:\n" + log.join(""));
      process.exit(1);
    }
    const url = `http://127.0.0.1:${PORT}`;
    browser = await chromium.launch({ headless: !HEADED });
    // Small viewport on purpose: headless SwiftShader renders unthrottled rAF
    // frames, and a full-size 3D scene saturates the main thread and starves
    // the click queue. That is a harness artefact, not a client bug (real GPUs
    // vsync), so keep the frames cheap instead of chasing flake.
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });

    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
    page.on("requestfailed", (r) => errors.push(`404/failed: ${r.url()}`));

    page.setDefaultTimeout(8000);   // a buried button should fail fast, not after 30s
    await page.goto(url, { waitUntil: "networkidle" });
    if (errors.length) failures.push(`errors at LOAD — ${errors.join(" | ")}`);

    // The splash must be the visible screen. Playtest 1 shipped with a CSS rule
    // that beat [hidden] and stacked every screen at once, so this is a real
    // regression guard, not ceremony.
    const splashVisible = await page.isVisible("#splash");
    if (!splashVisible) failures.push("splash screen is not visible on load");
    let stacked = false;
    for (const hidden of ["dropzone", "debrief", "world"]) {
      if (await page.isVisible(`#${hidden}`)) {
        stacked = true;
        failures.push(`#${hidden} is visible on load — [hidden] is being overridden (playtest-1 defect)`);
      }
    }
    // Bail immediately. With every screen stacked, #drop-in is buried and the
    // click below just times out after 30s with a message about a locator,
    // which buries the actual diagnosis under a harness error.
    if (stacked) {
      console.error("CLIENT SMOKE FAILED (screens are stacked — check the [hidden] rule in style.css):");
      for (const f of failures) console.error("  - " + f);
      process.exit(1);
    }

    // three.js must resolve through the importmap out of /vendor. If this 404s
    // the diorama is silently blank, which cost a whole playtest round.
    const vendorOk = (await page.request.get(`${url}/vendor/three/build/three.module.js`)).ok();
    if (!vendorOk) failures.push("/vendor/three/build/three.module.js did not serve — blank diorama");

    // Drop in, and wait for the world screen the way a player would.
    await page.click("#drop-in");
    let deployed = false;
    for (let i = 0; i < 60 && !deployed; i++) {
      await sleep(250);
      deployed = await page.evaluate(() => window.__smDebug?.screen === "world");
    }
    if (!deployed) {
      const dbg = await page.evaluate(() => window.__smDebug ?? null);
      failures.push(`drop-in never reached the world screen (debug: ${JSON.stringify(dbg)})`);
    } else {
      // A fresh context gets the first-deployment intro; dismiss it so the
      // checks below see the world, not the overlay.
      await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
      // The world must actually TICK. A frozen world renders identically to a
      // live one, so compare two samples rather than trusting a single read.
      const t1 = await page.evaluate(() => window.__smDebug.tick);
      await sleep(1500);
      const t2 = await page.evaluate(() => window.__smDebug.tick);
      if (!(t2 > t1)) failures.push(`world is not ticking (tick ${t1} -> ${t2})`);

      // The canvas must have real pixels, and the agent must exist.
      const canvas = await page.evaluate(() => {
        const c = document.getElementById("view");
        return c ? { w: c.width, h: c.height } : null;
      });
      if (!canvas || canvas.w < 2 || canvas.h < 2) {
        failures.push(`diorama canvas has no size: ${JSON.stringify(canvas)}`);
      }
      const agent = await page.evaluate(() => window.__smDebug.agent);
      if (!agent) failures.push("no own agent in the view after drop-in");
    }

    if (errors.length) failures.push(`runtime errors — ${errors.join(" | ")}`);
  } catch (e) {
    // Collect rather than throw: a timeout here is usually a SYMPTOM of a
    // failure already recorded above, and the recorded one is the useful
    // diagnosis. Losing it to an unhandled throw is how a gate ends up
    // reporting "waiting for locator" instead of "the screens are stacked".
    failures.push(`harness: ${e.message.split("\n")[0]}`);
  } finally {
    if (browser) await browser.close();
    proc.kill("SIGTERM");
  }

  if (failures.length) {
    console.error("CLIENT SMOKE FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("client smoke OK: loads clean, one screen visible, vendor three.js serves, drop-in deploys, world ticks");
}

main().catch((e) => { console.error(e); process.exit(1); });
