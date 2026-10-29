import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createFxLoop } from './loop';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('createFxLoop', () => {
  beforeEach(() => { vi.useFakeTimers(); setHidden(false); });
  afterEach(() => { vi.useRealTimers(); setHidden(false); });

  test('runs frames until stopped', () => {
    const frame = vi.fn();
    const loop = createFxLoop({ frame });
    loop.start();
    vi.advanceTimersByTime(100);
    const n = frame.mock.calls.length;
    expect(n).toBeGreaterThan(3);
    loop.stop();
    vi.advanceTimersByTime(100);
    expect(frame).toHaveBeenCalledTimes(n);
    loop.dispose();
  });

  test('pauses while the tab is hidden and resumes when shown', () => {
    const frame = vi.fn();
    const loop = createFxLoop({ frame });
    loop.start();
    vi.advanceTimersByTime(50);
    setHidden(true);
    const n = frame.mock.calls.length;
    vi.advanceTimersByTime(200);
    expect(frame).toHaveBeenCalledTimes(n);
    setHidden(false);
    vi.advanceTimersByTime(50);
    expect(frame.mock.calls.length).toBeGreaterThan(n);
    loop.dispose();
  });

  test('throttles to the reduced rate under reduced motion', () => {
    const frame = vi.fn();
    const loop = createFxLoop({ frame, reducedMotion: () => true, reducedGapMs: 250 });
    loop.start();
    vi.advanceTimersByTime(1000);
    expect(frame.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(frame.mock.calls.length).toBeLessThanOrEqual(5);
    loop.dispose();
  });

  test('does not start while hidden', () => {
    setHidden(true);
    const frame = vi.fn();
    const loop = createFxLoop({ frame });
    loop.start();
    vi.advanceTimersByTime(100);
    expect(frame).not.toHaveBeenCalled();
    loop.dispose();
  });
});
