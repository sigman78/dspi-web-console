import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { wireUpConnection } from './deviceService';
import { beginConnection, endConnection } from './connectionScope';
import { connection, dispatch, activeSession } from '@/state';

// Exercises the controller-guarded invariant that replaced the old
// attempt-token dispatch filter: a connection superseded mid-flight (its
// controller aborted by a newer beginConnection()) must not have its
// eventual settle -- success or failure -- change app state.

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function stubDevice(getSnapshot: () => Promise<unknown>): DspDevice {
  return { info: { serial: 'STALE' }, hardware: {}, getSnapshot } as unknown as DspDevice;
}

beforeEach(() => { dispatch({ t: 'disconnected' }); });
afterEach(() => { endConnection(); dispatch({ t: 'disconnected' }); });

describe('wireUpConnection — superseded-attempt guards', () => {
  it('a stale connect that finishes snapshotting after a newer attempt began never dispatches synced', async () => {
    const snap = deferred<unknown>();
    const stale = beginConnection();
    const pending = wireUpConnection(stubDevice(() => snap.promise), stale);

    expect(connection.phase).toBe('connecting');   // stale's own `requested` landed
    beginConnection();                             // a newer attempt supersedes it
    expect(stale.signal.aborted).toBe(true);

    snap.resolve({});                              // stale attempt's fetch finally settles
    await pending;

    expect(connection.phase).toBe('connecting');   // unchanged by the stale settle
    expect(activeSession()).toBeNull();             // no session was ever installed
  });

  it('a stale connect whose snapshot fetch fails after being superseded does not dispatch failed', async () => {
    const snap = deferred<unknown>();
    const stale = beginConnection();
    const pending = wireUpConnection(stubDevice(() => snap.promise), stale);

    beginConnection();                             // a newer attempt supersedes it
    snap.reject(new Error('late failure'));

    await expect(pending).rejects.toThrow('late failure');
    expect(connection.phase).toBe('connecting');   // the late failure never landed
  });

  it('a non-superseded connect still dispatches failed on snapshot error', async () => {
    const controller = beginConnection();
    const pending = wireUpConnection(stubDevice(() => Promise.reject(new Error('boom'))), controller);

    await expect(pending).rejects.toThrow('boom');
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('boom');
  });
});
