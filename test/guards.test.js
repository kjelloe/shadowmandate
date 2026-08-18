// test/guards.test.js — the standing invariants (S14). These land before
// content on purpose: the guards must exist before anything can violate them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "reports") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL_FILES = walk(ROOT);
const SOURCE = ALL_FILES.filter((f) => [".js", ".mjs"].includes(extname(f)));
const PURE = SOURCE.filter((f) => f.includes("/engine/") || f.includes("/shared/"));

test("D8: the banned term appears in no shipped artifact", () => {
  // Scope: everything that ships or renders — code, content, catalogs, assets.
  // Prose that DESCRIBES the ban (specs, plans, CLAUDE.md, this test) is not a
  // violation; a shipped identifier or string is. The repo codename in a path
  // is the one sanctioned occurrence.
  const SHIPPED = ALL_FILES.filter((f) =>
    ["/engine/", "/shared/", "/server/", "/client/", "/data/", "/tools/", "/debugging/"]
      .some((dir) => f.includes(dir))
    && ![".png", ".jpg", ".ico", ".gz"].includes(extname(f)));

  const offenders = [];
  for (const file of SHIPPED) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const [i, line] of text.split("\n").entries()) {
      const withoutCodename = line.replace(/multisyndicate/gi, "");
      if (/syndicat/i.test(withoutCodename)) {
        offenders.push(`${file.replace(ROOT, "")}:${i + 1}: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `banned term (D8) in shipped artifact:\n${offenders.join("\n")}`);
});

test("determinism: no Math.random, Date, or performance in engine/ or shared/", () => {
  const offenders = [];
  for (const file of PURE) {
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (line.trim().startsWith("//")) continue;
      if (/Math\.random|Date\.now|new Date|performance\.now/.test(line)) {
        offenders.push(`${file.replace(ROOT, "")}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `clock/entropy in pure code:\n${offenders.join("\n")}`);
});

test("determinism: no float literals or float ops in engine/ or shared/", () => {
  const offenders = [];
  for (const file of PURE) {
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      const code = line.split("//")[0];
      if (/\b\d+\.\d+\b/.test(code)) {
        offenders.push(`${file.replace(ROOT, "")}:${i + 1}: ${line.trim()}`);
      }
      // Math.floor/trunc are the sanctioned integer paths; Math.round on a
      // division is how float creep starts.
      if (/Math\.(sin|cos|tan|sqrt|pow|random|log|exp)\s*\(/.test(code)) {
        offenders.push(`${file.replace(ROOT, "")}:${i + 1}: float math: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `float risk in pure code:\n${offenders.join("\n")}`);
});

test("determinism: no I/O imports in engine/ or shared/", () => {
  const offenders = [];
  for (const file of PURE) {
    const text = readFileSync(file, "utf8");
    if (/from\s+["'](node:)?(fs|net|http|https|ws|path|child_process)["']/.test(text)) {
      offenders.push(file.replace(ROOT, ""));
    }
  }
  assert.deepEqual(offenders, [], `I/O in pure code: ${offenders.join(", ")}`);
});

test("D6: no entity-deletion event exists in the engine", () => {
  // Disable-only doctrine: agents are downed, captured, or held — never killed
  // and never spliced out of existence. This guard is why that stays true.
  const offenders = [];
  for (const file of PURE) {
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      const code = line.split("//")[0];
      if (/type:\s*["'](killed|died|death|destroyed|agentKilled)["']/.test(code)) {
        offenders.push(`${file.replace(ROOT, "")}:${i + 1}: ${line.trim()}`);
      }
      // Removing an agent from the roster would break id-stable indexing too.
      if (/agents\.splice|agents\s*=\s*.*filter/.test(code)) {
        offenders.push(`${file.replace(ROOT, "")}:${i + 1}: agent removal: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `D6 violation:\n${offenders.join("\n")}`);
});

test("no runtime dependencies are imported by engine/ or shared/", () => {
  const offenders = [];
  for (const file of PURE) {
    // Strip comments first: the naive scan matched the phrase
    // `from "this seat is lucky"` inside a prose comment and reported it as a
    // dependency. A guard that fires on English is a guard nobody trusts.
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
    const imports = [...text.matchAll(/^\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm)]
      .map((m) => m[1]);
    for (const spec of imports) {
      if (!spec.startsWith(".") && !spec.startsWith("node:")) {
        offenders.push(`${file.replace(ROOT, "")}: ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `dependency in pure code: ${offenders.join(", ")}`);
});

test("ops boundary: private machine detail stays out of the tracked tree", () => {
  // 2026-08-16: deploy runbooks and the batch lane moved to gitignored ops/
  // after LAN IPs, hub ports and netsh runbook lines were found duplicated
  // across tracked docs (plan-implementation-order.md carried the whole
  // bring-up wholesale). The guard matches the FORMS the leak actually took:
  // a 192.168 LAN address, the sibling hub ports 8970-8972 as standalone
  // numbers (local test ports 8977-8979 stay legal), and netsh lines.
  const LEAKS = [
    [/\b192\.168\.\d{1,3}\.\d{1,3}\b/, "LAN IP"],
    [/\bnetsh\b/i, "netsh runbook line"],
    [/\b897[0-2]\b/, "agent-mail hub port"],
  ];
  const SELF = new URL(import.meta.url).pathname;
  // ops/ is the sanctioned home; .claude/, .agent-mail/ and the dev-*.md
  // journals are gitignored and local-only.
  const TRACKED = ALL_FILES.filter((f) =>
    !["/ops/", "/.claude/", "/.agent-mail/"].some((d) => f.includes(d))
    && !/dev-(log|prompts|questions)\.md$/.test(f)
    && f !== SELF
    && ![".png", ".jpg", ".ico", ".gz"].includes(extname(f)));

  const offenders = [];
  for (const file of TRACKED) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const [i, line] of text.split("\n").entries()) {
      for (const [re, what] of LEAKS) {
        if (re.test(line)) {
          offenders.push(`${file.replace(ROOT, "")}:${i + 1} (${what}): ${line.trim().slice(0, 80)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `private ops detail in tracked file:\n${offenders.join("\n")}`);

  // The boundary itself: ops must stay gitignored, or the next commit
  // re-publishes everything the move just removed. The pattern must be "ops"
  // WITHOUT a trailing slash — ops is a symlink into the private repo
  // checkout, and "ops/" only matches a real directory, so the slashed form
  // leaves the link itself unignored (found live: git showed "?? ops").
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^ops$/m, '.gitignore must contain a bare "ops" line (no trailing slash)');
});
