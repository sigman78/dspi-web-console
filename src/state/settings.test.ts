import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { loadSettings } from './settings.svelte';

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
    expect(s.eqTarget).toBeNull();
    expect(s.showDebugStats).toBe(false);
    expect(s.lastSerial).toBeNull();
    expect(s.theme).toBe('dark');
  });

  test('loads valid v1 directly', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      theme: 'dark',
      showDebugStats: true,
      tab: 'eq',
      eqTarget: null,
      lastSerial: 'ABC123',
    }));
    const s = loadSettings();
    expect(s.showDebugStats).toBe(true);
    expect(s.tab).toBe('eq');
    expect(s.lastSerial).toBe('ABC123');
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
      showDebugStats: true,
      tab: 'mixer',
      eqTarget: null,
    }));
    const s = loadSettings();
    expect(s.showDebugStats).toBe(true);
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
      theme: 'dark',
      showDebugStats: false,
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
      theme: 'dark',
      showDebugStats: false,
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

describe('eagerReconcile', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('defaults eagerReconcile to false on first run', () => {
    const s = loadSettings();
    expect(s.eagerReconcile).toBe(false);
  });

  test('round-trips eagerReconcile=true through localStorage', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, eagerReconcile: true }));
    const s = loadSettings();
    expect(s.eagerReconcile).toBe(true);
  });

  test('falls back to false when eagerReconcile is missing or invalid', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ version: 1, eagerReconcile: 'not-a-bool' }));
    const s = loadSettings();
    expect(s.eagerReconcile).toBe(false);
  });
});
