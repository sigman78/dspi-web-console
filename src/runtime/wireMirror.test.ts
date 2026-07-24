import { describe, it, expect } from 'vitest';
import { WireMirror } from './wireMirror';
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

describe('WireMirror.splice', () => {
  it('splices a value and returns prev/next whose diff is exactly that field', async () => {
    const dev = await v10Device();
    const mirror = new WireMirror();
    const r = mirror.splice(dev, BYPASS_OFFSET, new Uint8Array([1]));
    expect(r).not.toBeNull();
    expect(r!.prev.bypass).toBe(false);
    expect(r!.next.bypass).toBe(true);
  });

  it('returns null when offset+size overruns the buffer', async () => {
    const dev = await v10Device();
    const mirror = new WireMirror();
    expect(mirror.splice(dev, 999999, new Uint8Array([1]))).toBeNull();
  });

  it('returns null when the device has no buffer yet', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    const dev = await DspDevice.create(mock);   // no getSnapshot → lastRawBulk null
    const mirror = new WireMirror();
    expect(mirror.splice(dev, BYPASS_OFFSET, new Uint8Array([1]))).toBeNull();
  });

  it('compounds successive splices, and reseeds when a new read replaces the buffer', async () => {
    const dev = await v10Device();
    const mirror = new WireMirror();
    mirror.splice(dev, BYPASS_OFFSET, new Uint8Array([1]));         // bypass → true in the working copy
    const r2 = mirror.splice(dev, BYPASS_OFFSET + 1, new Uint8Array([1])); // loudnessEnabled byte → true
    expect(r2!.next.bypass).toBe(true);          // earlier splice still present (compounded)
    expect(r2!.next.loudness.enabled).toBe(true);

    await dev.getSnapshot();                      // a fresh read → new lastRawBulk array → reseed
    const r3 = mirror.splice(dev, BYPASS_OFFSET, new Uint8Array([1]));
    expect(r3!.prev.bypass).toBe(false);          // reseeded from the fresh (bypass=0) read
  });

  it('two instances splicing distinct mock devices do not reseed each other', async () => {
    const devA = await v10Device();
    const devB = await v10Device();
    const mirrorA = new WireMirror();
    const mirrorB = new WireMirror();

    mirrorA.splice(devA, BYPASS_OFFSET, new Uint8Array([1]));   // A: bypass → true
    const rb = mirrorB.splice(devB, BYPASS_OFFSET, new Uint8Array([0]));  // B: bypass stays false

    expect(rb!.prev.bypass).toBe(false);   // B's own seed, untouched by A's splice
    expect(rb!.next.bypass).toBe(false);

    const ra2 = mirrorA.splice(devA, BYPASS_OFFSET, new Uint8Array([1]));
    expect(ra2!.prev.bypass).toBe(true);   // A's compounded state, unaffected by B
  });
});
