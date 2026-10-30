import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Writes from './writes.svelte';
import * as State from '@/state';
import type { ReadySession } from '@/state';
import { Result } from '@/utils';
import { RemoteRefused } from '@/transport/remote/errors';

// Install a ready session so writes resolve activeSession() and its
// WriteCoordinator/alive guard. Disposing it (or resetting app state)
// simulates a disconnect mid-flight.
let session: ReadySession;
function installSession(): void {
  session = State.makeReadySession({ info: {}, hardware: {} } as never);
  State.dispatch({ t: 'synced', id: State.mintConnId(), session });
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
    await Writes.write(session, send, mutate);
    expect(order).toEqual(['send', 'mutate']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('requests a non-eager reconcile on success', async () => {
    State.activeSession()!.mirror.consumeReconcile();  // clear any prior pending
    await Writes.write(session, async () => {}, () => {});
    const { wanted, eager } = State.activeSession()!.mirror.consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(false);
  });

  it('requests an eager reconcile when send fails (failure-path recovery)', async () => {
    const s = State.activeSession()!;
    s.mirror.consumeReconcile();
    await Writes.write(session, async () => { throw new Error('boom'); }, () => {});
    expect(s.mirror.consumeReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('claims writes.busy during send and releases it after settle', async () => {
    let busyDuringSend = false;
    const send = vi.fn(async () => {
      busyDuringSend = State.activeSession()!.writes.busy;
    });
    await Writes.write(session, send, () => {});
    expect(busyDuringSend).toBe(true);
    expect(State.activeSession()!.writes.busy).toBe(false);
  });

  it('does not mutate when send rejects', async () => {
    const s = State.activeSession()!;
    const mutate = vi.fn();
    const send = vi.fn(async () => { throw new Error('boom'); });
    await Writes.write(session, send, mutate);
    expect(mutate).not.toHaveBeenCalled();
    expect(s.writes.busy).toBe(false);
  });

  it('does not mutate when generation changes mid-flight', async () => {
    const mutate = vi.fn();
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const s = State.activeSession()!;
    const p = Writes.write(session, send, mutate);
    s.dispose();  // simulate disconnect mid-flight
    resolveSend!();
    await p;
    expect(mutate).not.toHaveBeenCalled();
    expect(s.writes.busy).toBe(false);
  });

  it('does not request a reconcile on failure if generation changed', async () => {
    const s = State.activeSession()!;
    s.mirror.consumeReconcile();
    let resolveSend!: (err: Error) => void;
    const send = vi.fn(() => new Promise<void>((_, reject) => { resolveSend = (e) => reject(e); }));
    const p = Writes.write(session, send, () => {});
    State.activeSession()?.dispose();
    resolveSend!(new Error('boom'));
    await p;
    expect(s.mirror.peekReconcile().wanted).toBe(false);
  });

  it('requests an eager reconcile on failure when generation unchanged', async () => {
    const s = State.activeSession()!;
    s.mirror.consumeReconcile();
    const send = vi.fn(async () => { throw new Error('boom'); });
    await Writes.write(session, send, () => {});
    expect(s.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });
});

describe('write() failure policy', () => {
  beforeEach(() => {
    installSession();
    State.clearNotices();
    vi.clearAllMocks();
  });

  it('a failed write stays connected, reports health, toasts, and requests an eager reconcile', async () => {
    session.mirror.consumeReconcile();
    await Writes.write(session, async () => { throw new Error('boom'); }, () => {});
    expect(State.connection.connected).toBe(true);
    expect(session.health.failTotal).toBe(1);
    expect(State.notices.list.some((n) => n.kind === 'error')).toBe(true);
    expect(session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('a write that fails into degraded neither toasts nor requests a reconcile', async () => {
    session.health.noteFail('write', new Error('x'));
    session.health.noteFail('write', new Error('x'));
    session.mirror.consumeReconcile();
    await Writes.write(session, async () => { throw new Error('boom'); }, () => {});
    expect(session.health.degraded).toBe(true);
    expect(State.notices.list.length).toBe(0);
    expect(session.mirror.peekReconcile().wanted).toBe(false);
  });

  it('refusals by the host console are toasted and reverted but never degrade the link', async () => {
    for (let i = 0; i < 3; i++) {
      session.mirror.consumeReconcile();
      await Writes.write(session, async () => { throw new RemoteRefused('no'); }, () => {});
      expect(session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    }
    await Writes.command(session, 'op', async () => { throw new RemoteRefused('no'); }, () => {});
    await Writes.writeChecked(session, 'op', async () => { throw new RemoteRefused('no'); }, () => {});
    expect(session.health.degraded).toBe(false);
    expect(session.health.failTotal).toBe(0);
    expect(State.notices.list.length).toBeGreaterThan(0);
    expect(State.notices.list.every((n) => n.kind === 'warn')).toBe(true);
  });

  it('a refused scrub is toasted and reverted without touching link health', async () => {
    for (let i = 0; i < 3; i++) {
      session.mirror.consumeReconcile();
      Writes.scrub(session, 'k', () => {}, async () => { throw new RemoteRefused('no'); });
      await Writes.flushAllWrites(session);
      expect(session.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    }
    expect(session.health.degraded).toBe(false);
    expect(session.health.failTotal).toBe(0);
    expect(State.notices.list.some((n) => n.kind === 'warn')).toBe(true);
  });

  it('while degraded, writes are refused unsent and silently', async () => {
    State.clearNotices();
    session.health.degraded = true;
    const send = vi.fn(async () => {});
    const mutate = vi.fn();
    expect(await Writes.write(session, send, mutate)).toBe(false);
    expect(await Writes.write(session, send, mutate)).toBe(false);
    Writes.scrub(session, 'k', mutate, send);
    expect(await Writes.writeChecked(session, 'op', async () => Result.ok(undefined), mutate)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(State.notices.list).toHaveLength(0);

    session.health.noteRecovered();
    expect(await Writes.write(session, send, mutate)).toBe(true);
  });

  it('a failed command reports health and stays connected', async () => {
    await Writes.command(session, 'set thing', async () => { throw new Error('boom'); }, () => {});
    expect(session.health.failTotal).toBe(1);
    expect(State.connection.connected).toBe(true);
  });
});

describe('writeChecked() helper', () => {
  beforeEach(() => {
    installSession();
    State.activeSession()!.mirror.consumeReconcile();
    State.clearNotices();
    vi.clearAllMocks();
  });

  it('patches and requests a non-eager reconcile on an ok Result', async () => {
    const patch = vi.fn();
    await Writes.writeChecked(session, 'op', async () => Result.ok(), patch);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(State.activeSession()!.mirror.consumeReconcile()).toEqual({ wanted: true, eager: false });
  });

  it('warns with the device message and skips the patch on a non-ok Result', async () => {
    const patch = vi.fn();
    await Writes.writeChecked(session, 'set pin', async () => Result.fail('x', 'GPIO pin already in use'), patch);
    expect(patch).not.toHaveBeenCalled();
    expect(State.notices.list).toHaveLength(1);
    expect(State.notices.list[0].kind).toBe('warn');
    expect(State.notices.list[0].message).toContain('in use');
  });

  it('treats a rejection as local — no reconcile request, no status change', async () => {
    await Writes.writeChecked(session, 'set pin', async () => Result.fail('x', 'rejected'), () => {});
    expect(State.activeSession()!.mirror.peekReconcile().wanted).toBe(false);
    expect(State.connection.connected).toBe(true);
  });

  it('error-toasts a transport throw without requesting a reconcile', async () => {
    await Writes.writeChecked(session, 'set pin', async () => { throw new Error('stall'); }, () => {});
    expect(State.notices.list).toHaveLength(1);
    expect(State.notices.list[0].kind).toBe('error');
    expect(State.activeSession()!.mirror.peekReconcile().wanted).toBe(false);
    expect(State.connection.connected).toBe(true);
  });

  it('does not patch when generation changes mid-flight', async () => {
    const patch = vi.fn();
    let resolveSend!: (r: Result<void, string>) => void;
    const send = vi.fn(() => new Promise<Result<void, string>>((res) => { resolveSend = res; }));
    const p = Writes.writeChecked(session, 'op', send, patch);
    State.activeSession()?.dispose();  // simulate disconnect mid-flight
    resolveSend!(Result.ok());
    await p;
    expect(patch).not.toHaveBeenCalled();
  });

  it('is drained by flushAllWrites', async () => {
    const patch = vi.fn();
    let resolveSend!: (r: Result<void, string>) => void;
    const send = vi.fn(() => new Promise<Result<void, string>>((res) => { resolveSend = res; }));
    void Writes.writeChecked(session, 'op', send, patch);
    const flushed = Writes.flushAllWrites(session);
    resolveSend!(Result.ok());
    await flushed;
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

describe('command() helper', () => {
  beforeEach(() => {
    installSession();
    State.clearNotices();
    vi.clearAllMocks();
  });

  it('runs onSettled with the resolved value on success', async () => {
    const onSettled = vi.fn();
    await Writes.command(session, 'op', async () => 42, onSettled);
    expect(onSettled).toHaveBeenCalledWith(42, State.activeSession()!);
  });

  it('drops onSettled and emits no toast when generation changes mid-flight', async () => {
    const onSettled = vi.fn();
    let resolve!: (v: number) => void;
    const p = Writes.command(session, 'op', () => new Promise<number>((r) => { resolve = r; }), onSettled);
    State.activeSession()?.dispose();  // simulate disconnect+reconnect mid-flight
    resolve!(1);
    await p;
    expect(onSettled).not.toHaveBeenCalled();
    expect(State.notices.list).toHaveLength(0);
  });

  it('error-toasts a throw without flipping connection status', async () => {
    await Writes.command(session, 'save', async () => { throw new Error('boom'); }, () => {});
    expect(State.notices.list).toHaveLength(1);
    expect(State.notices.list[0].kind).toBe('error');
    expect(State.connection.connected).toBe(true);
  });

  it('is drained by flushAllWrites', async () => {
    const onSettled = vi.fn();
    let resolve!: (v: number) => void;
    void Writes.command(session, 'op', () => new Promise<number>((r) => { resolve = r; }), onSettled);
    const flushed = Writes.flushAllWrites(session);
    resolve!(7);
    await flushed;
    expect(onSettled).toHaveBeenCalledWith(7, State.activeSession()!);
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
    Writes.scrub(session, 'k1', mutate, send);
    expect(mutate).toHaveBeenCalledTimes(1);   // synchronous, before any send settles
    await Writes.flushAllWrites(session);
  });

  it('sends immediately when the lane is idle', () => {
    const send = vi.fn(async () => {});
    Writes.scrub(session, 'k1', () => {}, send);
    expect(send).toHaveBeenCalledTimes(1);     // no coalesce timer in front
  });

  it('coalesces to the latest value while a send is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sends: number[] = [];
    Writes.scrub(session, 'k1', () => {}, async () => { sends.push(1); await gate; });
    Writes.scrub(session, 'k1', () => {}, async () => { sends.push(2); });
    Writes.scrub(session, 'k1', () => {}, async () => { sends.push(3); });
    release();
    await Writes.flushAllWrites(session);
    expect(sends).toEqual([1, 3]);             // 2 was replaced before the wire freed up
  });

  it('different keys do not coalesce', async () => {
    const sendA = vi.fn(async () => {});
    const sendB = vi.fn(async () => {});
    Writes.scrub(session, 'keyA', () => {}, sendA);
    Writes.scrub(session, 'keyB', () => {}, sendB);
    await Writes.flushAllWrites(session);
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a parked send without firing it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const parked = vi.fn(async () => {});
    Writes.scrub(session, 'k1', () => {}, async () => { await gate; });
    Writes.scrub(session, 'k1', () => {}, parked);    // parked behind the in-flight send
    session.writes.cancel();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(parked).not.toHaveBeenCalled();
    expect(session.writes.busy).toBe(false);
  });

  it('claims writes.busy once for a burst and releases it when the lane drains', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    Writes.scrub(session, 'k1', () => {}, async () => { await gate; });
    Writes.scrub(session, 'k1', () => {}, async () => {});
    expect(session.writes.busy).toBe(true);
    release();
    await Writes.flushAllWrites(session);
    expect(session.writes.busy).toBe(false);
  });

  it('cancel clears writes.busy', () => {
    Writes.scrub(session, 'k1', () => {}, async () => {});
    Writes.scrub(session, 'k2', () => {}, async () => {});
    expect(State.activeSession()!.writes.busy).toBe(true);
    session.writes.cancel();
    expect(State.activeSession()!.writes.busy).toBe(false);
  });

  it('on send failure: requests an eager reconcile, lane recovers', async () => {
    State.activeSession()!.mirror.consumeReconcile();
    const send = vi.fn(async () => { throw new Error('boom'); });
    Writes.scrub(session, 'k1', () => {}, send);
    await Writes.flushAllWrites(session);
    expect(State.activeSession()!.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('on send success: does not request an eager reconcile (case A — mirror already holds sent value)', async () => {
    State.activeSession()!.mirror.consumeReconcile();
    const send = vi.fn(async () => {});
    Writes.scrub(session, 'k1', () => {}, send);
    await Writes.flushAllWrites(session);
    expect(State.activeSession()!.mirror.peekReconcile().eager).toBe(false);
  });

  it('on send success: requests a non-eager reconcile', async () => {
    State.activeSession()!.mirror.consumeReconcile();
    Writes.scrub(session, 'k1', () => {}, async () => {});
    await Writes.flushAllWrites(session);
    const { wanted, eager } = State.activeSession()!.mirror.consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(false);
  });

  it('on send failure: requests an eager reconcile (not merely non-eager)', async () => {
    const s = State.activeSession()!;
    s.mirror.consumeReconcile();
    Writes.scrub(session, 'k1', () => {}, async () => { throw new Error('boom'); });
    await Writes.flushAllWrites(session);
    expect(s.mirror.consumeReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('stale-gen settle does not request a reconcile', async () => {
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    Writes.scrub(session, 'k1', () => {}, send);
    // Wait for timer to fire (coalesce window) so send starts
    await new Promise((r) => setTimeout(r, 25));
    const s = State.activeSession()!;
    s.mirror.consumeReconcile();
    s.dispose();  // simulate disconnect mid-send
    resolveSend!();
    await Writes.flushAllWrites(session);
    expect(s.mirror.peekReconcile().wanted).toBe(false);
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
    void Writes.write(session, send, mutate);
    // The write is in flight. flushAllWrites must wait for it.
    let flushed = false;
    const flushP = Writes.flushAllWrites(session).then(() => { flushed = true; });
    // Yield once: flush should NOT have resolved yet
    await Promise.resolve();
    expect(flushed).toBe(false);
    // Settle the send
    resolveSend!();
    await flushP;
    expect(flushed).toBe(true);
    expect(mutated).toBe(true);
  });

  it('writes.busy is true during a write() in flight', async () => {
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    void Writes.write(session, send, () => {});
    expect(State.activeSession()!.writes.busy).toBe(true);
    resolveSend!();
    await Writes.flushAllWrites(session);
    expect(State.activeSession()!.writes.busy).toBe(false);
  });
});

// The write lanes must track busy / alive / reconcile on the session they
// are GIVEN, not on whichever session happens to be active when the send
// settles. The send/mutate closures target the passed session; if lifecycle
// attached to the active session instead, a reconnect (or a second device)
// would route A's bookkeeping onto B.
describe('write lanes are scoped to the passed session, not the active one', () => {
  beforeEach(() => {
    installSession();           // session B is the active one
    vi.clearAllMocks();
  });

  it('write() claims writes.busy and requests reconcile on the passed session', async () => {
    const a = State.makeReadySession({ info: {}, hardware: {} } as never);  // not active
    a.mirror.consumeReconcile();
    session.mirror.consumeReconcile();
    let busyDuringSend = false;
    await Writes.write(a, async () => { busyDuringSend = a.writes.busy; }, () => {});
    expect(busyDuringSend).toBe(true);                        // A's coordinator, not B's
    expect(a.mirror.consumeReconcile().wanted).toBe(true);    // A got the reconcile
    expect(session.mirror.consumeReconcile().wanted).toBe(false);  // B untouched
  });

  it('scrub() schedules on the passed session lane and reconciles it', async () => {
    const a = State.makeReadySession({ info: {}, hardware: {} } as never);
    a.mirror.consumeReconcile();
    session.mirror.consumeReconcile();
    Writes.scrub(a, 'k1', () => {}, async () => {});
    await Writes.flushAllWrites(a);                                  // drains A's lane
    expect(a.mirror.consumeReconcile().wanted).toBe(true);
    expect(session.mirror.consumeReconcile().wanted).toBe(false);
  });
});
