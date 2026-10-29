import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import * as Settings from './settings.svelte';
import type { SelectionVisibility } from './settings.svelte';
import { ChannelId, type ChannelModel, type OutputModel } from '@/domain';

function ch(id: ChannelId, isOutput: boolean): ChannelModel {
  return { id, name: '', defaultName: '', shortName: '', bandCount: 10, isOutput, filters: [], xoverBands: [] };
}

function visibility(enabledOutputIds: ChannelId[], activeInputs: number | null = null): SelectionVisibility {
  return { enabledOutputIds, activeInputs };
}

const V1_KEY = 'dspi-console-web/settings/v1';
const LEGACY_UI_KEY = 'dspi-console-web/ui/v2';
const LEGACY_CONN_KEY = 'dspi-console-web/connection/v1';

describe('loadSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('returns defaults when no keys are present', () => {
    const s = Settings.loadSettings();
    expect(s.version).toBe(1);
    expect(s.seenVersion).toBeNull();
    expect(s.selectedChannel).toBeNull();
    expect(s.lastSerial).toBeNull();
  });

  test('loads valid v1 directly', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      selectedChannel: ChannelId.Out2L,
      lastSerial: 'ABC123',
    }));
    const s = Settings.loadSettings();
    expect(s.selectedChannel).toBe(ChannelId.Out2L);
    expect(s.lastSerial).toBe('ABC123');
  });

  test('keeps a stored room hue, clamped, and drops anything that is not a number', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, roomHue: 190 }));
    expect(Settings.loadSettings().roomHue).toBe(190);
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, roomHue: 900 }));
    expect(Settings.loadSettings().roomHue).toBe(360);
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, roomHue: 'red' }));
    expect(Settings.loadSettings().roomHue).toBeNull();
  });

  test('falls back to the spectrum room mode for an unknown stored value', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, roomMode: 'vu-out' }));
    expect(Settings.loadSettings().roomMode).toBe('vu-out');
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, roomMode: 'scope' }));
    expect(Settings.loadSettings().roomMode).toBe('spectrum');
  });

  test('falls back to the legacy eqTarget key when selectedChannel is absent', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      eqTarget: ChannelId.Out3R,
      lastSerial: null,
    }));
    const s = Settings.loadSettings();
    expect(s.selectedChannel).toBe(ChannelId.Out3R);
  });

  test('falls back to defaults on corrupted v1 JSON', () => {
    localStorage.setItem(V1_KEY, '{not json');
    const s = Settings.loadSettings();
    expect(s.lastSerial).toBeNull();
  });
});

describe('legacy migration', () => {
  test('migrates ui/v2 only', () => {
    localStorage.setItem(LEGACY_UI_KEY, JSON.stringify({ eqTarget: ChannelId.Out2L }));
    const s = Settings.loadSettings();
    expect(s.selectedChannel).toBe(ChannelId.Out2L);
    expect(s.lastSerial).toBeNull();
    expect(localStorage.getItem(LEGACY_UI_KEY)).toBeNull();
    expect(localStorage.getItem(V1_KEY)).not.toBeNull();
  });

  test('migrates connection/v1 only', () => {
    localStorage.setItem(LEGACY_CONN_KEY, JSON.stringify({ lastSerial: 'XYZ789' }));
    const s = Settings.loadSettings();
    expect(s.lastSerial).toBe('XYZ789');
    expect(localStorage.getItem(LEGACY_CONN_KEY)).toBeNull();
  });

  test('migrates both legacy keys together', () => {
    localStorage.setItem(LEGACY_UI_KEY, JSON.stringify({ eqTarget: ChannelId.Out2L }));
    localStorage.setItem(LEGACY_CONN_KEY, JSON.stringify({ lastSerial: 'BOTH' }));
    const s = Settings.loadSettings();
    expect(s.selectedChannel).toBe(ChannelId.Out2L);
    expect(s.lastSerial).toBe('BOTH');
    expect(localStorage.getItem(LEGACY_UI_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_CONN_KEY)).toBeNull();
  });

  test('v1 takes precedence over legacy keys (no migration runs)', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      eqTarget: null,
      lastSerial: 'V1WINS',
    }));
    localStorage.setItem(LEGACY_UI_KEY, JSON.stringify({ eqTarget: ChannelId.Out2L }));
    localStorage.setItem(LEGACY_CONN_KEY, JSON.stringify({ lastSerial: 'LEGACY' }));
    const s = Settings.loadSettings();
    expect(s.selectedChannel).toBeNull();
    expect(s.lastSerial).toBe('V1WINS');
    expect(localStorage.getItem(LEGACY_UI_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_CONN_KEY)).not.toBeNull();
  });

  test('corrupted legacy JSON falls back to defaults without throwing', () => {
    localStorage.setItem(LEGACY_UI_KEY, '{broken');
    localStorage.setItem(LEGACY_CONN_KEY, '{broken');
    expect(() => Settings.loadSettings()).not.toThrow();
    const s = Settings.loadSettings();
    expect(s.lastSerial).toBeNull();
  });
});

