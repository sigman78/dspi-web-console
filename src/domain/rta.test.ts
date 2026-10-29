import { describe, test, expect } from 'vitest';
import * as Domain from './rta';

const caps = { levelZero: 243, fftOrderDefault: 10 } as Domain.RtaCaps;
const cfg = (over: Partial<Domain.RtaConfig>): Domain.RtaConfig => ({
  tap: Domain.RtaTap.Output, channelMask: 0, fftOrder: 10, avgMs: 100, peakDecayDbS: 0, flags: 0, ...over,
});

describe('rtaLevelDb', () => {
  test('counts step 0.5 dB around the device-reported zero', () => {
    expect(Domain.rtaLevelDb(243, 243)).toBe(0);
    expect(Domain.rtaLevelDb(183, 243)).toBe(-30);
    expect(Domain.rtaLevelDb(100, 200)).toBe(-50);
  });

  test('count 0 is the silent floor', () => {
    expect(Domain.rtaLevelDb(0, 243)).toBe(-Infinity);
  });
});

describe('rtaDecodeFrame', () => {
  test('converts every band with the caps level zero and keeps identity fields', () => {
    const f = Domain.rtaDecodeFrame({ version: 3, channel: 3, seq: 9, ageMs: 40, avg: [243, 0, 223] }, caps);
    expect(f).toEqual({ channel: 3, seq: 9, ageMs: 40, levelsDb: [0, -Infinity, -10] });
  });

  test('a never-produced or stale frame decodes as silence', () => {
    const avg = [243, 223];
    expect(Domain.rtaDecodeFrame({ version: 3, channel: 0, seq: 0, ageMs: null, avg }, caps).levelsDb).toEqual([-Infinity, -Infinity]);
    expect(Domain.rtaDecodeFrame({ version: 3, channel: 0, seq: 0, ageMs: 5000, avg }, caps).levelsDb).toEqual([-Infinity, -Infinity]);
  });
});

describe('rtaPlanConfig', () => {
  const wanted = Domain.rtaWantedConfig(caps, 4);

  test('adopts an output-tap config that already covers our outputs', () => {
    expect(Domain.rtaPlanConfig(cfg({ channelMask: 0xFF, fftOrder: 12 }), wanted)).toBeNull();
  });

  test('widens a narrower output-tap mask with the other host channels', () => {
    const plan = Domain.rtaPlanConfig(cfg({ channelMask: 0b10001 }), wanted);
    expect(plan?.channelMask).toBe(0b11111);
    expect(plan?.tap).toBe(Domain.RtaTap.Output);
    expect(plan?.fftOrder).toBe(wanted.fftOrder);
  });

  test('replaces an input-tap config without carrying its mask over', () => {
    expect(Domain.rtaPlanConfig(cfg({ tap: Domain.RtaTap.Input, channelMask: 0xFF00 }), wanted)).toEqual(wanted);
  });
});
