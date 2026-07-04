import { describe, it, expect, beforeEach } from 'vitest';
import { LinkHealth } from './linkHealth.svelte';

describe('LinkHealth', () => {
  let h: LinkHealth;
  beforeEach(() => {
    h = new LinkHealth();
  });

  const fail = (op = 'write') => h.noteFail(op, new Error('boom'));

  it('a single failure does not degrade', () => {
    fail();
    expect(h.degraded).toBe(false);
  });

  it('two consecutive failures do not degrade', () => {
    fail(); fail();
    expect(h.degraded).toBe(false);
  });

  it('three consecutive failures degrade', () => {
    fail(); fail(); fail();
    expect(h.degraded).toBe(true);
  });

  it('an ok in between resets the streak, so a later failure run needs 3 fresh', () => {
    fail(); fail();
    h.noteOk();
    fail(); fail();
    expect(h.degraded).toBe(false);
    fail();
    expect(h.degraded).toBe(true);
  });

  it('an ordinary success does not clear degraded — only the probe does', () => {
    fail(); fail(); fail();
    expect(h.degraded).toBe(true);
    h.noteOk();
    expect(h.degraded).toBe(true);   // intermittent success mid-outage must not flap it clear
    h.noteOk();
    expect(h.degraded).toBe(true);
  });

  it('noteRecovered clears degraded and the streak', () => {
    fail(); fail(); fail();
    expect(h.degraded).toBe(true);
    h.noteRecovered();
    expect(h.degraded).toBe(false);
    fail(); fail();
    expect(h.degraded).toBe(false);   // streak was reset, needs 3 fresh again
  });

  it('records the last failing op and message for the UI', () => {
    h.noteFail('poll:status', new Error('dead'));
    expect(h.lastErrorOp).toBe('poll:status');
    expect(h.lastErrorMsg).toBe('dead');
  });

  it('failTotal accumulates across the session, unaffected by streak resets', () => {
    fail(); h.noteOk(); fail(); fail();
    expect(h.failTotal).toBe(3);
  });
});
