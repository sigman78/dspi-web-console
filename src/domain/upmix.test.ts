import { describe, expect, it } from 'vitest';
import { upmixParkingFor, upmixParkingStatus } from './upmix';
import { narrowUpmixParkedReason } from './processing';

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

describe('upmixParkingFor', () => {
  const v2 = (reported: number | null) => upmixParkingFor({
    upmixRoutes: true, reported: reported === null ? null : narrowUpmixParkedReason(reported), enabled: true, activeInputChannels: 2, sampleRateHz: 48000,
  });

  it('shows the device reason on upmixer v2, and neither active nor parked before the first read', () => {
    expect(v2(null)).toBe('unknown');
    expect([0, 1, 2, 3, 4, 5, 6].map(v2)).toEqual([
      'active', 'disabled', 'no profile for input', 'rate > 48 kHz', 'source absent', 'fading out', 'nothing routed',
    ]);
  });

  it('keeps the derived status on older firmware', () => {
    expect(upmixParkingFor({ upmixRoutes: false, reported: 0, enabled: true, activeInputChannels: 6, sampleRateHz: 48000 }))
      .toBe('input not stereo');
  });
});
