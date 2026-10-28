import { describe, it, expect } from 'vitest';
import { formatI2cAddr, parseI2cAddr, formatMasterDb, formatSignedDb } from './format';

describe('formatSignedDb', () => {
  it('signs with U+2212 and an explicit plus', () => {
    expect(formatSignedDb(-6)).toBe('−6.0');
    expect(formatSignedDb(3.25, 1)).toBe('+3.3');
    expect(formatSignedDb(2.5, 2)).toBe('+2.50');
  });

  it('reads a value that rounds to zero as plus zero', () => {
    expect(formatSignedDb(-0.02)).toBe('0.0');
    expect(formatSignedDb(0)).toBe('0.0');
  });

  it('renders negative infinity as the mute glyph', () => {
    expect(formatSignedDb(-Infinity)).toBe('−∞');
  });
});

describe('formatI2cAddr', () => {
  it('zero-pads to two uppercase hex digits', () => {
    expect(formatI2cAddr(0x0a)).toBe('0x0A');
    expect(formatI2cAddr(0x3c)).toBe('0x3C');
  });
});

describe('parseI2cAddr', () => {
  it('accepts bare hex and an optional 0x prefix, case-insensitive', () => {
    expect(parseI2cAddr('3c')).toBe(0x3c);
    expect(parseI2cAddr(' 0x3C ')).toBe(0x3c);
  });
  it('rejects addresses outside 0x08-0x77', () => {
    expect(parseI2cAddr('07')).toBeNull();
    expect(parseI2cAddr('0x78')).toBeNull();
  });
  it('rejects garbage and empty input', () => {
    expect(parseI2cAddr('zz')).toBeNull();
    expect(parseI2cAddr('0x')).toBeNull();
    expect(parseI2cAddr('123')).toBeNull();
    expect(parseI2cAddr('')).toBeNull();
  });
});

describe('formatMasterDb', () => {
  it('shows the mute glyph at and below the -127.5 threshold', () => {
    expect(formatMasterDb(-128)).toBe('−∞');
    expect(formatMasterDb(-127.5)).toBe('−∞');
  });

  it('shows a one-decimal dB value above the threshold', () => {
    expect(formatMasterDb(-127.4)).toBe('−127.4');
    expect(formatMasterDb(-6)).toBe('−6.0');
    expect(formatMasterDb(0)).toBe('0.0');
  });
});
