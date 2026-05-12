import { describe, it, expect, vi } from 'vitest';
import { actionCmd, FlashResult, PresetResult, flashResultFromByte, presetResultFromByte } from './results';
import type { DspTransport } from '../transport/DspTransport';

const mkTransport = (response: Uint8Array): DspTransport => ({
  open: vi.fn(), close: vi.fn(), isOpen: () => true,
  on: () => () => {},
  ctrlIn: vi.fn(async () => response),
  ctrlOut: vi.fn(async () => {}),
});

describe('actionCmd', () => {
  it('returns the first byte of the response', async () => {
    const t = mkTransport(new Uint8Array([0x02]));
    const code = await actionCmd(t, { code: 0x51 });
    expect(code).toBe(0x02);
  });

  it('returns 0xFF when the response is empty', async () => {
    const t = mkTransport(new Uint8Array());
    expect(await actionCmd(t, { code: 0x51 })).toBe(0xFF);
  });

  it('passes wValue through to ctrlIn', async () => {
    const t = mkTransport(new Uint8Array([0]));
    await actionCmd(t, { code: 0x90 }, 7);
    expect(t.ctrlIn).toHaveBeenCalledWith(0x90, 7, 1);
  });
});

describe('flashResultFromByte', () => {
  it('returns ok on 0', () => {
    const r = flashResultFromByte(0);
    expect(r.ok).toBe(true);
  });

  it('returns fail on non-zero with the FlashResult code', () => {
    const r = flashResultFromByte(FlashResult.ErrCrc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(FlashResult.ErrCrc);
  });

  it('treats unknown bytes as ErrWrite', () => {
    const r = flashResultFromByte(0x99);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(FlashResult.ErrWrite);
  });
});

describe('presetResultFromByte', () => {
  it('returns ok on 0', () => {
    expect(presetResultFromByte(0).ok).toBe(true);
  });

  it('returns fail with InvalidSlot on 0x01', () => {
    const r = presetResultFromByte(PresetResult.InvalidSlot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PresetResult.InvalidSlot);
  });

  it('treats unknown bytes as FlashWriteError', () => {
    const r = presetResultFromByte(0x99);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PresetResult.FlashWriteError);
  });
});
