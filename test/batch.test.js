// test/batch.test.js — the battery lane's transport (S14, D25).
//
// Git carries the lane now, which means task and response files are TRACKED
// and this remote is public. `ops/` is gitignored precisely so machine, LAN and
// host details never reach it; these files have no such protection, so the
// scrubbing is not tidiness — it is the only thing between a captured stack
// trace and a published home directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { KINDS, scrub } from "../tools/batch.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

test("the lane scrubs every path shape a stack trace can carry", () => {
  // The repo root itself.
  assert.equal(scrub(`Error at ${ROOT.replace(/\/$/, "")}/engine/areas.js:12`, ROOT.replace(/\/$/, "")),
    "Error at <repo>/engine/areas.js:12");
  // Any home directory, on either platform, even one we have never seen.
  assert.equal(scrub("open /home/someone/secret/ledger.json failed"),
    "open ~/secret/ledger.json failed");
  assert.equal(scrub("at /Users/anotherperson/GIT/x/tools/y.mjs"),
    "at ~/GIT/x/tools/y.mjs");
  // Multi-line stack traces collapse, and are capped: an unbounded error field
  // in a tracked file is a way to commit an entire heap dump by accident.
  const huge = "x".repeat(5000);
  assert.ok(scrub(huge).length <= 600);
  assert.equal(scrub("a\n  b\n\tc"), "a b c");
  assert.equal(scrub(null), "");
  assert.equal(scrub(undefined), "");
});

test("every queueable kind has an environment, and it is the ONLY such table", () => {
  // The pacing instruments once hardcoded five contract kinds while the engine
  // had six, so a whole column of results went into a bucket that did not
  // exist. One table, and the runner reads it.
  const names = Object.keys(KINDS);
  assert.ok(names.length >= 6, `only ${names.length} kinds`);
  for (const [name, spec] of Object.entries(KINDS)) {
    assert.equal(typeof spec.env, "function", `kind "${name}" has no env`);
    const env = spec.env({ ticks: 123, base: 7, count: 9 });
    assert.equal(typeof env, "object", `kind "${name}" env is not an object`);
    for (const v of Object.values(env)) {
      assert.equal(typeof v, "string",
        `kind "${name}" passes a non-string env value — spawnSync silently drops those`);
    }
  }
  // The two parameterised kinds must actually READ their parameter, or the job
  // runs the default and the CSV header quietly disagrees with the task file.
  assert.equal(KINDS.pacing.env({ ticks: 60000 }).TICKS, "60000");
  assert.equal(KINDS.patrol.env({ base: 3 }).PATROL_BASE, "3");
});

test("no queued task or stored response carries a private path", () => {
  // The guard that matters, run against whatever is actually in the tree.
  for (const dir of ["tasks", "responses"]) {
    const d = join(ROOT, "batch", dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const text = readFileSync(join(d, f), "utf8");
      assert.ok(!/\/home\/|\/Users\//.test(text),
        `batch/${dir}/${f} contains an absolute home path`);
      // A hostname would arrive via os.hostname(); the runner must never
      // record one, so nothing here should look like one.
      assert.ok(!/"host(name)?"\s*:/.test(text),
        `batch/${dir}/${f} records a hostname`);
    }
  }
});

test("a queued task names the era it was queued for", () => {
  // The stale-baseline hazard in a new transport: a task pushed under one era
  // and run under another answers a different question, and the response has
  // to be able to SAY so. It cannot if the task never recorded the era.
  const d = join(ROOT, "batch", "tasks");
  if (!existsSync(d)) return;
  const tasks = readdirSync(d).filter((f) => f.endsWith(".json"));
  for (const f of tasks) {
    const t = JSON.parse(readFileSync(join(d, f), "utf8"));
    assert.ok(t.id && t.kind, `${f} is missing id or kind`);
    assert.ok(KINDS[t.kind], `${f} queues unknown kind "${t.kind}"`);
    assert.ok(t.queuedForEra, `${f} does not record the era it was queued for`);
  }
});

// D70. The lane tells the operator "a pacing job already covers patrol base N",
// and a pacing job sets no PATROL_BASE — so N is whatever `data/` says, not a
// number this tool gets to have an opinion about. It DID have one, in three
// places. A retune of patrol density would have left the tool announcing a
// stale base with total confidence, which is the same restated-constant defect
// that had both pacing instruments measuring five contract kinds out of six.
test("D70: the patrol default is DERIVED from the ruleset, never restated", () => {
  const citygen = JSON.parse(readFileSync(join(ROOT, "data/citygen.json"), "utf8"));
  const truth = citygen.patrols.perDistrictBase;

  // The env the lane would hand the worker for a patrol job with no explicit
  // base must equal the ruleset's own number.
  const env = KINDS.patrol.env({});
  assert.equal(Number(env.PATROL_BASE), truth,
    `the lane defaults patrol base to ${env.PATROL_BASE} while data/citygen.json says ${truth}`);

  // And the literal must not be lying around in the source to drift back in.
  // Comments stripped: guards read code, not prose (this repo's rule, twice
  // learned) — and the explanation above legitimately contains the number.
  const src = readFileSync(join(ROOT, "tools/batch.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fallbacks = [...src.matchAll(/\?\?\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(!fallbacks.includes(truth) || truth === 60000,
    `tools/batch.mjs still hardcodes ${truth} as a fallback; derive it from data/`);
});
