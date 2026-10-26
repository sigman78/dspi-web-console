import { describe, expect, it } from 'vitest';
import { upmixStatus } from './upmixStatus';

describe('upmixStatus', () => {
  it('prefers disabled, then input shape, then rate', () => {
    expect(upmixStatus(false, 4, 96000)).toBe('disabled');
    expect(upmixStatus(true, 4, 96000)).toBe('input not stereo');
    expect(upmixStatus(true, 2, 96000)).toBe('rate > 48 kHz');
    expect(upmixStatus(true, 2, 48000)).toBe('active');
  });

  it('treats unknown telemetry as not parked', () => {
    expect(upmixStatus(true, null, null)).toBe('active');
  });
});
