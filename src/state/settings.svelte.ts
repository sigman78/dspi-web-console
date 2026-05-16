import type { ChannelId } from '../domain/channels';
import { dsp } from './dsp.svelte';

export type TabId = 'overview' | 'eq' | 'mixer' | 'processing' | 'presets' | 'system';

export const TAB_ORDER: readonly TabId[] = ['overview', 'eq', 'mixer', 'processing', 'presets', 'system'];

const TAB_IDS: ReadonlySet<TabId> = new Set(TAB_ORDER);

export interface Settings {
  version: 1;
  theme: 'dark' | 'light';
  showDebugStats: boolean;
  tab: TabId;
  eqTarget: ChannelId | null;
  soft: {
    muted: boolean;
    mutedFromDb: number | null;
  };
  lastSerial: string | null;
  warnOnPresetSwitchDirty: boolean;
}

const STORAGE_KEY = 'dspi-console-web/settings/v1';

function defaults(): Settings {
  return {
    version: 1,
    theme: 'dark',
    showDebugStats: false,
    tab: 'overview',
    eqTarget: null,
    soft: { muted: false, mutedFromDb: null },
    lastSerial: null,
    warnOnPresetSwitchDirty: true,
  };
}


// Per-field validators. Each accepts unknown input and falls back to a
// default rather than throwing
// ------------------------------
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function tabId(v: unknown, fallback: TabId): TabId {
  return typeof v === 'string' && TAB_IDS.has(v as TabId) ? (v as TabId) : fallback;
}
function channelIdOrNull(v: unknown): ChannelId | null {
  return typeof v === 'number' ? (v as ChannelId) : null;
}
function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function theme(v: unknown): 'dark' | 'light' {
  return v === 'light' ? 'light' : 'dark';
}

function safeJSON(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseV1(raw: string, fallback: Settings): Settings {
  const obj = safeJSON(raw);
  if (!obj) return fallback;
  const soft = (obj.soft && typeof obj.soft === 'object') ? (obj.soft as Record<string, unknown>) : {};
  return {
    version: 1,
    theme: theme(obj.theme),
    showDebugStats: bool(obj.showDebugStats, fallback.showDebugStats),
    tab: tabId(obj.tab, fallback.tab),
    eqTarget: channelIdOrNull(obj.eqTarget),
    soft: {
      muted: bool(soft.muted, false),
      mutedFromDb: numberOrNull(soft.mutedFromDb),
    },
    lastSerial: stringOrNull(obj.lastSerial),
    warnOnPresetSwitchDirty: bool(obj.warnOnPresetSwitchDirty, true),
  };
}

// LEGACY MIGRATION -- REMOVE AFTER 2026-Q4 (or when telemetry confirms
// no remaining users on legacy keys, whichever comes first).
//
// Reads pre-v1 keys ('ui/v2', 'connection/v1'), produces a v1 Settings,
// persists it, deletes the legacy keys. Returns null when no legacy
// data is present (true first-run).
//
// Once removed, loadSettings() collapses to: read v1 or return defaults
//
function migrateLegacyKeys(): Settings | null {
  if (!hasStorage()) return null;
  const ui = safeJSON(localStorage.getItem('dspi-console-web/ui/v2'));
  const conn = safeJSON(localStorage.getItem('dspi-console-web/connection/v1'));
  if (!ui && !conn) return null;

  const merged: Settings = {
    ...defaults(),
    showDebugStats: bool(ui?.showDebugStats, false),
    tab: tabId(ui?.tab, 'overview'),
    eqTarget: channelIdOrNull(ui?.eqTarget),
    soft: {
      muted: bool(ui?.muted, false),
      mutedFromDb: numberOrNull(ui?.mutedFromDb),
    },
    lastSerial: stringOrNull(conn?.lastSerial),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  localStorage.removeItem('dspi-console-web/ui/v2');
  localStorage.removeItem('dspi-console-web/connection/v1');
  return merged;
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  if (!hasStorage()) return defaults();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) return parseV1(raw, defaults());
  return migrateLegacyKeys() ?? defaults();
}

// Reactive store, hydrated once at module load.
export const settings = $state<Settings>(loadSettings());

export function setShowDebugStats(value: boolean): void {
  settings.showDebugStats = value;
}
export function setTab(t: TabId): void {
  settings.tab = t;
}
export function setEqTarget(id: ChannelId | null): void {
  settings.eqTarget = id;
}

// After connection sync hydrates dsp.live, validate the persisted eqTarget
// against the connected platform's channel set. If the stored ID isn't
// in dsp.live.channels (e.g. user reconnected to a smaller-platform
// device), fall back to the first output channel. eqTarget === null
// stays null -- explicit "no selection" is a valid persisted state.
export function reconcileEqTarget(): void {
  const target = settings.eqTarget;
  if (target === null) return;
  const channels = dsp.live?.channels;
  if (!channels) return;
  if (channels.some((c) => c.id === target)) return;
  const firstOutput = channels.find((c) => c.isOutput);
  settings.eqTarget = firstOutput?.id ?? null;
}

export function startSettingsPersistence(): void {
  if (!hasStorage()) return;
  $effect.root(() => {
    $effect(() => {
      const snap: Settings = {
        version: 1,
        theme: settings.theme,
        showDebugStats: settings.showDebugStats,
        tab: settings.tab,
        eqTarget: settings.eqTarget,
        soft: { muted: settings.soft.muted, mutedFromDb: settings.soft.mutedFromDb },
        lastSerial: settings.lastSerial,
        warnOnPresetSwitchDirty: settings.warnOnPresetSwitchDirty,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    });
    return () => {};
  });
}
