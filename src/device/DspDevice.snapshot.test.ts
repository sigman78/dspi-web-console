import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from './DspDevice';
import type { DspTransport } from '@/transport/DspTransport';
import { WireCmd } from '@/protocol';
import { PlatformType } from '@/domain';

type TestPlatform = 'rp2040' | 'rp2350';

function identityBytes(request: number, length: number, platform: TestPlatform): Uint8Array | null {
  if (request === WireCmd.GetSerial.code) {
    const out = new Uint8Array(length);
    out.set(new TextEncoder().encode(`TEST-${platform.toUpperCase()}`).slice(0, length));
    return out;
  }
  if (request === WireCmd.GetPlatform.code) {
    const out = new Uint8Array(length);
    out[0] = platform === 'rp2350' ? PlatformType.RP2350 : PlatformType.RP2040;
    if (length > 1) out[1] = 1;
    if (length > 2) out[2] = 0;
    return out;
  }
  return null;
}

function withIdentity(base: DspTransport, platform: TestPlatform = 'rp2350'): DspTransport {
  return {
    open: () => base.open(),
    close: () => base.close(),
    isOpen: () => base.isOpen(),
    on: (event, listener) => base.on(event, listener),
    ctrlIn: (request, value, length) => {
      const identity = identityBytes(request, length, platform);
      return identity ? Promise.resolve(identity) : base.ctrlIn(request, value, length);
    },
    ctrlOut: (request, value, data) => base.ctrlOut(request, value, data),
  };
}

async function createDevice(base: DspTransport, platform: TestPlatform = 'rp2350'): Promise<DspDevice> {
  const openTransport = base.isOpen() ? async () => {} : () => base.open();
  return DspDevice.create(withIdentity(base, platform), openTransport);
}

describe('DspDevice snapshot API', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('getSnapshot returns a domain snapshot', async () => {
    const snap = await d.getSnapshot();
    expect(snap.formatVersion).toBeGreaterThanOrEqual(3);
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
