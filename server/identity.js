// server/identity.js — seat tokens and recovery codes (S10, D10, D32).
//
// No accounts, no passwords, no email (that is V2). A browser holds a token;
// a human holds a recovery code. Identity is **per-server** (D32), so one code
// covers all of a player's Firms across that server's worlds.
//
// The recovery code is the only thing a player can lose and the only thing
// that can restore them, so it is shown ONCE, stored only as a hash, and made
// of words rather than characters — people transcribe words correctly.

import { createHash, randomBytes } from "node:crypto";

// A small, deliberately unambiguous word list: no homophones, no plurals of
// each other, nothing that sounds like another entry read aloud over a call.
const WORDS = [
  "amber", "anchor", "atlas", "beacon", "bishop", "borough", "cable", "cinder",
  "compass", "copper", "cradle", "current", "dagger", "dockyard", "ember",
  "fathom", "ferry", "gantry", "granite", "harbour", "hollow", "ivory",
  "jackal", "kestrel", "lantern", "ledger", "lumber", "marble", "meridian",
  "mortar", "needle", "nickel", "obsidian", "orchard", "parcel", "pewter",
  "quarry", "quartz", "ranger", "rivet", "sable", "signal", "sombre",
  "sterling", "tundra", "turbine", "velvet", "verdict", "walnut", "zephyr",
];

export const CODE_WORDS = 4;

export function generateToken() {
  return randomBytes(16).toString("hex");
}

export function generateRecoveryCode() {
  const picked = [];
  while (picked.length < CODE_WORDS) {
    // rejection sampling keeps the distribution even across the word list
    const byte = randomBytes(1)[0];
    if (byte >= 256 - (256 % WORDS.length)) continue;
    picked.push(WORDS[byte % WORDS.length]);
  }
  return picked.join("-");
}

// Stored as a hash, never in the clear: a leaked ledger file must not hand
// anyone else's Firm to whoever reads it.
export function hashCode(code) {
  return createHash("sha256").update(normaliseCode(code)).digest("hex");
}

// People type codes with stray capitals, spaces instead of dashes, and a
// trailing full stop. All of those should work.
export function normaliseCode(code) {
  return String(code ?? "").trim().toLowerCase().replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function looksLikeCode(code) {
  const parts = normaliseCode(code).split("-");
  return parts.length === CODE_WORDS && parts.every((w) => WORDS.includes(w));
}

// Issue a brand-new identity. The caller must show `recoveryCode` to the
// player exactly once — it is not recoverable from the store afterwards.
export function issueIdentity(store, firmId) {
  const token = generateToken();
  const recoveryCode = generateRecoveryCode();
  store.registerToken(token, hashCode(recoveryCode), firmId);
  return { token, recoveryCode, firmId };
}

export function resolveToken(store, token) {
  if (!token || typeof token !== "string") return null;
  const firmId = store.firmForToken(token);
  return firmId === null ? null : firmId;
}

// Claim an existing identity from a new browser. Returns a FRESH token: the
// old one keeps working too, because a player who reinstalls a browser should
// not lose the tab they still have open on their phone.
export function claimWithCode(store, code) {
  if (!looksLikeCode(code)) return { error: "malformed_code" };
  const firmId = store.firmForRecovery(hashCode(code));
  if (firmId === null) return { error: "unknown_code" };
  const token = generateToken();
  store.registerToken(token, hashCode(code), firmId);
  return { token, firmId };
}
