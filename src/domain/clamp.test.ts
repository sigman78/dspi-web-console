import { describe, it, expect } from 'vitest';
import {
  clampToRange,
  clampMasterVolumeDb,
  clampBandGainDb,
  clampBandFrequencyHz,
  clampBandQ,
  clampPreampDb,
  clampOutputGainDb,
  clampOutputDelayMs,
  clampCrosspointGainDb,
  clampLoudnessRefSpl,
  clampLoudnessIntensityPct,
  clampCrossfeedFreqHz,
  clampCrossfeedFeedDb,
  clampLevellerAmountPct,
  clampLevellerMaxGainDb,
  clampLevellerGateDb,
  clampNameToByteBudget,
} from './clamp';
import { CHANNEL_NAME_MAX_LEN } from './presetLimits';

describe('clampToRange', () => {
  it('passes through in-range values', () => {
    expect(clampToRange(5, 0, 10)).toBe(5);
  });
  it('clamps below min and above max', () => {
    expect(clampToRange(-3, 0, 10)).toBe(0);
    expect(clampToRange(99, 0, 10)).toBe(10);
  });
  it('coerces non-finite to a bound', () => {
    expect(clampToRange(NaN, 0, 10)).toBe(0);
    expect(clampToRange(Infinity, 0, 10)).toBe(10);
  });
});

describe('named clampers use the domain limits', () => {
  it('master volume clamps to [-60, 0]', () => {
    expect(clampMasterVolumeDb(5)).toBe(0);
    expect(clampMasterVolumeDb(-99)).toBe(-60);
    expect(clampMasterVolumeDb(-12)).toBe(-12);
  });
  it('band gain clamps to [-24, 24]', () => {
    expect(clampBandGainDb(30)).toBe(24);
    expect(clampBandGainDb(-30)).toBe(-24);
  });
  it('output delay clamps to [0, 170]', () => {
    expect(clampOutputDelayMs(-5)).toBe(0);
    expect(clampOutputDelayMs(999)).toBe(170);
  });
});

describe('clampNameToByteBudget truncates on UTF-8 byte budget', () => {
  it('passes short ASCII names through', () => {
    expect(clampNameToByteBudget('Left', CHANNEL_NAME_MAX_LEN)).toBe('Left');
  });
  it('never returns more than the byte budget', () => {
    const long = 'x'.repeat(100);
    const out = clampNameToByteBudget(long, CHANNEL_NAME_MAX_LEN);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(CHANNEL_NAME_MAX_LEN);
  });
  it('does not split a multi-byte codepoint', () => {
    // é = 2 bytes; floor(31 / 2) = 15 full characters fit in the 31-byte budget
    const out = clampNameToByteBudget('é'.repeat(40), CHANNEL_NAME_MAX_LEN);
    expect(out).toBe('é'.repeat(15));
  });
});
