// engine/access.js — credentials and access control (S16, M8 slice 8e).
//
// The lock whose counter-play is not a widget (D45). S16's table is explicit:
// instead of a lock-picking mini-game, the challenge is "finding the credential,
// or the guard carrying it". So a credential is a thing you GO AND GET, and the
// interesting play is where you get it from:
//
//   - an informant sells you one (S09 dialogue),
//   - a vendor stocks one (S09 shop),
//   - or you take it off a guard you disabled (D6: disabled, never killed).
//
// The third source is the one that makes the system breathe: it turns a patrol
// from a thing to avoid into a thing you might deliberately seek out, which is
// a genuinely different way to play a stealth map.
//
// HASH-INERT. Credentials live in their own collection, empty until somebody
// holds one — same reason as alarms (8a): a world where nobody has a credential
// hashes exactly as it did before this file existed. `fixture_populated` is what
// keeps that from becoming a blind spot in the paired hash.
//
// A LEAF: imports nothing from the engine.

export const CRED_NONE = 0;

// Credentials are per-AGENT, not per-Firm. A Firm cannot buy one card and have
// every operative walk through the same door — the card is carried, and it is
// lost with the agent (S04 capture), which is what gives losing one a cost.
export function credentialTier(state, agentId) {
  let best = CRED_NONE;
  for (const c of state.credentials ?? []) {
    if (c.agentId === agentId && c.tier > best) best = c.tier;
  }
  return best;
}

export function hasCredential(state, agentId, tier) {
  return credentialTier(state, agentId) >= (tier | 0);
}

// Grant a credential. Idempotent per (agent, tier) so buying twice is not an
// error and does not stack — the reason a source can be re-used without the
// engine needing to know which sources have already been used.
export function grantCredential(state, agentId, tier, source) {
  if ((tier | 0) <= CRED_NONE) return false;
  const existing = (state.credentials ?? []).find(
    (c) => c.agentId === agentId && c.tier === (tier | 0));
  if (existing) return false;
  state.credentials.push({ agentId: agentId | 0, tier: tier | 0 });
  state.events.push({ type: "credentialGained", agentId, tier: tier | 0, source });
  return true;
}

// Lose every credential an agent holds. Called when they are captured or
// extract: a card does not survive being arrested, and it does not come back
// next sortie either. Credentials are per-SORTIE, which keeps them a thing you
// plan around rather than a permanent unlock — the same reasoning D50 applies
// to upgrades one level up.
export function clearCredentials(state, agentId) {
  const before = (state.credentials ?? []).length;
  state.credentials = (state.credentials ?? []).filter((c) => c.agentId !== agentId);
  const lost = before - state.credentials.length;
  if (lost > 0) state.events.push({ type: "credentialsLost", agentId, count: lost });
  return lost;
}

// Take the card off a guard you have disabled. THE interesting source, and the
// reason a patrol is not only an obstacle.
//
// The guard must actually be out. S04's disruptor previously set `alertTicks`
// to 0 — indistinguishable from a patrol that was never bothered — so it now
// stamps `stunnedUntil` and this reads that. Inventing a second notion of
// "disabled" here would have let the two systems drift apart.
export function liftCredentialFromGuard(state, agent, patrol, cfg) {
  if (!patrol) return { ok: false, reason: "no_guard" };
  if (!isDisrupted(patrol, state.tick)) return { ok: false, reason: "guard_not_disabled" };
  const acx = Math.floor(agent.x / 256), acy = Math.floor(agent.y / 256);
  if (Math.abs(acx - patrol.x) + Math.abs(acy - patrol.y) > 1) {
    return { ok: false, reason: "not_adjacent" };
  }
  const tier = cfg?.guardTier | 0;
  if (!grantCredential(state, agent.id, tier, "guard")) {
    return { ok: false, reason: "already_held" };
  }
  return { ok: true, tier };
}

// A patrol the player has put out of action with an item (S04). Kept as one
// named predicate so "disabled" means the same thing everywhere.
export function isDisrupted(patrol, tick) {
  return (patrol?.stunnedUntil | 0) > (tick | 0);
}
