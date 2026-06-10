import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startLinkProbe } from './linkProbe';
import { dispatch, makeReadySession, connection, type ReadySession } from '@/state';
import type { LoopClock } from '@/utils';

vi.mock('@/runtime/resync', () => ({ forceResyncNow: vi.fn() }));

// Manual clock: collects the latest callback; step() fires it.
function manualClock(): LoopClock & { step(): void } {
  let cb: (() => void) | null = null;
  return {
    next(fn: () => void) { cb = fn; },
    cancel() { cb = null; },
    step() { const f = cb; cb = null; f?.(); },
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
    await vi.waitFor(() => expect(getBypass).toHaveBeenCalledTimes(1));
    expect(s.health.degraded).toBe(false);
    stop();
  });

  it('kills the session after persistent probe failure', async () => {
    const getBypass = vi.fn(async () => { throw new Error('dead'); });
    const close = vi.fn(async () => {});
    const s = installSession({ getBypass, close, info: {}, hardware: {} });
    s.health.degraded = true;
    const clock = manualClock();
    const stop = startLinkProbe(s, clock);
    for (let i = 0; i < 5; i++) {
      clock.step();
      await vi.waitFor(() => expect(getBypass).toHaveBeenCalledTimes(i + 1));
    }
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(connection.phase).toBe('errored');
    expect(s.alive).toBe(false);
    stop();
  });
});
