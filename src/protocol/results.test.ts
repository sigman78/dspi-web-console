import { describe, it, expect } from 'vitest';
import * as Results from './results';

describe('flashResultFromByte', () => {
  it('returns ok on 0', () => {
    const r = Results.flashResultFromByte(0);
    expect(r.ok).toBe(true);
  });

  it('returns fail on non-zero with the FlashResult code', () => {
    const r = Results.flashResultFromByte(Results.FlashResult.ErrCrc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Results.FlashResult.ErrCrc);
  });

  it('treats unknown bytes as ErrWrite', () => {
    const r = Results.flashResultFromByte(0x99);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Results.FlashResult.ErrWrite);
  });
});

describe('presetResultFromByte', () => {
  it('returns ok on 0', () => {
    expect(Results.presetResultFromByte(0).ok).toBe(true);
  });

  it('returns fail with InvalidSlot on 0x01', () => {
    const r = Results.presetResultFromByte(Results.PresetResult.InvalidSlot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Results.PresetResult.InvalidSlot);
  });

  it('treats unknown bytes as FlashWriteError', () => {
    const r = Results.presetResultFromByte(0x99);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Results.PresetResult.FlashWriteError);
  });
});

describe('pinConfigResultFromByte', () => {
  it('0x00 maps to ok', () => {
    expect(Results.pinConfigResultFromByte(0x00)).toEqual({ ok: true, value: undefined });
  });

  it('a known error byte maps to its typed code and message', () => {
    const r = Results.pinConfigResultFromByte(0x04);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(Results.PinConfigResult.OutputActive);
      expect(r.message).toMatch(/active/i);
    }
  });

  it('an unknown non-zero byte falls back to InvalidPin rather than throwing', () => {
    const r = Results.pinConfigResultFromByte(0x7f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Results.PinConfigResult.InvalidPin);
  });

  it('0x05 maps to InvalidParam with a range-style message', () => {
    const r = Results.pinConfigResultFromByte(Results.PinConfigResult.InvalidParam);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(Results.PinConfigResult.InvalidParam);
      expect(r.message).toMatch(/range/i);
    }
  });
});

describe('csStatusFromByte', () => {
  it('0x00 maps to ok', () => {
    expect(Results.csStatusFromByte(0x00).ok).toBe(true);
  });

  it('CS and shared-namespace codes carry the byte through as the typed code', () => {
    const adc = Results.csStatusFromByte(Results.CsStatusCode.PinNotAdc);
    expect(adc.ok).toBe(false);
    if (!adc.ok) {
      expect(adc.code).toBe(Results.CsStatusCode.PinNotAdc);
      expect(adc.message).toMatch(/ADC pin/);
    }
    const inUse = Results.csStatusFromByte(Results.PinConfigResult.PinInUse);
    expect(inUse.ok).toBe(false);
    if (!inUse.ok) expect(inUse.code).toBe(Results.PinConfigResult.PinInUse);
  });

  it('carries the v2/v3 status codes (target/event/busy) through with a specific message', () => {
    const target = Results.csStatusFromByte(Results.CsStatusCode.InvalidTarget);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.code).toBe(Results.CsStatusCode.InvalidTarget);
      expect(target.message).toMatch(/channel|band/i);
    }
    const busy = Results.csStatusFromByte(Results.CsStatusCode.Busy);
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.message).toMatch(/applying|retry/i);
  });

  it('an unknown non-zero byte fails with the generic message rather than throwing', () => {
    const r = Results.csStatusFromByte(0x7f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(0x7f);
      expect(r.message).toMatch(/failed to apply/i);
    }
  });
});
