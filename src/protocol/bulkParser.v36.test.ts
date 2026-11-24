// V35 (upmixer v2) and V36 (stereo spatializer) packet sections.

import { describe, it, expect } from 'vitest';
import * as BulkParser from './bulkParser';
import * as Wire from './wireTypes';

const shape = { platformId: 1, numCh: 17, numOut: 9, numIn: 8 };

function nonDefault(version: number) {
  const bulk = BulkParser.defaultBulkParams({ ...shape, formatVersion: version });
  bulk.upmix2.p0Ext = {
    srcA: 2, srcB: 3, activeCounts: 0b0110, backOffsetMs: 3.5,
    routes: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ outMask: 1 << i, trimQ1: i - 3, flags: i & 1 })),
  };
  bulk.upmix2.p1 = { ...bulk.upmix2.p1, enabled: true, centerMode: 2, strengthPct: 70, presenceDb: -3.5 };
  bulk.upmix2.p1Ext.routes[4] = { outMask: 0x1A0, trimQ1: -20, flags: 1 };
  bulk.spatial = {
    enabled: true, mode: 1, pairMask: 0b11, widthPct: 90, bassWidthPct: 140, shelfHz: 450,
    spanDeg: 15, attenDb: 6, midPct: 60, trimDb: -3,
  };
  return bulk;
}

describe('bulkParser V35/V36', () => {
  it('parses and rebuilds a V36 packet byte for byte, with both sections non-default', () => {
    const bytes = BulkParser.buildBulkParams(nonDefault(36));
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V36);
    const parsed = BulkParser.parseBulkParams(bytes);
    expect(parsed.spatial).toMatchObject({ enabled: true, mode: 1, pairMask: 0b11, shelfHz: 450 });
    expect(parsed.upmix2.p0Ext.routes[6]).toEqual({ outMask: 64, trimQ1: 3, flags: 0 });
    expect(parsed.upmix2.p1.presenceDb).toBe(-3.5);
    expect(BulkParser.buildBulkParams(parsed)).toEqual(bytes);
  });

  it('emits the device version and size at 34, 35 and 36', () => {
    const bulk = nonDefault(36);
    const built = [34, 35, 36].map((v) => BulkParser.buildBulkParams(bulk, v));
    expect(built.map((b) => [b[0], b.byteLength])).toEqual([[34, 6136], [35, 6252], [36, 6284]]);
  });

  it('carries the V35 section but not the spatializer in a V35 packet', () => {
    const parsed = BulkParser.parseBulkParams(BulkParser.buildBulkParams(nonDefault(36), 35));
    expect(parsed.upmix2.p0Ext.srcA).toBe(2);
    expect(parsed.spatial.enabled).toBe(false);
    expect(parsed.spatial.widthPct).toBe(125);
  });

  it.each([32, 34])('converts a V%i packet to V36 with firmware defaults, not zeros', (version) => {
    const old = BulkParser.parseBulkParams(BulkParser.buildBulkParams(
      BulkParser.defaultBulkParams({ ...shape, formatVersion: version })));
    const v36 = BulkParser.parseBulkParams(BulkParser.buildBulkParams(old, 36));
    expect(v36.formatVersion).toBe(36);
    for (const ext of [v36.upmix2.p0Ext, v36.upmix2.p1Ext]) {
      expect(ext).toMatchObject({ srcA: 0, srcB: 1, activeCounts: 1, backOffsetMs: 2 });
      expect(ext.routes).toHaveLength(7);
      expect(ext.routes.every((r) => r.outMask === 0 && r.trimQ1 === 0 && r.flags === 0)).toBe(true);
    }
    expect(v36.upmix2.p1).toEqual(v36.upmix);
    expect(v36.spatial).toEqual({
      enabled: false, mode: 0, pairMask: 1, widthPct: 125, bassWidthPct: 150, shelfHz: 700,
      spanDeg: 10, attenDb: 3, midPct: 100, trimDb: 0,
    });
  });
});
