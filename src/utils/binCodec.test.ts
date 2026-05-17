import { describe, it, expect } from 'vitest';
import { BinReader, BinWriter } from './binStream';
import { Codec } from './binCodec';

const {
  u8, u16, u32, i8, i16, i32, f32, f64, bool8,
  arr, struct, reserved, nulStr, fixedStr,
  encode, decode, decodePadded, sizeOf,
} = Codec;

describe('codec primitives', () => {
  it('u32 codec carries fixed size', () => {
    expect(u32.size).toBe(4);
  });

  it('arr codec roundtrips an array of f32', () => {
    const codec = arr(f32, 3);
    expect(codec.size).toBe(12);
    const w = new BinWriter(12);
    codec.write(w, [1.5, -2.25, 3.125]);
    const r = new BinReader(w.toUint8Array());
    expect(codec.read(r)).toEqual([1.5, -2.25, 3.125]);
  });

  it('reserved codec writes zeros and skips on read', () => {
    const w = new BinWriter(4);
    w.u8(0xFF);  // sentinel
    reserved(2).write(w, undefined);
    w.u8(0xFF);
    expect(Array.from(w.toUint8Array())).toEqual([0xFF, 0, 0, 0xFF]);
  });
});

describe('struct combinator', () => {
  const PointCodec = struct({
    x: f32,
    y: f32,
    flag: bool8,
    _pad: reserved(3),
  });

  it('exposes the byte size and parses round-trip', () => {
    expect(PointCodec.size).toBe(12);
    const w = new BinWriter(12);
    PointCodec.write(w, { x: 1.5, y: -2.5, flag: true });
    const r = new BinReader(w.toUint8Array());
    const v = PointCodec.read(r);
    expect(v).toEqual({ x: 1.5, y: -2.5, flag: true });
    expect('_pad' in v).toBe(false);
  });

  it('zeros padding bytes on write', () => {
    const w = new BinWriter(12);
    PointCodec.write(w, { x: 0, y: 0, flag: false });
    const bytes = w.toUint8Array();
    expect(bytes[9]).toBe(0);
    expect(bytes[10]).toBe(0);
    expect(bytes[11]).toBe(0);
  });

  it('arr of struct works', () => {
    const Triple = arr(struct({ a: u8, b: u16 }), 2);
    expect(Triple.size).toBe(6);
    const w = new BinWriter(6);
    Triple.write(w, [{ a: 1, b: 0x0203 }, { a: 4, b: 0x0506 }]);
    expect(Array.from(w.toUint8Array())).toEqual([1, 0x03, 0x02, 4, 0x06, 0x05]);
  });
});

describe('nulStr / fixedStr codecs', () => {
  it('nulStr roundtrip', () => {
    const c = nulStr(16);
    expect(c.size).toBe(16);
    const w = new BinWriter(16);
    c.write(w, 'hello');
    expect(c.read(new BinReader(w.toUint8Array()))).toBe('hello');
  });

  it('fixedStr.size matches its declared byte count', () => {
    expect(fixedStr(4).size).toBe(4);
  });
});

describe('codec ⇄ manual interop', () => {
  it('struct read aligns with manual reader after the same prefix', () => {
    const C = struct({ a: u8, b: u32 });
    const w = new BinWriter(8);
    C.write(w, { a: 0x10, b: 0x11223344 });
    w.u8(0xAA);
    const r = new BinReader(w.toUint8Array());
    expect(C.read(r)).toEqual({ a: 0x10, b: 0x11223344 });
    expect(r.u8()).toBe(0xAA);
  });
});

describe('encode / decode helpers', () => {
  it('roundtrips an f32 via the codec', () => {
    const bytes = encode(Codec.f32, 3.5);
    expect(bytes.byteLength).toBe(4);
    expect(decode(Codec.f32, bytes)).toBeCloseTo(3.5, 6);
  });

  it('roundtrips a struct codec', () => {
    const C = struct({ a: u8, b: f32 });
    const bytes = encode(C, { a: 7, b: -1.25 });
    expect(bytes.byteLength).toBe(5);
    expect(decode(C, bytes)).toEqual({ a: 7, b: -1.25 });
  });

  it('encode throws on variable-size codecs', () => {
    const variable = { read: () => 0, write: () => {} } as const;
    expect(() => encode(variable as any, 0)).toThrow();
  });
});

