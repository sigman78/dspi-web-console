import { describe, it, expect, beforeEach, vi } from 'vitest';
import { write, scrub, writeChecked, command, flushAllWrites } from './writes';
import { connection, settings, notices, clearNotices, dispatch, makeReadySession, activeSession, type ReadySession } from '@/state';
import { Result } from '@/utils';

// Mock the resync module so write() failures don't actually fire HTTP.
vi.mock('@/runtime/resync', () => ({
  forceResyncNow: vi.fn(),
}));

// vi.mock is hoisted, so this static import resolves to the mock above.
import { forceResyncNow } from '@/runtime/resync';

// Install a ready session so writes resolve activeSession() and its
// WriteCoordinator/alive guard. Disposing it (or dispatching disconnected)
// simulates a disconnect mid-flight — the per-session `alive` guard replaces the
// old session.generation bump.
let session: ReadySession;
function installSession(): void {
  session = makeReadySession({ info: {}, hardware: {} } as never);
  dispatch({ t: 'synced', session });
}

describe('write() helper', () => {
  beforeEach(() => {
    installSession();
    vi.clearAllMocks();
  });

  it('awaits send, then mutates on success', async () => {
    const order: string[] = [];
    const send = vi.fn(async () => { order.push('send'); });
    const mutate = vi.fn(() => { order.push('mutate'); });
    await write(session, send, mutate);
    expect(order).toEqual(['send', 'mutate']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('requests a reconcile on success (non-eager when flag off)', async () => {
    settings.eagerReconcile = false;
    activeSession()!.mirror.consumeReconcile();  // clear any prior pending
    await write(session, async () => {}, () => {});
    const { wanted, eager } = activeSession()!.mirror.consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(false);
  });

  it('requests an eager reconcile on success when flag on', async () => {
    settings.eagerReconcile = true;
    activeSession()!.mirror.consumeReconcile();
    await write(session, async () => {}, () => {});
    const { wanted, eager } = activeSession()!.mirror.consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(true);
    settings.eagerReconcile = false;
  });

  it('does not request a reconcile when send fails', async () => {
    const s = activeSession()!;
    s.mirror.consumeReconcile();
    await write(session, async () => { throw new Error('boom'); }, () => {});
    const { wanted } = s.mirror.consumeReconcile();
    expect(wanted).toBe(false);
  });

  it('stamps write activity when called', async () => {
    const before = activeSession()!.mirror.lastWriteMs;
    await write(session, async () => {}, () => {});
    expect(activeSession()!.mirror.lastWriteMs).toBeGreaterThanOrEqual(before);
    expect(activeSession()!.mirror.lastWriteMs).toBeGreaterThan(0);
  });

  it('bumps inflight during send and drops after settle', async () => {
    let inflightDuringSend = -1;
    const send = vi.fn(async () => {
      inflightDuringSend = activeSession()!.mirror.inflight;
    });
    await write(session, send, () => {});
    expect(inflightDuringSend).toBe(1);
    expect(activeSession()!.mirror.inflight).toBe(0);
  });

  it('does not mutate when send rejects', async () => {
    const s = activeSession()!;
    const mutate = vi.fn();
    const send = vi.fn(async () => { throw new Error('boom'); });
    await write(session, send, mutate);
    expect(mutate).not.toHaveBeenCalled();
    expect(s.mirror.inflight).toBe(0);
  });

  it('does not mutate when generation changes mid-flight', async () => {
    const mutate = vi.fn();
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const s = activeSession()!;
    const p = write(session, send, mutate);
    s.dispose();  // simulate disconnect mid-flight
    resolveSend!();
    await p;
    expect(mutate).not.toHaveBeenCalled();
    expect(s.mirror.inflight).toBe(0);
  });

  it('does not call forceResyncNow on failure if generation changed', async () => {
    let resolveSend!: (err: Error) => void;
    const send = vi.fn(() => new Promise<void>((_, reject) => { resolveSend = (e) => reject(e); }));
    const p = write(session, send, () => {});
    activeSession()?.dispose();
    resolveSend!(new Error('boom'));
    await p;
    expect(forceResyncNow).not.toHaveBeenCalled();
  });

  it('calls forceResyncNow on failure when generation unchanged', async () => {
    const send = vi.fn(async () => { throw new Error('boom'); });
    await write(session, send, () => {});
    expect(forceResyncNow).toHaveBeenCalled();
  });
});

describe('write() failure policy', () => {
  beforeEach(() => {
    installSession();
    clearNotices();
    vi.clearAllMocks();
  });

  it('a failed write stays connected, reports health, toasts, and resyncs', async () => {
    await write(session, async () => { throw new Error('boom'); }, () => {});
    expect(connection.connected).toBe(true);
    expect(session.health.failTotal).toBe(1);
    expect(notices.list.some((n) => n.kind === 'error')).toBe(true);
    expect(forceResyncNow).toHaveBeenCalledWith(session);
  });

  it('while degraded, a failed write neither toasts nor resyncs', async () => {
    session.health.degraded = true;
    await write(session, async () => { throw new Error('boom'); }, () => {});
    expect(notices.list.length).toBe(0);
    expect(forceResyncNow).not.toHaveBeenCalled();
  });

  it('a failed command reports health and stays connected', async () => {
    await command(session, 'set thing', async () => { throw new Error('boom'); }, () => {});
    expect(session.health.failTotal).toBe(1);
    expect(connection.connected).toBe(true);
  });
});

describe('writeChecked() helper', () => {
  beforeEach(() => {
    installSession();
    settings.eagerReconcile = false;
    activeSession()!.mirror.consumeReconcile();
    clearNotices();
    vi.clearAllMocks();
  });

  it('patches and requests a non-eager reconcile on an ok Result (eagerReconcile off)', async () => {
    const patch = vi.fn();
    await writeChecked(session, 'op', async () => Result.ok(), patch);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(activeSession()!.mirror.consumeReconcile()).toEqual({ wanted: true, eager: false });
  });

  it('honors settings.eagerReconcile=true on an ok Result', async () => {
    settings.eagerReconcile = true;
    await writeChecked(session, 'op', async () => Result.ok(), () => {});
    expect(activeSession()!.mirror.consumeReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('warns with the device message and skips the patch on a non-ok Result', async () => {
    const patch = vi.fn();
    await writeChecked(session, 'set pin', async () => Result.fail('x', 'GPIO pin already in use'), patch);
    expect(patch).not.toHaveBeenCalled();
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].kind).toBe('warn');
    expect(notices.list[0].message).toContain('in use');
  });

  it('treats a rejection as local — no resync, no status change', async () => {
    await writeChecked(session, 'set pin', async () => Result.fail('x', 'rejected'), () => {});
    expect(forceResyncNow).not.toHaveBeenCalled();
    expect(connection.connected).toBe(true);
  });

  it('error-toasts a transport throw without resyncing', async () => {
    await writeChecked(session, 'set pin', async () => { throw new Error('stall'); }, () => {});
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].kind).toBe('error');
    expect(forceResyncNow).not.toHaveBeenCalled();
    expect(connection.connected).toBe(true);
  });

  it('does not patch when generation changes mid-flight', async () => {
    const patch = vi.fn();
    let resolveSend!: (r: Result<void, string>) => void;
    const send = vi.fn(() => new Promise<Result<void, string>>((res) => { resolveSend = res; }));
    const p = writeChecked(session, 'op', send, patch);
    activeSession()?.dispose();  // simulate disconnect mid-flight
    resolveSend!(Result.ok());
    await p;
    expect(patch).not.toHaveBeenCalled();
  });

  it('is drained by flushAllWrites', async () => {
    const patch = vi.fn();
    let resolveSend!: (r: Result<void, string>) => void;
    const send = vi.fn(() => new Promise<Result<void, string>>((res) => { resolveSend = res; }));
    void writeChecked(session, 'op', send, patch);
    const flushed = flushAllWrites(session);
    resolveSend!(Result.ok());
    await flushed;
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

describe('command() helper', () => {
  beforeEach(() => {
    installSession();
    clearNotices();
    vi.clearAllMocks();
  });

  it('runs onSettled with the resolved value on success', async () => {
    const onSettled = vi.fn();
    await command(session, 'op', async () => 42, onSettled);
    expect(onSettled).toHaveBeenCalledWith(42, activeSession()!);
  });

  it('drops onSettled and emits no toast when generation changes mid-flight', async () => {
    const onSettled = vi.fn();
    let resolve!: (v: number) => void;
    const p = command(session, 'op', () => new Promise<number>((r) => { resolve = r; }), onSettled);
    activeSession()?.dispose();  // simulate disconnect+reconnect mid-flight
    resolve!(1);
    await p;
    expect(onSettled).not.toHaveBeenCalled();
    expect(notices.list).toHaveLength(0);
  });

  it('error-toasts a throw without flipping connection status', async () => {
    await command(session, 'save', async () => { throw new Error('boom'); }, () => {});
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].kind).toBe('error');
    expect(connection.connected).toBe(true);
  });

  it('is drained by flushAllWrites', async () => {
    const onSettled = vi.fn();
    let resolve!: (v: number) => void;
    void command(session, 'op', () => new Promise<number>((r) => { resolve = r; }), onSettled);
    const flushed = flushAllWrites(session);
    resolve!(7);
    await flushed;
    expect(onSettled).toHaveBeenCalledWith(7, activeSession()!);
  });
});

describe('scrub() helper', () => {
  beforeEach(() => {
    installSession();
    vi.clearAllMocks();
    session.writes.cancel();  // ensure no leftover lane state between tests
  });

  it('mutates immediately (optimistic)', async () => {
    const mutate = vi.fn();
    const send = vi.fn(async () => {});
    scrub(session, 'k1', mutate, send);
    expect(mutate).toHaveBeenCalledTimes(1);   // synchronous, before any send settles
    await flushAllWrites(session);
  });

  it('sends immediately when the lane is idle', () => {
    const send = vi.fn(async () => {});
    scrub(session, 'k1', () => {}, send);
    expect(send).toHaveBeenCalledTimes(1);     // no coalesce timer in front
  });

  it('stamps write activity on the call (before any send settles)', async () => {
    const before = activeSession()!.mirror.lastWriteMs;
    scrub(session, 'k1', () => {}, async () => {});
    expect(activeSession()!.mirror.lastWriteMs).toBeGreaterThan(0);
    expect(activeSession()!.mirror.lastWriteMs).toBeGreaterThanOrEqual(before);
    await flushAllWrites(session);
  });

  it('coalesces to the latest value while a send is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sends: number[] = [];
    scrub(session, 'k1', () => {}, async () => { sends.push(1); await gate; });
    scrub(session, 'k1', () => {}, async () => { sends.push(2); });
    scrub(session, 'k1', () => {}, async () => { sends.push(3); });
    release();
    await flushAllWrites(session);
    expect(sends).toEqual([1, 3]);             // 2 was replaced before the wire freed up
  });

  it('different keys do not coalesce', async () => {
    const sendA = vi.fn(async () => {});
    const sendB = vi.fn(async () => {});
    scrub(session, 'keyA', () => {}, sendA);
    scrub(session, 'keyB', () => {}, sendB);
    await flushAllWrites(session);
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a parked send without firing it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const parked = vi.fn(async () => {});
    scrub(session, 'k1', () => {}, async () => { await gate; });
    scrub(session, 'k1', () => {}, parked);    // parked behind the in-flight send
    session.writes.cancel();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(parked).not.toHaveBeenCalled();
    expect(session.mirror.inflight).toBe(0);
  });

  it('claims inflight once for a burst and drops it when the lane drains', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    scrub(session, 'k1', () => {}, async () => { await gate; });
    scrub(session, 'k1', () => {}, async () => {});
    expect(session.mirror.inflight).toBe(1);
    release();
    await flushAllWrites(session);
    expect(session.mirror.inflight).toBe(0);
  });

  it('cancel resets inflight to 0', () => {
    scrub(session, 'k1', () => {}, async () => {});
    scrub(session, 'k2', () => {}, async () => {});
    expect(activeSession()!.mirror.inflight).toBeGreaterThan(0);
    session.writes.cancel();
    expect(activeSession()!.mirror.inflight).toBe(0);
  });

  it('on send failure: forceResyncNow called, lane recovers', async () => {
    const send = vi.fn(async () => { throw new Error('boom'); });
    scrub(session, 'k1', () => {}, send);
    await flushAllWrites(session);
    expect(forceResyncNow).toHaveBeenCalled();
  });

  it('on send success: does NOT resync (case A — mirror already holds sent value)', async () => {
    const send = vi.fn(async () => {});
    scrub(session, 'k1', () => {}, send);
    await flushAllWrites(session);
    expect(forceResyncNow).not.toHaveBeenCalled();
  });

  it('on send success: requests a reconcile (eager per flag)', async () => {
    settings.eagerReconcile = true;
    activeSession()!.mirror.consumeReconcile();
    scrub(session, 'k1', () => {}, async () => {});
    await flushAllWrites(session);
    const { wanted, eager } = activeSession()!.mirror.consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(true);
    settings.eagerReconcile = false;
  });

  it('on send failure: does not request a reconcile', async () => {
    const s = activeSession()!;
    s.mirror.consumeReconcile();
    scrub(session, 'k1', () => {}, async () => { throw new Error('boom'); });
    await flushAllWrites(session);
    const { wanted } = s.mirror.consumeReconcile();
    expect(wanted).toBe(false);
  });

  it('stale-gen settle does not call forceResyncNow', async () => {
    vi.clearAllMocks();
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    scrub(session, 'k1', () => {}, send);
    // Wait for timer to fire (coalesce window) so send starts
    await new Promise((r) => setTimeout(r, 25));
    activeSession()?.dispose();  // simulate disconnect mid-send
    resolveSend!();
    await flushAllWrites(session);
    expect(forceResyncNow).not.toHaveBeenCalled();
  });
});

describe('flushAllWrites covers write() calls', () => {
  beforeEach(() => {
    installSession();
    session.writes.cancel();
  });

  it('flushAllWrites awaits in-flight write() before resolving', async () => {
    let resolveSend!: () => void;
    let mutated = false;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    const mutate = vi.fn(() => { mutated = true; });
    void write(session, send, mutate);
    // The write is in flight. flushAllWrites must wait for it.
    let flushed = false;
    const flushP = flushAllWrites(session).then(() => { flushed = true; });
    // Yield once: flush should NOT have resolved yet
    await Promise.resolve();
    expect(flushed).toBe(false);
    // Settle the send
    resolveSend!();
    await flushP;
    expect(flushed).toBe(true);
    expect(mutated).toBe(true);
  });

  it('inflight counter is non-zero during a write() in flight', async () => {
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    void write(session, send, () => {});
    expect(activeSession()!.mirror.inflight).toBe(1);
    resolveSend!();
    await flushAllWrites(session);
    expect(activeSession()!.mirror.inflight).toBe(0);
  });
});

// The write lanes must track inflight / alive / reconcile on the session they
// are GIVEN, not on whichever session happens to be active when the send
// settles. The send/mutate closures target the passed session; if lifecycle
// attached to the active session instead, a reconnect (or a second device)
// would route A's bookkeeping onto B.
describe('write lanes are scoped to the passed session, not the active one', () => {
  beforeEach(() => {
    installSession();           // session B is the active one
    settings.eagerReconcile = false;
    vi.clearAllMocks();
  });

  it('write() bumps inflight and requests reconcile on the passed session', async () => {
    const a = makeReadySession({ info: {}, hardware: {} } as never);  // not active
    a.mirror.consumeReconcile();
    session.mirror.consumeReconcile();
    let inflightDuringSend = -1;
    await write(a, async () => { inflightDuringSend = a.mirror.inflight; }, () => {});
    expect(inflightDuringSend).toBe(1);                       // A's counter, not B's
    expect(a.mirror.consumeReconcile().wanted).toBe(true);    // A got the reconcile
    expect(session.mirror.consumeReconcile().wanted).toBe(false);  // B untouched
  });

  it('scrub() schedules on the passed session lane and reconciles it', async () => {
    const a = makeReadySession({ info: {}, hardware: {} } as never);
    a.mirror.consumeReconcile();
    session.mirror.consumeReconcile();
    scrub(a, 'k1', () => {}, async () => {});
    await flushAllWrites(a);                                  // drains A's lane
    expect(a.mirror.consumeReconcile().wanted).toBe(true);
    expect(session.mirror.consumeReconcile().wanted).toBe(false);
  });
});
