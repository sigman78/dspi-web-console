import { describe, it, expect } from 'vitest';
import type { DspTransport } from '@/transport/DspTransport';
import { Codec } from '@/utils';
import { Cmd, Act } from './index';
import { readCmd, writeCmd, actionCmd, readByte } from './exec';

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
    let req = -1;
    const t = fakeTransport({ in: (r) => { req = r; return Codec.encode(Codec.f32, -7.25); } });
    expect(await readCmd(t, Cmd.MasterVolume)).toBeCloseTo(-7.25, 5);
    expect(req).toBe(Cmd.MasterVolume.legacy.get);
  });

  // Hardware regression: USB control-IN truncates to actual payload size.
  // readCmd must hand off through `decodePadded` so the trailing-NUL
  // semantics still decode correctly.  (The padding logic itself is
  // tested in binStream.test.ts.)
  it('survives a short USB control-IN response', async () => {
    const enc = new TextEncoder();
    const t = fakeTransport({ in: () => enc.encode('ABC123\0') });
    expect(await readCmd(t, Cmd.Serial)).toBe('ABC123');
  });
});

describe('writeCmd', () => {
  it('encodes the payload and writes via ctrlOut', async () => {
    let captured: { req: number; data: Uint8Array } | null = null;
    const t = fakeTransport({
      out: (req, _val, data) => { captured = { req, data }; },
    });
    await writeCmd(t, Cmd.MasterVolume, -3.5);
    expect(captured!.req).toBe(Cmd.MasterVolume.legacy.set);
    expect(captured!.data.byteLength).toBe(4);
  });
});

describe('actionCmd', () => {
  it('returns the first byte of the response', async () => {
    const t = fakeTransport({ in: () => new Uint8Array([0x02]) });
    expect(await actionCmd(t, Act.FactoryReset)).toBe(0x02);
  });

  it('returns 0xFF when the response is empty', async () => {
    const t = fakeTransport({ in: () => new Uint8Array() });
    expect(await actionCmd(t, Act.FactoryReset)).toBe(0xFF);
  });

  it('passes the command code, wValue, and a 1-byte length to ctrlIn', async () => {
    let call: { req: number; val: number; len: number } | null = null;
    const t = fakeTransport({ in: (req, val, len) => { call = { req, val, len }; return new Uint8Array([0]); } });
    await actionCmd(t, Act.PresetSave, 7);
    expect(call).toEqual({ req: Act.PresetSave.legacy.code, val: 7, len: 1 });
  });
});

describe('readByte', () => {
  it('reads the first byte via the get opcode with a 1-byte length', async () => {
    let call: { req: number; val: number; len: number } | null = null;
    const t = fakeTransport({ in: (req, val, len) => { call = { req, val, len }; return new Uint8Array([5]); } });
    expect(await readByte(t, Cmd.MckMultiplier, 3)).toBe(5);
    expect(call).toEqual({ req: Cmd.MckMultiplier.legacy.get, val: 3, len: 1 });
  });

  it('returns 0xFF when the response is empty', async () => {
    const t = fakeTransport({ in: () => new Uint8Array() });
    expect(await readByte(t, Cmd.MckMultiplier)).toBe(0xFF);
  });
});
