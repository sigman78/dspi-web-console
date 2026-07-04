import { describe, it, expect, vi } from 'vitest';
import { beginConnection, connectionSignal, endConnection } from './connectionScope';

describe('beginConnection / endConnection', () => {
  it('beginConnection aborts the prior active connection', () => {
    const onAbort = vi.fn();
    const first = beginConnection();
    first.signal.addEventListener('abort', onAbort);
    beginConnection();                  // should abort the first controller
    expect(onAbort).toHaveBeenCalledTimes(1);
    endConnection();
  });

  it('endConnection aborts and clears the active connection', () => {
    const onAbort = vi.fn();
    const c = beginConnection();
    c.signal.addEventListener('abort', onAbort);
    endConnection();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(connectionSignal()).toBeNull();
    endConnection();                    // idempotent, no throw
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('beginConnection mints a fresh signal each time; endConnection clears it', () => {
    const c1 = beginConnection();
    expect(connectionSignal()).toBe(c1.signal);
    const c2 = beginConnection();
    expect(connectionSignal()).toBe(c2.signal);
    expect(c2.signal).not.toBe(c1.signal);
    endConnection();
    expect(connectionSignal()).toBeNull();
  });

  it('double-abort of the same connection is a no-op beyond the first', () => {
    const onAbort = vi.fn();
    const c = beginConnection();
    c.signal.addEventListener('abort', onAbort);
    endConnection();
    c.abort();                          // already aborted; must not fire again
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
