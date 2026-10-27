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

  it('auto-expires warn and info notices but keeps errors until dismissed', () => {
    vi.useFakeTimers();
    try {
      pushNotice('warn', 'w');
      pushNotice('info', 'i');
      const e = pushNotice('error', 'boom');
      vi.advanceTimersByTime(1000);
      expect(notices.list).toHaveLength(3);   // still within the window
      vi.advanceTimersByTime(60_000);
      expect(notices.list.map((n) => n.message)).toEqual(['boom']);
      dismissNotice(e);
      expect(notices.list).toHaveLength(0);
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
