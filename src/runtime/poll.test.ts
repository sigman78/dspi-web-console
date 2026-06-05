import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlatformType, createHardwareProfile } from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';
import { settings, dispatch, makeReadySession, type ReadySession } from '@/state';
import { write } from './writes';
import { startPolling, RECONCILE_QUIET_MS } from './poll';
import type { LoopClock } from '@/utils';

const hw = createHardwareProfile(PlatformType.RP2350);

// A clock we drive by hand — no real timers, fully deterministic.
function manualClock(): LoopClock & { fire(): void; armed(): boolean } {
  let cb: (() => void) | null = null;
  return {
    next(c) { cb = c; },
    cancel() { cb = null; },
    fire() { const c = cb; cb = null; c?.(); },
    armed() { return cb !== null; },
  };
}

// Install a ready session so poll's activeSession()?.device read resolves AND
// the now session-scoped telemetry resolves to a fresh per-test StatusStore.
function connect(device: DspDevice): ReadySession {
  const session = makeReadySession(device);
  dispatch({ t: 'synced', session });
  return session;
}
function teardown(): void {
  dispatch({ t: 'disconnected' });
}

function pollDevice(status = { peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 }) {
  const calls = { status: 0, buffer: 0, info: 0 };
  const device = {
    info: { serial: 'T', platformType: PlatformType.RP2350, hardware: hw },
    hardware: hw,
    getSystemStatus: vi.fn(async () => { calls.status++; return status; }),
    getBufferStats: vi.fn(async () => { calls.buffer++; return null; }),
    getSystemInfo: vi.fn(async () => { calls.info++; return {}; }),
  } as unknown as DspDevice;
  return { device, calls };
}

// Fake device that also serves getSnapshot for the param reconcile cadence.
function paramDevice() {
  const calls = { status: 0, snapshot: 0 };
  const snap = fromBulkParams(hw, parseBulkParams(makeBulk()));
  const device = {
    info: { serial: 'T', platformType: PlatformType.RP2350, hardware: hw },
    hardware: hw,
    getSystemStatus: vi.fn(async () => { calls.status++; return { peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 }; }),
    getBufferStats: vi.fn(async () => null),
    getSystemInfo: vi.fn(async () => ({})),
    getSnapshot: vi.fn(async () => { calls.snapshot++; return snap; }),
  } as unknown as DspDevice;
  return { device, calls, snap };
}

// Settle the fire-and-forget doPoll chain (a few awaited device calls deep).
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// Fake device with a caller-supplied getSnapshot, for reconcile timing tests.
function deviceWithSnapshot(getSnapshot: () => Promise<unknown>) {
  return {
    info: { serial: 'T', platformType: PlatformType.RP2350, hardware: hw },
    hardware: hw,
    getSystemStatus: vi.fn(async () => ({ peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 })),
    getBufferStats: vi.fn(async () => null),
    getSystemInfo: vi.fn(async () => ({})),
    getSnapshot: vi.fn(getSnapshot),
  } as unknown as DspDevice;
}

describe('startPolling', () => {
  afterEach(() => { teardown(); });

  it('polls the status cadence when the clock fires, and stops after dispose', async () => {
    const { device, calls } = pollDevice();
    const session = connect(device);
    const clock = manualClock();
    const stop = startPolling(session, clock);
    clock.fire();                       // tick → doPoll
    await Promise.resolve(); await Promise.resolve();
    expect(calls.status).toBe(1);
    expect(clock.armed()).toBe(true);   // re-armed for the next tick
    stop();
    expect(clock.armed()).toBe(false);  // dispose cancelled the clock
  });

  it('polls the captured session device, not whichever session is active', async () => {
    const a = pollDevice();
    const sessionA = connect(a.device);
    const clock = manualClock();
    const stop = startPolling(sessionA, clock);
    // A second session becomes active mid-life of A's loop (reconnect / switch).
    const b = pollDevice();
    connect(b.device);
    clock.fire();
    await Promise.resolve(); await Promise.resolve();
    expect(a.calls.status).toBe(1);   // loop stays bound to its captured session
    expect(b.calls.status).toBe(0);   // not the newly-active session's device
    stop();
  });

  it('does not poll while the document is hidden', async () => {
    const { device, calls } = pollDevice();
    const session = connect(device);
    const clock = manualClock();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const stop = startPolling(session, clock);
    expect(clock.armed()).toBe(false);  // hidden ⇒ loop did not arm
    clock.fire();
    await Promise.resolve();
    expect(calls.status).toBe(0);
    stop();
    hiddenSpy.mockRestore();
  });
});

