import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { wireUpConnection, activateSession } from './deviceService';
import { bootMock } from './boot';
import { ConnectionScope } from './connectionScope';
import { write } from './writes.svelte';
import {
  connection, mintConnId, activeSession, activeRecord, recordOf, recordBySerial, sessionRecords,
  resetAppState, settings, notices, clearNotices,
} from '@/state';

// Exercises the scope-guarded invariant that replaced the old attempt-token
// dispatch filter: a connection superseded mid-flight (its scope aborted
// directly by whoever decided to abandon it) must not have its eventual
// settle -- success or failure -- change app state.

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function stubDevice(getSnapshot: () => Promise<unknown>): DspDevice {
  return { info: { serial: 'STALE' }, hardware: {}, getSnapshot } as unknown as DspDevice;
}

beforeEach(() => resetAppState());
afterEach(() => {
  // Dormant records need teardown too, not just the active one.
  for (const rec of sessionRecords().values()) rec.session.dispose();
  resetAppState();
});

describe('wireUpConnection — superseded-attempt guards', () => {
  it('a stale connect that finishes snapshotting after being superseded never dispatches synced', async () => {
    const snap = deferred<unknown>();
    const staleId = mintConnId();
    const stale = new ConnectionScope();
    const pending = wireUpConnection(stubDevice(() => snap.promise), stale, staleId);

    expect(connection.phase).toBe('connecting');   // stale's own `requested` landed
    stale.abort();                                 // this attempt is abandoned
    expect(stale.aborted).toBe(true);

    snap.resolve({});                              // stale attempt's fetch finally settles
    await pending;

    expect(connection.phase).toBe('connecting');   // unchanged by the stale settle
    expect(recordOf(staleId)).toBeNull();           // no session was ever installed
    expect(activeSession()).toBeNull();
  });

  it('a stale connect whose snapshot fetch fails after being superseded does not dispatch failed', async () => {
    const snap = deferred<unknown>();
    const staleId = mintConnId();
    const stale = new ConnectionScope();
    const pending = wireUpConnection(stubDevice(() => snap.promise), stale, staleId);

    stale.abort();                                 // this attempt is abandoned
    snap.reject(new Error('late failure'));

    await expect(pending).rejects.toThrow('late failure');
    expect(connection.phase).toBe('connecting');    // the late failure never landed
  });

  it('a non-superseded connect still dispatches failed on snapshot error', async () => {
    const id = mintConnId();
    const scope = new ConnectionScope();
    const pending = wireUpConnection(stubDevice(() => Promise.reject(new Error('boom'))), scope, id);

    await expect(pending).rejects.toThrow('boom');
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('boom');
  });
});

