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
    // numCh is the packet's own platform/generation channel count; cross-check
    // against the hardware profile derived independently (via capabilities,
    // from a header peek rather than the full bulk parse).
    expect(bulk.numCh).toBe(device.hardware.totalChannelCount);
    expect(bulk.numIn).toBe(device.hardware.inputs.length);
    expect(bulk.numOut).toBe(device.hardware.outputCount);
    expect(bulk.outputs).toHaveLength(9);
    // The DTO is always V16-max shaped regardless of the connected
    // generation -- a V10 packet fills only a prefix of these arrays.
    expect(bulk.crosspoints).toHaveLength(8);
    expect(bulk.crosspoints[0]).toHaveLength(9);
    expect(bulk.channelNames).toHaveLength(17);
  });

  it('reads master volume via control transfer matching the bulk-packet field', async () => {
    const bulk = await device.getAllParams();
    if (bulk.formatVersion < 6) return;
    const direct = await device.getMasterVolume();
    expect(direct).toBeCloseTo(bulk.masterVolumeDb, 2);
  });
});
