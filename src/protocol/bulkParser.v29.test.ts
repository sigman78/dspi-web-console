// V29 codec coverage: the subharmonic synthesizer section, appended after
// UpmixParams. Both platforms -- unlike psybass/upmix there is no RP2350
// gate. Packet grows to 5960 B.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v28Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 28 });
}
function v29Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 29 });
}

describe('bulkParser — V29 packet sizes', () => {
  it('a V29 packet is 5960 bytes', () => {
    expect(Wire.BULK_SIZE_V29).toBe(5960);
  });

  it('bulkLayout gates subharm on wire V29 AND payloadLength', () => {
    const v28 = Wire.bulkLayout({ formatVersion: 28, payloadLength: Wire.BULK_SIZE_V28 });
    expect(v28.subharm).toBe(false);

    const v29 = Wire.bulkLayout({ formatVersion: 29, payloadLength: Wire.BULK_SIZE_V29 });
    expect(v29.subharm).toBe(true);

    const truncated = Wire.bulkLayout({ formatVersion: 29, payloadLength: Wire.BULK_SIZE_V28 });
    expect(truncated.subharm).toBe(false);
  });
});

describe('bulkParser — V29 (subharmonic synthesizer) packet', () => {
  it('roundtrips a non-default subharm section', () => {
    const bulk = v29Base();
    bulk.subharm = { enabled: true, outputMask: 0x0103, lowDb: -6, highDb: 2, boostDb: 3 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V29);

    const p = parseBulkParams(bytes);
    expect(p.subharm).toEqual({ enabled: true, outputMask: 0x0103, lowDb: -6, highDb: 2, boostDb: 3 });
  });

  it('sits at byte offset 5944: enabled at 5944, mask LE at 5946-5947, low_db f32 at 5948', () => {
    const bulk = v29Base();
    bulk.subharm = { enabled: true, outputMask: 0x0103, lowDb: -6, highDb: 0, boostDb: 0 };

    const bytes = buildBulkParams(bulk);
    expect(bytes[5944]).toBe(1);
    expect([bytes[5946], bytes[5947]]).toEqual([0x03, 0x01]);
    const lowDb = new DataView(bytes.buffer, bytes.byteOffset + 5948, 4).getFloat32(0, true);
    expect(lowDb).toBeCloseTo(-6, 5);
  });

  it('a pre-V29 packet defaults subharm to disabled / all-outputs / zeroed levels', () => {
    const bulk = v28Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.subharm).toEqual({ enabled: false, outputMask: 0xFFFF, lowDb: 0, highDb: 0, boostDb: 0 });
  });

  it('down-converts a V29 snapshot to V28 (subharm dropped, 5944 bytes)', () => {
    const bulk = v29Base();
    bulk.subharm = { ...bulk.subharm, enabled: true, lowDb: -6 };

    const bytes = buildBulkParams(bulk, 28);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V28);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(28);
    expect(p.subharm.enabled).toBe(false);
  });

  it('default V29 bulk roundtrips through build+parse cleanly', () => {
    const base = v29Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
