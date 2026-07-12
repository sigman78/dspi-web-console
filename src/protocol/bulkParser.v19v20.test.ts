// V19/V20 codec coverage: the per-output loudness mask (V19, GlobalParams
// reserved-byte claim) and the crossfeed output-pair mask (V20, CrossfeedParams
// reserved-byte claim). Unlike V17/V18, neither claim grows the packet --
// both variants stay the same 16-byte section size, so BULK_SIZE_V19/V20 equal
// BULK_SIZE_V18.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v18Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 18 });
}
function v19Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 19 });
}
function v20Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 20 });
}

describe('bulkParser — V19 (loudness output mask) packet', () => {
  it('roundtrips the loudness output mask; packet size unchanged from V18', () => {
    const bulk = v19Base();
    bulk.loudness = { ...bulk.loudness, enabled: true, outputMask: 0x00F0 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V19);
    expect(Wire.BULK_SIZE_V19).toBe(Wire.BULK_SIZE_V18);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(19);
    expect(p.loudness.outputMask).toBe(0x00F0);
    expect(p.loudness.enabled).toBe(true);
  });

  it('a V18 packet defaults the loudness output mask to 0xFFFF (no V19 mask bytes)', () => {
    const bulk = v18Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.formatVersion).toBe(18);
    expect(p.loudness.outputMask).toBe(0xFFFF);
  });

  it('a V19 packet defaults the crossfeed output-pair mask to 0x01 (no V20 bytes yet)', () => {
    const bulk = v19Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.crossfeed.outputPairMask).toBe(0x01);
  });

  it('building for V18 emits zeroed reserved bytes at the loudness-mask offset', () => {
    const bulk = v18Base();
    bulk.loudness = { ...bulk.loudness, outputMask: 0xABCD };   // ignored at V18
    const bytes = buildBulkParams(bulk, 18);
    // GlobalParams: preampDb(4) bypass(1) loudnessEnabled(1) then the 2 reserved
    // bytes, at header(16) + offset 6 = byte 22.
    expect(bytes[22]).toBe(0);
    expect(bytes[23]).toBe(0);
  });
});

describe('bulkParser — V20 (crossfeed output-pair mask) packet', () => {
  it('roundtrips the crossfeed output-pair mask AND the loudness output mask', () => {
    const bulk = v20Base();
    bulk.loudness = { ...bulk.loudness, outputMask: 0x0F0F };
    bulk.crossfeed = { ...bulk.crossfeed, enabled: true, outputPairMask: 0x0D };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V20);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(20);
    expect(p.loudness.outputMask).toBe(0x0F0F);
    expect(p.crossfeed.outputPairMask).toBe(0x0D);
    expect(p.crossfeed.enabled).toBe(true);
  });

  it('building for V19 emits a zeroed reserved byte at the crossfeed-mask offset', () => {
    const bulk = v19Base();
    bulk.crossfeed = { ...bulk.crossfeed, outputPairMask: 0xFF };   // ignored at V19
    const bytes = buildBulkParams(bulk, 19);
    // GlobalParams(16) ends at header(16)+16=32; CrossfeedParams starts there:
    // enabled(1) preset(1) itd(1) then the reserved byte at offset 3 -> byte 35.
    expect(bytes[35]).toBe(0);
  });

  it('down-converts a V20 snapshot to a V18 packet (masks dropped, size unchanged)', () => {
    const bulk = v20Base();
    bulk.loudness = { ...bulk.loudness, outputMask: 0x1234 };
    bulk.crossfeed = { ...bulk.crossfeed, outputPairMask: 0x0A };
    bulk.masterVolumeDb = -6;

    const bytes = buildBulkParams(bulk, 18);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V18);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(18);
    expect(p.masterVolumeDb).toBeCloseTo(-6, 4);
    expect(p.loudness.outputMask).toBe(0xFFFF);
    expect(p.crossfeed.outputPairMask).toBe(0x01);
  });

  it('stamps the header formatVersion to match the requested write version', () => {
    const bulk = v20Base();
    const bytes19 = buildBulkParams(bulk, 19);
    expect(bytes19[0]).toBe(19);
    const bytes20 = buildBulkParams(bulk, 20);
    expect(bytes20[0]).toBe(20);
  });

  it('default V20 bulk roundtrips through build+parse cleanly', () => {
    const base = v20Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
