import { describe, it, expect, beforeEach } from 'vitest';
import { bootMock } from './boot';
import { applyCsBinding, clearCsBinding } from './actions';
import { activeSession, clearNotices } from '@/state';
import { CsType, CsNoun, CsAction, dbToQ8 } from '@/domain';

const sess = () => activeSession()!;

const ledBinding = {
  type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals,
  flags: 0, gpio0: 20, gpio1: null, value: 1, step: 0, rangeMin: 0, rangeMax: 0,
};

describe('runtime/controlSurfaces', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
    clearNotices();
  });

  it('connect fetches caps, nouns, status, and all 8 slot bindings', () => {
    const s = sess();
    expect(s.controlSurfaces.caps?.maxBindings).toBe(8);
    expect(s.controlSurfaces.nouns).toHaveLength(9);
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
    expect(s.controlSurfaces.bindings).toHaveLength(8);
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
    expect(s.controlSurfaces.lastFetchError).toBeNull();
  });

  it('applyCsBinding lands the accepted binding and refreshed status in state', async () => {
    const s = sess();
    const ok = await applyCsBinding(s, 5, ledBinding);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.bindings[5]).toEqual(ledBinding);
    expect(s.controlSurfaces.status?.activeMask).toBe(1 << 5);
    expect(s.controlSurfaces.status?.slotStatus[5]).toBe(0);
  });

  it('a rejected binding keeps the slot state and surfaces the failure status', async () => {
    const s = sess();
    const ok = await applyCsBinding(s, 0, {
      type: CsType.Encoder, noun: CsNoun.UserMute, action: CsAction.Step,
      flags: 0, gpio0: 21, gpio1: 22, value: 0, step: dbToQ8(1), rangeMin: 0, rangeMax: 0,
    });
    expect(ok).toBe(false);
    expect(s.controlSurfaces.bindings[0]).toBeNull();
    expect(s.controlSurfaces.status?.lastStatus).toBe(0x13);   // INVALID_ACTION
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
  });

  it('clearCsBinding empties the slot and drops its active bit', async () => {
    const s = sess();
    await applyCsBinding(s, 2, ledBinding);
    const ok = await clearCsBinding(s, 2);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.bindings[2]).toBeNull();
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
  });

  it('a V10 device skips the fetch entirely', async () => {
    await bootMock('rp2350');
    const s = sess();
    expect(s.device.capabilities.features.controlSurfaces).toBe(false);
    expect(s.controlSurfaces.caps).toBeNull();
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
  });
});
