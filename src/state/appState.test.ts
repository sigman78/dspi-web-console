import { describe, it, expect, beforeEach } from 'vitest';
import * as AppState from './appState.svelte';
import type { ReadySession } from './appState.svelte';
import { makeReadySession } from './makeSession.svelte';

const fakeSession: ReadySession = makeReadySession({ info: {}, hardware: {} } as never);

beforeEach(() => AppState.resetAppState());

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

describe('dispatch() — connection phase', () => {
  it('requested → connecting', () => {
    AppState.dispatch({ t: 'requested', id: AppState.mintConnId() });
    expect(AppState.connection.phase).toBe('connecting');
  });

  it('synced → ready, connection connected', () => {
    AppState.dispatch({ t: 'synced', id: AppState.mintConnId(), session: fakeSession });
    expect(AppState.connection.phase).toBe('ready');
    expect(AppState.connection.connected).toBe(true);
    expect(AppState.connection.error).toBeNull();
    expect(AppState.connection.errorKind).toBeNull();
  });

  it('failed → errored with message and default null errorKind', () => {
    AppState.dispatch({ t: 'failed', id: AppState.mintConnId(), message: 'boom' });
    expect(AppState.connection.phase).toBe('errored');
    expect(AppState.connection.error).toBe('boom');
    expect(AppState.connection.errorKind).toBeNull();
  });

  it('failed → errored preserves an explicit errorKind', () => {
    AppState.dispatch({ t: 'failed', id: AppState.mintConnId(), message: 'old fw', errorKind: 'unsupported-firmware' });
    expect(AppState.connection.phase).toBe('errored');
    expect(AppState.connection.error).toBe('old fw');
    expect(AppState.connection.errorKind).toBe('unsupported-firmware');
  });

  it('removed → noDevice when it drops the only record', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id, session: fakeSession });
    AppState.dispatch({ t: 'removed', id });
    expect(AppState.connection.phase).toBe('noDevice');
  });
});

describe('activeSession()', () => {
  it('returns null when not ready', () => {
    expect(AppState.activeSession()).toBeNull();
  });

  it('returns the session when ready', () => {
    AppState.dispatch({ t: 'synced', id: AppState.mintConnId(), session: fakeSession });
    expect(AppState.activeSession()).toBe(fakeSession);
  });
});

