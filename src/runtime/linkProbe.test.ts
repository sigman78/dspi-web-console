import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startLinkProbe } from './linkProbe';
import { dispatch, makeReadySession, connection, type ReadySession } from '@/state';
import type { LoopClock } from '@/utils';

vi.mock('@/runtime/resync', () => ({ forceResyncNow: vi.fn() }));

// Manual clock: collects the latest callback; step() fires it. armed() reports
// whether a callback is currently registered -- since startLinkProbe only
// re-arms AFTER its async probe body (including the queued getBypass send)
// fully settles, waiting on armed() (rather than a mock call count, which
// updates mid-flight, before the tick's async body finishes) is what actually
// serializes the test's steps with the loop's real completion.
function manualClock(): LoopClock & { step(): void; armed(): boolean } {
  let cb: (() => void) | null = null;
  return {
    next(fn: () => void) { cb = fn; },
    cancel() { cb = null; },
    step() { const f = cb; cb = null; f?.(); },
    armed() { return cb !== null; },
  };
}

function installSession(device: unknown): ReadySession {
  const s = makeReadySession(device as never);
  dispatch({ t: 'synced', session: s });
  return s;
}

describe('startLinkProbe', () => {
  beforeEach(() => {
    dispatch({ t: 'disconnected' });
    vi.clearAllMocks();
  });

  it('does nothing while healthy', async () => {
    const getBypass = vi.fn(async () => false);
    const s = installSession({ getBypass, close: vi.fn(), info: {}, hardware: {} });
    const clock = manualClock();
    const stop = startLinkProbe(s, clock);
    clock.step();
    await Promise.resolve();
    expect(getBypass).not.toHaveBeenCalled();
    stop();
  });

  it('probes while degraded and clears on success', async () => {
    const getBypass = vi.fn(async () => false);
    const s = installSession({ getBypass, close: vi.fn(), info: {}, hardware: {} });
    s.health.degraded = true;
    const clock = manualClock();
    const stop = startLinkProbe(s, clock);
    clock.step();
    // Wait on the actual end state, not the mock call count: the count updates
    // synchronously at send time, well before the queued op settles and
    // noteRecovered() runs.
    await vi.waitFor(() => expect(s.health.degraded).toBe(false));
    expect(getBypass).toHaveBeenCalledTimes(1);
    stop();
  });

  it('kills the session after persistent probe failure', async () => {
    const getBypass = vi.fn(async () => { throw new Error('dead'); });
    const close = vi.fn(async () => {});
    const s = installSession({ getBypass, close, info: {}, hardware: {} });
    s.health.degraded = true;
    const clock = manualClock();
    const stop = startLinkProbe(s, clock);
    // The first 4 failures re-arm the clock; wait for that (not the call
    // count) before stepping again, so each step lands after the previous
    // tick's async probe body has actually finished.
    for (let i = 0; i < 4; i++) {
      clock.step();
      await vi.waitFor(() => expect(clock.armed()).toBe(true));
    }
    // The 5th failure crosses PROBE_FAILS_TO_KILL and tears the session down
    // instead of re-arming.
    clock.step();
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(getBypass).toHaveBeenCalledTimes(5);
    expect(connection.phase).toBe('errored');
    expect(s.alive).toBe(false);
    stop();
  });
});
