import { describe, it, expect, beforeEach } from 'vitest';
import { bootMock } from './boot';
import { applyCsBinding, clearCsBinding, applyCsName, csSaveConfig, csRevertConfig } from './actions';
import { activeSession, clearNotices } from '@/state';
import { CsType, CsNoun, CsAction, CsEvent, CS_MAX_BINDINGS, dbToQ8 } from '@/domain';

const sess = () => activeSession()!;

const ledBinding = {
  type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals,
  flags: 0, gpio0: 20, gpio1: null, event: CsEvent.Press, target: 0, index: 0,
  value: 1, step: 0, rangeMin: 0, rangeMax: 0,
};

describe('runtime/controlSurfaces', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
    clearNotices();
  });

  it('connect fetches caps, nouns, status, and every slot binding and name', () => {
    const s = sess();
    expect(s.controlSurfaces.caps?.maxBindings).toBe(CS_MAX_BINDINGS);
    expect(s.controlSurfaces.caps?.capsVersion).toBeGreaterThanOrEqual(2);
    expect(s.controlSurfaces.nouns).toHaveLength(35);
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
    expect(s.controlSurfaces.bindings).toHaveLength(CS_MAX_BINDINGS);
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
    expect(s.controlSurfaces.names).toHaveLength(CS_MAX_BINDINGS);
    expect(s.controlSurfaces.names.every((n) => n === '')).toBe(true);
    expect(s.controlSurfaces.lastFetchError).toBeNull();
  });

  it('a device reporting a pre-v2 caps format is rejected with an explanatory error', async () => {
    await bootMock('rp2350', { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 }, csCapsVersion: 1 });
    const s = sess();
    expect(s.controlSurfaces.caps).toBeNull();
    expect(s.controlSurfaces.deviceCapsVersion).toBe(1);   // still recorded for display
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
    expect(s.controlSurfaces.lastFetchError).toBeTruthy();
  });

  it('applyCsBinding lands the accepted binding, marks the config dirty, and refreshes status', async () => {
    const s = sess();
    const ok = await applyCsBinding(s, 5, ledBinding);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.bindings[5]).toEqual(ledBinding);
    expect(s.controlSurfaces.status?.activeMask).toBe(1 << 5);
    expect(s.controlSurfaces.status?.slotStatus[5]).toBe(0);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
  });

  it('a rejected binding keeps the slot state and surfaces the failure status', async () => {
    const s = sess();
    const ok = await applyCsBinding(s, 0, {
      type: CsType.Encoder, noun: CsNoun.UserMute, action: CsAction.Step,
      flags: 0, gpio0: 21, gpio1: 22, event: CsEvent.Press, target: 0, index: 0,
      value: 0, step: dbToQ8(1), rangeMin: 0, rangeMax: 0,
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

  it('applyCsName lands the name, marks the config dirty, and leaves the binding untouched', async () => {
    const s = sess();
    const ok = await applyCsName(s, 3, 'Sub Level');
    expect(ok).toBe(true);
    expect(s.controlSurfaces.names[3]).toBe('Sub Level');
    expect(s.controlSurfaces.bindings[3]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);
  });

  it('csSaveConfig persists the live preview and clears dirty', async () => {
    const s = sess();
    await applyCsBinding(s, 5, ledBinding);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
    const ok = await csSaveConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
  });

  it('csRevertConfig discards an unsaved preview and re-fetches bindings, names, and status', async () => {
    const s = sess();
    await applyCsBinding(s, 5, ledBinding);
    await csSaveConfig(s);

    // Unsaved changes on top of the saved config: rename the slot and clear
    // the binding, neither of which is persisted.
    await applyCsName(s, 5, 'Renamed live');
    await clearCsBinding(s, 5);
    expect(s.controlSurfaces.bindings[5]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);

    const ok = await csRevertConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
    expect(s.controlSurfaces.bindings[5]).toEqual(ledBinding);   // restored from the saved snapshot
    expect(s.controlSurfaces.names[5]).toBe('');                 // the rename was never saved
  });

  it('a V10 device skips the fetch entirely', async () => {
    await bootMock('rp2350');
    const s = sess();
    expect(s.device.capabilities.features.controlSurfaces).toBe(false);
    expect(s.controlSurfaces.caps).toBeNull();
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
  });
});
