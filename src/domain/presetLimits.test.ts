import { describe, it, expect } from 'vitest';
import {
  PRESET_SLOT_COUNT,
  PRESET_NAME_MAX_LEN,
  CHANNEL_NAME_MAX_LEN,
  assertPresetSlot,
} from './presetLimits';

describe('presetLimits', () => {
  it('exports the expected constants', () => {
    expect(PRESET_SLOT_COUNT).toBe(10);
    expect(PRESET_NAME_MAX_LEN).toBe(31);
    expect(CHANNEL_NAME_MAX_LEN).toBe(31);
  });

  describe('assertPresetSlot', () => {
    it('accepts 0..9', () => {
      for (let i = 0; i < PRESET_SLOT_COUNT; i++) {
        expect(() => assertPresetSlot(i)).not.toThrow();
      }
    });

    it('rejects -1 and 10', () => {
      expect(() => assertPresetSlot(-1)).toThrow(RangeError);
      expect(() => assertPresetSlot(10)).toThrow(RangeError);
    });

    it('rejects non-integers and non-finite values', () => {
      expect(() => assertPresetSlot(1.5)).toThrow(RangeError);
      expect(() => assertPresetSlot(NaN)).toThrow(RangeError);
      expect(() => assertPresetSlot(Infinity)).toThrow(RangeError);
    });
  });
});
