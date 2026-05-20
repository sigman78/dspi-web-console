import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { hasFormatVersion, openSingleDevice } from '../../hil/setup';
import type { BulkParams } from '@/protocol';

// HIL: round-trip SET_ALL_PARAMS against real firmware.
// GET initial state once -> mutate safe fields per test -> SET -> GET -> assert.
// Initial state is restored in afterAll so reruns are idempotent.
// Pin/i2s/output-type mutations are deliberately omitted to avoid
// disrupting the hardware's physical output configuration.

const F32_TOL = 4;

// Brief settle window. Firmware defers bulk apply to the main loop
// (~5 ms per docs/HW-DSPUSB.md); 30 ms is comfortably above that
// and well below test timeouts.
const SETTLE_MS = 30;

describe('DspDevice.setAllParams round-trip (HIL)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;
  let initial: BulkParams;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    initial = await device.getAllParams();
  });

  afterAll(async () => {
    // Restore initial state so reruns are idempotent.
    if (device && initial) {
      try {
        await device.setAllParams(initial);
        await new Promise((r) => setTimeout(r, SETTLE_MS));
      } catch {
        // Best-effort restore; close the device regardless.
      }
    }
    if (close) await close();
  });

  it('SET then GET reflects bypass toggle', async () => {
    if (!hasFormatVersion(initial, 6)) return;
    const mutated: BulkParams = { ...initial, bypass: !initial.bypass };
    await device.setAllParams(mutated);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const after = await device.getAllParams();
    expect(after.bypass).toBe(mutated.bypass);
  });

  it('SET then GET reflects master volume change', async () => {
    if (!hasFormatVersion(initial, 6)) return;
    const target = initial.masterVolumeDb === 0 ? -6 : 0;
    const mutated: BulkParams = { ...initial, masterVolumeDb: target };
    await device.setAllParams(mutated);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const after = await device.getAllParams();
    expect(after.masterVolumeDb).toBeCloseTo(target, 1);
  });

  it('SET then GET reflects a channel rename', async () => {
    if (!hasFormatVersion(initial, 6)) return;
    const names = initial.channelNames.slice();
    names[0] = 'HIL-Test-Channel';
    const mutated: BulkParams = { ...initial, channelNames: names };
    await device.setAllParams(mutated);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const after = await device.getAllParams();
    expect(after.channelNames[0]).toBe('HIL-Test-Channel');
  });

  it('SET then GET reflects a filter change on channel 0 band 0', async () => {
    if (!hasFormatVersion(initial, 6)) return;
    const filters = initial.filters.map((row) => row.map((f) => ({ ...f })));
    filters[0][0] = { type: 1, frequency: 1234, q: 0.8, gain: -2.5 };
    const mutated: BulkParams = { ...initial, filters };
    await device.setAllParams(mutated);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const after = await device.getAllParams();
    expect(after.filters[0][0].type).toBe(1);
    expect(after.filters[0][0].frequency).toBeCloseTo(1234, 0);
    expect(after.filters[0][0].q).toBeCloseTo(0.8, F32_TOL);
    expect(after.filters[0][0].gain).toBeCloseTo(-2.5, F32_TOL);
  });
});
