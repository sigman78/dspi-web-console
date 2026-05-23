import { describe, it, expect } from 'vitest';
import * as Clamp from './clamp';
import { CHANNEL_NAME_MAX_LEN } from './presetLimits';

describe('Clamp.toRange', () => {
  it('passes through in-range values', () => {
    expect(Clamp.toRange(5, 0, 10)).toBe(5);
  });
  it('clamps below min and above max', () => {
    expect(Clamp.toRange(-3, 0, 10)).toBe(0);
    expect(Clamp.toRange(99, 0, 10)).toBe(10);
  });
  it('coerces non-finite to a bound', () => {
    expect(Clamp.toRange(NaN, 0, 10)).toBe(0);
    expect(Clamp.toRange(Infinity, 0, 10)).toBe(10);
  });
});

describe('named clampers use the domain limits', () => {
  it('master volume clamps to [-60, 0]', () => {
    expect(Clamp.masterVolumeDb(5)).toBe(0);
    expect(Clamp.masterVolumeDb(-99)).toBe(-60);
    expect(Clamp.masterVolumeDb(-12)).toBe(-12);
  });
  it('band gain clamps to [-24, 24]', () => {
    expect(Clamp.bandGainDb(30)).toBe(24);
    expect(Clamp.bandGainDb(-30)).toBe(-24);
  });
  it('output delay clamps to [0, 170]', () => {
    expect(Clamp.outputDelayMs(-5)).toBe(0);
    expect(Clamp.outputDelayMs(999)).toBe(170);
  });
});

describe('Clamp.nameToByteBudget truncates on UTF-8 byte budget', () => {
  it('passes short ASCII names through', () => {
    expect(Clamp.nameToByteBudget('Left', CHANNEL_NAME_MAX_LEN)).toBe('Left');
  });
  it('never returns more than the byte budget', () => {
    const long = 'x'.repeat(100);
    const out = Clamp.nameToByteBudget(long, CHANNEL_NAME_MAX_LEN);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(CHANNEL_NAME_MAX_LEN);
  });
  it('does not split a multi-byte codepoint', () => {
    // 2-byte UTF-8 chars; floor(31 / 2) = 15 full chars fit in the 31-byte budget
    const accented = 'é'; // 'e' with acute accent
    const out = Clamp.nameToByteBudget(accented.repeat(40), CHANNEL_NAME_MAX_LEN);
    expect(out).toBe(accented.repeat(15));
  });
});
