import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startNotifyChannel } from './notifyChannel';
import { notices, clearNotices, dispatch, makeReadySession, type ReadySession } from '@/state';
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
  return { readNotification: read } as unknown as DspDevice;
}

// Install a ready session for `dev` and return it (so the channel reads
// session.device/session.mirror).
function connect(dev: DspDevice): ReadySession {
  const session = makeReadySession(dev);
  dispatch({ t: 'synced', session });
  return session;
}

// Returns the MockTransport (caller pushes packets to it), a v10 device, and an
// installed session (with its mirror).
async function v10Setup() {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
  const dev = await DspDevice.create(mock);
  const session = connect(dev);
  return { mock, dev, session, mir: session.mirror };
}

// The channel starts in backlog-drain mode and stays muted until it reads an
// idle keep-alive (the firmware's "ring is empty" boundary). Tests that mean
// "the channel is already live" -- as every pre-existing test here did before
// backlog mode existed -- must cross that boundary first: enqueue an idle
// packet ahead of whatever they push next, and consume it with one extra tick.
function primeLive(mock: MockTransport): void {
  mock.pushNotify(new Uint8Array([0]));
}

beforeEach(() => { clearNotices(); });
afterEach(() => { dispatch({ t: 'disconnected' }); });

describe('startNotifyChannel', () => {
  it('requests a reconcile on a BULK_INVALIDATED event', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live bulkInvalidated
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });

  it('toasts a confirmation and requests a reconcile on a PRESET_LOADED event', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 3, 0, 0, 0])); // PRESET_LOADED, slot 3
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live presetLoaded -- regression pin: live events still toast/reconcile
    expect(notices.list.some((n) => n.kind === 'info' && n.message.includes('03'))).toBe(true);
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });

  it('does NOT reconcile on a HOST-sourced paramChanged echo', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    // PARAM_CHANGED, source=HOST(1), size=0
    mock.pushNotify(new Uint8Array([2, 2, 0, 1, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live HOST echo
    expect(mir.peekReconcile().wanted).toBe(false);
    stop();
  });

  it('resolves a registered waiter from a presetLoaded packet while still suppressing the self-echo reconcile', async () => {
    const { mock, session, mir } = await v10Setup();
    mir.beginPresetGuard();
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 4, 0, 0, 0])); // PRESET_LOADED, slot 4
    const p = session.notifyWaiters.waitFor((e) => e.kind === 'presetLoaded' && e.slot === 4, 1000);
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live presetLoaded
    await expect(p).resolves.toMatchObject({ kind: 'presetLoaded', slot: 4 });
    expect(mir.peekReconcile().wanted).toBe(false);   // echo still suppressed: observe, don't consume
    mir.endPresetGuard(0);
    stop();
  });

  it('bursts the read cadence while a waiter is pending, reverts once resolved', async () => {
    const { mock, session } = await v10Setup();
    const m = delayClock();
    const stop = startNotifyChannel(session, m.clock);
    void session.notifyWaiters.waitFor((e) => e.kind === 'presetLoaded', 1000);
    await m.tick();                          // idle read; waiter pending → burst re-arm
    expect(m.delays.at(-1)).toBe(8);
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 0, 0, 0, 0]));
    await m.tick();                          // event delivered; waiter gone → default re-arm
    expect(m.delays.at(-1)).toBeUndefined();
    stop();
  });

  it('reconciles when a seq gap reveals a missed event', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    // A HOST echo at seq=1 (no trigger), then a HOST echo at seq=3 (gap → 2 missed); size=0
    const host = (seq: number) => new Uint8Array([2, 2, 0, seq, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]);
    mock.pushNotify(host(1));
    mock.pushNotify(host(3));
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();                       // idle: crosses the backlog boundary
    await m.tick();                       // seq 1, no gap, no trigger
    expect(mir.peekReconcile().wanted).toBe(false);
    await m.tick();                       // seq 3, gap → reconcile
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });

  it('stops re-arming after stop()', async () => {
    const { session } = await v10Setup();
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();
    stop();
    expect(m.armed()).toBe(false);
  });

  it('reconciles on a seq wraparound gap (255 → 1, missed 0)', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    // size=0 so the frame parses as a valid paramChanged (HOST echo, no value)
    const host = (seq: number) => new Uint8Array([2, 2, 0, seq, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]);
    mock.pushNotify(host(255));
    mock.pushNotify(host(1));   // 255→0→1; seq 0 was missed
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();                       // idle: crosses the backlog boundary
    await m.tick();                       // seq 255, first live event, no gap check
    expect(mir.peekReconcile().wanted).toBe(false);
    await m.tick();                       // seq 1, gap (expected 0) → reconcile
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });

  it('suppresses a self-sourced bulkInvalidated echo while a preset-op guard is held', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));   // bulkInvalidated, src=preset
    const m = manualClock();
    mir.beginPresetGuard();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live self-echo
    expect(mir.peekReconcile().wanted).toBe(false);   // self-echo suppressed
    mir.endPresetGuard(0);
    stop();
  });

  it('suppresses a presetLoaded echo while a preset-op guard is held', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 1]));   // PRESET_LOADED, slot 1
    const m = manualClock();
    mir.beginPresetGuard();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live self-echo
    expect(mir.peekReconcile().wanted).toBe(false);
    mir.endPresetGuard(0);
    stop();
  });

  it('applies a non-HOST PARAM_CHANGED locally even under a preset guard (guard never suppresses it)', async () => {
    // The preset guard suppresses only bulk/preset self-echoes; a GPIO paramChanged
    // is applied precisely regardless of the guard (Layer 2). Seeded mirror → apply
    // succeeds in place, no full reconcile.
    resetWireMirror();
    const { mock, session, mir } = await v10Setup();
    mir.init(await session.device.getSnapshot());
    expect(mir.current?.bypass).toBe(false);
    primeLive(mock);
    mock.pushNotify(paramChangedFrame(20, [1], 5));   // GPIO(5), bypass byte at offset 20
    const m = manualClock();
    mir.beginPresetGuard();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live paramChanged
    expect(mir.current?.bypass).toBe(true);   // applied despite the guard
    expect(mir.peekReconcile().wanted).toBe(false);  // not a full reconcile
    mir.endPresetGuard(0);
    stop();
  });

  it('falls back to a reconcile when the apply declines (out-of-range offset)', async () => {
    resetWireMirror();
    const { mock, session, mir } = await v10Setup();
    mir.init(await session.device.getSnapshot());
    primeLive(mock);
    mock.pushNotify(paramChangedFrame(60000, [1], 5));  // offset out of range → apply returns false
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live paramChanged
    expect(mir.peekReconcile().wanted).toBe(true);     // backstop reconcile
    stop();
  });

  it('still reconciles a non-self bulkInvalidated (gpio source) under the guard', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 5, 0, 0, 0]));   // bulkInvalidated, src=GPIO(5)
    const m = manualClock();
    mir.beginPresetGuard();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live bulkInvalidated
    expect(mir.peekReconcile().wanted).toBe(true);
    mir.endPresetGuard(0);
    stop();
  });

  it('still reconciles on a seq gap even under the guard', async () => {
    const { mock, session, mir } = await v10Setup();
    primeLive(mock);
    // Two self-sourced echoes whose triggers are suppressed, but seq 1→3 is a gap.
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));   // bulkInvalidated src=preset seq=1
    mock.pushNotify(new Uint8Array([2, 3, 0, 3, 3, 0, 0, 0]));   // ...src=preset seq=3 (missed 2)
    const m = manualClock();
    mir.beginPresetGuard();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();
    expect(mir.peekReconcile().wanted).toBe(false);   // seq 1: echo suppressed, no gap yet
    await m.tick();
    expect(mir.peekReconcile().wanted).toBe(true);     // seq 3: gap ⇒ reconcile despite guard
    mir.endPresetGuard(0);
    stop();
  });

  it('resumes reconciling once the preset-op guard has released', async () => {
    const { mock, session, mir } = await v10Setup();
    mir.beginPresetGuard();
    mir.endPresetGuard(0);   // released with no trailing grace
    primeLive(mock);
    mock.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // idle: crosses the backlog boundary
    await m.tick();   // live bulkInvalidated
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });

  it('backs off on repeated read errors, then resets the cadence on a healthy read', async () => {
    let fail = true;
    const dev = fakeNotifyingDevice(async () => {
      if (fail) throw new Error('stall');
      return new Uint8Array([0]);  // idle
    });
    const session = connect(dev);
    const m = delayClock();
    const stop = startNotifyChannel(session, m.clock);
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
    const session = connect(dev);
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    expect(m.armed()).toBe(true);   // armed initially
    await m.tick();                 // reads null → stops, no re-arm
    expect(m.armed()).toBe(false);
    stop();
  });
});

