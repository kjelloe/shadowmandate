// tools/batch.mjs — the battery lane, with git as the transport (S14, D25).
//
// Replaces the LAN agent-mail hub: the dev machine commits a TASK, pushes, and
// the worker pulls, runs it, commits a RESPONSE and pushes back. Nothing is
// peer-to-peer, so the worker can live anywhere that can reach the remote.
//
//   node tools/batch.mjs queue pacing 300 60000   # dev: queue a job
//   node tools/batch.mjs queue patrol 3 300       # dev: patrol base 3, n=300
//   node tools/batch.mjs status                   # either side: the board
//   node tools/batch.mjs run                      # worker: run everything pending
//   node tools/batch.mjs run --dry                # worker: say what it would do
//
// THE RULES THIS ENCODES, all inherited from the mail-based worker because they
// were all earned the hard way:
//
//  - REFUSE TO SERVE ON A RED SUITE. Results from a broken build are worse than
//    no results, because they look like data.
//  - NAME THE COMMIT AND THE ERA IN EVERY RESULT. A stale worker produced
//    confusing verdicts for a day before anyone checked what it was running.
//    `sm_worldday` already stamps both into the CSV header; the response repeats
//    them so a directory listing answers the question without opening a file.
//  - REPORT FAILURE AS LOUDLY AS SUCCESS. A worker that dies quietly looks like
//    a worker with nothing to do, which is the worst of both.
//  - REFUSE EMPTY OUTPUT. A shard that dies silently would otherwise become a
//    cheerful "0 rows".
//
// AND ONE THE OLD LANE DID NOT NEED: **nothing written here may be private.**
// `ops/` is gitignored precisely so machine, LAN, port and host details never
// reach a public remote. These files ARE tracked, so the runner records no
// hostname and no user, and every captured error is scrubbed of absolute paths
// before it is written.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { cpus, tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const TASKS = join(ROOT, "batch", "tasks");
const RESPONSES = join(ROOT, "batch", "responses");

// The job kinds, and the ONE place their environment is defined. A second table
// somewhere else is how the pacing instruments ended up measuring a game with
// five contract kinds while the engine had six.
export const KINDS = {
  sweep: { env: () => ({}) },
  mirror: { env: () => ({ MIRROR: "1" }) },
  firmswap: { env: () => ({ FIRMSWAP: "1" }) },
  size128: { env: () => ({ SIZE: "128" }) },
  pacing: { env: (t) => ({ TICKS: String(t.ticks ?? 60000) }) },
  patrol: { env: (t) => ({ PATROL_BASE: String(t.base ?? 4), TICKS: String(t.ticks ?? 60000) }) },
};

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const ensure = (d) => mkdirSync(d, { recursive: true });

