import { describe, it, expect } from 'vitest';
import { CommandQueue, QueueDisposedError } from './commandQueue';

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('CommandQueue', () => {
  it('runs queued ops in FIFO order', async () => {
    const q = new CommandQueue();
    const order: number[] = [];
    const p1 = q.run(async () => { order.push(1); });
    const p2 = q.run(async () => { order.push(2); });
    const p3 = q.run(async () => { order.push(3); });
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a priority op jumps queued normals but never preempts the running op', async () => {
    const q = new CommandQueue();
    const order: string[] = [];
    const gate = deferred();
    const running = q.run(async () => { order.push('running'); await gate.promise; });
    const normal = q.run(async () => { order.push('normal'); });
    const priority = q.run(async () => { order.push('priority'); }, { priority: true });
    gate.resolve();
    await Promise.all([running, normal, priority]);
    expect(order).toEqual(['running', 'priority', 'normal']);
  });

  it('a rejected op settles only its own promise; the pump continues to the next op', async () => {
    const q = new CommandQueue();
    const failing = q.run(async () => { throw new Error('boom'); });
    const next = q.run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('dispose rejects queued ops with QueueDisposedError but lets the running op finish', async () => {
    const q = new CommandQueue();
    const gate = deferred();
    const running = q.run(async () => { await gate.promise; return 'done'; });
    const queued = q.run(async () => 'never');
    q.dispose();
    gate.resolve();
    await expect(running).resolves.toBe('done');
    await expect(queued).rejects.toBeInstanceOf(QueueDisposedError);
  });

  it('dispose is idempotent, and run() after dispose rejects immediately', async () => {
    const q = new CommandQueue();
    q.dispose();
    expect(() => q.dispose()).not.toThrow();
    await expect(q.run(async () => 'x')).rejects.toBeInstanceOf(QueueDisposedError);
  });
});
