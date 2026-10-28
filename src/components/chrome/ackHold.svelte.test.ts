import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAckHold } from './ackHold.svelte';

describe('createAckHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds the optimistic value until the mirror catches up', () => {
    let mirror = 1;
    const hold = createAckHold<number>();
    hold.begin(5, () => mirror === 5);
    expect(hold.value).toBe(5);
    mirror = 5;
    expect(hold.value).toBeNull();
  });

  it('stays released once acked, even if the mirror moves away again', () => {
    let mirror = 1;
    const hold = createAckHold<number>();
    hold.begin(5, () => mirror === 5);
    mirror = 5;
    expect(hold.value).toBeNull();
    mirror = 2;
    expect(hold.value).toBeNull();
  });

  it('falls back to the mirror after the timeout when no ack arrives', () => {
    const hold = createAckHold<number>(1500);
    hold.begin(5, () => false);
    vi.advanceTimersByTime(1499);
    expect(hold.value).toBe(5);
    vi.advanceTimersByTime(1);
    expect(hold.value).toBeNull();
  });

  it('a new hold replaces the previous one and restarts the timeout', () => {
    const hold = createAckHold<number>(1500);
    hold.begin(5, () => false);
    vi.advanceTimersByTime(1000);
    hold.begin(7, () => false);
    vi.advanceTimersByTime(1000);
    expect(hold.value).toBe(7);
  });
});
