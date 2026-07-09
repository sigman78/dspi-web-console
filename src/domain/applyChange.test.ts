import { describe, it, expect } from 'vitest';
import { applyChange } from './applyChange';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import type { FilterParams } from './filter';

function band(o: Partial<FilterParams> = {}): FilterParams {
  return { type: 0, bypass: false, frequency: 1000, q: 1.0, gain: 0, ...o };
}

describe('applyChange', () => {
  it('applies a single kind in place', () => {
    const t = makeSnapshot((b) => { b.numPinOutputs = 2; b.pins[0] = 6; b.pins[1] = 7; });
    applyChange({ kind: 'bypass', value: true }, t);
    expect(t.bypass).toBe(true);
    applyChange({ kind: 'band', channelIndex: 2, band: 4, value: band({ gain: 6 }) }, t);
    expect(t.channels[2].filters[4].gain).toBe(6);
    applyChange({ kind: 'inputPreamp', channel: 1, value: -3 }, t);
    expect(t.inputPreampDb[1]).toBe(-3);
    applyChange({ kind: 'outputPins', value: [6, 8] }, t);
    expect(t.outputPins).toEqual([6, 8]);
  });

  it('applies spdifRxPin without disturbing the input source', () => {
    const t = makeSnapshot((b) => { b.formatVersion = 10; });
    const source = t.inputConfig.source;
    applyChange({ kind: 'spdifRxPin', value: 9 }, t);
    expect(t.inputConfig.spdifRxPin).toBe(9);
    expect(t.inputConfig.source).toBe(source);
  });

  it('applies spdifExt without disturbing spdifRxPin or the input source', () => {
    const t = makeSnapshot((b) => { b.formatVersion = 10; });
    const source = t.inputConfig.source;
    const spdifRxPin = t.inputConfig.spdifRxPin;
    applyChange({ kind: 'spdifExt', value: { spdifRxPinExt: [16, 17], spdifExtEnabled: [true, true] } }, t);
    expect(t.inputConfig.spdifRxPinExt).toEqual([16, 17]);
    expect(t.inputConfig.spdifExtEnabled).toEqual([true, true]);
    expect(t.inputConfig.spdifRxPin).toBe(spdifRxPin);
    expect(t.inputConfig.source).toBe(source);
  });

  it('applies the lgSoundSync split kinds independently', () => {
    const t = makeSnapshot((b) => { b.formatVersion = 10; });
    applyChange({ kind: 'lgSoundSyncEnabled', value: true }, t);
    applyChange({ kind: 'lgSoundSyncStatus', value: { present: true, volume: 40, muted: false } }, t);
    expect(t.lgSoundSync).toEqual({ enabled: true, present: true, volume: 40, muted: false });
  });
});
