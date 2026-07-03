import type { ChannelId, ChannelModel } from '@/domain';

export type TabId = 'overview' | 'eq' | 'mixer' | 'processing' | 'presets' | 'system';

export const TAB_ORDER: readonly TabId[] = ['overview', 'eq', 'mixer', 'processing', 'presets', 'system'];

export const TAB_META: Record<TabId, { label: string; code: string }> = {
  overview:   { label: 'OVERVIEW',   code: '01' },
  eq:         { label: 'EQUALIZER',  code: '02' },
  mixer:      { label: 'MIXER',      code: '03' },
  processing: { label: 'PROCESSING', code: '04' },
  presets:    { label: 'PRESETS',    code: '05' },
  system:     { label: 'SYSTEM',     code: '06' },
};

const TAB_IDS: ReadonlySet<TabId> = new Set(TAB_ORDER);

export interface Settings {
  version: 1;
  tab: TabId;
  selectedChannel: ChannelId | null;
  lastSerial: string | null;
  warnOnPresetSwitchDirty: boolean;
}

const STORAGE_KEY = 'dspi-console-web/settings/v1';

function defaults(): Settings {
  return {
    version: 1,
    tab: 'overview',
    selectedChannel: null,
    lastSerial: null,
    warnOnPresetSwitchDirty: true,
  };
}


// Per-field validators: accept unknown input, fall back to a default not throw.
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function tabId(v: unknown, fallback: TabId): TabId {
  return typeof v === 'string' && TAB_IDS.has(v as TabId) ? (v as TabId) : fallback;
}
function channelIdOrNull(v: unknown): ChannelId | null {
  return typeof v === 'number' ? (v as ChannelId) : null;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
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
  return {
    version: 1,
    tab: tabId(obj.tab, fallback.tab),
    // Legacy fallback: the field was persisted as `eqTarget` before the rail
    // generalized selection beyond the EQ tab. Read it when the new key is absent.
    selectedChannel: channelIdOrNull(obj.selectedChannel ?? obj.eqTarget),
    lastSerial: stringOrNull(obj.lastSerial),
    warnOnPresetSwitchDirty: bool(obj.warnOnPresetSwitchDirty, true),
  };
}

// LEGACY MIGRATION -- REMOVE AFTER 2026-Q4. Reads pre-v1 keys ('ui/v2',
// 'connection/v1'), produces and persists a v1 Settings, deletes the legacy
// keys. Returns null when no legacy data is present (true first-run).
function migrateLegacyKeys(): Settings | null {
  if (!hasStorage()) return null;
  const ui = safeJSON(localStorage.getItem('dspi-console-web/ui/v2'));
  const conn = safeJSON(localStorage.getItem('dspi-console-web/connection/v1'));
  if (!ui && !conn) return null;

  const merged: Settings = {
    ...defaults(),
    tab: tabId(ui?.tab, 'overview'),
    selectedChannel: channelIdOrNull(ui?.eqTarget),
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

// Initialized to defaults at module load; restoreSettings() applies persisted
// values explicitly, so importing this module is pure (no localStorage I/O).
export const settings = $state<Settings>(defaults());

// Mutates `settings` in place from storage, once during startup before mounting
// and before startSettingsPersistence(). In-place preserves the exported
// reference's identity so prior imports stay valid.
export function restoreSettings(): void {
  const loaded = loadSettings();
  settings.version = loaded.version;
  settings.tab = loaded.tab;
  settings.selectedChannel = loaded.selectedChannel;
  settings.lastSerial = loaded.lastSerial;
  settings.warnOnPresetSwitchDirty = loaded.warnOnPresetSwitchDirty;
}

export function setTab(t: TabId): void {
  settings.tab = t;
}
export function setSelectedChannel(id: ChannelId | null): void {
  settings.selectedChannel = id;
}
// Rail selection: pick a channel globally and land on the EQ tab to edit it.
export function selectChannel(id: ChannelId): void {
  setSelectedChannel(id);
  setTab('eq');
}

// Validate the persisted selection against the connected platform's channel set;
// if the stored ID isn't present (e.g. reconnected to a smaller device), fall
// back to the first output. null stays null -- "no selection" is valid.
export function reconcileSelectedChannel(channels: readonly ChannelModel[] | undefined): void {
  const target = settings.selectedChannel;
  if (target === null) return;
  if (!channels) return;
  if (channels.some((c) => c.id === target)) return;
  const firstOutput = channels.find((c) => c.isOutput);
  settings.selectedChannel = firstOutput?.id ?? null;
}

export function startSettingsPersistence(): void {
  if (!hasStorage()) return;
  $effect.root(() => {
    $effect(() => {
      const snap: Settings = {
        version: 1,
        tab: settings.tab,
        selectedChannel: settings.selectedChannel,
        lastSerial: settings.lastSerial,
        warnOnPresetSwitchDirty: settings.warnOnPresetSwitchDirty,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    });
    return () => {};
  });
}
