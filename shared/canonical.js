// shared/canonical.js — canonical byte serialization + FNV-1a 64 hashing.
// Reconstructed for the 1E contract from test/fixtures/0A + 0B (milestone 0).
// All output is little-endian bytes; all inputs are validated integers.
// 64-bit hashing uses 32-bit limb arithmetic (no BigInt) to stay Luau-portable.

function assertIntInRange(v, min, max, label) {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${label} out of range: ${v}`);
  }
}

export function createByteWriter() {
  const bytes = [];
  const w = {
    writeU8(v) {
      assertIntInRange(v, 0, 0xFF, "u8");
      bytes.push(v);
      return w;
    },
    writeU16LE(v) {
      assertIntInRange(v, 0, 0xFFFF, "u16");
      bytes.push(v & 0xFF, (v >>> 8) & 0xFF);
      return w;
    },
    writeU32LE(v) {
      assertIntInRange(v, 0, 0xFFFFFFFF, "u32");
      bytes.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
      return w;
    },
    writeI32LE(v) {
      assertIntInRange(v, -0x80000000, 0x7FFFFFFF, "i32");
      const u = v >>> 0;
      bytes.push(u & 0xFF, (u >>> 8) & 0xFF, (u >>> 16) & 0xFF, (u >>> 24) & 0xFF);
      return w;
    },
    writeBool(v) {
      if (typeof v !== "boolean") throw new RangeError(`bool expected: ${v}`);
      bytes.push(v ? 1 : 0);
      return w;
    },
    writeOptionalU32(isPresent, value) {
      if (typeof isPresent !== "boolean") throw new RangeError(`bool expected: ${isPresent}`);
      bytes.push(isPresent ? 1 : 0);
      if (isPresent) w.writeU32LE(value);
      return w;
    },
    writeBytes(data) {
      for (const b of data) {
        assertIntInRange(b, 0, 0xFF, "byte");
        bytes.push(b);
      }
      return w;
    },
    writeUtf8U16(str) {
      if (typeof str !== "string") throw new RangeError(`string expected: ${str}`);
      const encoded = utf8Encode(str);
      if (encoded.length > 0xFFFF) throw new RangeError("utf8 string too long for u16 length");
      w.writeU16LE(encoded.length);
      for (const b of encoded) bytes.push(b);
      return w;
    },
    toBytes() {
      return new Uint8Array(bytes);
    },
  };
  return w;
}

function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code > 0xFFFF) i++; // surrogate pair consumed
    if (code <= 0x7F) {
      out.push(code);
    } else if (code <= 0x7FF) {
      out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code <= 0xFFFF) {
      out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      out.push(
        0xF0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3F),
        0x80 | ((code >> 6) & 0x3F),
        0x80 | (code & 0x3F)
      );
    }
  }
  return out;
}

// FNV-1a 64-bit. offset basis = 0xcbf29ce484222325, prime = 0x100000001b3.
// State is kept as four 16-bit limbs (lo to hi) so every multiply stays exact
// inside JS doubles and the algorithm ports directly to Luau integers.
const FNV_OFFSET = [0x2325, 0x8422, 0x9ce4, 0xcbf2];
const FNV_PRIME = [0x01b3, 0x0000, 0x0100, 0x0000]; // 0x00000100000001b3

export function computeFnv1a64(data) {
  let h0 = FNV_OFFSET[0], h1 = FNV_OFFSET[1], h2 = FNV_OFFSET[2], h3 = FNV_OFFSET[3];
  for (let i = 0; i < data.length; i++) {
    h0 ^= data[i];
    // 64-bit multiply h * FNV_PRIME over 16-bit limbs, keeping low 64 bits.
    // prime limbs: p0=0x01b3, p2=0x0100 (p1 = p3 = 0)
    const p0 = 0x01b3;
    let c0 = h0 * p0;
    let c1 = h1 * p0;
    let c2 = h2 * p0 + h0 * 0x0100;
    let c3 = h3 * p0 + h1 * 0x0100;
    h0 = c0 & 0xFFFF;
    c1 += c0 >>> 16;
    h1 = c1 & 0xFFFF;
    c2 += Math.floor(c1 / 0x10000);
    h2 = c2 & 0xFFFF;
    c3 += Math.floor(c2 / 0x10000);
    h3 = c3 & 0xFFFF;
  }
  return {
    hashHi: ((h3 << 16) | h2) >>> 0,
    hashLo: ((h1 << 16) | h0) >>> 0,
  };
}

export function hashToHex64(hashHi, hashLo) {
  return (
    (hashHi >>> 0).toString(16).padStart(8, "0") +
    (hashLo >>> 0).toString(16).padStart(8, "0")
  );
}

export function assertU32(v) {
  if ((v >>> 0) !== v) throw new TypeError("expected u32");
  return v >>> 0;
}

export function assertI32(v) {
  if ((v | 0) !== v) throw new TypeError("expected i32");
  return v | 0;
}
