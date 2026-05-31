import { describe, it, expect, beforeEach } from 'vitest';
import { startNotifyChannel } from './notifyChannel';
import { peekReconcile, beginPresetGuard, endPresetGuard, mirror } from '@/state/mirror.svelte';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice } from '@/device/DspDevice';
import { resetWireMirror } from './wireMirror';

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

// Like manualClock but records the per-arm delay passed to next(cb, delayMs).
function delayClock() {
  let cb: (() => void) | null = null;
  const delays: (number | undefined)[] = [];
  return {
    clock: { next: (fn: () => void, d?: number) => { cb = fn; delays.push(d); }, cancel: () => { cb = null; } },
    tick: async () => {
      const f = cb; cb = null; f?.();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
    delays,
    armed: () => cb !== null,
  };
}

// Minimal device exposing only what the channel touches, so a test can inject
// read failures / null reads without a transport.
function fakeNotifyingDevice(read: () => Promise<Uint8Array | null>): DspDevice {
  return { capabilities: { features: { notifications: true } }, readNotification: read } as unknown as DspDevice;
}

// Returns the MockTransport (caller pushes packets to it) and a v10 device.
async function v10Setup() {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
  const dev = await DspDevice.create(mock);
  return { mock, dev };
}

beforeEach(() => { mirror.reset(); });

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
    // PARAM_CHANGED, source=HOST(1), size=0
    mock.pushNotify(new Uint8Array([2, 2, 0, 1, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(false);
    stop();
  });

  it('reconciles when a seq gap reveals a missed event', async () => {
    const { mock, dev } = await v10Setup();
    // A HOST echo at seq=1 (no trigger), then a HOST echo at seq=3 (gap → 2 missed); size=0
    const host = (seq: number) => new Uint8Array([2, 2, 0, seq, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]);
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
    // size=0 so the frame parses as a valid paramChanged (HOST echo, no value)
    const host = (seq: number) => new Uint8Array([2, 2, 0, seq, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]);
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

  it('suppresses a self-sourced bulkInvalidated echo while a preset-op guard is held', async () => {
    const { mock, dev } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));   // bulkInvalidated, src=preset
    const m = manualClock();
    beginPresetGuard();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(false);   // self-echo suppressed
    endPresetGuard(0);
    stop();
  });

  it('suppresses a presetLoaded echo while a preset-op guard is held', async () => {
    const { mock, dev } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 1]));   // PRESET_LOADED, slot 1
    const m = manualClock();
    beginPresetGuard();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(false);
    endPresetGuard(0);
    stop();
  });

  it('applies a non-HOST PARAM_CHANGED locally even under a preset guard (guard never suppresses it)', async () => {
    // The preset guard suppresses only bulk/preset self-echoes; a GPIO paramChanged
    // is applied precisely regardless of the guard (Layer 2). Seeded mirror → apply
    // succeeds in place, no full reconcile.
    resetWireMirror();
    const { mock, dev } = await v10Setup();
    mirror.init(await dev.getSnapshot());
    expect(mirror.current?.bypass).toBe(false);
    mock.pushNotify(paramChangedFrame(20, [1], 5));   // GPIO(5), bypass byte at offset 20
    const m = manualClock();
    beginPresetGuard();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(mirror.current?.bypass).toBe(true);   // applied despite the guard
    expect(peekReconcile().wanted).toBe(false);  // not a full reconcile
    endPresetGuard(0);
    stop();
  });

  it('still reconciles a non-self bulkInvalidated (gpio source) under the guard', async () => {
    const { mock, dev } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 5, 0, 0, 0]));   // bulkInvalidated, src=GPIO(5)
    const m = manualClock();
    beginPresetGuard();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(true);
    endPresetGuard(0);
    stop();
  });

  it('still reconciles on a seq gap even under the guard', async () => {
    const { mock, dev } = await v10Setup();
    // Two self-sourced echoes whose triggers are suppressed, but seq 1→3 is a gap.
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));   // bulkInvalidated src=preset seq=1
    mock.pushNotify(new Uint8Array([2, 3, 0, 3, 3, 0, 0, 0]));   // ...src=preset seq=3 (missed 2)
    const m = manualClock();
    beginPresetGuard();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(false);   // seq 1: echo suppressed, no gap yet
    await m.tick();
    expect(peekReconcile().wanted).toBe(true);     // seq 3: gap ⇒ reconcile despite guard
    endPresetGuard(0);
    stop();
  });

  it('resumes reconciling once the preset-op guard has released', async () => {
    const { mock, dev } = await v10Setup();
    beginPresetGuard();
    endPresetGuard(0);   // released with no trailing grace
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(true);
    stop();
  });

  it('backs off on repeated read errors, then resets the cadence on a healthy read', async () => {
    let fail = true;
    const dev = fakeNotifyingDevice(async () => {
      if (fail) throw new Error('stall');
      return new Uint8Array([0]);  // idle
    });
    const m = delayClock();
    const stop = startNotifyChannel(dev, m.clock);
    expect(m.delays[0]).toBeUndefined();   // initial arm = normal cadence
    await m.tick();                        // error → first backoff
    await m.tick();                        // error → larger backoff
    const b1 = m.delays[1];
    const b2 = m.delays[2];
    expect(b1).toBeGreaterThan(0);
    expect(b2).toBeGreaterThan(b1!);
    fail = false;
    await m.tick();                        // healthy read → cadence resets
    expect(m.delays[3]).toBeUndefined();
    stop();
  });

  it('stops the loop when the transport exposes no notify endpoint (readNotification null)', async () => {
    const dev = fakeNotifyingDevice(async () => null);
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    expect(m.armed()).toBe(true);   // armed initially
    await m.tick();                 // reads null → stops, no re-arm
    expect(m.armed()).toBe(false);
    stop();
  });
});

