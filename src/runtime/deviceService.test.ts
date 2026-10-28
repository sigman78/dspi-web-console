import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { wireUpConnection, activateSession, switchSession, hasPendingWork, fetchOutputLatency } from './deviceService';
import { bootMock } from './boot';
import { ConnectionScope } from './connectionScope';
import { write } from './writes.svelte';
import * as State from '@/state';
import { Wire } from '@/protocol';

// Exercises the scope-guard invariant: a connection superseded mid-flight
// (its scope aborted directly by whoever decided to abandon it) must not
// have its eventual settle -- success or failure -- change app state.

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function stubDevice(getSnapshot: () => Promise<unknown>): DspDevice {
  return { info: { serial: 'STALE' }, hardware: {}, getSnapshot } as unknown as DspDevice;
}

beforeEach(() => State.resetAppState());
afterEach(() => {
  // Dormant records need teardown too, not just the active one.
  for (const rec of State.sessionRecords().values()) rec.session.dispose();
  State.resetAppState();
});

describe('wireUpConnection — superseded-attempt guards', () => {
  it('a stale connect that finishes snapshotting after being superseded never dispatches synced', async () => {
    const snap = deferred<unknown>();
    const staleId = State.mintConnId();
    const stale = new ConnectionScope();
    const pending = wireUpConnection(stubDevice(() => snap.promise), stale, staleId);

    expect(State.connection.phase).toBe('connecting');   // stale's own `requested` landed
    stale.abort();                                 // this attempt is abandoned
    expect(stale.aborted).toBe(true);

    snap.resolve({});                              // stale attempt's fetch finally settles
    await pending;

    expect(State.connection.phase).toBe('connecting');   // unchanged by the stale settle
    expect(State.recordOf(staleId)).toBeNull();           // no session was ever installed
    expect(State.activeSession()).toBeNull();
  });

  it('a stale connect whose snapshot fetch fails after being superseded does not dispatch failed', async () => {
    const snap = deferred<unknown>();
    const staleId = State.mintConnId();
    const stale = new ConnectionScope();
    const pending = wireUpConnection(stubDevice(() => snap.promise), stale, staleId);

    stale.abort();                                 // this attempt is abandoned
    snap.reject(new Error('late failure'));

    await expect(pending).rejects.toThrow('late failure');
    expect(State.connection.phase).toBe('connecting');    // the late failure never landed
  });

  it('a non-superseded connect still dispatches failed on snapshot error', async () => {
    const id = State.mintConnId();
    const scope = new ConnectionScope();
    const pending = wireUpConnection(stubDevice(() => Promise.reject(new Error('boom'))), scope, id);

    await expect(pending).rejects.toThrow('boom');
    expect(State.connection.phase).toBe('errored');
    expect(State.connection.error).toBe('boom');
  });
});

// Registry + activation semantics: adopting a session, going dormant, and the
// switch protocol. bootMock mints its own id/scope per call and drives the
// real wireUpConnection path, so these exercise the actual runtime, not just
// the reducer.
describe('registry: adoption, dormancy, and the switch protocol', () => {
  it('a second synced session adopts active and leaves the first dormant (loops stopped)', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    expect(a.loops).not.toBeNull();

    await bootMock('rp2350');
    const b = State.activeRecord()!;

    expect(b.id).not.toBe(a.id);
    expect(State.activeRecord()?.id).toBe(b.id);
    expect(a.loops).toBeNull();          // dormant: no traffic
    expect(b.loops).not.toBeNull();      // active: running
    expect(State.recordOf(a.id)).not.toBeNull();  // still registered, just dormant
  });

  it('removed on a dormant record leaves the active session untouched', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    const b = State.activeRecord()!;
    expect(a.loops).toBeNull();

    await a.session.device.close();      // dormant device unplugged

    expect(State.recordOf(a.id)).toBeNull();
    expect(State.activeRecord()?.id).toBe(b.id);
    expect(b.loops).not.toBeNull();      // untouched
  });

  it('removed on the active record promotes the most recently adopted remaining record, starts its loops, and requests an eager reconcile', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    const b = State.activeRecord()!;
    expect(a.loops).toBeNull();
    a.session.mirror.consumeReconcile();

    await b.session.device.close();      // active device unplugged

    expect(State.recordOf(b.id)).toBeNull();
    expect(State.activeRecord()?.id).toBe(a.id);       // promoted
    expect(a.loops).not.toBeNull();              // runtime disconnect path started its loops
    expect(a.session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('activateSession is a no-op for an unknown id', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await activateSession(State.mintConnId() + 1_000_000);
    expect(State.activeRecord()?.id).toBe(a.id);
  });

  it('activateSession is a no-op when the id is already active', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    const loopsBefore = a.loops;
    await activateSession(a.id);
    expect(a.loops).toBe(loopsBefore);   // untouched -- no stop/restart churn
  });

  it('activateSession switches: deactivates the previous record (stop before flush) before activating the target', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    const b = State.activeRecord()!;   // active; a is dormant
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

    expect(State.activeRecord()?.id).toBe(a.id);
    expect(a.loops).not.toBeNull();      // reactivated
    expect(a.session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    expect(b.session.writes.busy).toBe(false);
  });

  it('activateSession updates settings.lastSerial to the newly active device on a successful switch', async () => {
    await bootMock('rp2350', { serial: 'A' });
    await bootMock('rp2350', { serial: 'B' });   // B active, A dormant
    expect(State.settings.lastSerial).toBe('B');

    await activateSession(State.recordBySerial('A')!.id);

    expect(State.settings.lastSerial).toBe('A');
  });
});

