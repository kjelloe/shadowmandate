// server/ruleset.js — loads data/*.json and hands the engine a plain object.
//
// I/O lives here on purpose: the engine never reads a file. A world is created
// with a ruleset; the ruleset's version identifies the era its numbers belong
// to, which is what makes battery baselines comparable (S13/S14).

import { readFileSync } from "node:fs";

const DATA = new URL("../data/", import.meta.url).pathname;

export function loadRuleset() {
  const manifest = JSON.parse(readFileSync(DATA + "ruleset.json", "utf8"));
  const rules = { version: manifest.version };
  const nameOf = (file) => file.replace(/\.json$/, "");
  for (const file of manifest.files) {
    rules[nameOf(file)] = JSON.parse(readFileSync(DATA + file, "utf8"));
  }
  // Convenience aliases matching how the engine names its subsystems.
  rules.agents = rules.agents ?? {};
  rules.detection = rules.detection ?? {};
  rules.combat = rules.combat ?? {};
  rules.payloads = loadBuildingPayloads();
  rules.disguises = loadDisguises();
  return rules;
}

export function loadBuildingPayloads() {
  // Missing content is a real error, not a silent empty world: a shop with no
  // catalogue looks identical to a shop nobody can buy from.
  return JSON.parse(readFileSync(DATA + "buildings/payloads.json", "utf8"));
}

export function loadDisguises() {
  return JSON.parse(readFileSync(DATA + "buildings/disguises.json", "utf8"));
}
