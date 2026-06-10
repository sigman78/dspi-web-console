import { describe, it, expect, vi } from 'vitest';
import { ConnectionScope, beginConnection, connectionScope, endConnection } from './connectionScope';

describe('ConnectionScope', () => {
  it('disposes registered disposers in LIFO order', () => {
    const order: number[] = [];
    const s = new ConnectionScope();
    s.add(() => order.push(1));
    s.add(() => order.push(2));
    s.dispose();
    expect(order).toEqual([2, 1]);
  });

  it('is idempotent: a second dispose runs nothing', () => {
    const d = vi.fn();
    const s = new ConnectionScope();
    s.add(d);
    s.dispose();
    s.dispose();
    expect(d).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing disposer so the rest still run', () => {
    const after = vi.fn();
    const s = new ConnectionScope();
    s.add(after);                       // added first → disposed last
    s.add(() => { throw new Error('boom'); });
    expect(() => s.dispose()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('active scope', () => {
  it('beginConnection disposes the prior active scope', () => {
    const prior = vi.fn();
    beginConnection();
    connectionScope()!.add(prior);
    beginConnection();                  // should dispose the first scope
    expect(prior).toHaveBeenCalledTimes(1);
    endConnection();
  });

  it('endConnection disposes and clears the active scope', () => {
    const d = vi.fn();
    beginConnection();
    connectionScope()!.add(d);
    endConnection();
    expect(d).toHaveBeenCalledTimes(1);
    expect(connectionScope()).toBeNull();
    endConnection();                    // idempotent, no throw
    expect(d).toHaveBeenCalledTimes(1);
  });
});

import { currentAttempt } from '@/state';

describe('attempt ownership', () => {
  it('beginConnection mints a fresh current attempt; endConnection clears it', () => {
    const s1 = beginConnection();
    expect(currentAttempt()).toBe(s1.attempt);
    const s2 = beginConnection();
    expect(s2.attempt).toBeGreaterThan(s1.attempt);
    expect(currentAttempt()).toBe(s2.attempt);
    endConnection();
    expect(currentAttempt()).toBeNull();
  });
});