// A device with no host connected accumulates notify events in its ring
// (firmware always-armed pattern: an entry is popped only once a transfer is
// ARMED). Connecting replays that backlog; these pin that it's read and
// dropped silently rather than replayed as live toasts/reconciles.
describe('startNotifyChannel backlog drain', () => {
  it('drops backlog presetLoaded events before the first idle: no toast, no reconcile', async () => {
    const { mock, session, mir } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 3, 0, 0, 0]));   // PRESET_LOADED, slot 3 (backlog)
    mock.pushNotify(new Uint8Array([2, 4, 0, 2, 5, 0, 0, 0]));   // PRESET_LOADED, slot 5 (backlog)
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // backlog event 1: dropped
    await m.tick();   // backlog event 2: dropped
    expect(notices.list.length).toBe(0);
    expect(mir.peekReconcile().wanted).toBe(false);
    stop();
  });

  it('schedules backlog reads immediately (delay 0), not the default cadence', async () => {
    const { mock, session } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 4, 0, 1, 3, 0, 0, 0]));   // backlog event
    const m = delayClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // backlog event: dropped, re-armed for an immediate re-read
    expect(m.delays.at(-1)).toBe(0);
    stop();
  });

  it('primes seq continuity so a contiguous first live event does not trigger a gap reconcile', async () => {
    const { mock, session, mir } = await v10Setup();
    // Backlog: HOST paramChanged echo at seq=5 (dropped, but its seq is recorded).
    mock.pushNotify(new Uint8Array([2, 2, 0, 5, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]));
    mock.pushNotify(new Uint8Array([0]));   // idle: crosses the backlog boundary
    // Live: contiguous with the backlog's seq=5 -- must NOT read as a gap.
    mock.pushNotify(new Uint8Array([2, 2, 0, 6, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]));
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // backlog seq=5: dropped, lastSeq primed to 5
    await m.tick();   // idle boundary
    await m.tick();   // live seq=6: contiguous with the primed 5
    expect(mir.peekReconcile().wanted).toBe(false);
    stop();
  });

  it('primes seq continuity so the very first live event still detects a gap against the backlog baseline', async () => {
    // Same setup as above, but the live event skips a seq (5 -> 7, missing 6).
    // This only reads as a gap if the backlog's seq=5 was actually recorded as
    // lastSeq -- if priming were a no-op, this would be treated as the first
    // event ever seen and skip the gap check entirely.
    const { mock, session, mir } = await v10Setup();
    mock.pushNotify(new Uint8Array([2, 2, 0, 5, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]));   // backlog seq=5
    mock.pushNotify(new Uint8Array([0]));   // idle: crosses the backlog boundary
    mock.pushNotify(new Uint8Array([2, 2, 0, 7, 0x80, 0x0b, 0, 0, 1, 0, 0, 0]));   // live seq=7: skipped 6
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    await m.tick();   // backlog seq=5: dropped, lastSeq primed to 5
    await m.tick();   // idle boundary
    await m.tick();   // live seq=7: gap against the primed baseline
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });

  it('caps the backlog drain at 64 events and goes live anyway without ever seeing an idle', async () => {
    const { mock, session, mir } = await v10Setup();
    for (let i = 1; i <= 65; i++) {
      mock.pushNotify(new Uint8Array([2, 4, 0, i & 0xff, 9, 0, 0, 0]));   // PRESET_LOADED, slot 9; no idle ever queued
    }
    const m = manualClock();
    const stop = startNotifyChannel(session, m.clock);
    for (let i = 0; i < 64; i++) await m.tick();   // drain the cap: all 64 dropped
    expect(notices.list.length).toBe(0);
    expect(mir.peekReconcile().wanted).toBe(false);
    await m.tick();   // 65th read: cap exceeded on the previous read -> this one is live
    expect(notices.list.some((n) => n.kind === 'info')).toBe(true);
    expect(mir.peekReconcile().wanted).toBe(true);
    stop();
  });
});

// v2 PARAM_CHANGED frame: [2, 0x02, flags, seq, off_lo, off_hi, size_lo, size_hi, source, r,r,r, ...value]
function paramChangedFrame(offset: number, value: number[], source = 5, seq = 1): Uint8Array {
  return new Uint8Array([2, 0x02, 0, seq, offset & 0xff, (offset >> 8) & 0xff, value.length & 0xff, (value.length >> 8) & 0xff, source, 0, 0, 0, ...value]);
}