// Registry + activation semantics: adopting a session, going dormant, and the
// switch protocol. bootMock mints its own id/scope per call and drives the
// real wireUpConnection path, so these exercise the actual runtime, not just
// the reducer.
describe('registry: adoption, dormancy, and the switch protocol', () => {
  it('a second synced session adopts active and leaves the first dormant (loops stopped)', async () => {
    await bootMock('rp2350');
    const a = activeRecord()!;
    expect(a.loops).not.toBeNull();

    await bootMock('rp2350');
    const b = activeRecord()!;

    expect(b.id).not.toBe(a.id);
    expect(activeRecord()?.id).toBe(b.id);
    expect(a.loops).toBeNull();          // dormant: no traffic
    expect(b.loops).not.toBeNull();      // active: running
    expect(recordOf(a.id)).not.toBeNull();  // still registered, just dormant
  });

  it('removed on a dormant record leaves the active session untouched', async () => {
    await bootMock('rp2350');
    const a = activeRecord()!;
    await bootMock('rp2350');
    const b = activeRecord()!;
    expect(a.loops).toBeNull();

    await a.session.device.close();      // dormant device unplugged

    expect(recordOf(a.id)).toBeNull();
    expect(activeRecord()?.id).toBe(b.id);
    expect(b.loops).not.toBeNull();      // untouched
  });

  it('removed on the active record promotes the most recently adopted remaining record, starts its loops, and requests an eager reconcile', async () => {
    await bootMock('rp2350');
    const a = activeRecord()!;
    await bootMock('rp2350');
    const b = activeRecord()!;
    expect(a.loops).toBeNull();
    a.session.mirror.consumeReconcile();

    await b.session.device.close();      // active device unplugged

    expect(recordOf(b.id)).toBeNull();
    expect(activeRecord()?.id).toBe(a.id);       // promoted
    expect(a.loops).not.toBeNull();              // runtime disconnect path started its loops
    expect(a.session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('activateSession is a no-op for an unknown id', async () => {
    await bootMock('rp2350');
    const a = activeRecord()!;
    await activateSession(mintConnId() + 1_000_000);
    expect(activeRecord()?.id).toBe(a.id);
  });

  it('activateSession is a no-op when the id is already active', async () => {
    await bootMock('rp2350');
    const a = activeRecord()!;
    const loopsBefore = a.loops;
    await activateSession(a.id);
    expect(a.loops).toBe(loopsBefore);   // untouched -- no stop/restart churn
  });

  it('activateSession switches: deactivates the previous record (stop before flush) before activating the target', async () => {
    await bootMock('rp2350');
    const a = activeRecord()!;
    await bootMock('rp2350');
    const b = activeRecord()!;   // active; a is dormant
    expect(a.loops).toBeNull();

    let resolveSend!: () => void;
    const pending = write(b.session, () => new Promise<void>((r) => { resolveSend = r; }), () => {});
    expect(b.session.writes.busy).toBe(true);
    b.session.mirror.consumeReconcile();

    const switchPromise = activateSession(a.id);
    await Promise.resolve();             // let the switch's synchronous prefix run
    expect(b.loops).toBeNull();          // stopped already...
    expect(b.session.writes.busy).toBe(true);   // ...but the flush is still awaiting the pending write

    resolveSend();
    await switchPromise;
    await pending;

    expect(activeRecord()?.id).toBe(a.id);
    expect(a.loops).not.toBeNull();      // reactivated
    expect(a.session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    expect(b.session.writes.busy).toBe(false);
  });

  it('activateSession updates settings.lastSerial to the newly active device on a successful switch', async () => {
    await bootMock('rp2350', { serial: 'A' });
    await bootMock('rp2350', { serial: 'B' });   // B active, A dormant
    expect(settings.lastSerial).toBe('B');

    await activateSession(recordBySerial('A')!.id);

    expect(settings.lastSerial).toBe('A');
  });
});

describe('background adoption: wireUpConnection(..., { activate: false })', () => {
  it('registers dormant without disturbing the active record or lastSerial', async () => {
    await bootMock('rp2350', { serial: 'ACTIVE' });
    const activeBefore = activeRecord()!;

    await bootMock('rp2350', { serial: 'BG' }, { activate: false });

    expect(activeRecord()?.id).toBe(activeBefore.id);
    const bg = recordBySerial('BG')!;
    expect(bg.loops).toBeNull();
    expect(settings.lastSerial).toBe('ACTIVE');
  });

  it('becomes active anyway while idle -- the registry never ends up with no active session -- and starts its loops', async () => {
    await bootMock('rp2350', { serial: 'ONLY' }, { activate: false });

    const rec = activeRecord()!;
    expect(rec.session.info.serial).toBe('ONLY');
    expect(rec.loops).not.toBeNull();
    expect(settings.lastSerial).toBe('ONLY');
  });

  it('registers a dormant record\'s loop-stop teardown at adoption time, usable after a later activation', async () => {
    await bootMock('rp2350', { serial: 'A' });
    await bootMock('rp2350', { serial: 'B' }, { activate: false });
    const b = recordBySerial('B')!;
    expect(b.loops).toBeNull();

    await activateSession(b.id);
    expect(b.loops).not.toBeNull();

    b.session.dispose();   // aborts the scope registered back when B was still dormant
    expect(b.loops).toBeNull();
  });
});

describe('link-probe death of the active session with a dormant survivor', () => {
  it('promotes the survivor, starts its loops via onKilled, and surfaces a notice instead of the hero', async () => {
    await bootMock('rp2350', { serial: 'SURVIVOR' });
    await bootMock('rp2350', { serial: 'DOOMED' });
    const survivor = recordBySerial('SURVIVOR')!;
    const doomed = recordBySerial('DOOMED')!;
    expect(activeRecord()?.id).toBe(doomed.id);
    expect(survivor.loops).toBeNull();

    vi.useFakeTimers();
    try {
      // Re-activate under fake timers so the probe's clock is controllable.
      await activateSession(survivor.id);
      await activateSession(doomed.id);

      // Silence the transport-disconnect path so the promotion below can only
      // come from the probe's onKilled callback.
      Object.assign(doomed.session.device, {
        getBypass: () => Promise.reject(new Error('wedged')),
        close: async () => {},
      });
      for (let i = 0; i < 3; i++) doomed.session.health.noteFail('test', new Error('wedged'));
      expect(doomed.session.health.degraded).toBe(true);
      clearNotices();

      await vi.advanceTimersByTimeAsync(7000);

      expect(recordOf(doomed.id)).toBeNull();
      expect(activeRecord()?.id).toBe(survivor.id);
      expect(survivor.loops).not.toBeNull();
      expect(connection.phase).toBe('ready');
      expect(notices.list).toHaveLength(1);
      expect(notices.list[0]).toMatchObject({ kind: 'error' });
    } finally {
      vi.useRealTimers();
      clearNotices();
    }
  });
});
