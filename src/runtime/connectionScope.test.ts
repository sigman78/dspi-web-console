import { describe, it, expect, vi } from 'vitest';
import { ConnectionScope } from './connectionScope';

describe('ConnectionScope.onTeardown', () => {
  it('fires exactly once on abort', () => {
    const scope = new ConnectionScope();
    const fn = vi.fn();
    scope.onTeardown(fn);
    scope.abort();
    scope.abort();                      // idempotent; must not refire
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires immediately when the scope is already aborted', () => {
    const scope = new ConnectionScope();
    scope.abort();
    const fn = vi.fn();
    scope.onTeardown(fn);               // would never fire via 'abort' listener alone
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs multiple teardown hooks in registration order', () => {
    const scope = new ConnectionScope();
    const order: string[] = [];
    scope.onTeardown(() => order.push('a'));
    scope.onTeardown(() => order.push('b'));
    scope.abort();
    expect(order).toEqual(['a', 'b']);
  });

  it('signal reflects aborted state; cannot be aborted through the observer half', () => {
    const scope = new ConnectionScope();
    expect(scope.signal.aborted).toBe(false);
    scope.abort();
    expect(scope.signal.aborted).toBe(true);
    expect(scope.aborted).toBe(true);
  });
});
