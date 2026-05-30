import { describe, it, expect, beforeEach } from 'vitest';
import { startNotifyChannel } from './notifyChannel';
import { consumeReconcile, peekReconcile } from '@/state/mirror.svelte';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from '@/device/DspDevice';

// A manual clock: tests call tick() to advance the loop one read at a time.
// tick() flushes several microtasks so the async pump (readNotification →
// notifyIn) fully settles before assertions.
function manualClock() {
  let cb: (() => void) | null = null;
  return {
    clock: { next: (fn: () => void) => { cb = fn; }, cancel: () => { cb = null; } },
    tick: async () => {
      const f = cb; cb = null; f?.();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
    armed: () => cb !== null,
  };
}

// Returns the MockTransport (caller pushes packets to it) and a v10 device.
async function v10Setup() {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
  const dev = await DspDevice.create(mock);
  return { mock, dev };
}

beforeEach(() => { consumeReconcile(); });

describe('startNotifyChannel', () => {
  it('does nothing on a device without the notifications capability', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350' })); // wire 6
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    expect(m.armed()).toBe(false);   // loop never started
    stop();
  });

  it('requests a reconcile on a BULK_INVALIDATED event', async () => {
    const { mock, dev } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(true);
    stop();
  });

  it('does NOT reconcile on a HOST-sourced paramChanged echo', async () => {
    const { mock, dev } = await v10Setup();
    // PARAM_CHANGED, source=HOST(1)
    mock.pushNotify(new Uint8Array([2, 2, 0, 1, 0x80, 0x0b, 4, 0, 1, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(false);
    stop();
  });

  it('reconciles when a seq gap reveals a missed event', async () => {
    const { mock, dev } = await v10Setup();
    // A HOST echo at seq=1 (no trigger), then a HOST echo at seq=3 (gap → 2 missed)
    const host = (seq: number) => new Uint8Array([2, 2, 0, seq, 0x80, 0x0b, 4, 0, 1, 0, 0, 0]);
    mock.pushNotify(host(1));
    mock.pushNotify(host(3));
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();                       // seq 1, no gap, no trigger
    expect(peekReconcile().wanted).toBe(false);
    await m.tick();                       // seq 3, gap → reconcile
    expect(peekReconcile().wanted).toBe(true);
    stop();
  });

  it('stops re-arming after stop()', async () => {
    const { dev } = await v10Setup();
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    stop();
    expect(m.armed()).toBe(false);
  });

  it('reconciles on a seq wraparound gap (255 → 1, missed 0)', async () => {
    const { mock, dev } = await v10Setup();
    const host = (seq: number) => new Uint8Array([2, 2, 0, seq, 0x80, 0x0b, 4, 0, 1, 0, 0, 0]);
    mock.pushNotify(host(255));
    mock.pushNotify(host(1));   // 255→0→1; seq 0 was missed
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();                       // seq 255, first event, no gap check
    expect(peekReconcile().wanted).toBe(false);
    await m.tick();                       // seq 1, gap (expected 0) → reconcile
    expect(peekReconcile().wanted).toBe(true);
    stop();
  });

  it('requests a reconcile on a PRESET_LOADED event', async () => {
    const { mock, dev } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 3]));  // PRESET_LOADED, slot 3
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(true);
    stop();
  });
});