// v2 PARAM_CHANGED frame: [2, 0x02, flags, seq, off_lo, off_hi, size_lo, size_hi, source, r,r,r, ...value]
function paramChangedFrame(offset: number, value: number[], source = 5, seq = 1): Uint8Array {
  return new Uint8Array([2, 0x02, 0, seq, offset & 0xff, (offset >> 8) & 0xff, value.length & 0xff, (value.length >> 8) & 0xff, source, 0, 0, 0, ...value]);
}

describe('startNotifyChannel — Layer 2 PARAM_CHANGED apply', () => {
  it('applies a non-HOST paramChanged locally without requesting a reconcile', async () => {
    resetWireMirror();
    const { mock, dev } = await v10Setup();
    mirror.init(await dev.getSnapshot());          // mirror.current + dev.lastRawBulk
    expect(mirror.current?.bypass).toBe(false);
    mock.pushNotify(paramChangedFrame(20, [1], 5));  // bypass byte (offset 20), source=GPIO(5)
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(mirror.current?.bypass).toBe(true);     // applied locally
    expect(peekReconcile().wanted).toBe(false);    // no full reconcile
    stop();
  });

  it('falls back to a reconcile when the apply declines (out-of-range offset)', async () => {
    resetWireMirror();
    const { mock, dev } = await v10Setup();
    mirror.init(await dev.getSnapshot());
    mock.pushNotify(paramChangedFrame(60000, [1], 5));  // offset out of range → apply returns false
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(peekReconcile().wanted).toBe(true);     // backstop reconcile
    stop();
  });

  it('drops a HOST-sourced paramChanged (our own echo) without applying or reconciling', async () => {
    resetWireMirror();
    const { mock, dev } = await v10Setup();
    mirror.init(await dev.getSnapshot());
    mock.pushNotify(paramChangedFrame(20, [1], 1));  // source=HOST(1)
    const m = manualClock();
    const stop = startNotifyChannel(dev, m.clock);
    await m.tick();
    expect(mirror.current?.bypass).toBe(false);    // not applied
    expect(peekReconcile().wanted).toBe(false);    // not reconciled
    stop();
  });
});
