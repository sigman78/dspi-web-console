import { describe, it, expect } from 'vitest';
import type { DspTransport } from '../transport/DspTransport';
import { Codec } from '../utils';
import { WireCmd, readCmd, writeCmd } from './wireCmd';

// Minimal in-memory transport for unit tests.
function fakeTransport(opts: {
  in?: (request: number, value: number, length: number) => Uint8Array;
  out?: (request: number, value: number, data: Uint8Array) => void;
}): DspTransport {
  return {
    open:    async () => {},
    close:   async () => {},
    isOpen:  () => true,
    on:      () => () => {},
    ctrlIn:  async (req, val, len) => opts.in?.(req, val, len) ?? new Uint8Array(len),
    ctrlOut: async (req, val, data) => { opts.out?.(req, val, data); },
  };
}

describe('readCmd', () => {
  it('decodes a fixed-size codec payload', async () => {
    const t = fakeTransport({ in: () => Codec.encode(Codec.f32, -7.25) });
    expect(await readCmd(t, WireCmd.GetMasterVolume)).toBeCloseTo(-7.25, 5);
  });

  // Hardware regression: USB control-IN truncates to actual payload size.
  // readCmd must hand off through `decodePadded` so the trailing-NUL
  // semantics still decode correctly.  (The padding logic itself is
  // tested in binStream.test.ts.)
  it('survives a short USB control-IN response', async () => {
    const enc = new TextEncoder();
    const t = fakeTransport({ in: () => enc.encode('ABC123\0') });
    expect(await readCmd(t, WireCmd.GetSerial)).toBe('ABC123');
  });
});

describe('writeCmd', () => {
  it('encodes the payload and writes via ctrlOut', async () => {
    let captured: { req: number; data: Uint8Array } | null = null;
    const t = fakeTransport({
      out: (req, _val, data) => { captured = { req, data }; },
    });
    await writeCmd(t, WireCmd.SetMasterVolume, -3.5);
    expect(captured!.req).toBe(WireCmd.SetMasterVolume.code);
    expect(captured!.data.byteLength).toBe(4);
  });
});
