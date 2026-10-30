import { describe, it, expect } from 'vitest';
import * as Frames from './frames';

describe('decodeFrame', () => {
  it('rejects a truncated header', () => {
    expect(() => Frames.decodeFrame(new Uint8Array([Frames.FrameType.Ok, 1, 0, 0]))).toThrow();
  });

  it('rejects an unknown type', () => {
    expect(() => Frames.decodeFrame(new Uint8Array([0x7f, 0, 0, 0, 0]))).toThrow();
  });

  it('rejects a CTRL_OUT whose len exceeds the frame', () => {
    const buf = Frames.encodeFrame({ type: 'ctrlOut', id: 1, request: 0x40, value: 0, data: new Uint8Array(4) });
    new DataView(buf.buffer).setUint16(8, 100, true);
    expect(() => Frames.decodeFrame(buf)).toThrow();
  });

  it('rejects trailing bytes on a fixed-size frame', () => {
    const buf = Frames.encodeFrame({ type: 'ctrlIn', id: 1, request: 0x40, value: 0, length: 4 });
    const padded = new Uint8Array(buf.length + 1);
    padded.set(buf);
    expect(() => Frames.decodeFrame(padded)).toThrow();
  });

  it('rejects a frame beyond the wire limit', () => {
    const buf = new Uint8Array(Frames.MAX_FRAME_BYTES + 1);
    buf[0] = Frames.FrameType.Ok;
    expect(() => Frames.decodeFrame(buf)).toThrow();
  });
});

describe('frame round trips', () => {
  it('carries a full-size CTRL_OUT payload', () => {
    const data = Uint8Array.from({ length: Frames.MAX_PAYLOAD }, (_, i) => i & 0xff);
    const back = Frames.decodeFrame(Frames.encodeFrame({ type: 'ctrlOut', id: 0xdeadbeef, request: 0xa1, value: 0x1234, data }));
    expect(back).toEqual({ type: 'ctrlOut', id: 0xdeadbeef, request: 0xa1, value: 0x1234, data });
  });

  it('carries an empty OK', () => {
    const back = Frames.decodeFrame(Frames.encodeFrame({ type: 'ok', id: 7, data: new Uint8Array(0) }));
    expect(back).toEqual({ type: 'ok', id: 7, data: new Uint8Array(0) });
  });

  it('truncates long multibyte ERR text on a character boundary', () => {
    const back = Frames.decodeFrame(Frames.encodeFrame({ type: 'err', id: 3, kind: 1, message: 'é'.repeat(300) }));
    if (back.type !== 'err') throw new Error('wrong type');
    expect(back.message).toBe('é'.repeat(127));
  });

  it('carries the handshake frames', () => {
    const hello = Frames.decodeFrame(Frames.encodeFrame({ type: 'hello', version: 1, wantReadOnly: true, consoleBuild: 'abc' }));
    expect(hello).toEqual({ type: 'hello', version: 1, wantReadOnly: true, consoleBuild: 'abc' });
    const welcome = Frames.decodeFrame(Frames.encodeFrame({ type: 'welcome', version: 1, leaseKind: 1, hasNotify: false, consoleBuild: 'x' }));
    expect(welcome).toEqual({ type: 'welcome', version: 1, leaseKind: 1, hasNotify: false, consoleBuild: 'x' });
  });
});
