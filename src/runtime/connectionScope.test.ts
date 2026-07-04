import { describe, it, expect, vi } from 'vitest';
import { beginConnection, connectionScope, endConnection, ConnectionScope } from './connectionScope';

describe('beginConnection / endConnection', () => {
  it('beginConnection aborts the prior active connection', () => {
    const onAbort = vi.fn();
    const first = beginConnection();
    first.onTeardown(onAbort);
    beginConnection();                  // should abort the first scope
    expect(onAbort).toHaveBeenCalledTimes(1);
    endConnection();
  });

  it('endConnection aborts and clears the active connection', () => {
    const onAbort = vi.fn();
    const c = beginConnection();
    c.onTeardown(onAbort);
    endConnection();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(connectionScope()).toBeNull();
    endConnection();                    // idempotent, no throw
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('beginConnection mints a fresh scope each time; endConnection clears it', () => {
    const c1 = beginConnection();
    expect(connectionScope()).toBe(c1);
    const c2 = beginConnection();
    expect(connectionScope()).toBe(c2);
    expect(c2).not.toBe(c1);
    endConnection();
    expect(connectionScope()).toBeNull();
  });

  it('double-abort of the same connection is a no-op beyond the first', () => {
    const onAbort = vi.fn();
    const c = beginConnection();
    c.onTeardown(onAbort);
    endConnection();
    c.abort();                          // already aborted; must not fire again
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});

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
});
