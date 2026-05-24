import { describe, test, expect } from 'vitest';
import { PlatformType } from './platform';
import type { DspSnapshot } from './snapshot';
import { isAssignablePin, pinsInUse, availablePinsFor, validBckPins } from './pins';

function snap(over: Partial<DspSnapshot> = {}): DspSnapshot {
  return {
    platform: { type: PlatformType.RP2350, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    formatVersion: 6, bypass: false, masterPreampDb: 0, inputPreampDb: [0, 0], masterVolumeDb: 0,
    channels: [], outputs: [], routes: [],
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 },
    leveller: null,
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
    ...over,
  } as DspSnapshot;
}

describe('pins', () => {
  test('reserved/range pins are not assignable; normal pins are', () => {
    expect(isAssignablePin(PlatformType.RP2350, 12)).toBe(false);
    expect(isAssignablePin(PlatformType.RP2350, 24)).toBe(false);
    expect(isAssignablePin(PlatformType.RP2040, 29)).toBe(false);
    expect(isAssignablePin(PlatformType.RP2350, 29)).toBe(true);
    expect(isAssignablePin(PlatformType.RP2350, 16)).toBe(true);
  });

  test('switching a slot to I2S puts BCK and LRCLK into the in-use set', () => {
    const before = pinsInUse(snap());
    expect(before.has(14)).toBe(false);
    const after = pinsInUse(snap({ i2s: { outputSlotTypes: [1, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 } }));
    expect(after.get(14)).toMatch(/BCK/);
    expect(after.get(15)).toMatch(/LRCLK/);
  });

  test('availablePinsFor marks other outputs in-use but treats the selected pin as free', () => {
    const list = availablePinsFor(PlatformType.RP2350, snap(), 6);
    expect(list.find((c) => c.pin === 6)?.usedBy).toBeNull();
    expect(list.find((c) => c.pin === 7)?.usedBy).not.toBeNull();
    expect(list.some((c) => c.pin === 12)).toBe(false);
  });

  test('validBckPins excludes a pin whose N+1 is reserved and includes a clear pair', () => {
    const valid = validBckPins(PlatformType.RP2350, snap());
    expect(valid).not.toContain(11);
    expect(valid).toContain(16);
    expect(valid).not.toContain(6);
  });
});