describe('dispatch() — registry semantics', () => {
  it('synced registers a record and makes it active', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id, session: fakeSession });
    expect(AppState.sessionRecords().has(id)).toBe(true);
    expect(AppState.activeRecord()?.id).toBe(id);
    expect(AppState.recordOf(id)?.session).toBe(fakeSession);
  });

  it('a second synced adopts the new id active, leaving the first dormant in the registry', () => {
    const first = AppState.mintConnId();
    const second = AppState.mintConnId();
    const sessionB = makeReadySession({ info: {}, hardware: {} } as never);
    AppState.dispatch({ t: 'synced', id: first, session: fakeSession });
    AppState.dispatch({ t: 'synced', id: second, session: sessionB });
    expect(AppState.activeRecord()?.id).toBe(second);
    expect(AppState.sessionRecords().has(first)).toBe(true);   // dormant, not dropped
    expect(AppState.recordOf(first)?.session).toBe(fakeSession);
  });

  it('activated switches the active id among existing records', () => {
    const first = AppState.mintConnId();
    const second = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id: first, session: fakeSession });
    AppState.dispatch({ t: 'synced', id: second, session: makeReadySession({ info: {}, hardware: {} } as never) });
    AppState.dispatch({ t: 'activated', id: first });
    expect(AppState.activeRecord()?.id).toBe(first);
  });

  it('activated is a no-op for an unknown id', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id, session: fakeSession });
    AppState.dispatch({ t: 'activated', id: AppState.mintConnId() });
    expect(AppState.activeRecord()?.id).toBe(id);
  });

  it('removed on a dormant record leaves the active session untouched', () => {
    const active = AppState.mintConnId();
    const dormant = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id: active, session: fakeSession });
    AppState.dispatch({ t: 'synced', id: dormant, session: makeReadySession({ info: {}, hardware: {} } as never) });
    AppState.dispatch({ t: 'activated', id: active });
    AppState.dispatch({ t: 'removed', id: dormant });
    expect(AppState.activeRecord()?.id).toBe(active);
    expect(AppState.sessionRecords().has(dormant)).toBe(false);
  });

  it('removed on the active record promotes the most recently adopted remaining record', () => {
    const first = AppState.mintConnId();
    const second = AppState.mintConnId();
    const third = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id: first, session: fakeSession });
    AppState.dispatch({ t: 'synced', id: second, session: makeReadySession({ info: {}, hardware: {} } as never) });
    AppState.dispatch({ t: 'synced', id: third, session: makeReadySession({ info: {}, hardware: {} } as never) });
    AppState.dispatch({ t: 'activated', id: first });   // first is active; second, third dormant
    AppState.dispatch({ t: 'removed', id: first });
    expect(AppState.activeRecord()?.id).toBe(third);    // last remaining by adoption order
  });

  it('removed on the last record clears activeId to null', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id, session: fakeSession });
    AppState.dispatch({ t: 'removed', id });
    expect(AppState.activeRecord()).toBeNull();
    expect(AppState.activeSession()).toBeNull();
  });

  it('failed after synced (late failure) removes the record and lands the errored attempt', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id, session: fakeSession });
    AppState.dispatch({ t: 'failed', id, message: 'late failure' });
    expect(AppState.recordOf(id)).toBeNull();
    expect(AppState.activeSession()).toBeNull();
    expect(AppState.connection.phase).toBe('errored');
    expect(AppState.connection.error).toBe('late failure');
  });

  it('failed while another record stays active does not paint the error state', () => {
    const survivor = AppState.mintConnId();
    const dying = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id: survivor, session: fakeSession });
    AppState.dispatch({ t: 'synced', id: dying, session: makeReadySession({ info: {}, hardware: {} } as never) });
    AppState.dispatch({ t: 'failed', id: dying, message: 'link dead' });
    expect(AppState.recordOf(dying)).toBeNull();
    expect(AppState.activeRecord()?.id).toBe(survivor);
    expect(AppState.connection.phase).toBe('ready');
    expect(AppState.connection.error).toBeNull();
  });

  it('failed while another record stays active clears its own connecting attempt', () => {
    const survivor = AppState.mintConnId();
    const failing = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id: survivor, session: fakeSession });
    AppState.dispatch({ t: 'requested', id: failing });
    AppState.dispatch({ t: 'failed', id: failing, message: 'adoption failed' });
    expect(AppState.activeRecord()?.id).toBe(survivor);
    expect(AppState.connection.phase).toBe('ready');
    AppState.dispatch({ t: 'removed', id: survivor });
    expect(AppState.connection.phase).toBe('noDevice');
  });

  it('removed while the attempt is connecting resets the attempt to idle', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'requested', id });
    expect(AppState.connection.phase).toBe('connecting');
    AppState.dispatch({ t: 'removed', id });
    expect(AppState.connection.phase).toBe('noDevice');
  });

  it('removed while the attempt is errored (same id) resets the attempt to idle', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'failed', id, message: 'boom' });
    expect(AppState.connection.phase).toBe('errored');
    AppState.dispatch({ t: 'removed', id });
    expect(AppState.connection.phase).toBe('noDevice');
  });
});

describe('dispatch() — background adoption (synced with activate: false)', () => {
  it('registers dormant, leaving the existing active record untouched', () => {
    const active = AppState.mintConnId();
    const background = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id: active, session: fakeSession });
    AppState.dispatch({ t: 'synced', id: background, session: makeReadySession({ info: {}, hardware: {} } as never), activate: false });
    expect(AppState.activeRecord()?.id).toBe(active);
    expect(AppState.sessionRecords().has(background)).toBe(true);
  });

  it('becomes active anyway when nothing else is active (the registry never ends up with no active session)', () => {
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'synced', id, session: fakeSession, activate: false });
    expect(AppState.activeRecord()?.id).toBe(id);
  });
});

describe('adoptionInProgress()', () => {
  it('is true only while an attempt is connecting', () => {
    expect(AppState.adoptionInProgress()).toBe(false);
    const id = AppState.mintConnId();
    AppState.dispatch({ t: 'requested', id });
    expect(AppState.adoptionInProgress()).toBe(true);
    AppState.dispatch({ t: 'synced', id, session: fakeSession });
    expect(AppState.adoptionInProgress()).toBe(false);
  });
});

describe('recordBySerial()', () => {
  it('finds a registered record by its session serial, dormant or active', () => {
    const a = AppState.mintConnId();
    const b = AppState.mintConnId();
    const sessionA = makeReadySession({ info: { serial: 'AAA' }, hardware: {} } as never);
    const sessionB = makeReadySession({ info: { serial: 'BBB' }, hardware: {} } as never);
    AppState.dispatch({ t: 'synced', id: a, session: sessionA });
    AppState.dispatch({ t: 'synced', id: b, session: sessionB, activate: false });
    expect(AppState.recordBySerial('AAA')?.id).toBe(a);
    expect(AppState.recordBySerial('BBB')?.id).toBe(b);
  });

  it('returns null for a serial that has no registered record', () => {
    expect(AppState.recordBySerial('NOPE')).toBeNull();
  });
});
