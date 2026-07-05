import { describe, test, expect } from 'vitest';
import { PlatformType } from './platform';
import type { DspSnapshot } from './snapshot';
import { isAssignablePin, pinsInUse, availablePinsFor, validBckPins } from './pins';
import { DEFAULT_UART_CONTROL_CONFIG } from './controlInterfaces';

function snap(over: Partial<DspSnapshot> = {}): DspSnapshot {
  return {
    platform: { type: PlatformType.RP2350, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    bypass: false, masterPreampDb: 0, inputPreampDb: [0, 0], masterVolumeDb: 0,
    channels: [], outputs: [], routes: [],
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 },
    leveller: null,
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
    inputConfig: { source: 0, spdifRxPin: 5 },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
    ...over,
  } as DspSnapshot;
}

function snapV16(over: Partial<DspSnapshot> = {}): DspSnapshot {
  const base = snap(over);
  return { ...base, platform: { ...base.platform, wireGen: 16 } } as DspSnapshot;
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

  test('with no output pins registered, an active I2S slot yields BCK/LRCLK plus the RX pin', () => {
    const m = pinsInUse(snap({
      outputPins: [],
      i2s: { outputSlotTypes: [1, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
    }));
    expect(m.size).toBe(3);
    expect(m.get(14)).toBe('BCK');
    expect(m.get(15)).toBe('LRCLK');
    expect(m.get(5)).toBe('SPDIF RX');
  });

  test('the S/PDIF RX pin is always in use; the DAC mute pin only when enabled', () => {
    const off = pinsInUse(snap());
    expect(off.get(5)).toBe('SPDIF RX');
    expect(off.has(11)).toBe(false);
    const on = pinsInUse(snap({ dacHwMute: { enabled: true, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 } }));
    expect(on.get(11)).toBe('DAC MUTE');
  });

  test('a V10 snapshot still reserves GPIO 12', () => {
    const list = availablePinsFor(PlatformType.RP2350, snap(), 6);   // default fixture wireGen = 10
    expect(list.some((c) => c.pin === 12)).toBe(false);
  });

  test('on a V16 snapshot GPIO 16/17 are assignable when no control interface is enabled', () => {
    const list = availablePinsFor(PlatformType.RP2350, snapV16(), 6);
    expect(list.find((c) => c.pin === 16)?.usedBy).toBeNull();
    expect(list.find((c) => c.pin === 17)?.usedBy).toBeNull();
  });

  test('enabling UART removes its TX/RX pins from availablePinsFor and validBckPins', () => {
    const s = snapV16();
    const ctrl = { uart: { ...DEFAULT_UART_CONTROL_CONFIG, enabled: true } };   // tx 16 / rx 17

    const withoutUart = availablePinsFor(PlatformType.RP2350, s, 6);
    expect(withoutUart.find((c) => c.pin === 16)?.usedBy).toBeNull();

    const withUart = availablePinsFor(PlatformType.RP2350, s, 6, ctrl);
    expect(withUart.find((c) => c.pin === 16)?.usedBy).toBe('UART TX');
    expect(withUart.find((c) => c.pin === 17)?.usedBy).toBe('UART RX');

    expect(validBckPins(PlatformType.RP2350, s)).toContain(16);
    expect(validBckPins(PlatformType.RP2350, s, ctrl)).not.toContain(16);
  });
});
