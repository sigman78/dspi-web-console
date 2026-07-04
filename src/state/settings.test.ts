import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { loadSettings, settings, selectChannel, reconcileSelectedChannel } from './settings.svelte';
import { ChannelId, type ChannelModel } from '@/domain';

function ch(id: ChannelId, isOutput: boolean): ChannelModel {
  return { id, name: '', defaultName: '', shortName: '', bandCount: 10, isOutput, filters: [], xoverBands: [] };
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
    const s = loadSettings();
    expect(s.version).toBe(1);
    expect(s.tab).toBe('overview');
    expect(s.selectedChannel).toBeNull();
    expect(s.lastSerial).toBeNull();
  });

  test('loads valid v1 directly', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      tab: 'eq',
      selectedChannel: ChannelId.Out2L,
      lastSerial: 'ABC123',
    }));
    const s = loadSettings();
    expect(s.tab).toBe('eq');
    expect(s.selectedChannel).toBe(ChannelId.Out2L);
    expect(s.lastSerial).toBe('ABC123');
  });

  test('falls back to the legacy eqTarget key when selectedChannel is absent', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      tab: 'eq',
      eqTarget: ChannelId.Out3R,
      lastSerial: null,
    }));
    const s = loadSettings();
    expect(s.selectedChannel).toBe(ChannelId.Out3R);
  });

  test('falls back to defaults on corrupted v1 JSON', () => {
    localStorage.setItem(V1_KEY, '{not json');
    const s = loadSettings();
    expect(s.tab).toBe('overview');
    expect(s.lastSerial).toBeNull();
  });
});

describe('legacy migration', () => {
  test('migrates ui/v2 only', () => {
    localStorage.setItem(LEGACY_UI_KEY, JSON.stringify({
      tab: 'mixer',
      eqTarget: null,
    }));
    const s = loadSettings();
    expect(s.tab).toBe('mixer');
    expect(s.lastSerial).toBeNull();
    expect(localStorage.getItem(LEGACY_UI_KEY)).toBeNull();
    expect(localStorage.getItem(V1_KEY)).not.toBeNull();
  });

  test('migrates connection/v1 only', () => {
    localStorage.setItem(LEGACY_CONN_KEY, JSON.stringify({ lastSerial: 'XYZ789' }));
    const s = loadSettings();
    expect(s.lastSerial).toBe('XYZ789');
    expect(s.tab).toBe('overview');
    expect(localStorage.getItem(LEGACY_CONN_KEY)).toBeNull();
  });

  test('migrates both legacy keys together', () => {
    localStorage.setItem(LEGACY_UI_KEY, JSON.stringify({ tab: 'system' }));
    localStorage.setItem(LEGACY_CONN_KEY, JSON.stringify({ lastSerial: 'BOTH' }));
    const s = loadSettings();
    expect(s.tab).toBe('system');
    expect(s.lastSerial).toBe('BOTH');
    expect(localStorage.getItem(LEGACY_UI_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_CONN_KEY)).toBeNull();
  });

  test('v1 takes precedence over legacy keys (no migration runs)', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      tab: 'processing',
      eqTarget: null,
      lastSerial: 'V1WINS',
    }));
    localStorage.setItem(LEGACY_UI_KEY, JSON.stringify({ tab: 'system' }));
    localStorage.setItem(LEGACY_CONN_KEY, JSON.stringify({ lastSerial: 'LEGACY' }));
    const s = loadSettings();
    expect(s.tab).toBe('processing');
    expect(s.lastSerial).toBe('V1WINS');
    expect(localStorage.getItem(LEGACY_UI_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_CONN_KEY)).not.toBeNull();
  });

  test('corrupted legacy JSON falls back to defaults without throwing', () => {
    localStorage.setItem(LEGACY_UI_KEY, '{broken');
    localStorage.setItem(LEGACY_CONN_KEY, '{broken');
    expect(() => loadSettings()).not.toThrow();
    const s = loadSettings();
    expect(s.tab).toBe('overview');
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
    const s = loadSettings();
    expect(s.warnOnPresetSwitchDirty).toBe(true);
  });

  test('round-trips warnOnPresetSwitchDirty=false through localStorage', () => {
    const payload = {
      version: 1,
      tab: 'overview',
      eqTarget: null,
      lastSerial: null,
      warnOnPresetSwitchDirty: false,
    };
    localStorage.setItem(V1_KEY, JSON.stringify(payload));
    const s = loadSettings();
    expect(s.warnOnPresetSwitchDirty).toBe(false);
  });

  test('falls back to true when warnOnPresetSwitchDirty is missing or invalid', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, warnOnPresetSwitchDirty: 'not-a-bool' }));
    const s = loadSettings();
    expect(s.warnOnPresetSwitchDirty).toBe(true);
  });
});

describe('selectChannel', () => {
  test('sets the selected channel and switches to the EQ tab', () => {
    settings.tab = 'overview';
    settings.selectedChannel = null;
    selectChannel(ChannelId.Out1L);
    expect(settings.selectedChannel).toBe(ChannelId.Out1L);
    expect(settings.tab).toBe('eq');
  });
});

describe('reconcileSelectedChannel', () => {
  const channels = [ch(ChannelId.In1L, false), ch(ChannelId.In1R, false), ch(ChannelId.Out1L, true), ch(ChannelId.Out1R, true)];

  test('defaults a null selection to the first output channel', () => {
    settings.selectedChannel = null;
    reconcileSelectedChannel(channels);
    expect(settings.selectedChannel).toBe(ChannelId.Out1L);
  });

  test('leaves a valid selection untouched', () => {
    settings.selectedChannel = ChannelId.Out1R;
    reconcileSelectedChannel(channels);
    expect(settings.selectedChannel).toBe(ChannelId.Out1R);
  });

  test('falls back to the first output when the selection is not in the channel set', () => {
    settings.selectedChannel = ChannelId.Out4L;
    reconcileSelectedChannel(channels);
    expect(settings.selectedChannel).toBe(ChannelId.Out1L);
  });

  test('clears to null when the channel set has no outputs', () => {
    settings.selectedChannel = null;
    reconcileSelectedChannel([ch(ChannelId.In1L, false)]);
    expect(settings.selectedChannel).toBeNull();
  });

  test('is a no-op when channels is undefined (not yet connected)', () => {
    settings.selectedChannel = null;
    reconcileSelectedChannel(undefined);
    expect(settings.selectedChannel).toBeNull();
  });
});