describe('param reconcile cadence', () => {
  afterEach(() => { teardown(); });

  it('reconciles via getSnapshot when a reconcile is pending and idle', async () => {
    const { device, calls } = paramDevice();
    const session = connect(device);
    const mir = session.mirror;
    const clock = manualClock();
    const stop = startPolling(session, clock);
    mir.requestReconcile(false);
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);
    stop();
  });

  it('does not reconcile when nothing is pending', async () => {
    const { device, calls } = paramDevice();
    const session = connect(device);
    const clock = manualClock();
    const stop = startPolling(session, clock);
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(0);
    stop();
  });

  it('does not reconcile while a write is in flight (no mid-drag clobber)', async () => {
    const { device, calls } = paramDevice();
    const session = connect(device);
    const mir = session.mirror;
    const clock = manualClock();
    const stop = startPolling(session, clock);
    mir.requestReconcile(false);
    mir.bumpInflight();                      // simulate an in-flight write
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(0);
    mir.dropInflight();
    stop();
  });

  it('applies via replaceCurrent — baseline stays pinned', async () => {
    // Device reconciles to a distinct master volume so we can tell current
    // (advanced) from baseline (pinned). $state wraps cells in a proxy, so we
    // assert on a field value, not object identity.
    const reconciled = fromBulkParams(hw, parseBulkParams(makeBulk()));
    reconciled.masterVolumeDb = -33;
    const device = {
      info: { serial: 'T', platformType: PlatformType.RP2350, hardware: hw },
      hardware: hw,
      getSystemStatus: vi.fn(async () => ({ peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 })),
      getBufferStats: vi.fn(async () => null),
      getSystemInfo: vi.fn(async () => ({})),
      getSnapshot: vi.fn(async () => reconciled),
    } as unknown as DspDevice;
    const session = connect(device);
    const mir = session.mirror;
    const initial = fromBulkParams(hw, parseBulkParams(makeBulk()));
    initial.masterVolumeDb = -5;
    mir.init(initial);                                  // current + baseline = -5
    const clock = manualClock();
    const stop = startPolling(session, clock);
    mir.requestReconcile(false);
    clock.fire();
    await settle();
    expect(mir.current!.masterVolumeDb).toBe(-33);      // current advanced
    expect(mir.baseline!.masterVolumeDb).toBe(-5);      // baseline pinned
    stop();
  });

  it('non-eager waits for the interval; eager bypasses it', async () => {
    const { device, calls } = paramDevice();
    const session = connect(device);
    const mir = session.mirror;
    const clock = manualClock();
    const stop = startPolling(session, clock);

    mir.requestReconcile(false);
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);          // first run, stamps lastParamMs

    mir.requestReconcile(false);             // non-eager, interval not elapsed
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);          // skipped by interval gate

    mir.requestReconcile(true);              // eager → bypass interval
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(2);          // ran despite interval
    stop();
  });

  it('end-to-end: an eager write() drives a poll reconcile once writes go quiet', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const { device, calls } = paramDevice();
      const session = connect(device);
      settings.eagerReconcile = true;
      const clock = manualClock();
      const stop = startPolling(session, clock);
      vi.advanceTimersByTime(RECONCILE_QUIET_MS + 1);   // clear of t=0 floor
      await write(session, async () => {}, () => {});    // stamps lastWriteMs = now
      clock.fire();
      await settle();
      expect(calls.snapshot).toBe(0);                    // write too recent: blocked
      vi.advanceTimersByTime(RECONCILE_QUIET_MS + 1);    // writes go quiet
      clock.fire();
      await settle();
      expect(calls.snapshot).toBe(1);                    // eager + quiet → reconciles
      settings.eagerReconcile = false;
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reconcile while writes are recent; reconciles once quiet (#1)', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const { device, calls } = paramDevice();
      const session = connect(device);
      const mir = session.mirror;
      const clock = manualClock();
      const stop = startPolling(session, clock);
      vi.advanceTimersByTime(RECONCILE_QUIET_MS + 1);
      mir.noteWriteActivity();              // a write/scrub just happened
      mir.requestReconcile(false);
      clock.fire();
      await settle();
      expect(calls.snapshot).toBe(0);       // blocked: within quiet window
      vi.advanceTimersByTime(RECONCILE_QUIET_MS + 1);
      clock.fire();
      await settle();
      expect(calls.snapshot).toBe(1);       // quiet elapsed → reconciles
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('discards the snapshot if a write lands during the fetch — no mid-drag clobber (#1)', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      let resolveSnap!: () => void;
      const reconciled = fromBulkParams(hw, parseBulkParams(makeBulk()));
      reconciled.masterVolumeDb = -99;
      const device = deviceWithSnapshot(() => new Promise((r) => { resolveSnap = () => r(reconciled); }));
      const session = connect(device);
      const mir = session.mirror;
      const initial = fromBulkParams(hw, parseBulkParams(makeBulk()));
      initial.masterVolumeDb = -5;
      mir.init(initial);
      const clock = manualClock();
      const stop = startPolling(session, clock);
      vi.advanceTimersByTime(RECONCILE_QUIET_MS + 1);
      mir.requestReconcile(false);
      clock.fire();
      await settle();                       // pollParam parked on getSnapshot
      vi.advanceTimersByTime(1);
      mir.noteWriteActivity();              // a write lands mid-fetch
      resolveSnap();
      await settle();
      expect(mir.current!.masterVolumeDb).toBe(-5);   // discarded, not -99
      expect(mir.peekReconcile().wanted).toBe(true);      // request still pending
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the reconcile request pending when getSnapshot fails (#3)', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const device = deviceWithSnapshot(async () => { throw new Error('boom'); });
      const session = connect(device);
      const mir = session.mirror;
      const clock = manualClock();
      const stop = startPolling(session, clock);
      vi.advanceTimersByTime(RECONCILE_QUIET_MS + 1);
      mir.requestReconcile(false);
      clock.fire();
      await settle();
      expect(mir.peekReconcile().wanted).toBe(true);   // not consumed on failure
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startPolling — visibility resume', () => {
  it('requests an eager reconcile when the tab becomes visible', () => {
    const stub = makeReadySession({ info: {}, hardware: {} } as never);
    const mir = stub.mirror;
    const clock: LoopClock = { next: () => {}, cancel: () => {} };
    const stop = startPolling(stub, clock);
    // Simulate hide → show.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mir.peekReconcile()).toMatchObject({ wanted: true, eager: true });
    stop();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
