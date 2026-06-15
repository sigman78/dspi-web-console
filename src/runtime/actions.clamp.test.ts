import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, setOutputDelay } from './actions';
import { activeSession } from '@/state';
import { bootMock } from './boot';
import { endConnection } from './connectionScope';

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { endConnection(); cancelWrites(); });

describe('action boundary clamps out-of-range values', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('clamps master volume above 0 dB to 0', () => {
    setMasterVolume(activeSession()!, 12);
    expect(activeSession()!.mirror.current?.masterVolumeDb).toBe(0);
  });

  it('clamps master volume below -60 dB to -60', () => {
    setMasterVolume(activeSession()!, -999);
    expect(activeSession()!.mirror.current?.masterVolumeDb).toBe(-60);
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
