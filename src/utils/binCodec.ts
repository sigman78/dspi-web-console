// Composable codec layer on top of BinReader/BinWriter. A `BinCodec<T>` reads
// and writes a `T` and carries a static byte size when known. Everything lives
// on the `Codec` namespace; schema-dense call sites destructure it
// (`const { u8, struct, arr } = Codec`).

import { BinReader, BinWriter } from './binStream';

export interface BinCodec<T> {
  readonly size?: number; // size in bytes if known, `undefined` for variable length
  read(r: BinReader): T;
  write(w: BinWriter, v: T): void;
}

type FieldsOf<T> = { [K in keyof T]: BinCodec<T[K]> };

type StripPad<T> = { [K in keyof T as K extends `_${string}` ? never : K]: T[K] };

type StructValue<F> = StripPad<{ [K in keyof F]: F[K] extends BinCodec<infer V> ? V : never }>;

export type { FieldsOf, StructValue };

const prim = <T>(size: number, read: (r: BinReader) => T, write: (w: BinWriter, v: T) => void): BinCodec<T> =>
  ({ size, read, write });

// Skip `n` bytes on read; emit `n` zero bytes on write.  Useful for inline padding/reserved fields.
function reserved(n: number): BinCodec<undefined> {
  return {
    size: n,
    read(r) { r.skip(n); return undefined; },
    // Writer's buffer is already zero, so skip(n) leaves the padding zeroed.
    write(w) { w.skip(n); },
  };
}

// Fixed-length array of `n` elements of the same codec
function arr<T>(codec: BinCodec<T>, n: number): BinCodec<T[]> {
  const elemSize = codec.size;
  return {
    size: elemSize === undefined ? undefined : elemSize * n,
    read(r) {
      const out: T[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = codec.read(r);
      return out;
    },
    write(w, v) {
      for (let i = 0; i < n; i++) codec.write(w, v[i]);
    },
  };
}

// NUL-terminated UTF-8 inside a fixed window of `maxBytes`.
function nulStr(maxBytes: number): BinCodec<string> {
  return {
    size: maxBytes,
    read(r) { return r.utf8Nul(maxBytes); },
    write(w, v) { w.utf8Nul(v, maxBytes); },
  };
}

// `fixedStr` (here) and `f64` (in Codec below) round out the codec set as a
// deliberately-complete, symmetric primitive layer. Neither has a current wire
// caller -- the live wire format uses only NUL-terminated strings and 32-bit
// scalars -- but they are retained so the primitive set stays whole.
// Exactly `n` bytes of UTF-8, no NUL trim.
function fixedStr(n: number): BinCodec<string> {
  return {
    size: n,
    read(r) { return r.utf8Fixed(n); },
    write(w, v) { w.utf8Fixed(v, n); },
  };
}

// Schema: keys map to codecs. Keys starting with "_" are padding/reserved slots;
// they are read/written in place but stripped from the result type.
function struct<F extends Record<string, BinCodec<any>>>(fields: F): BinCodec<StructValue<F>> {
  const entries = Object.entries(fields);
  let total = 0;
  let allFixed = true;
  for (const [, c] of entries) {
    if (c.size === undefined) { allFixed = false; break; }
    total += c.size;
  }
  return {
    size: allFixed ? total : undefined,
    read(r) {
      const out: Record<string, unknown> = {};
      for (const [name, codec] of entries) {
        const v = codec.read(r);
        if (!name.startsWith('_')) out[name] = v;
      }
      return out as StructValue<F>;
    },
    write(w, v) {
      const obj = v as unknown as Record<string, unknown>;
      for (const [name, codec] of entries) {
        if (name.startsWith('_')) {
          codec.write(w, undefined as never);
        } else {
          codec.write(w, obj[name] as never);
        }
      }
    },
  };
}

// Byte size of a fixed-width codec.  Throws if the codec is variable-width
function sizeOf<T>(codec: BinCodec<T>): number {
  if (codec.size === undefined) {
    throw new Error('Codec.sizeOf: codec has no fixed size');
  }
  return codec.size;
}

// Encode a value with a fixed-size codec.  Throws if the codec is variable-width
function encode<T>(codec: BinCodec<T>, value: T): Uint8Array {
  const w = new BinWriter(sizeOf(codec));
  codec.write(w, value);
  return w.toUint8Array();
}

// Decode bytes with any codec; strict, throws if the buffer is too short.
function decode<T>(codec: BinCodec<T>, bytes: Uint8Array): T {
  return codec.read(new BinReader(bytes));
}

// Zero-pad a short buffer up to `codec.size` before decoding, for boundaries
// where the source legitimately truncates (USB control-IN, implicit-zero tails).
// Use sparingly: it masks "buffer too short" bugs; prefer strict `decode` for
// already-validated internal buffers.
function decodePadded<T>(codec: BinCodec<T>, bytes: Uint8Array): T {
  const size = sizeOf(codec);
  if (bytes.byteLength >= size) return decode(codec, bytes);
  const padded = new Uint8Array(size);
  padded.set(bytes);
  return decode(codec, padded);
}

// All entries are little-endian.
export const Codec = {
  u8:    prim<number> (1, r => r.u8(),    (w, v) => { w.u8(v); }),
  i8:    prim<number> (1, r => r.i8(),    (w, v) => { w.i8(v); }),
  u16:   prim<number> (2, r => r.u16(),   (w, v) => { w.u16(v); }),
  i16:   prim<number> (2, r => r.i16(),   (w, v) => { w.i16(v); }),
  u32:   prim<number> (4, r => r.u32(),   (w, v) => { w.u32(v); }),
  i32:   prim<number> (4, r => r.i32(),   (w, v) => { w.i32(v); }),
  f32:   prim<number> (4, r => r.f32(),   (w, v) => { w.f32(v); }),
  f64:   prim<number> (8, r => r.f64(),   (w, v) => { w.f64(v); }),
  bool8: prim<boolean>(1, r => r.bool8(), (w, v) => { w.bool8(v); }),
  reserved,
  arr,
  nulStr,
  fixedStr,
  struct,
  encode,
  decode,
  decodePadded,
  sizeOf,
};
