import { describe, it, expect } from 'vitest';
import { Codec } from '@/utils';
import { describeBulkOffset } from './bulkOffsets';
import * as Wire from './wireTypes';

describe('describeBulkOffset — total-size cross-check', () => {
  // Independently walks the same sections bulkSizeForVersion sums up; a drift
  // in either place shows up as a boundary mismatch here.
  it.each([28, 29, 30, 31, 32])('resolves the last byte and rejects the next one (v%i)', (version) => {
    const total = Wire.bulkSizeForVersion(version);
    expect(describeBulkOffset(total - 1, version)).not.toBeNull();
    expect(describeBulkOffset(total, version)).toBeNull();
  });
});

describe('describeBulkOffset — real-world cases', () => {
  it('resolves the diagnosed GPIO jitter offset (v28)', () => {
    const hit = describeBulkOffset(1212, 28);
    expect(hit?.path).toBe('eq[ch2].band0.frequency');
    expect(hit?.leafOffset).toBe(1212);
    expect(hit?.leaf && Codec.sizeOf(hit.leaf)).toBe(4);
  });

  it('resolves a 16-byte band-start hit at the type field', () => {
    const hit = describeBulkOffset(1208, 28);
    expect(hit?.path).toBe('eq[ch2].band0.type');
    expect(hit?.leafOffset).toBe(1208);
  });
});

describe('describeBulkOffset — V29 subharm section', () => {
  it('resolves the section start as subharm.enabled', () => {
    const hit = describeBulkOffset(5944, 29);
    expect(hit?.path).toBe('subharm.enabled');
  });

  it('resolves the low_db field offset', () => {
    const hit = describeBulkOffset(5948, 29);
    expect(hit?.path).toBe('subharm.lowDb');
  });
});

describe('describeBulkOffset — V30 subharm section tail', () => {
  it('resolves the tail start as subharm.topDb', () => {
    const hit = describeBulkOffset(5960, 30);
    expect(hit?.path).toBe('subharm.topDb');
  });

  it('resolves the link_pairs field offset', () => {
    const hit = describeBulkOffset(5977, 30);
    expect(hit?.path).toBe('subharm.linkPairs');
  });
});

describe('describeBulkOffset — V31 tube / V32 limiter sections', () => {
  it('resolves the tube section start', () => {
    expect(describeBulkOffset(5980, 31)?.path).toBe('tube.enabled');
  });

  it('resolves per-output limiter entries', () => {
    expect(describeBulkOffset(6028, 32)?.path).toBe('limiter[0].enabled');
    expect(describeBulkOffset(6028 + 12 * 8 + 4, 32)?.path).toBe('limiter[8].thresholdDb');
  });

  it('does not resolve the limiter on a V31 packet', () => {
    expect(describeBulkOffset(6028, 31)).toBeNull();
  });
});

describe('describeBulkOffset — edges', () => {
  it('rejects a negative offset', () => {
    expect(describeBulkOffset(-1, 28)).toBeNull();
  });
});

describe('describeBulkOffset — V28 input-config interior relayout', () => {
  it('walks the 3-entry spdifRxPinExt, so the enable mask sits at section byte 11', () => {
    const base = 4716;
    expect(describeBulkOffset(base, 28)?.path).toBe('inputConfig.inputSource');
    expect(describeBulkOffset(base + 10, 28)?.path).toBe('inputConfig.spdifRxPinExt');
    expect(describeBulkOffset(base + 11, 28)?.path).toBe('inputConfig.spdifRxEnabledExtP1');
  });
});