describe('decodePadded', () => {
  it('matches decode when the buffer is full-sized', () => {
    const C = struct({ a: u8, b: f32 });
    const bytes = encode(C, { a: 7, b: -1.25 });
    expect(decodePadded(C, bytes)).toEqual({ a: 7, b: -1.25 });
  });

  it('zero-pads a short nulStr buffer to the declared size', () => {
    const enc = new TextEncoder();
    expect(decodePadded(nulStr(32), enc.encode('ABC123\0'))).toBe('ABC123');
  });

  it('decodes a struct with trailing nulStr from a short buffer', () => {
    const C = struct({ kind: u8, name: nulStr(31) });
    const enc = new TextEncoder();
    const buf = new Uint8Array(8);
    buf[0] = 0x42;
    buf.set(enc.encode('hi'), 1);
    expect(decodePadded(C, buf)).toEqual({ kind: 0x42, name: 'hi' });
  });

  it('handles a 0-byte input by returning the all-zero shape', () => {
    expect(decodePadded(nulStr(16), new Uint8Array(0))).toBe('');
    expect(decodePadded(Codec.f32, new Uint8Array(0))).toBe(0);
  });

  it('does not copy when the buffer is already large enough', () => {
    const bytes = encode(Codec.u32, 0x12345678);
    expect(decodePadded(Codec.u32, bytes)).toBe(0x12345678);
  });

  it('throws on variable-size codecs', () => {
    const variable = { read: () => 0, write: () => {} } as const;
    expect(() => decodePadded(variable as any, new Uint8Array(0))).toThrow();
  });
});

describe('sizeOf', () => {
  it('returns the byte size of fixed codecs', () => {
    expect(sizeOf(Codec.f32)).toBe(4);
    expect(sizeOf(arr(Codec.u16, 5))).toBe(10);
    expect(sizeOf(struct({ a: u8, b: f32 }))).toBe(5);
  });

  it('throws on variable-size codecs', () => {
    const variable = { read: () => 0, write: () => {} } as const;
    expect(() => sizeOf(variable as any)).toThrow();
  });
});

describe('every primitive codec carries the right size', () => {
  it('reports static byte sizes', () => {
    expect(u8.size).toBe(1);
    expect(i8.size).toBe(1);
    expect(u16.size).toBe(2);
    expect(i16.size).toBe(2);
    expect(u32.size).toBe(4);
    expect(i32.size).toBe(4);
    expect(f32.size).toBe(4);
    expect(f64.size).toBe(8);
    expect(bool8.size).toBe(1);
    expect(fixedStr(4).size).toBe(4);
  });
});

describe('nulStr — wire-budget invariant', () => {
  // Per user_presets_spec.md §REQ_PRESET_SET_NAME / §REQ_SET_CHANNEL_NAME:
  // "Host MUST send exactly 32 bytes (short transfers cause USB reset on
  // some controllers)". These tests pin that the encoder always emits the
  // full window regardless of input length so the contract can't silently
  // regress.

  it('emits exactly 32 bytes for an empty string', () => {
    const out = encode(nulStr(32), '');
    expect(out.byteLength).toBe(32);
    expect(Array.from(out)).toEqual(new Array(32).fill(0));
  });

  it('emits exactly 32 bytes for a 5-char ASCII string with trailing NUL padding', () => {
    const out = encode(nulStr(32), 'Hello');
    expect(out.byteLength).toBe(32);
    expect(out[0]).toBe(0x48); // 'H'
    expect(out[4]).toBe(0x6F); // 'o'
    expect(out[5]).toBe(0x00); // NUL terminator
    // Remaining bytes should all be zero.
    for (let i = 6; i < 32; i++) expect(out[i]).toBe(0);
  });

  it('emits exactly 32 bytes when input is longer than the window, with byte 31 forced NUL', () => {
    const long = 'A'.repeat(64);
    const out = encode(nulStr(32), long);
    expect(out.byteLength).toBe(32);
    // First 31 bytes are 'A' (0x41); byte 31 must be NUL — reader.utf8Nul
    // walks until NUL within maxBytes, so dropping the terminator would
    // bleed beyond the buffer on read.
    for (let i = 0; i < 31; i++) expect(out[i]).toBe(0x41);
    expect(out[31]).toBe(0x00);
  });

  it('emits exactly 32 bytes for a multi-byte UTF-8 string', () => {
    // "café" = 5 bytes UTF-8 (c, a, f, [0xC3, 0xA9]).
    const out = encode(nulStr(32), 'café');
    expect(out.byteLength).toBe(32);
    expect(out[0]).toBe(0x63); // 'c'
    expect(out[3]).toBe(0xC3); // first byte of 'é'
    expect(out[4]).toBe(0xA9); // second byte of 'é'
    expect(out[5]).toBe(0x00); // NUL terminator
  });
});
