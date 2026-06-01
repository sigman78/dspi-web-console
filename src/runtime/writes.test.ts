import { describe, it, expect, beforeEach, vi } from 'vitest';
import { write, scrub, writeChecked, command, flushAllWrites, cancelAllWrites } from './writes';
import { inflight, dropInflight, consumeReconcile, lastWriteMs } from '@/state/mirror.svelte';
import { session, settings, notices, clearNotices } from '@/state';
import { Result } from '@/utils';

// Mock the resync module so write() failures don't actually fire HTTP.
vi.mock('@/runtime/resync', () => ({
  forceResyncNow: vi.fn(),
}));

describe('write() helper', () => {
  beforeEach(() => {
    while (inflight.current > 0) dropInflight();
    session.generation = 0;
    vi.clearAllMocks();
  });

  it('awaits send, then mutates on success', async () => {
    const order: string[] = [];
    const send = vi.fn(async () => { order.push('send'); });
    const mutate = vi.fn(() => { order.push('mutate'); });
    await write(send, mutate);
    expect(order).toEqual(['send', 'mutate']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('requests a reconcile on success (non-eager when flag off)', async () => {
    settings.eagerReconcile = false;
    consumeReconcile();  // clear any prior pending
    await write(async () => {}, () => {});
    const { wanted, eager } = consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(false);
  });

  it('requests an eager reconcile on success when flag on', async () => {
    settings.eagerReconcile = true;
    consumeReconcile();
    await write(async () => {}, () => {});
    const { wanted, eager } = consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(true);
    settings.eagerReconcile = false;
  });

  it('does not request a reconcile when send fails', async () => {
    consumeReconcile();
    await write(async () => { throw new Error('boom'); }, () => {});
    const { wanted } = consumeReconcile();
    expect(wanted).toBe(false);
  });

  it('stamps write activity when called', async () => {
    const before = lastWriteMs();
    await write(async () => {}, () => {});
    expect(lastWriteMs()).toBeGreaterThanOrEqual(before);
    expect(lastWriteMs()).toBeGreaterThan(0);
  });

  it('bumps inflight during send and drops after settle', async () => {
    let inflightDuringSend = -1;
    const send = vi.fn(async () => {
      inflightDuringSend = inflight.current;
    });
    await write(send, () => {});
    expect(inflightDuringSend).toBe(1);
    expect(inflight.current).toBe(0);
  });

  it('does not mutate when send rejects', async () => {
    const mutate = vi.fn();
    const send = vi.fn(async () => { throw new Error('boom'); });
    await write(send, mutate);
    expect(mutate).not.toHaveBeenCalled();
    expect(inflight.current).toBe(0);
  });

  it('does not mutate when generation changes mid-flight', async () => {
    const mutate = vi.fn();
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const p = write(send, mutate);
    session.generation += 1;  // simulate disconnect mid-flight
    resolveSend!();
    await p;
    expect(mutate).not.toHaveBeenCalled();
    expect(inflight.current).toBe(0);
  });

  it('does not call forceResyncNow on failure if generation changed', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    let resolveSend!: (err: Error) => void;
    const send = vi.fn(() => new Promise<void>((_, reject) => { resolveSend = (e) => reject(e); }));
    const p = write(send, () => {});
    session.generation += 1;
    resolveSend!(new Error('boom'));
    await p;
    expect(forceResyncNow).not.toHaveBeenCalled();
  });

  it('calls forceResyncNow on failure when generation unchanged', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    const send = vi.fn(async () => { throw new Error('boom'); });
    await write(send, () => {});
    expect(forceResyncNow).toHaveBeenCalled();
  });
});

describe('writeChecked() helper', () => {
  beforeEach(() => {
    while (inflight.current > 0) dropInflight();
    session.generation = 0;
    session.status = 'connected';
    settings.eagerReconcile = false;
    consumeReconcile();
    clearNotices();
    vi.clearAllMocks();
  });

  it('patches and requests a non-eager reconcile on an ok Result (eagerReconcile off)', async () => {
    const patch = vi.fn();
    await writeChecked('op', async () => Result.ok(), patch);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(consumeReconcile()).toEqual({ wanted: true, eager: false });
  });

  it('honors settings.eagerReconcile=true on an ok Result', async () => {
    settings.eagerReconcile = true;
    await writeChecked('op', async () => Result.ok(), () => {});
    expect(consumeReconcile()).toEqual({ wanted: true, eager: true });
  });

  it('warns with the device message and skips the patch on a non-ok Result', async () => {
    const patch = vi.fn();
    await writeChecked('set pin', async () => Result.fail('x', 'GPIO pin already in use'), patch);
    expect(patch).not.toHaveBeenCalled();
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].kind).toBe('warn');
    expect(notices.list[0].message).toContain('in use');
  });

  it('treats a rejection as local — no resync, no status change', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    await writeChecked('set pin', async () => Result.fail('x', 'rejected'), () => {});
    expect(forceResyncNow).not.toHaveBeenCalled();
    expect(session.status).toBe('connected');
  });

  it('error-toasts a transport throw without resyncing', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    await writeChecked('set pin', async () => { throw new Error('stall'); }, () => {});
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].kind).toBe('error');
    expect(forceResyncNow).not.toHaveBeenCalled();
    expect(session.status).toBe('connected');
  });

  it('does not patch when generation changes mid-flight', async () => {
    const patch = vi.fn();
    let resolveSend!: (r: Result<void, string>) => void;
    const send = vi.fn(() => new Promise<Result<void, string>>((res) => { resolveSend = res; }));
    const p = writeChecked('op', send, patch);
    session.generation += 1;  // simulate disconnect mid-flight
    resolveSend!(Result.ok());
    await p;
    expect(patch).not.toHaveBeenCalled();
  });

  it('is drained by flushAllWrites', async () => {
    const patch = vi.fn();
    let resolveSend!: (r: Result<void, string>) => void;
    const send = vi.fn(() => new Promise<Result<void, string>>((res) => { resolveSend = res; }));
    void writeChecked('op', send, patch);
    const flushed = flushAllWrites();
    resolveSend!(Result.ok());
    await flushed;
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

describe('command() helper', () => {
  beforeEach(() => {
    while (inflight.current > 0) dropInflight();
    session.generation = 0;
    session.status = 'connected';
    clearNotices();
    vi.clearAllMocks();
  });

  it('runs onSettled with the resolved value on success', async () => {
    const onSettled = vi.fn();
    await command('op', async () => 42, onSettled);
    expect(onSettled).toHaveBeenCalledWith(42);
  });

  it('drops onSettled and emits no toast when generation changes mid-flight', async () => {
    const onSettled = vi.fn();
    let resolve!: (v: number) => void;
    const p = command('op', () => new Promise<number>((r) => { resolve = r; }), onSettled);
    session.generation += 1;  // simulate disconnect+reconnect mid-flight
    resolve!(1);
    await p;
    expect(onSettled).not.toHaveBeenCalled();
    expect(notices.list).toHaveLength(0);
  });

  it('error-toasts a throw without flipping connection status', async () => {
    await command('save', async () => { throw new Error('boom'); }, () => {});
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].kind).toBe('error');
    expect(session.status).toBe('connected');
  });

  it('is drained by flushAllWrites', async () => {
    const onSettled = vi.fn();
    let resolve!: (v: number) => void;
    void command('op', () => new Promise<number>((r) => { resolve = r; }), onSettled);
    const flushed = flushAllWrites();
    resolve!(7);
    await flushed;
    expect(onSettled).toHaveBeenCalledWith(7);
  });
});

