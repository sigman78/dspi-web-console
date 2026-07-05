import { describe, it, expect } from 'vitest';
import { withSerializedCtrl } from './withSerializedCtrl';
import type { DspTransport } from './DspTransport';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Drains the microtask queue via a macrotask boundary, so assertions about
// "has this queued op started yet" don't depend on counting .then() hops.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeControllableTransport() {
  const order: string[] = [];
  const pending = new Map<string, Deferred<Uint8Array>>();

  const t: DspTransport = {
    open:    async () => {},
    close:   async () => {},
    isOpen:  () => true,
    on:      () => () => {},
    ctrlIn:  (request) => {
      const key = `ctrlIn:${request}`;
      order.push(`start:${key}`);
      const d = defer<Uint8Array>();
      pending.set(key, d);
      return d.promise.then((v) => { order.push(`end:${key}`); return v; });
    },
    ctrlOut: async () => {},
  };

  return {
    t, order,
    settle: (request: number, value: Uint8Array = new Uint8Array()) => pending.get(`ctrlIn:${request}`)!.resolve(value),
    fail: (request: number, err: unknown) => pending.get(`ctrlIn:${request}`)!.reject(err),
  };
}

describe('withSerializedCtrl', () => {
  it('does not start a second ctrlIn until the first settles', async () => {
    const { t, order, settle } = makeControllableTransport();
    const s = withSerializedCtrl(t);

    const p1 = s.ctrlIn(0x01, 0, 4);
    const p2 = s.ctrlIn(0x02, 0, 4);

    await flush();
    expect(order).toEqual(['start:ctrlIn:1']);

    settle(0x01);
    await p1;
    await flush();
    expect(order).toEqual(['start:ctrlIn:1', 'end:ctrlIn:1', 'start:ctrlIn:2']);

    settle(0x02);
    await p2;
    expect(order).toEqual(['start:ctrlIn:1', 'end:ctrlIn:1', 'start:ctrlIn:2', 'end:ctrlIn:2']);
  });

  it('exclusive() blocks a concurrent ctrlIn until the exclusive fn resolves', async () => {
    const { t, order, settle } = makeControllableTransport();
    const s = withSerializedCtrl(t);

    const exclusiveDone = defer<void>();
    const exPromise = s.exclusive(async (raw) => {
      order.push('exclusive:start');
      await raw.ctrlIn(0x10, 0, 4);
      await exclusiveDone.promise;
      order.push('exclusive:end');
    });
    const afterPromise = s.ctrlIn(0x20, 0, 4);

    await flush();
    settle(0x10);
    await flush();
    // The queued ctrlIn must not have started yet: exclusive() still holds the queue.
    expect(order).not.toContain('start:ctrlIn:32');

    exclusiveDone.resolve();
    await exPromise;
    await flush();
    expect(order).toContain('start:ctrlIn:32');
    expect(order.indexOf('exclusive:end')).toBeLessThan(order.indexOf('start:ctrlIn:32'));

    settle(0x20);
    await afterPromise;
  });

  it('a rejected op does not prevent later ops from running', async () => {
    const { t, settle, fail } = makeControllableTransport();
    const s = withSerializedCtrl(t);

    const p1 = s.ctrlIn(0x30, 0, 4);
    const p2 = s.ctrlIn(0x31, 0, 4);

    await flush();
    fail(0x30, new Error('STALL'));
    await expect(p1).rejects.toThrow('STALL');

    await flush();
    settle(0x31, new Uint8Array([9]));
    await expect(p2).resolves.toEqual(new Uint8Array([9]));
  });
});
