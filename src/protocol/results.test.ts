import { describe, it, expect } from 'vitest';
import { FlashResult, PresetResult, flashResultFromByte, presetResultFromByte, PinConfigResult, pinConfigResultFromByte, CsStatusCode, csStatusFromByte } from './results';

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

describe('pinConfigResultFromByte', () => {
  it('0x00 maps to ok', () => {
    expect(pinConfigResultFromByte(0x00)).toEqual({ ok: true, value: undefined });
  });

  it('a known error byte maps to its typed code and message', () => {
    const r = pinConfigResultFromByte(0x04);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(PinConfigResult.OutputActive);
      expect(r.message).toMatch(/active/i);
    }
  });

  it('an unknown non-zero byte falls back to InvalidPin rather than throwing', () => {
    const r = pinConfigResultFromByte(0x7f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PinConfigResult.InvalidPin);
  });

  it('0x05 maps to InvalidParam with a range-style message', () => {
    const r = pinConfigResultFromByte(PinConfigResult.InvalidParam);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(PinConfigResult.InvalidParam);
      expect(r.message).toMatch(/range/i);
    }
  });
});

describe('csStatusFromByte', () => {
  it('0x00 maps to ok', () => {
    expect(csStatusFromByte(0x00).ok).toBe(true);
  });

  it('CS and shared-namespace codes carry the byte through as the typed code', () => {
    const adc = csStatusFromByte(CsStatusCode.PinNotAdc);
    expect(adc.ok).toBe(false);
    if (!adc.ok) {
      expect(adc.code).toBe(CsStatusCode.PinNotAdc);
      expect(adc.message).toMatch(/ADC pin/);
    }
    const inUse = csStatusFromByte(PinConfigResult.PinInUse);
    expect(inUse.ok).toBe(false);
    if (!inUse.ok) expect(inUse.code).toBe(PinConfigResult.PinInUse);
  });

  it('carries the v2/v3 status codes (target/event/busy) through with a specific message', () => {
    const target = csStatusFromByte(CsStatusCode.InvalidTarget);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.code).toBe(CsStatusCode.InvalidTarget);
      expect(target.message).toMatch(/channel|band/i);
    }
    const busy = csStatusFromByte(CsStatusCode.Busy);
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.message).toMatch(/applying|retry/i);
  });

  it('an unknown non-zero byte fails with the generic message rather than throwing', () => {
    const r = csStatusFromByte(0x7f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(0x7f);
      expect(r.message).toMatch(/failed to apply/i);
    }
  });
});
