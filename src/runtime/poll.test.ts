import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformType, fromBulkParams, createHardwareProfile } from '@/domain';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, dsp, resetStatus } from '@/state';
import { startPolling, timerClock, type PollClock } from './poll';

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

describe('timerClock', () => {
  it('next arms exactly one pending tick — a double next does not leak a timer', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const c = timerClock(50);
      c.next(fn);
      c.next(fn);            // second arm must replace, not stack
      c.cancel();            // clears the single pending timer
      vi.advanceTimersByTime(200);
      expect(fn).not.toHaveBeenCalled();   // nothing leaked past cancel
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startPolling', () => {
  beforeEach(() => { resetStatus(); dsp.live = fromBulkParams(hw, parseBulkParams(makeBulk())); });
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

  it('dispose removes the visibilitychange listener', () => {
    const { device } = pollDevice();
    bindDevice(device);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const stop = startPolling(manualClock());
    stop();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    removeSpy.mockRestore();
  });
});
