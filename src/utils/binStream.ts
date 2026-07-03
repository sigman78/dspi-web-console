// Cursor-based little-endian binary reader/writer over `Uint8Array`, no codec
// knowledge. Reads return sub-views (no copy) and never advance past the end;
// writes target a fixed-size buffer that never grows. Codec layer: ./binCodec.ts.

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

export class BinReader {
  private readonly view: DataView;
  private readonly end: number;
  pos: number;

  constructor(buf: Uint8Array, offset = 0, length = buf.byteLength - offset) {
    if (offset < 0 || length < 0 || offset + length > buf.byteLength) {
      throw new RangeError(`BinReader: out-of-range window offset=${offset} length=${length} buf=${buf.byteLength}`);
    }
    this.view = new DataView(buf.buffer, buf.byteOffset + offset, length);
    this.end = length;
    this.pos = 0;
  }

  get remaining(): number { return this.end - this.pos; }

  private take(n: number): number {
    const at = this.pos;
    if (at + n > this.end) {
      throw new RangeError(`BinReader: read past end (need ${n} at ${at}, end ${this.end})`);
    }
    this.pos = at + n;
    return at;
  }

  skip(n: number): this { this.take(n); return this; }
  seek(absolute: number): this {
    if (absolute < 0 || absolute > this.end) {
      throw new RangeError(`BinReader: seek out of range ${absolute}`);
    }
    this.pos = absolute;
    return this;
  }

  bytes(n: number): Uint8Array {
    const at = this.take(n);
    return new Uint8Array(this.view.buffer, this.view.byteOffset + at, n);
  }

  u8():  number { return this.view.getUint8(this.take(1)); }
  i8():  number { return this.view.getInt8(this.take(1)); }
  u16(): number { return this.view.getUint16(this.take(2), true); }
  i16(): number { return this.view.getInt16(this.take(2), true); }
  u32(): number { return this.view.getUint32(this.take(4), true); }
  i32(): number { return this.view.getInt32(this.take(4), true); }
  f32(): number { return this.view.getFloat32(this.take(4), true); }
  bool8(): boolean { return this.u8() !== 0; }

  // Read up to a NUL within the next `maxBytes`; always advances by `maxBytes`.
  utf8Nul(maxBytes: number): string {
    const at = this.take(maxBytes);
    const buf = new Uint8Array(this.view.buffer, this.view.byteOffset + at, maxBytes);
    let len = 0;
    while (len < maxBytes && buf[len] !== 0) len++;
    return TEXT_DECODER.decode(buf.subarray(0, len));
  }

  // Read exactly `n` bytes as UTF-8 with no NUL trim.
  utf8Fixed(n: number): string {
    const at = this.take(n);
    return TEXT_DECODER.decode(new Uint8Array(this.view.buffer, this.view.byteOffset + at, n));
  }
}

export class BinWriter {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  pos: number;

  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }

  get remaining(): number { return this.buf.byteLength - this.pos; }

  private take(n: number): number {
    const at = this.pos;
    if (at + n > this.buf.byteLength) {
      throw new RangeError(`BinWriter: write past end (need ${n} at ${at}, size ${this.buf.byteLength})`);
    }
    this.pos = at + n;
    return at;
  }

  skip(n: number): this { this.take(n); return this; }
  seek(absolute: number): this {
    if (absolute < 0 || absolute > this.buf.byteLength) {
      throw new RangeError(`BinWriter: seek out of range ${absolute}`);
    }
    this.pos = absolute;
    return this;
  }

  bytes(b: Uint8Array): this {
    const at = this.take(b.byteLength);
    this.buf.set(b, at);
    return this;
  }

  u8(v:  number): this { this.view.setUint8(this.take(1), v); return this; }
  i8(v:  number): this { this.view.setInt8(this.take(1), v); return this; }
  u16(v: number): this { this.view.setUint16(this.take(2), v, true); return this; }
  i16(v: number): this { this.view.setInt16(this.take(2), v, true); return this; }
  u32(v: number): this { this.view.setUint32(this.take(4), v, true); return this; }
  i32(v: number): this { this.view.setInt32(this.take(4), v, true); return this; }
  f32(v: number): this { this.view.setFloat32(this.take(4), v, true); return this; }
  bool8(v: boolean): this { return this.u8(v ? 1 : 0); }

  // Write `s` UTF-8 into a fixed `maxBytes` window, NUL-padded; truncates to
  // leave at least one trailing zero.
  utf8Nul(s: string, maxBytes: number): this {
    const at = this.take(maxBytes);
    const enc = TEXT_ENCODER.encode(s);
    const n = Math.min(enc.byteLength, maxBytes - 1);
    this.buf.set(enc.subarray(0, n), at);
    return this;
  }

  // Write `s` UTF-8 into exactly `n` bytes (truncate or zero-pad).
  utf8Fixed(s: string, n: number): this {
    const at = this.take(n);
    const enc = TEXT_ENCODER.encode(s);
    this.buf.set(enc.subarray(0, n), at);
    return this;
  }

  // The underlying buffer, not a copy.
  toUint8Array(): Uint8Array { return this.buf; }
}

// Hex preview of the first `n` bytes for diagnostic logs.
export function bytesPreview(buf: Uint8Array, n = 16): string {
  const head = Array.from(buf.subarray(0, n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `len=${buf.length} head=${head}${buf.length > n ? ' …' : ''}`;
}
