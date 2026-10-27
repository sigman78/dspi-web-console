import { describe, expect, it } from 'vitest';
import { upmixParkingStatus } from './upmix';

describe('upmixParkingStatus', () => {
  it('prefers disabled, then input shape, then rate', () => {
    expect(upmixParkingStatus(false, 4, 96000)).toBe('disabled');
    expect(upmixParkingStatus(true, 4, 96000)).toBe('input not stereo');
    expect(upmixParkingStatus(true, 2, 96000)).toBe('rate > 48 kHz');
    expect(upmixParkingStatus(true, 2, 48000)).toBe('active');
  });

  it('treats unknown telemetry as not parked', () => {
    expect(upmixParkingStatus(true, null, null)).toBe('active');
  });
});
