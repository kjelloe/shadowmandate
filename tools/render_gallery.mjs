// tools/render_gallery.mjs — screenshot the asset gallery (S15, slice 7a-3).
//
// Visual work has to be reviewable without a human at a keyboard, both so the
// owner can look at a PNG rather than run a server, and so a look candidate
// (Q41c) can be screenshot-diffed later.
//
//   node tools/render_gallery.mjs                 -> reports/gallery.png
//   node tools/render_gallery.mjs out.png
//
// Exit 0 = rendered · 1 = the page reported errors · 2 = playwright missing.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OUT = process.argv[2] ?? "reports/gallery.png";
const PORT = Number(process.env.GALLERY_PORT ?? 8982);

function startServer() {
  const proc = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: String(PORT), TICK_MS: "500" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  proc.stdout.on("data", (d) => log.push(String(d)));
  proc.stderr.on("data", (d) => log.push(String(d)));
  return { proc, log };
}

async function main() {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { console.error("playwright not installed: npm i -D playwright"); process.exit(2); }

  const { proc, log } = startServer();
  let browser, failed = false;
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not up */ }
      await sleep(200);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1240, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/gallery.html`, { waitUntil: "networkidle" });
    // Wait for the page to SAY it finished, rather than guessing at a delay —
    // a screenshot taken early looks exactly like a broken renderer.
    await page.waitForFunction(() => document.body.dataset.galleryReady === "1", { timeout: 20000 })
      .catch(() => errors.push("gallery never signalled ready"));

    const onPage = await page.textContent("#err").catch(() => "");
    if (onPage?.trim()) { errors.push(`on-page: ${onPage.trim()}`); }

    mkdirSync(dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT, fullPage: true });
    console.log(`gallery -> ${OUT}`);

    if (errors.length) {
      failed = true;
      console.error("GALLERY REPORTED ERRORS:");
      for (const e of errors) console.error("  - " + e);
    }
  } catch (e) {
    failed = true;
    console.error("render_gallery failed:", e.message.split("\n")[0]);
    console.error(log.join("").slice(-500));
  } finally {
    if (browser) await browser.close();
    proc.kill("SIGTERM");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
