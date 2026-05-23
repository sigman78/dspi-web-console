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

  it('hasState is false before any snapshot fetch', () => {
    expect(d.hasState).toBe(false);
  });

  it('getSnapshot returns a domain snapshot and sets hasState', async () => {
    const snap = await d.getSnapshot();
    expect(snap.formatVersion).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(snap.channels)).toBe(true);
    expect(d.hasState).toBe(true);
  });

  it('applyBulk throws if called before any snapshot fetch', async () => {
    await expect(d.applyBulk({} as never)).rejects.toThrow();
  });

  it('applyBulk round-trips an edited snapshot through the wire', async () => {
    const snap = await d.getSnapshot();
    snap.masterVolumeDb = -12;
    await d.applyBulk(snap);
    const after = await d.getSnapshot();
    expect(after.masterVolumeDb).toBe(-12);
  });

  it('captureState + restoreState copy device state opaquely', async () => {
    await d.getSnapshot();
    const blob = await d.captureState();
    const snap = await d.getSnapshot();
    snap.masterVolumeDb = -30;
    await d.applyBulk(snap);
    await d.restoreState(blob);
    const restored = await d.getSnapshot();
    expect(restored.masterVolumeDb).toBe(blob.masterVolumeDb);
  });
});
