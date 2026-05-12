import { describe, it, expect } from 'vitest';
import { BinReader, BinWriter, bytesPreview } from './binStream';

describe('BinReader / BinWriter primitives', () => {
  it('roundtrips every numeric primitive', () => {
    const w = new BinWriter(64);
    w.u8(0xA5).i8(-7)
     .u16(0xBEEF).i16(-1234)
     .u32(0xCAFEBABE).i32(-100000)
     .f32(3.5).f64(-2.71828);
    expect(w.pos).toBe(1+1+2+2+4+4+4+8);

    const r = new BinReader(w.toUint8Array());
    expect(r.u8()).toBe(0xA5);
    expect(r.i8()).toBe(-7);
    expect(r.u16()).toBe(0xBEEF);
    expect(r.i16()).toBe(-1234);
    expect(r.u32()).toBe(0xCAFEBABE);
    expect(r.i32()).toBe(-100000);
    expect(r.f32()).toBeCloseTo(3.5, 6);
    expect(r.f64()).toBeCloseTo(-2.71828, 10);
  });

  it('writes little-endian byte order', () => {
    const w = new BinWriter(4);
    w.u32(0x12345678);
    expect(Array.from(w.toUint8Array())).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it('bool8 roundtrip', () => {
    const w = new BinWriter(2);
    w.bool8(true).bool8(false);
    const r = new BinReader(w.toUint8Array());
    expect(r.bool8()).toBe(true);
    expect(r.bool8()).toBe(false);
  });

  it('skip / seek / remaining behave', () => {
    const r = new BinReader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(r.remaining).toBe(8);
    r.skip(3);
    expect(r.pos).toBe(3);
    expect(r.remaining).toBe(5);
    expect(r.u8()).toBe(4);
    r.seek(0);
    expect(r.u8()).toBe(1);
  });

  it('throws when reading past end', () => {
    const r = new BinReader(new Uint8Array(2));
    r.u8();
    expect(() => r.u32()).toThrow();
  });

  it('throws when writing past end', () => {
    const w = new BinWriter(3);
    expect(() => w.u32(0)).toThrow();
  });

  it('honors a window inside a larger buffer', () => {
    const big = new Uint8Array(16);
    new DataView(big.buffer).setUint32(8, 0xDEADBEEF, true);
    const r = new BinReader(big, 8, 4);
    expect(r.u32()).toBe(0xDEADBEEF);
    expect(r.remaining).toBe(0);
  });
});

describe('utf8 helpers', () => {
  it('utf8Nul roundtrips and pads with zeros', () => {
    const w = new BinWriter(8);
    w.utf8Nul('hi', 8);
    const bytes = w.toUint8Array();
    expect(bytes[0]).toBe(0x68);  // h
    expect(bytes[1]).toBe(0x69);  // i
    expect(bytes[2]).toBe(0);
    expect(bytes[7]).toBe(0);

    const r = new BinReader(bytes);
    expect(r.utf8Nul(8)).toBe('hi');
    expect(r.pos).toBe(8);
  });

  it('utf8Nul truncates to keep at least one trailing zero', () => {
    const w = new BinWriter(4);
    w.utf8Nul('abcd', 4);
    expect(Array.from(w.toUint8Array())).toEqual([0x61, 0x62, 0x63, 0]);
    expect(new BinReader(w.toUint8Array()).utf8Nul(4)).toBe('abc');
  });

  it('utf8Nul handles multi-byte characters', () => {
    const w = new BinWriter(8);
    w.utf8Nul('café', 8);
    expect(new BinReader(w.toUint8Array()).utf8Nul(8)).toBe('café');
  });

  it('utf8Fixed reads exactly n bytes with no NUL trim', () => {
    const w = new BinWriter(4);
    w.utf8Fixed('ab', 4); // pads with zero
    const r = new BinReader(w.toUint8Array());
    const s = r.utf8Fixed(4);
    expect(s.length).toBe(4); // includes two NUL chars
    expect(s.charCodeAt(0)).toBe(0x61);
    expect(s.charCodeAt(1)).toBe(0x62);
    expect(s.charCodeAt(2)).toBe(0);
    expect(s.charCodeAt(3)).toBe(0);
  });

  it('bytes() returns a sub-view, not a copy', () => {
    const big = new Uint8Array([1, 2, 3, 4, 5]);
    const r = new BinReader(big);
    const slice = r.bytes(3);
    expect(Array.from(slice)).toEqual([1, 2, 3]);
    expect(slice.buffer).toBe(big.buffer);
  });
});

describe('signed primitives sign-extend correctly', () => {
  it('i8 negative roundtrip', () => {
    const w = new BinWriter(1); w.i8(-1);
    expect(new BinReader(w.toUint8Array()).i8()).toBe(-1);
  });
  it('i16 negative roundtrip', () => {
    const w = new BinWriter(2); w.i16(-32000);
    expect(new BinReader(w.toUint8Array()).i16()).toBe(-32000);
  });
});

describe('bytesPreview', () => {
  it('formats hex with length and ellipsis', () => {
    expect(bytesPreview(new Uint8Array([1, 2, 3]), 16)).toBe('len=3 head=01 02 03');
    expect(bytesPreview(new Uint8Array([1, 2, 3, 4, 5]), 2)).toBe('len=5 head=01 02 …');
  });

  it('zero-pads hex bytes to width 2', () => {
    expect(bytesPreview(new Uint8Array([0x00, 0x0f, 0xa0]))).toBe('len=3 head=00 0f a0');
  });
});