describe('scrub() helper', () => {
  beforeEach(() => {
    while (inflight.current > 0) dropInflight();
    session.generation = 0;
    vi.clearAllMocks();
    cancelAllWrites();  // ensure no leftover lane state between tests
  });

  it('mutates immediately (optimistic)', async () => {
    const mutate = vi.fn();
    const send = vi.fn(async () => {});
    scrub('k1', mutate, send);
    expect(mutate).toHaveBeenCalledTimes(1);   // BEFORE the timer fires
    await flushAllWrites();
  });

  it('stamps write activity on the call (before any send settles)', async () => {
    const before = lastWriteMs();
    scrub('k1', () => {}, async () => {});
    expect(lastWriteMs()).toBeGreaterThan(0);
    expect(lastWriteMs()).toBeGreaterThanOrEqual(before);
    await flushAllWrites();
  });

  it('coalesces rapid calls to one send per key', async () => {
    const send = vi.fn(async () => {});
    scrub('k1', () => {}, send);
    scrub('k1', () => {}, send);
    scrub('k1', () => {}, send);
    await flushAllWrites();
    expect(send).toHaveBeenCalledTimes(1);     // latest wins
  });

  it('different keys do not coalesce', async () => {
    const sendA = vi.fn(async () => {});
    const sendB = vi.fn(async () => {});
    scrub('keyA', () => {}, sendA);
    scrub('keyB', () => {}, sendB);
    await flushAllWrites();
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).toHaveBeenCalledTimes(1);
  });

  it('cancelAllWrites cancels pending sends', async () => {
    const send = vi.fn(async () => {});
    scrub('k1', () => {}, send);
    cancelAllWrites();
    // Timer cancelled; send must not fire even after wait
    await new Promise((r) => setTimeout(r, 30));
    expect(send).not.toHaveBeenCalled();
  });

  it('cancelAllWrites resets inflight to 0', () => {
    scrub('k1', () => {}, async () => {});
    scrub('k2', () => {}, async () => {});
    expect(inflight.current).toBeGreaterThan(0);
    cancelAllWrites();
    expect(inflight.current).toBe(0);
  });

  it('on send failure: forceResyncNow called, lane recovers', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    const send = vi.fn(async () => { throw new Error('boom'); });
    scrub('k1', () => {}, send);
    await flushAllWrites();
    expect(forceResyncNow).toHaveBeenCalled();
  });

  it('on send success: does NOT resync (case A — mirror already holds sent value)', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    const send = vi.fn(async () => {});
    scrub('k1', () => {}, send);
    await flushAllWrites();
    expect(forceResyncNow).not.toHaveBeenCalled();
  });

  it('on send success: requests a reconcile (eager per flag)', async () => {
    settings.eagerReconcile = true;
    consumeReconcile();
    scrub('k1', () => {}, async () => {});
    await flushAllWrites();
    const { wanted, eager } = consumeReconcile();
    expect(wanted).toBe(true);
    expect(eager).toBe(true);
    settings.eagerReconcile = false;
  });

  it('on send failure: does not request a reconcile', async () => {
    consumeReconcile();
    scrub('k1', () => {}, async () => { throw new Error('boom'); });
    await flushAllWrites();
    const { wanted } = consumeReconcile();
    expect(wanted).toBe(false);
  });

  it('stale-gen settle does not call forceResyncNow', async () => {
    const { forceResyncNow } = await import('@/runtime/resync');
    vi.clearAllMocks();
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    scrub('k1', () => {}, send);
    // Wait for timer to fire (coalesce window) so send starts
    await new Promise((r) => setTimeout(r, 25));
    session.generation += 1;  // simulate disconnect mid-send
    resolveSend!();
    await flushAllWrites();
    expect(forceResyncNow).not.toHaveBeenCalled();
  });
});

describe('flushAllWrites covers write() calls', () => {
  beforeEach(() => {
    while (inflight.current > 0) dropInflight();
    session.generation = 0;
    cancelAllWrites();
  });

  it('flushAllWrites awaits in-flight write() before resolving', async () => {
    let resolveSend!: () => void;
    let mutated = false;
    const send = vi.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    const mutate = vi.fn(() => { mutated = true; });
    void write(send, mutate);
    // The write is in flight. flushAllWrites must wait for it.
    let flushed = false;
    const flushP = flushAllWrites().then(() => { flushed = true; });
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
    void write(send, () => {});
    expect(inflight.current).toBe(1);
    resolveSend!();
    await flushAllWrites();
    expect(inflight.current).toBe(0);
  });
});
