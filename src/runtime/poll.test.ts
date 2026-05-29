import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformType, createHardwareProfile } from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, resetStatus, mirror, presetBaseline, settings } from '@/state';
import {
  requestReconcile, consumeReconcile,
  inflight, bumpInflight, dropInflight,
} from '@/state/mirror.svelte';
import { write } from '@/device/writes';
import { startPolling, type PollClock } from './poll';

const hw = createHardwareProfile(PlatformType.RP2350);

// A clock we drive by hand — no real timers, fully deterministic.
function manualClock(): PollClock & { fire(): void; armed(): boolean } {
  let cb: (() => void) | null = null;
  return {
    next(c) { cb = c; },
    cancel() { cb = null; },
    fire() { const c = cb; cb = null; c?.(); },
    armed() { return cb !== null; },
  };
}

function pollDevice(status = { peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 }) {
  const calls = { status: 0, buffer: 0, info: 0 };
  const device = {
    info: { serial: 'T', firmwareVersion: '6.0.0', platformType: PlatformType.RP2350, hardware: hw },
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
    info: { serial: 'T', firmwareVersion: '6.0.0', platformType: PlatformType.RP2350, hardware: hw },
    hardware: hw,
    getSystemStatus: vi.fn(async () => { calls.status++; return { peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 }; }),
    getBufferStats: vi.fn(async () => null),
    getSystemInfo: vi.fn(async () => ({})),
    getSnapshot: vi.fn(async () => { calls.snapshot++; return snap; }),
  } as unknown as DspDevice;
  return { device, calls, snap };
}

// Settle the fire-and-forget doPoll chain (a few awaited device calls deep).
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('startPolling', () => {
  beforeEach(() => { resetStatus(); mirror.replaceCurrent(fromBulkParams(hw, parseBulkParams(makeBulk()))); });
  afterEach(() => { bindDevice(null); });

  it('polls the status cadence when the clock fires, and stops after dispose', async () => {
    const { device, calls } = pollDevice();
    bindDevice(device);
    const clock = manualClock();
    const stop = startPolling(clock);
    clock.fire();                       // tick → doPoll
    await Promise.resolve(); await Promise.resolve();
    expect(calls.status).toBe(1);
    expect(clock.armed()).toBe(true);   // re-armed for the next tick
    stop();
    expect(clock.armed()).toBe(false);  // dispose cancelled the clock
  });

  it('does not poll while the document is hidden', async () => {
    const { device, calls } = pollDevice();
    bindDevice(device);
    const clock = manualClock();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const stop = startPolling(clock);
    expect(clock.armed()).toBe(false);  // hidden ⇒ loop did not arm
    clock.fire();
    await Promise.resolve();
    expect(calls.status).toBe(0);
    stop();
    hiddenSpy.mockRestore();
  });
});

describe('param reconcile cadence', () => {
  beforeEach(() => {
    resetStatus();
    consumeReconcile();                      // clear any pending request
    while (inflight.current > 0) dropInflight();
    mirror.replaceCurrent(fromBulkParams(hw, parseBulkParams(makeBulk())));
  });
  afterEach(() => { bindDevice(null); consumeReconcile(); while (inflight.current > 0) dropInflight(); });

  it('reconciles via getSnapshot when a reconcile is pending and idle', async () => {
    const { device, calls } = paramDevice();
    bindDevice(device);
    const clock = manualClock();
    const stop = startPolling(clock);
    requestReconcile(false);
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);
    stop();
  });

  it('does not reconcile when nothing is pending', async () => {
    const { device, calls } = paramDevice();
    bindDevice(device);
    const clock = manualClock();
    const stop = startPolling(clock);
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(0);
    stop();
  });

  it('does not reconcile while a write is in flight (no mid-drag clobber)', async () => {
    const { device, calls } = paramDevice();
    bindDevice(device);
    const clock = manualClock();
    const stop = startPolling(clock);
    requestReconcile(false);
    bumpInflight();                          // simulate an in-flight write
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(0);
    dropInflight();
    stop();
  });

  it('applies via replaceCurrent — baseline stays pinned', async () => {
    // Device reconciles to a distinct master volume so we can tell current
    // (advanced) from baseline (pinned). $state wraps cells in a proxy, so we
    // assert on a field value, not object identity.
    const reconciled = fromBulkParams(hw, parseBulkParams(makeBulk()));
    reconciled.masterVolumeDb = -33;
    const device = {
      info: { serial: 'T', firmwareVersion: '6.0.0', platformType: PlatformType.RP2350, hardware: hw },
      hardware: hw,
      getSystemStatus: vi.fn(async () => ({ peaks: [0, 0], clipFlags: 0, cpu0: 1, cpu1: 2 })),
      getBufferStats: vi.fn(async () => null),
      getSystemInfo: vi.fn(async () => ({})),
      getSnapshot: vi.fn(async () => reconciled),
    } as unknown as DspDevice;
    bindDevice(device);
    const initial = fromBulkParams(hw, parseBulkParams(makeBulk()));
    initial.masterVolumeDb = -5;
    mirror.init(initial);                               // current + baseline = -5
    const clock = manualClock();
    const stop = startPolling(clock);
    requestReconcile(false);
    clock.fire();
    await settle();
    expect(mirror.current!.masterVolumeDb).toBe(-33);   // current advanced
    expect(presetBaseline.current!.masterVolumeDb).toBe(-5); // baseline pinned
    stop();
  });

  it('non-eager waits for the interval; eager bypasses it', async () => {
    const { device, calls } = paramDevice();
    bindDevice(device);
    const clock = manualClock();
    const stop = startPolling(clock);

    requestReconcile(false);
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);          // first run, stamps lastParamMs

    requestReconcile(false);                 // non-eager, interval not elapsed
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);          // skipped by interval gate

    requestReconcile(true);                  // eager → bypass interval
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(2);          // ran despite interval
    stop();
  });

  it('end-to-end: an eager write() drives a poll reconcile', async () => {
    const { device, calls } = paramDevice();
    bindDevice(device);
    settings.eagerReconcile = true;
    const clock = manualClock();
    const stop = startPolling(clock);
    // A real click-paced write through the helper: it requests an eager
    // reconcile on success, which the next idle poll tick honors.
    await write(async () => {}, () => {});
    clock.fire();
    await settle();
    expect(calls.snapshot).toBe(1);
    settings.eagerReconcile = false;
    stop();
  });
});
