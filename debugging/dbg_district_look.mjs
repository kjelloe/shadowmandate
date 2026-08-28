// debugging/dbg_district_look.mjs — drop into a named district (zone picker, by
// label) and photograph its identity. Uses the __smFreeze probe seam —
// SwiftShader cannot screenshot a live diorama since the decor pass grew.
//
//   node debugging/dbg_district_look.mjs [District] [x,y] [zoomOuts]
//
// The optional cell steers the operative somewhere specific after landing.
// Landing in the right DISTRICT is not the same as standing near the thing you
// came to photograph: the first industrial shot framed an empty corner while
// twenty smoking stacks stood four streets away.
//
// Was hardwired to Commercial for DC-2 (neon against the window field). Playtest
// 13 finding 7 added smoking works and residential parks, and a probe that can
// only photograph one district cannot review district character — which is the
// entire subject of both findings.
process.chdir("/home/kjelloe/GIT/shadowmandate");
const { spawn } = await import("node:child_process");
const { setTimeout: sleep } = await import("node:timers/promises");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const WANT = process.argv[2] ?? "Commercial";
const AIM = (process.argv[3] ?? "").split(",").map(Number);
const ZOOMS = Number(process.argv[4] ?? 3);
const SHOT = `debugging/district-${WANT.toLowerCase()}.png`;
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
  // With an AIM, drop by CLICKING THE ZONE MAP at that cell — it snaps to the
  // nearest offered zone. Walking there instead was tried and does not work:
  // crossing a district on foot takes long enough to get noticed, and the last
  // three attempts photographed a burned operative thirty cells short of the
  // thing being reviewed.
  const aimed = AIM.length === 2 && Number.isFinite(AIM[0]);
  if (aimed) {
    const box = await page.evaluate(() => {
      const r = document.getElementById("zone-map").getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height,
        size: window.__smView?.size ?? 64 };
    });
    await page.mouse.click(box.left + ((AIM[0] + 0.5) / box.size) * box.w,
      box.top + ((AIM[1] + 0.5) / box.size) * box.h);
  } else {
    const picked = await page.evaluate((want) => {
      const lis = [...document.querySelectorAll("#zone-districts li")];
      const labels = lis.map((el) => el.textContent.trim());
      const li = lis.find((el) => el.textContent.includes(want));
      (li ?? lis[0]).click();
      return { labels, matched: !!li };
    }, WANT);
    // SAY WHETHER THE PICK LANDED. Falling back to the first district silently
    // is how two "different district" shots came back photographing the same
    // corner of the same place.
    console.log(`districts offered: ${JSON.stringify(picked.labels)} — matched ${WANT}: ${picked.matched}`);
  }
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await page.evaluate(() => window.__smDebug?.screen === "world")) break;
  }
  await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
  // Step off the HQ roof and down the street so facades face the camera.
  await page.evaluate(() => {
    const a = window.__smView.agents[0];
    const ax = Math.floor(a.x / 256), ay = Math.floor(a.y / 256);
    window.__smSend({ type: 20, agentId: a.id, cellX: ax + 3, cellY: ay + 2 });
  });
  // Long enough to actually ARRIVE. 9s was sized for the five-cell nudge; an
  // aimed walk crosses a district, and photographing the operative still
  // standing at the drop point proves nothing about where it was sent.
  await sleep(9000);
  for (let i = 0; i < ZOOMS; i++) await page.evaluate(() => document.getElementById("zoom-out").click());
  await sleep(1200);
  // SAY WHERE THE CAMERA ENDED UP. Three industrial shots in a row framed
  // empty streets before anyone checked whether the operative had reached the
  // works at all — a photograph of the wrong place looks exactly like a feature
  // that does not render.
  const where = await page.evaluate(() => {
    const a = window.__smView.agents[0];
    return { cell: [Math.floor(a.x / 256), Math.floor(a.y / 256)],
      det: a.detection, districts: window.__smView.districts?.length ?? 0 };
  });
  console.log("camera on:", JSON.stringify(where));
  const dropInfo = await page.evaluate(() => ({
    zones: (window.__smZones ?? []).length,
  }));
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(400);
  await page.screenshot({ path: SHOT, timeout: 30000, animations: "disabled" });
  await browser.close();
  console.log(`${WANT} shot -> ${SHOT}`);
} finally { proc.kill(); }
