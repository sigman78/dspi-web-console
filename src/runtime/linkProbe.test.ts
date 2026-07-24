import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startLinkProbe } from './linkProbe';
import { ConnectionScope } from './connectionScope';
import {
  dispatch, mintConnId, makeReadySession, connection, resetAppState, notices, clearNotices,
  type ConnId, type ReadySession,
} from '@/state';
import type { LoopClock } from '@/utils';

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

// Wires the session to its own connection scope, matching production
// (wireUpConnection passes the same scope into makeReadySession) -- killing
// the session only tears it down via that shared scope.
function installSession(device: unknown, opts?: { activate?: false }): { id: ConnId; s: ReadySession } {
  const id = mintConnId();
  const scope = new ConnectionScope();
  const s = makeReadySession(device as never, scope);
  dispatch({ t: 'synced', id, session: s, activate: opts?.activate });
  return { id, s };
}

describe('startLinkProbe', () => {
  beforeEach(() => {
    resetAppState();
    clearNotices();
    vi.clearAllMocks();
  });

  it('does nothing while healthy', async () => {
    const getBypass = vi.fn(async () => false);
    const { id, s } = installSession({ getBypass, close: vi.fn(), info: {}, hardware: {} });
    const clock = manualClock();
    const stop = startLinkProbe(s, id, clock);
    clock.step();
    await Promise.resolve();
    expect(getBypass).not.toHaveBeenCalled();
    stop();
  });

  it('probes while degraded, clears on success, and requests an eager reconcile', async () => {
    const getBypass = vi.fn(async () => false);
    const { id, s } = installSession({ getBypass, close: vi.fn(), info: {}, hardware: {} });
    s.health.degraded = true;
    s.mirror.consumeReconcile();
    const clock = manualClock();
    const stop = startLinkProbe(s, id, clock);
    clock.step();
    // Wait on the actual end state, not the mock call count: the count updates
    // synchronously at send time, well before the queued op settles and
    // noteRecovered() runs.
    await vi.waitFor(() => expect(s.health.degraded).toBe(false));
    expect(getBypass).toHaveBeenCalledTimes(1);
    // Recovery repaints via the param cadence's eager path, not an ad-hoc fetch.
    expect(s.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    stop();
  });

  it('kills the session after persistent probe failure', async () => {
    const getBypass = vi.fn(async () => { throw new Error('dead'); });
    const close = vi.fn(async () => {});
    const { id, s } = installSession({ getBypass, close, info: {}, hardware: {} });
    s.health.degraded = true;
    const clock = manualClock();
    const stop = startLinkProbe(s, id, clock);
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
    // No survivor was left active, so this is today's plain errored-hero path
    // -- no extra notice on top of it.
    expect(notices.list.length).toBe(0);
    stop();
  });

  it('invokes onKilled once the teardown (removed + dispose + failed) has fully landed', async () => {
    const getBypass = vi.fn(async () => { throw new Error('dead'); });
    const close = vi.fn(async () => {});
    const { id, s } = installSession({ getBypass, close, info: {}, hardware: {} });
    s.health.degraded = true;
    const clock = manualClock();
    const onKilled = vi.fn();
    const stop = startLinkProbe(s, id, clock, { onKilled });
    for (let i = 0; i < 4; i++) {
      clock.step();
      await vi.waitFor(() => expect(clock.armed()).toBe(true));
    }
    clock.step();
    await vi.waitFor(() => expect(onKilled).toHaveBeenCalledTimes(1));
    expect(connection.phase).toBe('errored');   // teardown had already landed
    stop();
  });

  it('surfaces the death as an error notice (not the hero) when another session stays active', async () => {
    installSession({ getBypass: vi.fn(async () => false), close: vi.fn(), info: { serial: 'SURVIVOR' }, hardware: {} });
    const getBypass = vi.fn(async () => { throw new Error('dead'); });
    const close = vi.fn(async () => {});
    const { id, s } = installSession(
      { getBypass, close, info: { serial: 'DYING' }, hardware: {} },
      { activate: false },
    );
    s.health.degraded = true;
    const clock = manualClock();
    const stop = startLinkProbe(s, id, clock);
    for (let i = 0; i < 4; i++) {
      clock.step();
      await vi.waitFor(() => expect(clock.armed()).toBe(true));
    }
    clock.step();
    await vi.waitFor(() => expect(close).toHaveBeenCalled());

    expect(connection.phase).toBe('ready');   // the survivor's UI, not the error hero
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0]).toMatchObject({ kind: 'error' });
    expect(notices.list[0].message).toContain('DYING');
    stop();
  });
});
