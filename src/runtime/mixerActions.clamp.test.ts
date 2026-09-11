import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { setOutputDelay } from './mixerActions';
import { activeSession, resetAppState } from '@/state';
import { bootMock } from './boot';

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

describe('action boundary clamps out-of-range values', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('clamps output delay above the UI cap to 170 ms', async () => {
    // setOutputDelay uses write() (await-then-mutate); flush microtasks to settle.
    vi.useFakeTimers();
    setOutputDelay(activeSession()!, 0, 999);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(activeSession()!.mirror.current?.outputs.find((o) => o.wireIndex === 0)?.delayMs).toBe(170);
  });
});
