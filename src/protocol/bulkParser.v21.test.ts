// V21 codec coverage: I2S clock role (InputConfig reserved-byte claim) and the
// always-on I2S slave-clock pins (WireI2SConfig reserved-byte claim, not
// version-gated). Like V19/V20, the claim doesn't grow the packet --
// BULK_SIZE_V21 equals BULK_SIZE_V20.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v20Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 20 });
}
function v21Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 21 });
}

describe('bulkParser — V21 (I2S slave clock) packet', () => {
  it('roundtrips the I2S clock mode; packet size unchanged from V20', () => {
    const bulk = v21Base();
    bulk.inputConfig = { ...bulk.inputConfig, i2sClockMode: 1 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V21);
    expect(Wire.BULK_SIZE_V21).toBe(Wire.BULK_SIZE_V20);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(21);
    expect(p.inputConfig.i2sClockMode).toBe(1);
  });

  it('a V20 packet defaults i2sClockMode to 0 (no V21 byte)', () => {
    const bulk = v20Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.formatVersion).toBe(20);
    expect(p.inputConfig.i2sClockMode).toBe(0);
  });

  it('writing at V20 ignores a staged i2sClockMode value (reserved on that wire)', () => {
    const bulk = v20Base();
    bulk.inputConfig = { ...bulk.inputConfig, i2sClockMode: 1 };   // ignored at V20
    const p = parseBulkParams(buildBulkParams(bulk, 20));
    expect(p.inputConfig.i2sClockMode).toBe(0);
  });

  it('roundtrips the I2S slave-clock pins (clockPinModeP1, bckPinSlave); not version-gated', () => {
    const bulk = v21Base();
    bulk.i2s = { ...bulk.i2s, clockPinModeP1: 2, bckPinSlave: 26 };

    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.i2s.clockPinModeP1).toBe(2);
    expect(p.i2s.bckPinSlave).toBe(26);
  });

  it('the slave-clock pins round-trip on a V20 (pre-V21) packet too -- not gated on i2sClockMode', () => {
    const bulk = v20Base();
    bulk.i2s = { ...bulk.i2s, clockPinModeP1: 1, bckPinSlave: 12 };

    const p = parseBulkParams(buildBulkParams(bulk, 20));
    expect(p.i2s.clockPinModeP1).toBe(1);
    expect(p.i2s.bckPinSlave).toBe(12);
  });

  it('down-converts a V21 snapshot to a V18 packet (clock mode dropped, size unchanged)', () => {
    const bulk = v21Base();
    bulk.inputConfig = { ...bulk.inputConfig, i2sClockMode: 1 };
    bulk.masterVolumeDb = -6;

    const bytes = buildBulkParams(bulk, 18);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V18);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(18);
    expect(p.masterVolumeDb).toBeCloseTo(-6, 4);
    expect(p.inputConfig.i2sClockMode).toBe(0);
  });

  it('stamps the header formatVersion to match the requested write version', () => {
    const bulk = v21Base();
    const bytes20 = buildBulkParams(bulk, 20);
    expect(bytes20[0]).toBe(20);
    const bytes21 = buildBulkParams(bulk, 21);
    expect(bytes21[0]).toBe(21);
  });

  it('default V21 bulk roundtrips through build+parse cleanly', () => {
    const base = v21Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
