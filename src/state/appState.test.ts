import { describe, it, expect, beforeEach } from 'vitest';
import { transition, makeReadySession, type AppState, type ReadySession } from './appState.svelte';

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
  it('wraps the device, info and hardware; starts with no copy source', () => {
    const device = { info: { serial: 'X1' }, hardware: { name: 'rp2350' } } as never;
    const s = makeReadySession(device);
    expect(s.device).toBe(device);
    expect(s.info).toEqual({ serial: 'X1' });
    expect(s.hardware).toEqual({ name: 'rp2350' });
    expect(s.copySource.slot).toBeNull();
  });
});

import { app, dispatch, activeSession } from './appState.svelte';
import { session, setStatus } from './session.svelte';

describe('dispatch()', () => {
  // Reset both cells to a known start: dispatch clears _app to noDevice, then
  // setStatus('idle') resets the legacy projection (matches mirror.reset() hygiene).
  beforeEach(() => { dispatch({ t: 'disconnected' }); setStatus('idle'); });

  it('requested → app connecting + projects session.status', () => {
    dispatch({ t: 'requested' });
    expect(app.current.kind).toBe('connecting');
    expect(session.status).toBe('connecting');
  });

  it('synced → app ready + projects connected, clears error', () => {
    dispatch({ t: 'synced', session: fakeSession });
    expect(app.current).toEqual({ kind: 'ready', session: fakeSession });
    expect(session.status).toBe('connected');
    expect(session.error).toBeNull();
    expect(session.errorKind).toBeNull();
  });

  it('failed → app errored + projects error fields', () => {
    dispatch({ t: 'failed', message: 'old fw', errorKind: 'unsupported-firmware' });
    expect(app.current.kind).toBe('errored');
    expect(session.status).toBe('error');
    expect(session.error).toBe('old fw');
    expect(session.errorKind).toBe('unsupported-firmware');
  });

  it('disconnected → app noDevice + projects disconnected', () => {
    dispatch({ t: 'disconnected' });
    expect(app.current.kind).toBe('noDevice');
    expect(session.status).toBe('disconnected');
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
