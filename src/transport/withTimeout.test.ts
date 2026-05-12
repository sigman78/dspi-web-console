import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from './withTimeout';
import type { DspTransport } from './DspTransport';

function makeNeverTransport(): DspTransport {
  return {
    open:    async () => {},
    close:   async () => {},
    isOpen:  () => true,
    on:      () => () => {},
    ctrlIn:  () => new Promise(() => {}) as Promise<Uint8Array>,
    ctrlOut: () => new Promise(() => {}) as Promise<void>,
  };
}

function makeFastTransport(): DspTransport {
  return {
    open:    async () => {},
    close:   async () => {},
    isOpen:  () => true,
    on:      () => () => {},
    ctrlIn:  async () => new Uint8Array([1, 2, 3]),
    ctrlOut: async () => {},
  };
}

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects ctrlIn with TimeoutError when transfer never resolves', async () => {
    const t = withTimeout(makeNeverTransport(), { ctrlMs: 50 });
    const promise = t.ctrlIn(0x10, 0, 4);
    // Catch the rejection synchronously to avoid an unhandled rejection
    // warning while the timer advances.
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    const err = await settled;
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).name).toBe('DspTimeoutError');
  });

  it('rejects ctrlOut with TimeoutError when transfer never resolves', async () => {
    const t = withTimeout(makeNeverTransport(), { ctrlMs: 50 });
    const promise = t.ctrlOut(0x20, 0, new Uint8Array([1]));
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    const err = await settled;
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('passes through fast calls and clears the timer', async () => {
    const t = withTimeout(makeFastTransport(), { ctrlMs: 1000 });
    const r = await t.ctrlIn(0x10, 0, 4);
    expect(r).toEqual(new Uint8Array([1, 2, 3]));
    // No pending timer means advancing the clock does nothing observable.
    await vi.advanceTimersByTimeAsync(2000);
  });

  it('passes through open/close/isOpen/on', async () => {
    let opened = 0;
    let closed = 0;
    let listenerCalls = 0;
    const inner: DspTransport = {
      open:    async () => { opened++; },
      close:   async () => { closed++; },
      isOpen:  () => true,
      on:      (_e, _l) => { listenerCalls++; return () => {}; },
      ctrlIn:  async () => new Uint8Array(),
      ctrlOut: async () => {},
    };
    const t = withTimeout(inner, { ctrlMs: 1000 });
    await t.open();
    await t.close();
    expect(t.isOpen()).toBe(true);
    t.on('connect', () => {});
    expect(opened).toBe(1);
    expect(closed).toBe(1);
    expect(listenerCalls).toBe(1);
  });
});
