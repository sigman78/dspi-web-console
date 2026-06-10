import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotifyWaiters } from './notifyWaiters';
import type { NotifyEvent } from '@/protocol';

const loaded = (slot: number): NotifyEvent => ({ kind: 'presetLoaded', seq: 1, slot });

describe('NotifyWaiters', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves a waiter with the matching event', async () => {
    const w = new NotifyWaiters();
    const p = w.waitFor((e) => e.kind === 'presetLoaded' && e.slot === 3, 1000);
    w.notify(loaded(3));
    await expect(p).resolves.toEqual(loaded(3));
  });

  it('ignores non-matching events and keeps waiting', async () => {
    const w = new NotifyWaiters();
    const p = w.waitFor((e) => e.kind === 'presetLoaded' && e.slot === 3, 1000);
    w.notify(loaded(7));
    w.notify(loaded(3));
    await expect(p).resolves.toEqual(loaded(3));
  });

  it('resolves null on timeout and removes the waiter', async () => {
    const w = new NotifyWaiters();
    const p = w.waitFor(() => true, 500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeNull();
    expect(w.pending()).toBe(false);
  });

  it('an event resolves every matching waiter, not just the first', async () => {
    const w = new NotifyWaiters();
    const p1 = w.waitFor((e) => e.kind === 'presetLoaded', 1000);
    const p2 = w.waitFor((e) => e.kind === 'presetLoaded', 1000);
    w.notify(loaded(0));
    await expect(p1).resolves.toEqual(loaded(0));
    await expect(p2).resolves.toEqual(loaded(0));
  });

  it('cancelAll resolves outstanding waiters with null', async () => {
    const w = new NotifyWaiters();
    const p = w.waitFor(() => true, 60_000);
    w.cancelAll();
    await expect(p).resolves.toBeNull();
    expect(w.pending()).toBe(false);
  });

  it('kicks the pump when a waiter registers', () => {
    const w = new NotifyWaiters();
    const kick = vi.fn();
    w.setKick(kick);
    void w.waitFor(() => true, 100);
    expect(kick).toHaveBeenCalledTimes(1);
  });
});
