import { describe, it, expect, beforeEach } from 'vitest';
import { spliceWireParam, resetWireMirror } from './wireMirror';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from '@/device/DspDevice';

// GlobalParams.bypass is the byte after Header(16) + preampDb f32(4) = offset 20.
const BYPASS_OFFSET = 20;

async function v10Device() {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
  const dev = await DspDevice.create(mock);
  await dev.getSnapshot();   // populates dev.lastRawBulk (bypass byte = 0)
  return dev;
}

beforeEach(() => { resetWireMirror(); });

describe('spliceWireParam', () => {
  it('splices a value and returns prev/next whose diff is exactly that field', async () => {
    const dev = await v10Device();
    const r = spliceWireParam(dev, BYPASS_OFFSET, new Uint8Array([1]));
    expect(r).not.toBeNull();
    expect(r!.prev.bypass).toBe(false);
    expect(r!.next.bypass).toBe(true);
  });

  it('returns null when offset+size overruns the buffer', async () => {
    const dev = await v10Device();
    expect(spliceWireParam(dev, 999999, new Uint8Array([1]))).toBeNull();
  });

  it('returns null when the device has no buffer yet', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    const dev = await DspDevice.create(mock);   // no getSnapshot → lastRawBulk null
    expect(spliceWireParam(dev, BYPASS_OFFSET, new Uint8Array([1]))).toBeNull();
  });

  it('compounds successive splices, and reseeds when a new read replaces the buffer', async () => {
    const dev = await v10Device();
    spliceWireParam(dev, BYPASS_OFFSET, new Uint8Array([1]));         // bypass → true in the working copy
    const r2 = spliceWireParam(dev, BYPASS_OFFSET + 1, new Uint8Array([1])); // loudnessEnabled byte → true
    expect(r2!.next.bypass).toBe(true);          // earlier splice still present (compounded)
    expect(r2!.next.loudness.enabled).toBe(true);

    await dev.getSnapshot();                      // a fresh read → new lastRawBulk array → reseed
    const r3 = spliceWireParam(dev, BYPASS_OFFSET, new Uint8Array([1]));
    expect(r3!.prev.bypass).toBe(false);          // reseeded from the fresh (bypass=0) read
  });
});
