import { describe, it, expect } from 'vitest';
import * as ValueFormat from './valueFieldFormat';

describe('valueFieldFormat — format', () => {
  it('formats plain dB at precision', () => {
    expect(ValueFormat.formatValue('dB', -2.5, 2)).toBe('-2.50');
    expect(ValueFormat.formatValue('dB',  3,    1)).toBe('3.0');
  });

  it('formats dB-signed with proper sign glyphs', () => {
    expect(ValueFormat.formatValue('dB-signed',  2.5,  2)).toBe('+2.50');
    expect(ValueFormat.formatValue('dB-signed', -2.5,  2)).toBe('−2.50');  // U+2212
    expect(ValueFormat.formatValue('dB-signed',  0,    2)).toBe('0.00');
  });

  it('formats ms at default precision 1', () => {
    expect(ValueFormat.formatValue('ms', 4.27, 1)).toBe('4.3');
    expect(ValueFormat.formatValue('ms', 0,    1)).toBe('0.0');
  });

  it('formats hz with k-shorthand boundaries', () => {
    expect(ValueFormat.formatValue('hz',     20, 0)).toBe('20');
    expect(ValueFormat.formatValue('hz',    999, 0)).toBe('999');
    expect(ValueFormat.formatValue('hz',   1000, 0)).toBe('1.00k');
    expect(ValueFormat.formatValue('hz',   1500, 0)).toBe('1.50k');
    expect(ValueFormat.formatValue('hz',   9999, 0)).toBe('10.00k');  // < 10000 path
    expect(ValueFormat.formatValue('hz',  10000, 0)).toBe('10.0k');
    expect(ValueFormat.formatValue('hz',  20000, 0)).toBe('20.0k');
  });

  it('formats q, pct, int', () => {
    expect(ValueFormat.formatValue('q',   1.41421, 2)).toBe('1.41');
    expect(ValueFormat.formatValue('pct', 47.6,    0)).toBe('48');
    expect(ValueFormat.formatValue('pct', 47.6,    1)).toBe('47.6');
    expect(ValueFormat.formatValue('int', 12.7,    0)).toBe('13');
  });
});

describe('valueFieldFormat — parseAndClamp', () => {
  it('snaps off-grid bounds inward instead of past them', () => {
    // -32767 Q8 = -127.996 dB; snapping to 0.5 must not reach -128.
    expect(ValueFormat.parseAndClamp('-200', -127.996, 0, 0.5)).toBe(-127.5);
    // Q8 max 0x7FFF = 127.996 with a 0.01 grid.
    expect(ValueFormat.parseAndClamp('500', 0, 127.996, 0.01)).toBe(127.99);
  });

  it('parses decimals and snaps to step', () => {
    expect(ValueFormat.parseAndClamp('3.7', 0, 10, 0.5)).toBe(3.5);
    expect(ValueFormat.parseAndClamp('3.8', 0, 10, 0.5)).toBe(4);
  });

  it('clamps to range', () => {
    expect(ValueFormat.parseAndClamp('99', 0, 10, 1)).toBe(10);
    expect(ValueFormat.parseAndClamp('-5', 0, 10, 1)).toBe(0);
  });

  it('accepts european comma decimal', () => {
    expect(ValueFormat.parseAndClamp('2,5', 0, 10, 0.5)).toBe(2.5);
  });

  it('strips trailing unit suffixes when re-editing', () => {
    expect(ValueFormat.parseAndClamp('3.0 dB',  -10, 10, 0.5)).toBe(3);
    expect(ValueFormat.parseAndClamp('+1.5dB', -10, 10, 0.5)).toBe(1.5);
  });

  it('returns null on unparseable input', () => {
    expect(ValueFormat.parseAndClamp('abc',  0, 10, 1)).toBeNull();
    expect(ValueFormat.parseAndClamp('',     0, 10, 1)).toBeNull();
    expect(ValueFormat.parseAndClamp('   ',  0, 10, 1)).toBeNull();
  });

  it('rejects non-finite (Infinity/NaN)', () => {
    // parseFloat('Infinity') returns Infinity; ensure we reject
    expect(ValueFormat.parseAndClamp('Infinity', 0, 10, 1)).toBeNull();
  });

  it('avoids float drift after step snapping', () => {
    // 0.1 + 0.2 style -- without toFixed cleanup, snap can produce 0.30000000000000004
    expect(ValueFormat.parseAndClamp('0.30001', 0, 1, 0.1)).toBe(0.3);
  });

  it('rejects out-of-range when clamp is disabled', () => {
    expect(ValueFormat.parseAndClamp('99', 0, 10, 1, false)).toBeNull();
    expect(ValueFormat.parseAndClamp('-1', 0, 10, 1, false)).toBeNull();
  });

  it('still snaps in-range values when clamp is disabled', () => {
    expect(ValueFormat.parseAndClamp('3.7', 0, 10, 0.5, false)).toBe(3.5);
    expect(ValueFormat.parseAndClamp('0',   0, 10, 1,   false)).toBe(0);
    expect(ValueFormat.parseAndClamp('10',  0, 10, 1,   false)).toBe(10);
  });
});

describe('valueFieldFormat — stepDecimals', () => {
  it('counts fractional digits', () => {
    expect(ValueFormat.stepDecimals(1)).toBe(0);
    expect(ValueFormat.stepDecimals(0.5)).toBe(1);
    expect(ValueFormat.stepDecimals(0.01)).toBe(2);
    expect(ValueFormat.stepDecimals(0.001)).toBe(3);
  });
});
