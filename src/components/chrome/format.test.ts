import { describe, it, expect } from 'vitest';
import { formatI2cAddr, formatSignedDb } from './format';

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
