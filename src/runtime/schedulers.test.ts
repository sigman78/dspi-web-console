import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeResyncScheduler } from './schedulers';

describe('makeResyncScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires resync once after the trailing-edge window', async () => {
    const resync = vi.fn().mockResolvedValue(undefined);
    const s = makeResyncScheduler(resync, 100);

    s.schedule();
    await vi.advanceTimersByTimeAsync(99);
    expect(resync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('extends the timer if schedule() is called again within the window', async () => {
    const resync = vi.fn().mockResolvedValue(undefined);
    const s = makeResyncScheduler(resync, 100);

    s.schedule();
    await vi.advanceTimersByTimeAsync(50);
    s.schedule();
    await vi.advanceTimersByTimeAsync(99);
    expect(resync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('cancel() clears a pending schedule', async () => {
    const resync = vi.fn().mockResolvedValue(undefined);
    const s = makeResyncScheduler(resync, 100);

    s.schedule();
    s.cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(resync).not.toHaveBeenCalled();
  });

  it('survives a rejected resync and can be scheduled again', async () => {
    const resync = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const s = makeResyncScheduler(resync, 50);

    s.schedule();
    await vi.advanceTimersByTimeAsync(60);
    await vi.runAllTimersAsync();
    expect(resync).toHaveBeenCalledTimes(1);

    s.schedule();
    await vi.advanceTimersByTimeAsync(60);
    expect(resync).toHaveBeenCalledTimes(2);
  });
});
