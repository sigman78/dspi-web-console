import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { openSingleDevice } from '@test/hil/setup';

describe('bulkParser against real hardware', () => {
  let device: DspDevice;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('parses a real GetAllParams response', async () => {
    const bulk = await device.getAllParams();
    expect(bulk.formatVersion).toBeGreaterThanOrEqual(2);
    expect([0, 1]).toContain(bulk.platformId);
    expect(bulk.numCh).toBeGreaterThanOrEqual(7);
    expect(bulk.numCh).toBeLessThanOrEqual(11);
    expect(bulk.outputs).toHaveLength(9);
    expect(bulk.crosspoints).toHaveLength(2);
    expect(bulk.crosspoints[0]).toHaveLength(9);
    expect(bulk.channelNames).toHaveLength(11);
  });

  it('reads master volume via control transfer matching the bulk-packet field', async () => {
    const bulk = await device.getAllParams();
    if (bulk.formatVersion < 6) return;
    const direct = await device.getMasterVolume();
    expect(direct).toBeCloseTo(bulk.masterVolumeDb, 2);
  });
});
