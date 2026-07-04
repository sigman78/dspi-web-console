import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from './DspDevice';
import { createDevice } from '@test/fixtures/deviceHarness';

describe('DspDevice snapshot API', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('getSnapshot returns a domain snapshot', async () => {
    const snap = await d.getSnapshot();
    expect(d.capabilities.wire).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(snap.channels)).toBe(true);
  });

  it('captureState + restoreState round-trip device state opaquely', async () => {
    // Mutate to a non-default value, capture that, mutate again to a
    // different value, then restore the blob and confirm the captured value
    // (not the default, not the post-capture value) comes back. Two distinct
    // non-default values prove both that captureState saw the first mutation
    // AND that restoreState pushed the blob back to the device.
    await d.setMasterVolume(-7);
    const blob = await d.captureState();
    expect((await d.getSnapshot()).masterVolumeDb).toBe(-7);

    await d.setMasterVolume(-3);
    expect((await d.getSnapshot()).masterVolumeDb).toBe(-3);

    await d.restoreState(blob);
    expect((await d.getSnapshot()).masterVolumeDb).toBe(-7);
  });
});
