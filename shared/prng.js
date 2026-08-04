// shared/prng.js — deterministic PRNG primitives.
// Reconstructed for the 1E contract from test/fixtures/0C + 0D (milestone 0).
// mix32 algorithm (pinned in fixture 0C):
//   v ^= v>>>16; v *= 0x45d9f3b; v ^= v>>>16; v *= 0x45d9f3b; v ^= v>>>16
// seedSfc32 expands a root seed via mix32(seed+1..seed+4); sfc32Next is the
// standard sfc32 step with d acting as the stream counter.

export function mix32(v) {
  v = v >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  v = Math.imul(v, 0x45d9f3b) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  v = Math.imul(v, 0x45d9f3b) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  return v;
}

export function seedSfc32(rootSeed) {
  const s = rootSeed >>> 0;
  return {
    a: mix32((s + 1) >>> 0),
    b: mix32((s + 2) >>> 0),
    c: mix32((s + 3) >>> 0),
    d: mix32((s + 4) >>> 0),
  };
}

export function sfc32Next(state) {
  const t = (state.a + state.b + state.d) >>> 0;
  const d = (state.d + 1) >>> 0;
  const a = (state.b ^ (state.b >>> 9)) >>> 0;
  const b = (state.c + ((state.c << 3) >>> 0)) >>> 0;
  const c = ((((state.c << 21) | (state.c >>> 11)) >>> 0) + t) >>> 0;
  return { value: t, nextState: { a, b, c, d } };
}
