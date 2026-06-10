import { describe, it, expect, beforeEach } from 'vitest';
import { LinkHealth, isHealthEvent } from './linkHealth.svelte';
import { UnsupportedOnFirmware } from '@/device/DspDevice';

describe('isHealthEvent', () => {
  it('counts generic transfer errors and timeouts', () => {
    expect(isHealthEvent(new Error('controlTransferIn(40) status=stall'))).toBe(true);
    const t = new Error('timeout');
    t.name = 'DspTimeoutError';
    expect(isHealthEvent(t)).toBe(true);
  });

  it('excludes capability errors thrown before any transfer', () => {
    expect(isHealthEvent(new UnsupportedOnFirmware('bandBypass', 'wire V7'))).toBe(false);
  });
});

describe('LinkHealth', () => {
  let h: LinkHealth;
  let now: number;
  beforeEach(() => {
    h = new LinkHealth();
    now = 10_000;
  });

  const fail = (op = 'write') => h.noteFail(op, new Error('boom'), now);

  it('a single failure does not degrade', () => {
    fail();
    expect(h.degraded).toBe(false);
  });

  it('K consecutive failures spanning real time degrade', () => {
    fail();
    now += 800; fail();
    now += 800; fail();
    expect(h.degraded).toBe(true);
  });

  it('a burst of failures within the span guard does NOT degrade', () => {
    fail(); fail(); fail(); fail();
    expect(h.degraded).toBe(false);
  });

  it('a success resets the consecutive streak but degraded holds while failures are recent', () => {
    fail(); now += 800; fail(); now += 800; fail();
    expect(h.degraded).toBe(true);
    h.noteOk(now);
    expect(h.degraded).toBe(true);    // failures still in window: flaky, not recovered
    fail();
    expect(h.degraded).toBe(true);
  });

  it('noteOk clears degraded once the failure window has drained', () => {
    fail(); now += 800; fail(); now += 800; fail();
    expect(h.degraded).toBe(true);
    now += 31_000;
    h.noteOk(now);
    expect(h.degraded).toBe(false);
  });

  it('noteRecovered clears immediately', () => {
    fail(); now += 800; fail(); now += 800; fail();
    expect(h.degraded).toBe(true);
    h.noteRecovered();
    expect(h.degraded).toBe(false);
    fail();
    expect(h.degraded).toBe(false);   // streak and window were reset
  });

  it('M failures in the window degrade even with successes interleaved', () => {
    for (let i = 0; i < 5; i++) {
      fail();
      h.noteOk(now);
      now += 2000;
    }
    expect(h.degraded).toBe(true);
  });

  it('failures outside the window age out', () => {
    fail();
    now += 31_000;
    fail();
    h.noteOk(now);
    now += 2000;
    fail();
    h.noteOk(now);
    expect(h.degraded).toBe(false);   // never 5 in-window, never 3 consecutive
  });

  it('non-health errors are ignored entirely', () => {
    h.noteFail('cap', new UnsupportedOnFirmware('spdifRx', 'wire V8'), now);
    expect(h.failTotal).toBe(0);
    expect(h.lastErrorOp).toBeNull();
  });

  it('records the last failing op for the UI', () => {
    h.noteFail('poll:status', new Error('dead'), now);
    expect(h.lastErrorOp).toBe('poll:status');
    expect(h.lastErrorMsg).toBe('dead');
  });
});
