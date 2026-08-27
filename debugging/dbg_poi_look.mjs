// debugging/dbg_poi_look.mjs — playtest 13, findings 1 and 4 (kept).
//
// Are re-spray shops legible as standing landmarks, and is an ALERTED patrol
// loud enough to act on? Both are claims about what a player can see at a
// glance, which no unit test can answer: the models are tested, the marks are
// tokens, and the whole question is whether the result reads.
//
// Zooms OUT deliberately. The default framing is 3.5 cells across, which is the
// right frame for playing and the wrong one for asking "can I find the nearest
// shop from here" — that question is asked at street-planning distance.
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8994;
const server = spawn("node", ["server/index.js"], {
  env: { ...process.env, PORT: String(PORT), SEED: "4711", SIZE: "64", TICK_MS: "250",
    LEDGER_PATH: joinPath(mkdtempSync(joinPath(tmpdir(), "sm-poi-")), "ledger.json") },
  stdio: "ignore",
});
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await sleep(1500);
  await page.click("#drop-in");
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__smDebug?.screen === "world")) break;
    await sleep(300);
  }
  await page.evaluate(() => document.getElementById("intro-dismiss")?.click());
  await sleep(6500);

  // The census FIRST, so the photograph is read against numbers rather than
  // impressions — "I think I can see a shop" is not a finding.
  const census = await page.evaluate(() => {
    const v = window.__smView;
    return {
      buildings: v.buildings.length,
      coverShops: v.buildings.filter((b) => b.kind === 2).length,
      patrols: v.patrols.length,
      alerted: v.patrols.filter((p) => p.alerted).length,
    };
  });
  console.log("census:", JSON.stringify(census));

  // Zoom out to street-planning distance.
  for (let i = 0; i < 9; i++) {
    await page.evaluate(() => document.getElementById("zoom-out").click());
    await sleep(120);
  }
  await sleep(1200);
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(300);
  await page.screenshot({ path: "reports/poi_wide.png", timeout: 90000 });
  await page.evaluate(() => window.__smFreeze?.(false));

  // The radar on its own, magnified: it is 180px on screen and the whole
  // question of finding 1 is whether a shop reads at that size.
  const radar = await page.$("#minimap");
  await page.evaluate(() => window.__smFreeze?.(true));
  await sleep(300);
  await radar.screenshot({ path: "reports/poi_radar.png", timeout: 90000 });
  await page.evaluate(() => window.__smFreeze?.(false));

  // PROVOKE AN ALERT (finding 4). At spawn there is usually no patrol in sight
  // at all, so photographing the default view proves nothing about the alerted
  // marker — the state it exists for never occurs. Walk at the nearest patrol
  // in HURRY, which is the loudest thing an operative can do, until one reacts.
  // WHERE THE PATROLS ACTUALLY ARE. The client only reports patrols within
  // SIGHT (10 cells), so a client-side hunt is a blind search — and it found
  // nothing in 90 attempts through a world that has twelve. The probe runs in
  // node, so it can generate the same deterministic city the server did and
  // walk the operative straight at a route.
  const { loadRuleset } = await import("../server/ruleset.js");
  const { generateCity } = await import("../engine/citygen.js");
  const rules = await loadRuleset();
  const city = generateCity(4711, 64, rules.citygen, rules);
  const patrolSpots = city.patrols.flatMap((p) => p.route.map((c) => ({ x: c.x, y: c.y })));
  console.log(`patrol routes: ${city.patrols.length} patrols, ${patrolSpots.length} route cells`);

  const alerted = await page.evaluate(async (spots) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const me = () => window.__smView.agents.find((a) => a.state === 1);
    for (let i = 0; i < 90; i++) {
      const v = window.__smView;
      const self = me();
      if (!self) break;
      if (v.patrols.some((p) => p.alerted)) return { found: true, after: i, det: self.detection };
      const here = { x: Math.floor(self.x / 256), y: Math.floor(self.y / 256) };
      // Nearest patrol, or wander if none is on screen yet.
      let best = null, bestD = Infinity;
      for (const p of v.patrols) {
        const d = Math.abs(p.x - here.x) + Math.abs(p.y - here.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      window.__smSend({ type: 21, agentId: self.id, stance: 2 });   // HURRY
      // The fallback used to be `here + 6,6`, which lands in building mass and
      // is rejected as no_route — so the operative stood still for the whole
      // hunt and the probe reported "no patrols" about a world full of them.
      // The same trap the test conventions warn about, in a probe. Walk at the
      // NEAREST KNOWN PATROL ROUTE CELL instead: those are, by construction,
      // reachable street cells where a patrol goes.
      // CLOSE AND HOLD. Patrols only go alert when a burn converges them
      // (detection.js: convergePatrols is called from burnAgent), and being
      // burned needs SUSTAINED exposure. The first version kept re-issuing move
      // orders and simply ran past every patrol it found, never standing still
      // long enough to be seen — a probe that keeps moving cannot be caught.
      let target = best;
      if (best && bestD <= 3) target = null;        // stand in the open and wait
      if (!target && !best) {
        let bd = Infinity;
        for (const c of spots) {
          const d = Math.abs(c.x - here.x) + Math.abs(c.y - here.y);
          if (d > 1 && d < bd) { bd = d; target = c; }
        }
      }
      if (target) window.__smSend({ type: 20, agentId: self.id, cellX: target.x, cellY: target.y });
      await wait(600);
    }
    return { found: false, patrols: window.__smView.patrols.length,
      det: me()?.detection ?? -1 };
  }, patrolSpots);
  console.log("alert hunt:", JSON.stringify(alerted));
  if (alerted.found) {
    await page.evaluate(() => window.__smFreeze?.(true));
    await sleep(300);
    await page.screenshot({ path: "reports/poi_alert.png", timeout: 90000 });
    await radar.screenshot({ path: "reports/poi_alert_radar.png", timeout: 90000 });
    console.log("shots -> reports/poi_alert.png, reports/poi_alert_radar.png");
  } else {
    // Say so, rather than shipping a photograph of the wrong state. A probe that
    // silently captures whatever it happened to find is how "verified" gets
    // claimed for something nobody looked at.
    console.log("NO ALERTED PATROL PROVOKED — the finding-4 marker is UNPHOTOGRAPHED");
  }

  await browser.close();
  console.log("shots -> reports/poi_wide.png, reports/poi_radar.png");
} finally { server.kill(); }
