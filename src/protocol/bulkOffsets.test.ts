import { describe, it, expect } from 'vitest';
import { Codec } from '@/utils';
import { describeBulkOffset } from './bulkOffsets';
import * as Wire from './wireTypes';

describe('describeBulkOffset — total-size cross-check', () => {
  // Independently walks the same sections bulkSizeForVersion sums up; a drift
  // in either place shows up as a boundary mismatch here.
  it.each([10, 16, 17, 18, 21, 24, 26])('resolves the last byte and rejects the next one (v%i)', (version) => {
    const total = Wire.bulkSizeForVersion(version);
    expect(describeBulkOffset(total - 1, version)).not.toBeNull();
    expect(describeBulkOffset(total, version)).toBeNull();
  });
});

describe('describeBulkOffset — real-world cases', () => {
  it('resolves the diagnosed GPIO jitter offset (v26)', () => {
    const hit = describeBulkOffset(1212, 26);
    expect(hit?.path).toBe('eq[ch2].band0.frequency');
    expect(hit?.leafOffset).toBe(1212);
    expect(hit?.leaf && Codec.sizeOf(hit.leaf)).toBe(4);
  });

  it('resolves a V10 eq offset (V10 eq base is 368)', () => {
    const hit = describeBulkOffset(372, 10);
    expect(hit?.path).toBe('eq[ch0].band0.frequency');
  });

  it('resolves a 16-byte band-start hit at the type field', () => {
    const hit = describeBulkOffset(1208, 26);
    expect(hit?.path).toBe('eq[ch2].band0.type');
    expect(hit?.leafOffset).toBe(1208);
  });
});

describe('describeBulkOffset — V18 interior leveller grow', () => {
  it('shifts userVolume by +4 bytes once the leveller masks land (V18)', () => {
    const v17 = describeBulkOffset(4744, 17);
    const v18 = describeBulkOffset(4748, 18);
    expect(v17?.path.startsWith('userVolume.')).toBe(true);
    expect(v18?.path.startsWith('userVolume.')).toBe(true);
  });

  it('the V17 userVolume offset lands in the wrong section on V18', () => {
    const hit = describeBulkOffset(4744, 18);
    expect(hit?.path.startsWith('userVolume.')).toBe(false);
  });
});

describe('describeBulkOffset — edges', () => {
  it('rejects a negative offset', () => {
    expect(describeBulkOffset(-1, 26)).toBeNull();
  });
});
