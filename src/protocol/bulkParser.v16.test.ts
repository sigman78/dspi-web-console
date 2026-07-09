// V16 (unified channel model) codec coverage: packet size contract, full
// roundtrip of the V16-only fields, and cross-generation conversion.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v16Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 16 });
}

describe('bulkParser — V16 packet', () => {
  it('BULK_SIZE_V16 matches the firmware sizeof(WireBulkParams) contract', () => {
    // 5864 comes from bulk_params.h; a codec shape drift breaks this first.
    expect(Wire.BULK_SIZE_V16).toBe(5864);
  });

  it('roundtrips the V16-only fields (crossover, wide arrays, i2s input config)', () => {
    const bulk = v16Base();
    bulk.delaysMs[16] = 1.25;
    bulk.channelNames[16] = 'PDM sub';
    bulk.crosspoints[7][8] = { enabled: true, invert: true, gainDb: -6 };
    bulk.filters[16][11] = { type: 1, bypass: true, frequency: 320, q: 2, gain: -3 };
    bulk.inputPreampsDb = [0, -1, -2, -3, -4, -5, -6, -7];
    bulk.inputConfig = {
      source: 2, spdifRxPin: 5,
      i2sRxPins: [1, 2, 3, 4], i2sInputRateEnc: 2, i2sInputChannels: 6,
      spdifRxPinExt: [0, 0], spdifRxEnabledExtP1: 0,
    };
    bulk.crossover[8][0] = { type: 34, bypass: false, frequency: 2400, q: 0.707, gain: 0 };
    bulk.crossover[16][3] = { type: 33, bypass: true, frequency: 120, q: 0.5, gain: 0 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V16);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(16);
    expect(p.delaysMs[16]).toBeCloseTo(1.25, 5);
    expect(p.channelNames[16]).toBe('PDM sub');
    expect(p.crosspoints[7][8]).toEqual({ enabled: true, invert: true, gainDb: -6 });
    expect(p.filters[16][11].frequency).toBeCloseTo(320, 3);
    expect(p.filters[16][11].bypass).toBe(true);
    expect(p.inputPreampsDb.map(Math.round)).toEqual([0, -1, -2, -3, -4, -5, -6, -7]);
    expect(p.inputConfig).toEqual({
      source: 2, spdifRxPin: 5,
      i2sRxPins: [1, 2, 3, 4], i2sInputRateEnc: 2, i2sInputChannels: 6,
      spdifRxPinExt: [0, 0], spdifRxEnabledExtP1: 0,
    });
    expect(p.crossover[8][0].type).toBe(34);
    expect(p.crossover[8][0].frequency).toBeCloseTo(2400, 3);
    expect(p.crossover[16][3].bypass).toBe(true);
  });

  it('down-converts a V16 snapshot to a V10 packet (rows beyond V10 dims drop)', () => {
    const bulk = v16Base();
    bulk.crossover[8][0] = { type: 34, bypass: false, frequency: 2400, q: 0.707, gain: 0 };
    bulk.inputPreampsDb[5] = -9;
    bulk.masterVolumeDb = -12;

    const bytes = buildBulkParams(bulk, 10);
    expect(bytes.byteLength).toBe(Wire.BulkSizes.V10);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(10);
    expect(p.masterVolumeDb).toBeCloseTo(-12, 4);
    // V10 carries neither crossover nor input slots beyond 2.
    expect(p.crossover[8][0].type).toBe(0);
    expect(p.inputPreampsDb[5]).toBe(0);
  });

  it('up-converts a V10 snapshot to the full-size V16 packet with defaulted new sections', () => {
    const v10 = defaultBulkParams({ platformId: 1, numCh: 11, numOut: 9 });
    v10.masterVolumeDb = -7;

    const bytes = buildBulkParams(v10, 16);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V16);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(16);
    expect(p.masterVolumeDb).toBeCloseTo(-7, 4);
    expect(p.crossover.every((row) => row.every((b) => b.type === 0))).toBe(true);
  });
});
