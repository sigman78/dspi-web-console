import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, setOutputDelay } from './actions';
import { mirror, bindDevice } from '@/state';
import { bootMock } from './session';
import { cancelAllWrites as cancelWrites } from '@/device/writes';
import { endConnection } from './connectionScope';

afterEach(() => { endConnection(); cancelWrites(); });

describe('action boundary clamps out-of-range values', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  afterEach(() => {
    bindDevice(null);
  });

  it('clamps master volume above 0 dB to 0', () => {
    setMasterVolume(12);
    expect(mirror.current?.masterVolumeDb).toBe(0);
  });

  it('clamps master volume below -60 dB to -60', () => {
    setMasterVolume(-999);
    expect(mirror.current?.masterVolumeDb).toBe(-60);
  });

  it('clamps output delay above the UI cap to 170 ms', async () => {
    // setOutputDelay uses write() (await-then-mutate); flush microtasks to settle.
    vi.useFakeTimers();
    setOutputDelay(0, 999);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(mirror.current?.outputs.find((o) => o.wireIndex === 0)?.delayMs).toBe(170);
  });
});
