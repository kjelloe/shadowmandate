// server/index.js — one process: static client files + the WebSocket worlds.
//
// The transport boundary (S11). Everything inbound is allowlist-validated here
// as well as in the reducer: a frame that is malformed, or that claims a Firm
// the token does not own, never reaches the engine.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { loadRuleset } from "./ruleset.js";
import { LedgerStore } from "./ledger.js";
import { issueIdentity, claimWithCode, resolveToken } from "./identity.js";
import { World } from "./world.js";
import { validate } from "../engine/commands.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CLIENT = join(ROOT, "client");
const VENDOR = join(ROOT, "node_modules");
const PORT = Number(process.env.PORT ?? 8080);
const SEED = Number(process.env.SEED ?? 4711);
const SIZE = Number(process.env.SIZE ?? 64);
const WORLD_ID = process.env.WORLD ?? "sample";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const rules = loadRuleset();
const ledger = new LedgerStore(join(ROOT, "reports", "ledger.json"));
const worlds = new Map();

function getWorld(id) {
  if (!worlds.has(id)) {
    worlds.set(id, new World({ id, seed: SEED, size: SIZE, rules, ledger }));
  }
  return worlds.get(id);
}

// ── Static files ──────────────────────────────────────────────────────────
const http = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/version") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ruleset: rules.version, worlds: [...worlds.keys()] }));
    return;
  }
  // D50's disclosure surface: what a player can see about a world BEFORE
  // joining it. Day-of-season and the tier range of the Firms competing there,
  // so meeting stronger agents is an informed choice rather than an ambush.
  // Deliberately public and unauthenticated — the whole point is that you can
  // read it before you have an identity on this server.
  if (url.pathname === "/worlds") {
    // The configured world is instantiated so it can be DISCLOSED. Worlds are
    // otherwise built lazily on first connection, which meant a freshly
    // restarted host answered this route with an empty list — telling a player
    // choosing a world that there was nothing here, which is the exact opposite
    // of what D50 asks this route to do. Building it costs one citygen.
    getWorld(WORLD_ID);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ruleset: rules.version,
      seasonDays: rules.season.days | 0,
      defaultWorld: WORLD_ID,
      worlds: [...worlds.values()].map((w) => w.standing()),
    }));
    return;
  }
  // The deploy guard's probe. It reports the TICK rather than a bare "ok",
  // because a wedged pump still answers HTTP and a liveness-only check would
  // call that a successful deploy. The guard curls twice and requires the tick
  // to move — see ops/DEPLOYING.md (private ops repo).
  //
  // A SLEEPING world is healthy, not broken: D16 parks an empty world so it
  // costs nothing, and the sample host is empty most of the time. Reporting
  // dormancy as unhealthy would make the runbook cry wolf every quiet night.
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      uptimeSec: Math.trunc(process.uptime()),
      ruleset: rules.version,
      worlds: [...worlds.values()].map((w) => ({
        id: w.id,
        tick: w.state?.tick ?? 0,
        seats: w.seats?.size ?? 0,
        sleeping: w.sleepingSince !== null,
      })),
    }));
    return;
  }
  // Path traversal is the one static-server bug that actually matters.
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname)
    .replace(/^(\.\.[/\\])+/, "");
  // /vendor serves the pinned three.js out of node_modules — the sibling
  // project's pattern. No committed vendor tree, no CDN.
  const underVendor = rel.startsWith("/vendor/") || rel.startsWith("vendor/");
  const base = underVendor ? VENDOR : CLIENT;
  const file = underVendor
    ? join(VENDOR, rel.replace(/^\/?vendor\//, ""))
    : join(CLIENT, rel);
  if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

// ── The socket ────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (socket) => {
  let firmId = null;
  let world = null;
  const send = (msg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  socket.on("message", (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return send({ type: "error", reason: "bad_json" }); }
    if (!frame || typeof frame !== "object") return send({ type: "error", reason: "bad_frame" });

    switch (frame.type) {
      case "hello": {
        world = getWorld(frame.world ?? WORLD_ID);
        let id = resolveToken(ledger, frame.token);
        let issued = null;
        if (id === null) {
          // A free human seat: AI Firms hold the low ids, so scan past them.
          const free = world.state.firms.find((f) => !f.isAi && f.state === 0
            && ![...world.seats.keys()].includes(f.id));
          if (!free) return send({ type: "error", reason: "world_full" });
          issued = issueIdentity(ledger, free.id);
          id = free.id;
        }
        firmId = id;
        world.seat(firmId, send);
        send({
          type: "welcome",
          firmId,
          // The recovery code is shown ONCE, on issue, and never again.
          token: issued?.token ?? frame.token,
          recoveryCode: issued?.recoveryCode ?? null,
          briefing: world.briefingFor(firmId),
          view: world.viewFor(firmId),
          // Terrain rides along with the welcome as well as the drop-zone
          // reply: a RECONNECTING player never asks for drop zones, so without
          // this their map would render blank forever.
          tiles: world.clientTiles(),
          // Dialogue and shop content, plus the disguise portraits. Static
          // content, so it ships once with the welcome rather than per tick.
          content: { payloads: rules.payloads, disguises: rules.disguises },
          ruleset: rules.version,
        });
        return;
      }
      case "claim": {
        const claimed = claimWithCode(ledger, frame.code);
        if (claimed.error) return send({ type: "error", reason: claimed.error });
        return send({ type: "claimed", token: claimed.token, firmId: claimed.firmId });
      }
      case "command": {
        if (firmId === null || !world) return send({ type: "error", reason: "not_seated" });
        const command = frame.command;
        if (!validate(command)) return send({ type: "error", reason: "invalid_command" });
        // A seat may only act as ITSELF. Without this, any client could drive
        // a rival's Firm by editing one number.
        if (command.firmId !== undefined && command.firmId !== firmId) {
          return send({ type: "error", reason: "not_your_firm" });
        }
        if (command.agentId !== undefined) {
          const agent = world.state.agents[command.agentId];
          if (!agent || agent.firmId !== firmId) {
            return send({ type: "error", reason: "not_your_agent" });
          }
        }
        // The bank is authoritative here, never taken from the client.
        if (command.bank !== undefined) {
          command.bank = ledger.get(world.id, firmId).bank | 0;
        }
        world.submit(command);
        return;
      }
      case "dropZones": {
        if (!world || firmId === null) return send({ type: "error", reason: "not_seated" });
        // Cap what crosses the wire: a 64-world has hundreds of valid zones and
        // the client only needs enough to choose between.
        const zones = world.dropZones().slice(0, 400);
        const auto = world.autoDropZone(firmId);
        return send({
          type: "dropZones", zones, auto, tiles: world.clientTiles(),
          // Districts with their trait, heat band and how much tier-appropriate
          // work is in them: a choice between 240 identical squares is not a
          // choice (D37 picks well, but the player should see WHY).
          districts: world.districtSummary(firmId),
        });
      }
      default:
        return send({ type: "error", reason: "unknown_frame" });
    }
  });

  socket.on("close", () => {
    if (world && firmId !== null) world.unseat(firmId);
  });
});

http.listen(PORT, () => {
  console.log(`Shadow Mandate — ruleset ${rules.version}`);
  console.log(`  http://localhost:${PORT}   (world "${WORLD_ID}", seed ${SEED}, ${SIZE}x${SIZE})`);
});
