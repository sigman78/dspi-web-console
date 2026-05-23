import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformType, createHardwareProfile } from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, resetStatus, applyDraftSnapshot } from '@/state';
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

describe('startPolling', () => {
  beforeEach(() => { resetStatus(); applyDraftSnapshot(fromBulkParams(hw, parseBulkParams(makeBulk()))); });
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