describe('warnOnPresetSwitchDirty', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('defaults warnOnPresetSwitchDirty to true on first run', () => {
    const s = Settings.loadSettings();
    expect(s.warnOnPresetSwitchDirty).toBe(true);
  });

  test('round-trips warnOnPresetSwitchDirty=false through localStorage', () => {
    const payload = {
      version: 1,
      eqTarget: null,
      lastSerial: null,
      warnOnPresetSwitchDirty: false,
    };
    localStorage.setItem(V1_KEY, JSON.stringify(payload));
    const s = Settings.loadSettings();
    expect(s.warnOnPresetSwitchDirty).toBe(false);
  });

  test('falls back to true when warnOnPresetSwitchDirty is missing or invalid', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, warnOnPresetSwitchDirty: 'not-a-bool' }));
    const s = Settings.loadSettings();
    expect(s.warnOnPresetSwitchDirty).toBe(true);
  });
});

describe('selectChannel', () => {
  test('sets the selected channel', () => {
    Settings.settings.selectedChannel = null;
    Settings.selectChannel(ChannelId.Out1L);
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1L);
  });
});

describe('reconcileSelectedChannel', () => {
  const channels = [
    ch(ChannelId.In1L, false), ch(ChannelId.In1R, false),
    ch(ChannelId.In2L, false), ch(ChannelId.In2R, false),
    ch(ChannelId.Out1L, true), ch(ChannelId.Out1R, true),
  ];
  const allOutputsEnabled = visibility([ChannelId.Out1L, ChannelId.Out1R]);

  test('defaults a null selection to the first enabled output channel', () => {
    Settings.settings.selectedChannel = null;
    Settings.reconcileSelectedChannel(channels, allOutputsEnabled);
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1L);
  });

  test('leaves a valid enabled-output selection untouched', () => {
    Settings.settings.selectedChannel = ChannelId.Out1R;
    Settings.reconcileSelectedChannel(channels, allOutputsEnabled);
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1R);
  });

  test('falls back to the first enabled output when the selection is not in the channel set', () => {
    Settings.settings.selectedChannel = ChannelId.Out4L;
    Settings.reconcileSelectedChannel(channels, allOutputsEnabled);
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1L);
  });

  test('is a no-op when channels is undefined (not yet connected)', () => {
    Settings.settings.selectedChannel = null;
    Settings.reconcileSelectedChannel(undefined, allOutputsEnabled);
    expect(Settings.settings.selectedChannel).toBeNull();
  });

  test('a disabled-output selection falls back to the first enabled output', () => {
    Settings.settings.selectedChannel = ChannelId.Out1R;
    Settings.reconcileSelectedChannel(channels, visibility([ChannelId.Out1L]));
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1L);
  });

  test('clears to null when every output is disabled', () => {
    Settings.settings.selectedChannel = ChannelId.Out1L;
    Settings.reconcileSelectedChannel(channels, visibility([]));
    expect(Settings.settings.selectedChannel).toBeNull();
  });

  test('an input beyond the live input count falls back to the first enabled output', () => {
    Settings.settings.selectedChannel = ChannelId.In2L;
    Settings.reconcileSelectedChannel(channels, visibility([ChannelId.Out1L, ChannelId.Out1R], 2));
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1L);
  });

  test('an input within the live input count is preserved', () => {
    Settings.settings.selectedChannel = ChannelId.In1R;
    Settings.reconcileSelectedChannel(channels, visibility([ChannelId.Out1L, ChannelId.Out1R], 2));
    expect(Settings.settings.selectedChannel).toBe(ChannelId.In1R);
  });

  test('a selected disabled output stays selected', () => {
    const outputs = [
      { id: ChannelId.Out1L, enabled: true },
      { id: ChannelId.Out1R, enabled: false },
    ] as unknown as OutputModel[];
    Settings.settings.selectedChannel = ChannelId.Out1R;
    Settings.reconcileSelectedChannel(channels, Settings.selectionVisibilityOf(outputs, null));
    expect(Settings.settings.selectedChannel).toBe(ChannelId.Out1R);
  });

  test('an input selection is preserved while activeInputs is null (count not yet known)', () => {
    Settings.settings.selectedChannel = ChannelId.In2R;
    Settings.reconcileSelectedChannel(channels, visibility([ChannelId.Out1L, ChannelId.Out1R], null));
    expect(Settings.settings.selectedChannel).toBe(ChannelId.In2R);
  });
});
