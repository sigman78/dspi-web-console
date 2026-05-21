import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import { hasFormatVersion, openSingleDevice } from '@test/hil/setup';
import type { BulkParams } from '@/protocol';

// HIL: paste round-trip — capture all params, mutate masterVolumeDb,
// push via setAllParams, re-read, assert the field changed, then restore.
// Exercises the same code path as a user "paste" action in the UI.

const SETTLE_MS = 30;

describe('Paste round-trip via setAllParams (HIL)', () => {
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

  it('setAllParams(sourceBlob) makes RAM equal the pushed blob', async () => {
    if (!hasFormatVersion(initial, 6)) return;
    const source = initial;
    const mutated: BulkParams = {
      ...source,
      masterVolumeDb: source.masterVolumeDb <= -20 ? -10 : -20,
    };
    await device.setAllParams(mutated);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const after = await device.getAllParams();
    expect(after.masterVolumeDb).toBeCloseTo(mutated.masterVolumeDb, 1);
    // restore original device state
    await device.setAllParams(source);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  });
});
