import { describe, it, expect } from 'vitest';
import { transition, makeReadySession, type AppState, type ReadySession } from './appState.svelte';

const fakeSession: ReadySession = {
  device: {} as never,
  info: {} as never,
  hardware: {} as never,
};

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
  it('wraps the device, info and hardware', () => {
    const device = { info: { serial: 'X1' }, hardware: { name: 'rp2350' } } as never;
    const s = makeReadySession(device);
    expect(s.device).toBe(device);
    expect(s.info).toEqual({ serial: 'X1' });
    expect(s.hardware).toEqual({ name: 'rp2350' });
  });
});