describe('switchSession: pending-work guard', () => {
  afterEach(() => State.resetBoundary());

  it('switches straight away when the active device holds nothing pending', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    expect(await switchSession(a.id)).toBe(true);
    expect(State.activeRecord()?.id).toBe(a.id);
    expect(State.boundary.pending).toBeNull();
  });

  it('asks first when console-local drafts are pending, and Cancel stays on the device', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    const b = State.activeRecord()!;
    b.session.drafts.of('macros').editDraft(0, {});
    expect(hasPendingWork(b.session)).toBe(true);

    const switched = switchSession(a.id);
    await Promise.resolve();
    expect(State.boundary.pending?.saveLabel).toBeUndefined();
    State.resolveBoundary('cancel');

    expect(await switched).toBe(false);
    expect(State.activeRecord()?.id).toBe(b.id);
  });

  it('Switch anyway proceeds and leaves the pending work on the dormant device', async () => {
    await bootMock('rp2350');
    const a = State.activeRecord()!;
    await bootMock('rp2350');
    const b = State.activeRecord()!;
    b.session.staging.stage({
      key: 'k', label: 'k', from: 'a', to: 'b', value: 1, order: 1,
      apply: async () => true, overlay: (snap) => snap,
    });

    const switched = switchSession(a.id);
    await Promise.resolve();
    State.resolveBoundary('discard');

    expect(await switched).toBe(true);
    expect(State.activeRecord()?.id).toBe(a.id);
    expect(b.session.staging.entries).toHaveLength(1);
  });
});

describe('background adoption: wireUpConnection(..., { activate: false })', () => {
  it('registers dormant without disturbing the active record or lastSerial', async () => {
    await bootMock('rp2350', { serial: 'ACTIVE' });
    const activeBefore = State.activeRecord()!;

    await bootMock('rp2350', { serial: 'BG' }, { activate: false });

    expect(State.activeRecord()?.id).toBe(activeBefore.id);
    const bg = State.recordBySerial('BG')!;
    expect(bg.loops).toBeNull();
    expect(State.settings.lastSerial).toBe('ACTIVE');
  });

  it('becomes active anyway while idle -- the registry never ends up with no active session -- and starts its loops', async () => {
    await bootMock('rp2350', { serial: 'ONLY' }, { activate: false });

    const rec = State.activeRecord()!;
    expect(rec.session.info.serial).toBe('ONLY');
    expect(rec.loops).not.toBeNull();
    expect(State.settings.lastSerial).toBe('ONLY');
  });

  it('registers a dormant record\'s loop-stop teardown at adoption time, usable after a later activation', async () => {
    await bootMock('rp2350', { serial: 'A' });
    await bootMock('rp2350', { serial: 'B' }, { activate: false });
    const b = State.recordBySerial('B')!;
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
    const survivor = State.recordBySerial('SURVIVOR')!;
    const doomed = State.recordBySerial('DOOMED')!;
    expect(State.activeRecord()?.id).toBe(doomed.id);
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
      State.clearNotices();

      await vi.advanceTimersByTimeAsync(7000);

      expect(State.recordOf(doomed.id)).toBeNull();
      expect(State.activeRecord()?.id).toBe(survivor.id);
      expect(survivor.loops).not.toBeNull();
      expect(State.connection.phase).toBe('ready');
      expect(State.notices.list).toHaveLength(1);
      expect(State.notices.list[0]).toMatchObject({ kind: 'error' });
    } finally {
      vi.useRealTimers();
      State.clearNotices();
    }
  });
});

describe('resetAppState', () => {
  it('disposes non-active records and stops their loops', async () => {
    await bootMock('rp2350', { serial: 'LOOPY' });
    const rec = State.activeRecord()!;
    // A raw synced dispatch over a running session (a common test pattern)
    // re-points active without deactivating it -- its loops keep running.
    State.dispatch({ t: 'synced', id: State.mintConnId(), session: State.makeReadySession({ info: { serial: 'TEST' }, hardware: {} } as never) });
    expect(State.activeRecord()?.id).not.toBe(rec.id);
    expect(rec.loops).not.toBeNull();

    State.resetAppState();

    expect(rec.loops).toBeNull();
    expect(rec.session.alive).toBe(false);
    expect(State.sessionRecords().size).toBe(0);
  });
});

describe('fetchSysClock', () => {
  it('leaves the status unsupported when the firmware STALLs the system-clock opcodes', async () => {
    await bootMock('rp2350', { sysClock: false });
    const { sysClock } = State.activeSession()!;
    expect(sysClock.supported).toBe(false);
    expect(sysClock.status).toBeNull();
  });
});

describe('fetchOutputLatency', () => {
  it('reads status and options when the firmware answers the latency request', async () => {
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION, fwHead: true });
    const { outputLatency } = State.activeSession()!;
    expect(outputLatency.supported).toBe(true);
    expect(outputLatency.status?.requestedId).toBeGreaterThan(0);
    expect(outputLatency.options?.length).toBe(outputLatency.status?.optionCount);
  });

  it('keeps support confirmed when only the options read fails', async () => {
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION, fwHead: true });
    const s = State.activeSession()!;
    vi.spyOn(s.device, 'getOutputLatencyOptions').mockRejectedValueOnce(new Error('transfer failed'));
    await fetchOutputLatency(s);
    expect(s.outputLatency.supported).toBe(true);
    expect(s.outputLatency.status).not.toBeNull();
    expect(s.outputLatency.options).toBeNull();
  });

  it('marks the feature unsupported when the firmware STALLs the request', async () => {
    await bootMock('rp2350', { wireVersion: 32 });
    const { outputLatency } = State.activeSession()!;
    expect(outputLatency.supported).toBe(false);
    expect(outputLatency.status).toBeNull();
    expect(outputLatency.options).toBeNull();
  });
});
