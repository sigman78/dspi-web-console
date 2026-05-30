import { describe, it, expect } from 'vitest';
import { AudioInputSource, FilterType, defaultFilter } from '@/domain';

describe('domain — 1.1.4 sections + filter taxonomy', () => {
  it('AudioInputSource enumerates USB and S/PDIF', () => {
    expect(AudioInputSource.Usb).toBe(0);
    expect(AudioInputSource.Spdif).toBe(1);
  });

  it('FilterType gains Notch and Allpass', () => {
    expect(FilterType.Notch).toBe(6);
    expect(FilterType.Allpass).toBe(7);
  });

  it('a default filter is not bypassed', () => {
    expect(defaultFilter().bypass).toBe(false);
  });
});
