import { describe, it, expect } from 'vitest';
import { utf8ByteLength, utf8Truncate } from './utf8';

describe('utf8ByteLength', () => {
  it('counts ASCII as 1 byte each', () => {
    expect(utf8ByteLength('abc')).toBe(3);
  });

  it('counts multi-byte UTF-8 correctly', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('中')).toBe(3);
    expect(utf8ByteLength('🎵')).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('utf8Truncate', () => {
  it('returns the string unchanged when it fits', () => {
    expect(utf8Truncate('hello', 10)).toBe('hello');
  });

  it('truncates ASCII at the exact byte budget', () => {
    expect(utf8Truncate('A'.repeat(40), 31)).toBe('A'.repeat(31));
  });

  it('does not split a multi-byte codepoint', () => {
    // Each emoji is 4 bytes. Budget = 10. 2 emojis = 8 bytes fits;
    // adding a 3rd would push to 12 > 10. Result must be 2 emojis only,
    // never a partial 3rd that would decode as U+FFFD on the wire.
    const s = '🎵🎵🎵';
    const out = utf8Truncate(s, 10);
    expect(out).toBe('🎵🎵');
    expect(utf8ByteLength(out)).toBe(8);
  });

  it('handles maxBytes 0 by returning empty string', () => {
    expect(utf8Truncate('abc', 0)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(utf8Truncate('', 10)).toBe('');
  });
});
