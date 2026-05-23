import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, setOutputDelay } from './actions';
import { dsp, bindDevice } from '@/state';
import { bootMock } from './session';
import { cancelAllCommands } from './outbox';
import { endConnection } from './connectionScope';

afterEach(() => { endConnection(); cancelAllCommands(); });

describe('action boundary clamps out-of-range values', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  afterEach(() => {
    bindDevice(null);
  });

  it('clamps master volume above 0 dB to 0', () => {
    setMasterVolume(12);
    expect(dsp.draft?.masterVolumeDb).toBe(0);
  });

  it('clamps master volume below -60 dB to -60', () => {
    setMasterVolume(-999);
    expect(dsp.draft?.masterVolumeDb).toBe(-60);
  });

  it('clamps output delay above the UI cap to 170 ms', () => {
    setOutputDelay(0, 999);
    expect(dsp.draft?.outputs.find((o) => o.wireIndex === 0)?.delayMs).toBe(170);
  });
});
