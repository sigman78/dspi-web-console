import { describe, it, expect, beforeEach } from 'vitest';
import type { PresetSlot } from '@/domain';
import { presets, resetPresets } from './presets.svelte';
import { makeReadySession, dispatch } from './appState.svelte';

function installSession(): void {
  dispatch({ t: 'synced', session: makeReadySession({ info: {}, hardware: {} } as never) });
}

describe('presets (session-scoped forwarder)', () => {
  beforeEach(() => { dispatch({ t: 'disconnected' }); resetPresets(); });

  it('reads inert defaults when there is no ready session', () => {
    expect(presets.directory).toBeNull();
    expect(presets.active).toBeNull();
    expect(presets.busy).toBe(false);
  });

  it('writes route to the active session presets', () => {
    installSession();
    presets.active = 3 as PresetSlot;
    presets.busy = true;
    expect(presets.active).toBe(3);
    expect(presets.busy).toBe(true);
  });

  it('each session has independent presets', () => {
    installSession();
    presets.active = 5 as PresetSlot;
    dispatch({ t: 'disconnected' });
    installSession();
    expect(presets.active).toBeNull();
  });

  it('resetPresets clears the active session presets (but not savedMasterVolumeDb)', () => {
    installSession();
    presets.active = 2 as PresetSlot;
    presets.savedMasterVolumeDb = -10;
    resetPresets();
    expect(presets.active).toBeNull();
    expect(presets.savedMasterVolumeDb).toBe(-10);
  });
});
