// V31/V32 codec coverage: the tube preamp section (48 B at 5980) and the
// per-output limiter section (9 x 12 B at 6028). Packet grows to 6136 B.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function base(formatVersion: number) {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion });
}

describe('bulkParser — V31/V32 layout gating', () => {
  it('bulkLayout gates tube on V31 and limiter on V32, both AND payloadLength', () => {
    const v30 = Wire.bulkLayout({ formatVersion: 30, payloadLength: Wire.BULK_SIZE_V30 });
    expect([v30.tube, v30.limiter]).toEqual([false, false]);

    const v31 = Wire.bulkLayout({ formatVersion: 31, payloadLength: Wire.BULK_SIZE_V31 });
    expect([v31.tube, v31.limiter]).toEqual([true, false]);

    const v32 = Wire.bulkLayout({ formatVersion: 32, payloadLength: Wire.BULK_SIZE_V32 });
    expect([v32.tube, v32.limiter]).toEqual([true, true]);

    const truncated = Wire.bulkLayout({ formatVersion: 32, payloadLength: Wire.BULK_SIZE_V31 });
    expect([truncated.tube, truncated.limiter]).toEqual([true, false]);
  });
});

describe('bulkParser — V32 packet', () => {
  it('roundtrips non-default tube and limiter values', () => {
    const bulk = base(32);
    bulk.tube = {
      enabled: true, tubeType: 12, rectifier: 3, xfmrEnabled: false, outputMask: 0x0035,
      driveDb: 6, biasPct: -40, asymDb: -2.5, hardnessPct: 75, sagPct: 30,
      xfmrDamping: 7, xfmrResHz: 120, mixPct: 55, trimDb: -3,
    };
    bulk.limiter[0] = { enabled: true, linkGroup: 2, thresholdDb: -6, releaseMs: 250 };
    bulk.limiter[8] = { enabled: true, linkGroup: 4, thresholdDb: -20, releaseMs: 10 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V32);

    const p = parseBulkParams(bytes);
    expect(p.tube).toEqual(bulk.tube);
    expect(p.limiter).toEqual(bulk.limiter);
  });

  it('writes the tube at byte 5980 and the limiter at byte 6028', () => {
    const bulk = base(32);
    bulk.tube = { ...bulk.tube, enabled: true, tubeType: 9, outputMask: 0x0102, driveDb: 6 };
    bulk.limiter[1] = { enabled: true, linkGroup: 3, thresholdDb: -6, releaseMs: 250 };

    const bytes = buildBulkParams(bulk);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(bytes[5980]).toBe(1);
    expect(bytes[5981]).toBe(9);
    expect(dv.getUint16(5984, true)).toBe(0x0102);
    expect(dv.getFloat32(5988, true)).toBe(6);
    expect(dv.getFloat32(6024, true)).toBe(0);      // reserved float
    expect(bytes[6028 + 12]).toBe(1);
    expect(bytes[6028 + 12 + 1]).toBe(3);
    expect(dv.getFloat32(6028 + 12 + 4, true)).toBe(-6);
    expect(dv.getFloat32(6028 + 12 + 8, true)).toBe(250);
  });

  it('default V32 bulk roundtrips through build+parse cleanly', () => {
    const d = base(32);
    expect(parseBulkParams(buildBulkParams(d))).toEqual(d);
  });
});

describe('bulkParser — older packets parse with firmware defaults', () => {
  it('a V31 packet carries the tube and defaults the limiter', () => {
    const bulk = base(31);
    bulk.tube = { ...bulk.tube, enabled: true, trimDb: 4 };
    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V31);

    const p = parseBulkParams(bytes);
    expect(p.tube.enabled).toBe(true);
    expect(p.tube.trimDb).toBe(4);
    expect(p.limiter).toHaveLength(9);
    expect(p.limiter[4]).toEqual({ enabled: false, linkGroup: 0, thresholdDb: -1, releaseMs: 100 });
  });

  it('a V30 packet parses with the tube and limiter at defaults', () => {
    const p = parseBulkParams(buildBulkParams(base(30)));
    expect(p.tube).toEqual({
      enabled: false, tubeType: 1, rectifier: 1, xfmrEnabled: true, outputMask: 0xFFFF,
      driveDb: -12, biasPct: 10, asymDb: 3, hardnessPct: 40, sagPct: 15,
      xfmrDamping: 2, xfmrResHz: 95, mixPct: 100, trimDb: 0,
    });
    expect(p.limiter.every((o) => !o.enabled && o.linkGroup === 0 && o.thresholdDb === -1 && o.releaseMs === 100)).toBe(true);
  });

  it('a V30 state built at V32 (paste from a beta3 device) carries firmware defaults for both sections', () => {
    const fromV30 = parseBulkParams(buildBulkParams(base(30)));
    const bytes = buildBulkParams(fromV30, 32);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V32);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect([bytes[5980], bytes[5981], bytes[5982], bytes[5983]]).toEqual([0, 1, 1, 1]);
    expect(dv.getUint16(5984, true)).toBe(0xFFFF);
    expect(dv.getFloat32(5988, true)).toBe(-12);
    expect([bytes[6028], bytes[6029]]).toEqual([0, 0]);
    expect(dv.getFloat32(6032, true)).toBe(-1);
    expect(dv.getFloat32(6036, true)).toBe(100);
  });

  it('a V32 header whose payload stops after the tube section reads the tube and defaults the limiter', () => {
    const bulk = base(32);
    bulk.tube = { ...bulk.tube, enabled: true, mixPct: 40 };
    bulk.limiter[0] = { enabled: true, linkGroup: 1, thresholdDb: -9, releaseMs: 300 };
    const full = buildBulkParams(bulk);
    const short = full.slice(0, Wire.BULK_SIZE_V31);
    new DataView(short.buffer, short.byteOffset).setUint16(6, Wire.BULK_SIZE_V31, true);  // header payloadLength
    const p = parseBulkParams(short);
    expect(p.tube.enabled).toBe(true);
    expect(p.tube.mixPct).toBe(40);
    expect(p.limiter[0]).toEqual({ enabled: false, linkGroup: 0, thresholdDb: -1, releaseMs: 100 });
  });

  it('building at V31 from a state carrying limiter data drops it and emits 6028 bytes', () => {
    const bulk = base(32);
    bulk.limiter[0] = { enabled: true, linkGroup: 1, thresholdDb: -12, releaseMs: 500 };
    const bytes = buildBulkParams(bulk, 31);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V31);
    expect(parseBulkParams(bytes).limiter[0].enabled).toBe(false);
  });
});

describe('bulkParser — enum clamping', () => {
  it('clamps a garbled tube_type / rectifier / link_group byte on read', () => {
    const bytes = buildBulkParams(base(32));
    bytes[5981] = 200;            // tube_type
    bytes[5982] = 9;              // rectifier
    bytes[6028 + 12 * 5 + 1] = 7; // limiter[5].link_group
    const p = parseBulkParams(bytes);
    expect(p.tube.tubeType).toBe(16);
    expect(p.tube.rectifier).toBe(3);
    expect(p.limiter[5].linkGroup).toBe(0);
  });

  it('clamps out-of-range enums on write', () => {
    const bulk = base(32);
    bulk.tube = { ...bulk.tube, tubeType: 40 as never, rectifier: 9 as never };
    bulk.limiter[2] = { ...bulk.limiter[2], linkGroup: 9 };
    const bytes = buildBulkParams(bulk);
    expect(bytes[5981]).toBe(16);
    expect(bytes[5982]).toBe(3);
    expect(bytes[6028 + 24 + 1]).toBe(0);
  });
});
