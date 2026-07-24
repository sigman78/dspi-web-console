import { describe, it, expect, beforeEach } from 'vitest';
import {
  dispatch, mintConnId, activeSession, activeRecord, recordOf, sessionRecords, resetAppState,
  connection, type ReadySession,
} from './appState.svelte';
import { makeReadySession } from './makeSession.svelte';

const fakeSession: ReadySession = makeReadySession({ info: {}, hardware: {} } as never);

beforeEach(() => resetAppState());

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
    dispatch({ t: 'requested', id: mintConnId() });
    expect(connection.phase).toBe('connecting');
  });

  it('synced → ready, connection connected', () => {
    dispatch({ t: 'synced', id: mintConnId(), session: fakeSession });
    expect(connection.phase).toBe('ready');
    expect(connection.connected).toBe(true);
    expect(connection.error).toBeNull();
    expect(connection.errorKind).toBeNull();
  });

  it('failed → errored with message and default null errorKind', () => {
    dispatch({ t: 'failed', id: mintConnId(), message: 'boom' });
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('boom');
    expect(connection.errorKind).toBeNull();
  });

  it('failed → errored preserves an explicit errorKind', () => {
    dispatch({ t: 'failed', id: mintConnId(), message: 'old fw', errorKind: 'unsupported-firmware' });
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('old fw');
    expect(connection.errorKind).toBe('unsupported-firmware');
  });

  it('removed → noDevice when it drops the only record', () => {
    const id = mintConnId();
    dispatch({ t: 'synced', id, session: fakeSession });
    dispatch({ t: 'removed', id });
    expect(connection.phase).toBe('noDevice');
  });
});

describe('activeSession()', () => {
  it('returns null when not ready', () => {
    expect(activeSession()).toBeNull();
  });

  it('returns the session when ready', () => {
    dispatch({ t: 'synced', id: mintConnId(), session: fakeSession });
    expect(activeSession()).toBe(fakeSession);
  });
});

describe('dispatch() — registry semantics', () => {
  it('synced registers a record and makes it active', () => {
    const id = mintConnId();
    dispatch({ t: 'synced', id, session: fakeSession });
    expect(sessionRecords().has(id)).toBe(true);
    expect(activeRecord()?.id).toBe(id);
    expect(recordOf(id)?.session).toBe(fakeSession);
  });

  it('a second synced adopts the new id active, leaving the first dormant in the registry', () => {
    const first = mintConnId();
    const second = mintConnId();
    const sessionB = makeReadySession({ info: {}, hardware: {} } as never);
    dispatch({ t: 'synced', id: first, session: fakeSession });
    dispatch({ t: 'synced', id: second, session: sessionB });
    expect(activeRecord()?.id).toBe(second);
    expect(sessionRecords().has(first)).toBe(true);   // dormant, not dropped
    expect(recordOf(first)?.session).toBe(fakeSession);
  });

  it('activated switches the active id among existing records', () => {
    const first = mintConnId();
    const second = mintConnId();
    dispatch({ t: 'synced', id: first, session: fakeSession });
    dispatch({ t: 'synced', id: second, session: makeReadySession({ info: {}, hardware: {} } as never) });
    dispatch({ t: 'activated', id: first });
    expect(activeRecord()?.id).toBe(first);
  });

  it('activated is a no-op for an unknown id', () => {
    const id = mintConnId();
    dispatch({ t: 'synced', id, session: fakeSession });
    dispatch({ t: 'activated', id: mintConnId() });
    expect(activeRecord()?.id).toBe(id);
  });

  it('removed on a dormant record leaves the active session untouched', () => {
    const active = mintConnId();
    const dormant = mintConnId();
    dispatch({ t: 'synced', id: active, session: fakeSession });
    dispatch({ t: 'synced', id: dormant, session: makeReadySession({ info: {}, hardware: {} } as never) });
    dispatch({ t: 'activated', id: active });
    dispatch({ t: 'removed', id: dormant });
    expect(activeRecord()?.id).toBe(active);
    expect(sessionRecords().has(dormant)).toBe(false);
  });

  it('removed on the active record promotes the most recently adopted remaining record', () => {
    const first = mintConnId();
    const second = mintConnId();
    const third = mintConnId();
    dispatch({ t: 'synced', id: first, session: fakeSession });
    dispatch({ t: 'synced', id: second, session: makeReadySession({ info: {}, hardware: {} } as never) });
    dispatch({ t: 'synced', id: third, session: makeReadySession({ info: {}, hardware: {} } as never) });
    dispatch({ t: 'activated', id: first });   // first is active; second, third dormant
    dispatch({ t: 'removed', id: first });
    expect(activeRecord()?.id).toBe(third);    // last remaining by adoption order
  });

  it('removed on the last record clears activeId to null', () => {
    const id = mintConnId();
    dispatch({ t: 'synced', id, session: fakeSession });
    dispatch({ t: 'removed', id });
    expect(activeRecord()).toBeNull();
    expect(activeSession()).toBeNull();
  });

  it('failed after synced (late failure) removes the record and lands the errored attempt', () => {
    const id = mintConnId();
    dispatch({ t: 'synced', id, session: fakeSession });
    dispatch({ t: 'failed', id, message: 'late failure' });
    expect(recordOf(id)).toBeNull();
    expect(activeSession()).toBeNull();
    expect(connection.phase).toBe('errored');
    expect(connection.error).toBe('late failure');
  });

  it('failed while another record stays active does not paint the error state', () => {
    const survivor = mintConnId();
    const dying = mintConnId();
    dispatch({ t: 'synced', id: survivor, session: fakeSession });
    dispatch({ t: 'synced', id: dying, session: makeReadySession({ info: {}, hardware: {} } as never) });
    dispatch({ t: 'failed', id: dying, message: 'link dead' });
    expect(recordOf(dying)).toBeNull();
    expect(activeRecord()?.id).toBe(survivor);
    expect(connection.phase).toBe('ready');
    expect(connection.error).toBeNull();
  });

  it('failed while another record stays active clears its own connecting attempt', () => {
    const survivor = mintConnId();
    const failing = mintConnId();
    dispatch({ t: 'synced', id: survivor, session: fakeSession });
    dispatch({ t: 'requested', id: failing });
    dispatch({ t: 'failed', id: failing, message: 'adoption failed' });
    expect(activeRecord()?.id).toBe(survivor);
    expect(connection.phase).toBe('ready');
    dispatch({ t: 'removed', id: survivor });
    expect(connection.phase).toBe('noDevice');
  });

  it('removed while the attempt is connecting resets the attempt to idle', () => {
    const id = mintConnId();
    dispatch({ t: 'requested', id });
    expect(connection.phase).toBe('connecting');
    dispatch({ t: 'removed', id });
    expect(connection.phase).toBe('noDevice');
  });

  it('removed while the attempt is errored (same id) resets the attempt to idle', () => {
    const id = mintConnId();
    dispatch({ t: 'failed', id, message: 'boom' });
    expect(connection.phase).toBe('errored');
    dispatch({ t: 'removed', id });
    expect(connection.phase).toBe('noDevice');
  });
});
