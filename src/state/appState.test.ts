import { describe, it, expect, beforeEach } from 'vitest';
import { transition, type AppState, type ReadySession } from './appState.svelte';
import { makeReadySession } from './makeSession.svelte';

const fakeSession: ReadySession = makeReadySession({ info: {}, hardware: {} } as never);

describe('transition()', () => {
  const noDevice: AppState = { kind: 'noDevice' };

  it('requested → connecting', () => {
    expect(transition(noDevice, { t: 'requested' })).toEqual({ kind: 'connecting' });
  });

  it('synced → ready carrying the session', () => {
    expect(transition({ kind: 'connecting' }, { t: 'synced', session: fakeSession }))
      .toEqual({ kind: 'ready', session: fakeSession });
  });

  it('failed → errored with message and default null errorKind', () => {
    expect(transition(noDevice, { t: 'failed', message: 'boom' }))
      .toEqual({ kind: 'errored', message: 'boom', errorKind: null });
  });

  it('failed → errored preserves an explicit errorKind', () => {
    expect(transition(noDevice, { t: 'failed', message: 'old fw', errorKind: 'unsupported-firmware' }))
      .toEqual({ kind: 'errored', message: 'old fw', errorKind: 'unsupported-firmware' });
  });

  it('disconnected → noDevice', () => {
    expect(transition({ kind: 'ready', session: fakeSession }, { t: 'disconnected' }))
      .toEqual({ kind: 'noDevice' });
  });
});

describe('makeReadySession()', () => {
  it('wraps the device, info and hardware; starts with no copy source, fresh telemetry, empty presets', () => {
    const device = { info: { serial: 'X1' }, hardware: { name: 'rp2350' } } as never;
    const s = makeReadySession(device);
    expect(s.device).toBe(device);
    expect(s.info).toEqual({ serial: 'X1' });
    expect(s.hardware).toEqual({ name: 'rp2350' });
    expect(s.copySource.slot).toBeNull();
    expect(s.telemetry.errorCount).toBe(0);
    expect(s.presets.directory).toBeNull();
    expect(s.presets.busy).toBe(false);
    expect(s.mirror.current).toBeNull();
    expect(s.mirror.inflight).toBe(0);
  });
});

import { app, connection, dispatch, activeSession } from './appState.svelte';

describe('dispatch()', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); });

  it('requested → app connecting', () => {
    dispatch({ t: 'requested' });
    expect(app.current.kind).toBe('connecting');
    expect(connection.phase).toBe('connecting');
  });

  it('synced → app ready, connection connected', () => {
    dispatch({ t: 'synced', session: fakeSession });
    expect(app.current).toEqual({ kind: 'ready', session: fakeSession });
    expect(connection.connected).toBe(true);
    expect(connection.error).toBeNull();
    expect(connection.errorKind).toBeNull();
  });

  it('failed → app errored with error fields', () => {
    dispatch({ t: 'failed', message: 'old fw', errorKind: 'unsupported-firmware' });
    expect(app.current.kind).toBe('errored');
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('old fw');
    expect(connection.errorKind).toBe('unsupported-firmware');
  });

  it('disconnected → app noDevice', () => {
    dispatch({ t: 'disconnected' });
    expect(app.current.kind).toBe('noDevice');
    expect(connection.phase).toBe('noDevice');
  });
});

describe('activeSession()', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); });

  it('returns null when not ready', () => {
    expect(activeSession()).toBeNull();
  });

  it('returns the session when ready', () => {
    dispatch({ t: 'synced', session: fakeSession });
    expect(activeSession()).toBe(fakeSession);
  });
});

import { newAttempt, clearAttempt, currentAttempt } from './appState.svelte';

describe('attempt tokens', () => {
  it('newAttempt mints monotonically increasing tokens and makes them current', () => {
    const a = newAttempt();
    const b = newAttempt();
    expect(b).toBeGreaterThan(a);
    expect(currentAttempt()).toBe(b);
  });

  it('clearAttempt leaves no current attempt', () => {
    newAttempt();
    clearAttempt();
    expect(currentAttempt()).toBeNull();
  });

  it('dispatch drops an event carrying a stale attempt', () => {
    const stale = newAttempt();
    newAttempt();
    dispatch({ t: 'disconnected' });                       // unscoped: passes, → noDevice
    dispatch({ t: 'failed', message: 'late', attempt: stale });
    expect(app.current.kind).toBe('noDevice');             // stale failed dropped
  });

  it('dispatch drops a scoped event after clearAttempt', () => {
    const a = newAttempt();
    dispatch({ t: 'disconnected' });
    clearAttempt();
    dispatch({ t: 'failed', message: 'late', attempt: a });
    expect(app.current.kind).toBe('noDevice');
  });

  it('dispatch accepts an event carrying the current attempt', () => {
    const a = newAttempt();
    dispatch({ t: 'failed', message: 'now', attempt: a });
    expect(app.current.kind).toBe('errored');
  });

  it('dispatch accepts unscoped events regardless of current attempt', () => {
    newAttempt();
    dispatch({ t: 'failed', message: 'forced' });
    expect(app.current.kind).toBe('errored');
  });
});
