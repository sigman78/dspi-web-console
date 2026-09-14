// V30 codec coverage: the subharm section tail (third band, selectivity,
// ceiling, pair link), appended after the V29 SubharmParams. Packet grows to
// 5980 B.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';
import type { SubharmSelect } from '@/domain';

function v29Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 29 });
}
function v30Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 30 });
}

describe('bulkParser — V30 packet sizes', () => {
  it('a V30 packet is 5980 bytes', () => {
    expect(Wire.BULK_SIZE_V30).toBe(5980);
  });

  it('bulkLayout gates subharmExt on wire V30 AND payloadLength (subharm itself stays gated on V29)', () => {
    const v29 = Wire.bulkLayout({ formatVersion: 29, payloadLength: Wire.BULK_SIZE_V29 });
    expect(v29.subharm).toBe(true);
    expect(v29.subharmExt).toBe(false);

    const v30 = Wire.bulkLayout({ formatVersion: 30, payloadLength: Wire.BULK_SIZE_V30 });
    expect(v30.subharm).toBe(true);
    expect(v30.subharmExt).toBe(true);

    const truncated = Wire.bulkLayout({ formatVersion: 30, payloadLength: Wire.BULK_SIZE_V29 });
    expect(truncated.subharm).toBe(true);
    expect(truncated.subharmExt).toBe(false);
  });
});

describe('bulkParser — V30 (subharm section tail) packet', () => {
  it('roundtrips a non-default tail', () => {
    const bulk = v30Base();
    bulk.subharm = {
      ...bulk.subharm,
      topDb: -3, selectMode: 1, selectDepth: 40, selectHoldMs: 250, ceilingDb: -6, linkPairs: false,
    };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V30);

    const p = parseBulkParams(bytes);
    expect(p.subharm.topDb).toBeCloseTo(-3, 5);
    expect(p.subharm.selectMode).toBe(1);
    expect(p.subharm.selectDepth).toBeCloseTo(40, 5);
    expect(p.subharm.selectHoldMs).toBeCloseTo(250, 5);
    expect(p.subharm.ceilingDb).toBeCloseTo(-6, 5);
    expect(p.subharm.linkPairs).toBe(false);
  });

  it('sits at byte offset 5960: top_db f32 at 5960, select_mode at 5976, link_pairs at 5977', () => {
    const bulk = v30Base();
    bulk.subharm = { ...bulk.subharm, topDb: -3, selectMode: 2, linkPairs: true };

    const bytes = buildBulkParams(bulk);
    const topDb = new DataView(bytes.buffer, bytes.byteOffset + 5960, 4).getFloat32(0, true);
    expect(topDb).toBeCloseTo(-3, 5);
    expect(bytes[5976]).toBe(2);
    expect(bytes[5977]).toBe(1);
  });

  it('a V29 packet parses with the tail at defaults', () => {
    const bulk = v29Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.subharm.topDb).toBe(-30);
    expect(p.subharm.selectMode).toBe(0);
    expect(p.subharm.selectDepth).toBe(100);
    expect(p.subharm.selectHoldMs).toBe(150);
    expect(p.subharm.ceilingDb).toBe(0);
    expect(p.subharm.linkPairs).toBe(true);
  });

  it('building at formatVersion 29 from a state that carries a tail drops it and emits exactly 5960 bytes', () => {
    const bulk = v30Base();
    bulk.subharm = { ...bulk.subharm, topDb: -3, selectMode: 1, ceilingDb: -6 };

    const bytes = buildBulkParams(bulk, 29);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V29);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(29);
    expect(p.subharm.topDb).toBe(-30);       // tail defaults, not the dropped -3
    expect(p.subharm.selectMode).toBe(0);
  });

  it('clamps an out-of-range selectMode to 2 on write', () => {
    const bulk = v30Base();
    bulk.subharm = { ...bulk.subharm, selectMode: 7 as SubharmSelect };

    const bytes = buildBulkParams(bulk);
    expect(bytes[5976]).toBe(2);
    expect(parseBulkParams(bytes).subharm.selectMode).toBe(2);
  });

  it('default V30 bulk roundtrips through build+parse cleanly', () => {
    const base = v30Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
