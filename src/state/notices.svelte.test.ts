import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notices, pushNotice, dismissNotice, clearNotices } from './notices.svelte';

beforeEach(() => clearNotices());

describe('notices', () => {
  it('pushes a notice with its kind + message and returns its id', () => {
    const id = pushNotice('warn', 'pin in use');
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0]).toMatchObject({ id, kind: 'warn', message: 'pin in use' });
  });

  it('dismisses a specific notice by id, leaving the rest', () => {
    const a = pushNotice('info', 'a');
    pushNotice('info', 'b');
    dismissNotice(a);
    expect(notices.list.map((n) => n.message)).toEqual(['b']);
  });

  it('auto-expires a notice after its TTL elapses', () => {
    vi.useFakeTimers();
    try {
      pushNotice('error', 'boom');
      vi.advanceTimersByTime(1000);
      expect(notices.list).toHaveLength(1);   // still within the window
      vi.advanceTimersByTime(60_000);
      expect(notices.list).toHaveLength(0);   // expired
    } finally {
      vi.useRealTimers();
    }
  });

  it('clearNotices empties the list', () => {
    pushNotice('warn', 'x');
    pushNotice('error', 'y');
    clearNotices();
    expect(notices.list).toHaveLength(0);
  });
});