// Never write a machine path into a tracked file. Errors are the leak risk:
// a node stack trace is full of absolute paths, and this repo is public.
export function scrub(text, root = ROOT) {
  if (!text) return "";
  return String(text)
    .split(root).join("<repo>")
    .replace(/\/(home|Users)\/[^/\s:"']+/g, "~")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function git(...args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function currentEra() {
  try { return read(join(ROOT, "data", "ruleset.json")).version ?? "unknown"; }
  catch { return "unknown"; }
}

function taskFiles() {
  if (!existsSync(TASKS)) return [];
  return readdirSync(TASKS).filter((f) => f.endsWith(".json")).sort();
}

function responseFor(id) {
  const p = join(RESPONSES, `${id}.json`);
  return existsSync(p) ? read(p) : null;
}

// ── queue (dev side) ───────────────────────────────────────────────────────
function queue(argv) {
  const kind = argv[0];
  if (!KINDS[kind]) {
    console.error(`unknown kind "${kind}". known: ${Object.keys(KINDS).join(" ")}`);
    process.exit(1);
  }
  ensure(TASKS);
  const seq = String(taskFiles().length + 1).padStart(4, "0");
  const id = `${seq}-${kind}`;
  const task = { id, kind, queuedForEra: currentEra(), queuedAtCommit: git("rev-parse", "--short", "HEAD") };
  if (kind === "patrol") {
    task.base = Number(argv[1] ?? 4);
    task.count = Number(argv[2] ?? 300);
  } else {
    task.count = Number(argv[1] ?? 100);
    if (kind === "pacing") task.ticks = Number(argv[2] ?? 60000);
  }
  // No timestamp: a wall-clock stamp is the one field that would churn the diff
  // on every re-queue while saying nothing the commit does not already say.
  writeFileSync(join(TASKS, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  console.log(`queued batch/tasks/${id}.json`);
  console.log(JSON.stringify(task));
  // Measured, not guessed: 0001-pacing and 0003-patrol came back BYTE-IDENTICAL
  // on era 2, because the pacing job runs at the DEFAULT patrol base — which is
  // 4. Paying for both buys one result. Said here, at the moment of queuing,
  // because a note in a README is read once and this decision recurs.
  const patrolDefault = 4;
  if (kind === "patrol" && task.base === patrolDefault) {
    console.log(`\nNOTE: patrol base ${patrolDefault} is the DEFAULT, which is what a`
      + ` 'pacing' job already runs at.\n      On era 2 the two came back byte-identical.`
      + ` Queue this only if you have no\n      pacing job for the same era — otherwise it is a`
      + ` duplicate you pay for twice.`);
  }
  if (kind === "pacing") {
    console.log(`\nNOTE: this runs at patrol base ${patrolDefault} (the default), so it also`
      + ` serves as\n      the base-${patrolDefault} patrol reading. Do not queue 'patrol ${patrolDefault}'`
      + ` alongside it.`);
  }
  console.log("\ncommit and push it, then the worker picks it up on its next pull.");
}

// ── status (either side) ───────────────────────────────────────────────────
function status() {
  const tasks = taskFiles().map((f) => read(join(TASKS, f)));
  if (!tasks.length) { console.log("no tasks queued"); return; }
  console.log(`era here: ${currentEra()}   commit: ${git("describe", "--always", "--dirty")}\n`);
  for (const t of tasks) {
    const r = responseFor(t.id);
    const state = !r ? "PENDING" : (r.status === "ok" ? "done" : "FAILED");
    const detail = !r ? ""
      : r.status === "ok"
        ? `${r.rows} rows on ${r.ranOnEra} @ ${r.commit}${r.eraMatch ? "" : "  <-- ERA MISMATCH"}`
        : `${r.error}`;
    const shape = [t.ticks ? `${t.ticks} ticks` : null, t.base !== undefined ? `base ${t.base}` : null]
      .filter(Boolean).join(" ");
    const drift = r && r.status === "ok" && r.ticks && t.ticks && r.ticks !== t.ticks
      ? `  <-- RAN AT ${r.ticks} TICKS, QUEUED FOR ${t.ticks}` : "";
    console.log(`  ${state.padEnd(8)} ${t.id.padEnd(18)} n=${t.count ?? "?"} ${shape.padEnd(18)} ${detail}${drift}`);
  }
  const pending = tasks.filter((t) => !responseFor(t.id)).length;
  console.log(`\n${pending} pending, ${tasks.length - pending} answered`);
}

// ── run (worker side) ──────────────────────────────────────────────────────
function writeResponse(id, body) {
  ensure(RESPONSES);
  writeFileSync(join(RESPONSES, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

function runTask(task, dry) {
  const spec = KINDS[task.kind];
  const commit = git("describe", "--always", "--dirty");
  const ranOnEra = currentEra();
  const base = {
    id: task.id, kind: task.kind, commit, ranOnEra,
    queuedForEra: task.queuedForEra ?? null,
    // A battery measured under a different era than it was queued for is not
    // wrong, but it answers a different question — and reading it as the old
    // one is exactly the stale-baseline hazard the era discipline exists for.
    // Flagged, never silently corrected.
    eraMatch: (task.queuedForEra ?? ranOnEra) === ranOnEra,
    // The era is not the only thing that makes two batteries incomparable.
    // `queue pacing 300` once defaulted to 36000 ticks while the era-2 pacing
    // baseline had been run at 60000 — the obvious re-queue command silently
    // built a DIFFERENT INSTRUMENT, and nothing in the response said so.
    // Recorded so a mismatch is visible on the board instead of in a verdict.
    ticks: Number(task.ticks ?? 0) || null,
    base: task.base ?? null,
  };
  const cores = Math.max(1, cpus().length);
  const shards = Math.min(6, cores);
  if (dry) {
    console.log(`  would run ${task.id}: count=${task.count} shards=${shards} env=${JSON.stringify(spec.env(task))}`);
    return;
  }

  const tmp = join(tmpdir(), `sm-batch-${task.id}`);
  ensure(tmp);
  const parts = [];
  let failure = null;
  for (let i = 0; i < shards; i++) {
    const r = spawnSync(process.execPath, ["tools/sm_worldday.mjs", String(task.count)], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...spec.env(task), SHARDS: String(shards), SHARD: String(i) },
    });
    // A shard that dies silently becomes a cheerful "0 rows" if nobody looks.
    if (r.status !== 0 || !r.stdout || !r.stdout.trim()) {
      failure = `shard ${i} produced nothing: ${scrub(r.stderr) || `exit ${r.status}`}`;
      break;
    }
    parts.push(r.stdout);
  }
  rmSync(tmp, { recursive: true, force: true });

  if (failure) {
    writeResponse(task.id, { ...base, status: "failed", error: failure });
    console.log(`  FAILED ${task.id}: ${failure}`);
    return;
  }

  // Header from the first shard (it already stamps era, commit and settings);
  // data rows from the rest.
  const lines = [];
  parts.forEach((out, i) => {
    const rows = out.split("\n").filter((l) => l.length);
    if (i === 0) lines.push(...rows);
    else lines.push(...rows.filter((l) => !l.startsWith("#")).slice(1));
  });
  const dataRows = lines.filter((l) => l && !l.startsWith("#")).length - 1;
  if (dataRows <= 0) {
    writeResponse(task.id, { ...base, status: "failed", error: "no data rows after merging shards" });
    console.log(`  FAILED ${task.id}: no data rows`);
    return;
  }
  ensure(RESPONSES);
  writeFileSync(join(RESPONSES, `${task.id}.csv`), `${lines.join("\n")}\n`);
  writeResponse(task.id, { ...base, status: "ok", shards, rows: dataRows, csv: `${task.id}.csv` });
  console.log(`  ok ${task.id}: ${dataRows} rows -> batch/responses/${task.id}.csv`);
}

function run(argv) {
  const dry = argv.includes("--dry");
  const pending = taskFiles().map((f) => read(join(TASKS, f))).filter((t) => !responseFor(t.id));
  if (!pending.length) { console.log("nothing pending"); return; }
  console.log(`${pending.length} pending, era ${currentEra()}, commit ${git("describe", "--always", "--dirty")}`);

  if (!dry) {
    // REFUSE TO SERVE ON A RED SUITE. Results from a broken build are worse
    // than no results, because they look like data.
    process.stdout.write("checking the suite... ");
    const t = spawnSync("npm", ["test"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (t.status !== 0) {
      const tail = scrub((t.stdout ?? "").split("\n").slice(-12).join(" "));
      console.log("RED — refusing to serve");
      for (const task of pending) {
        writeResponse(task.id, {
          id: task.id, kind: task.kind, status: "failed",
          commit: git("describe", "--always", "--dirty"), ranOnEra: currentEra(),
          error: `npm test is RED on this commit — refusing to serve. ${tail}`,
        });
      }
      console.log("wrote a FAILED response for every pending task — commit and push so it is visible.");
      process.exit(1);
    }
    console.log("green");
  }
  for (const task of pending) runTask(task, dry);
  if (!dry) console.log("\ncommit batch/responses and push.");
}

// Only act when INVOKED, never when imported. Without this guard, importing the
// module to test `scrub` ran the CLI, hit the usage branch and called
// process.exit — which killed the test process after its first test and looked
// like a suite that had simply stopped caring.
const invokedDirectly = process.argv[1]
  && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const [, , cmd, ...argv] = process.argv;
  if (cmd === "queue") queue(argv);
  else if (cmd === "status") status();
  else if (cmd === "run") run(argv);
  else {
    console.log("usage: node tools/batch.mjs queue <kind> [args] | status | run [--dry]");
    console.log(`kinds: ${Object.keys(KINDS).join(" ")}`);
    process.exit(cmd ? 1 : 0);
  }
}
