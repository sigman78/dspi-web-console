import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setMasterVolume } from './volumeActions';
import { activeSession, resetAppState } from '@/state';
import { bootMock } from './boot';

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

describe('action boundary clamps out-of-range values', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('clamps master volume above 0 dB to 0', () => {
    setMasterVolume(activeSession()!, 12);
    expect(activeSession()!.mirror.current?.masterVolumeDb).toBe(0);
  });

  it('clamps master volume below -128 dB to -128 (mute sentinel)', () => {
    setMasterVolume(activeSession()!, -999);
    expect(activeSession()!.mirror.current?.masterVolumeDb).toBe(-128);
  });
});
