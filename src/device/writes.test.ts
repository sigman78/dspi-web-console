import { describe, it, expect, beforeEach, vi } from 'vitest';
import { write } from './writes';
import * as mirror from './mirror.svelte';
import { session } from '@/state';

// Mock the resync module so write() failures don't actually fire HTTP.
vi.mock('@/runtime/resync', () => ({
  scheduleResync: vi.fn(),
  forceResyncNow: vi.fn(),
  cancelResync: vi.fn(),
}));

describe('write() helper', () => {
  beforeEach(() => {
    while (mirror.inflight.current > 0) mirror.dropInflight();
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

  it('bumps inflight during send and drops after settle', async () => {
    let inflightDuringSend = -1;
    const send = vi.fn(async () => {
      inflightDuringSend = mirror.inflight.current;
    });
    await write(send, () => {});
    expect(inflightDuringSend).toBe(1);
    expect(mirror.inflight.current).toBe(0);
  });

  it('does not mutate when send rejects', async () => {
    const mutate = vi.fn();
    const send = vi.fn(async () => { throw new Error('boom'); });
    await write(send, mutate);
    expect(mutate).not.toHaveBeenCalled();
    expect(mirror.inflight.current).toBe(0);
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
    expect(mirror.inflight.current).toBe(0);
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
