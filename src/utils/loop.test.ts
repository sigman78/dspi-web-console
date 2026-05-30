import { describe, it, expect, vi, afterEach } from 'vitest';
import { timerClock, subscribeVisibility } from './loop';

describe('timerClock', () => {
  afterEach(() => vi.useRealTimers());

  it('arms a callback after the default cadence', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    timerClock(100).next(cb);
    vi.advanceTimersByTime(99);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second next() cancels the prior pending callback', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const c = timerClock(100);
    c.next(first);
    c.next(second);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('honors a per-arm delayMs override', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    timerClock(100).next(cb, 500);
    vi.advanceTimersByTime(100);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops a pending callback', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const c = timerClock(100);
    c.next(cb);
    c.cancel();
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('subscribeVisibility', () => {
  const setHidden = (v: boolean) => Object.defineProperty(document, 'hidden', { value: v, configurable: true });
  afterEach(() => setHidden(false));

  it('routes visibility transitions to onShow/onHide and unsubscribes on dispose', () => {
    const onShow = vi.fn();
    const onHide = vi.fn();
    const off = subscribeVisibility(onShow, onHide);

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onShow).not.toHaveBeenCalled();

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onShow).toHaveBeenCalledTimes(1);

    off();
    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onHide).toHaveBeenCalledTimes(1);   // no further calls after dispose
  });
});
