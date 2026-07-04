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
    expect(s.copySource.held).toBeNull();
    expect(s.telemetry.errorCount).toBe(0);
    expect(s.presets.directory).toBeNull();
    expect(s.presets.busy).toBe(false);
    expect(s.mirror.current).toBeNull();
    expect(s.writes.busy).toBe(false);
  });
});

import { connection, dispatch, activeSession } from './appState.svelte';

describe('dispatch()', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); });

  it('requested → app connecting', () => {
    dispatch({ t: 'requested' });
    expect(connection.phase).toBe('connecting');
  });

  it('synced → app ready, connection connected', () => {
    dispatch({ t: 'synced', session: fakeSession });
    expect(connection.connected).toBe(true);
    expect(connection.error).toBeNull();
    expect(connection.errorKind).toBeNull();
  });

  it('failed → app errored with error fields', () => {
    dispatch({ t: 'failed', message: 'old fw', errorKind: 'unsupported-firmware' });
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('old fw');
    expect(connection.errorKind).toBe('unsupported-firmware');
  });

  it('disconnected → app noDevice', () => {
    dispatch({ t: 'disconnected' });
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
