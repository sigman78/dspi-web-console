// AutoEQ headphone-profile library: DB fetch state, favorites, and user-saved
// entries. Favorites/user entries live in reactive state (hydrated from
// localStorage by ensureAutoEqDb or the first mutation -- never during render)
// and persist back on every mutation.

import type { AutoEqEntry, AutoEqDatabase, FilterParams } from '@/domain';
import { autoEqDisplayName, bandsToAutoEqFilters, roundAutoEqValue } from '@/domain';
import { errMessage } from '@/utils';

export type AutoEqDbStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AutoEqDbState {
  status: AutoEqDbStatus;
  generatedAt: string | null;
  error: string | null;
}

export const autoEqDb = $state<AutoEqDbState>({
  status: 'idle',
  generatedAt: null,
  error: null,
});

// DB entries are immutable after load: a raw signal (reassigned wholesale,
// never mutated) keeps the ~4k-entry tree free of deep proxies and signals.
let dbEntries = $state.raw<AutoEqEntry[]>([]);

export function autoEqEntries(): AutoEqEntry[] {
  return dbEntries;
}

export function setAutoEqEntries(entries: AutoEqEntry[]): void {
  dbEntries = entries;
}

function isAutoEqDatabase(v: unknown): v is AutoEqDatabase {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.version === 'number' && typeof d.generatedAt === 'string'
    && typeof d.entryCount === 'number' && Array.isArray(d.entries);
}

export function ensureAutoEqDb(): void {
  if (!library.hydrated) hydrateAutoEqLibrary();
  if (autoEqDb.status === 'loading' || autoEqDb.status === 'ready') return;
  autoEqDb.status = 'loading';
  autoEqDb.error = null;
  void fetch(`${import.meta.env.BASE_URL}autoeq-db.json`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const data: unknown = await r.json();
      if (!isAutoEqDatabase(data)) throw new Error('invalid AutoEQ database payload');
      dbEntries = data.entries;
      autoEqDb.generatedAt = data.generatedAt;
      autoEqDb.status = 'ready';
    })
    .catch((e: unknown) => {
      autoEqDb.status = 'error';
      autoEqDb.error = errMessage(e);
    });
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
}

function safeJSON(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const FAVS_KEY = 'dspi-console-web/autoeq-favs/v1';

interface AutoEqLibrary {
  hydrated: boolean;
  favIds: string[];
  userEntries: AutoEqEntry[];
}

const library = $state<AutoEqLibrary>({ hydrated: false, favIds: [], userEntries: [] });

// Re-reads localStorage into the reactive state. Must not run during render
// (readers below stay pure); mutators and ensureAutoEqDb call it on demand.
export function hydrateAutoEqLibrary(): void {
  library.favIds = loadFavIds();
  library.userEntries = loadUserEntries();
  library.hydrated = true;
}

function favIds(): string[] {
  if (!library.hydrated) hydrateAutoEqLibrary();
  return library.favIds;
}

function loadFavIds(): string[] {
  if (!hasStorage()) return [];
  const parsed = safeJSON(localStorage.getItem(FAVS_KEY));
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
}

function saveFavIds(): void {
  if (!hasStorage()) return;
  localStorage.setItem(FAVS_KEY, JSON.stringify(library.favIds));
}

export function isAutoEqFavorite(id: string): boolean {
  return library.favIds.includes(id);
}

export function toggleAutoEqFavorite(id: string): void {
  const ids = favIds();
  const i = ids.indexOf(id);
  if (i === -1) ids.push(id); else ids.splice(i, 1);
  saveFavIds();
}

const USER_KEY = 'dspi-console-web/autoeq-user/v1';

function isAutoEqEntry(v: unknown): v is AutoEqEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.manufacturer === 'string' && typeof e.model === 'string'
    && typeof e.source === 'string' && typeof e.formFactor === 'string'
    && typeof e.preamp === 'number' && Array.isArray(e.filters);
}

function userEntries(): AutoEqEntry[] {
  if (!library.hydrated) hydrateAutoEqLibrary();
  return library.userEntries;
}

function loadUserEntries(): AutoEqEntry[] {
  if (!hasStorage()) return [];
  const parsed = safeJSON(localStorage.getItem(USER_KEY));
  return Array.isArray(parsed) ? parsed.filter(isAutoEqEntry) : [];
}

function saveUserEntries(): void {
  if (!hasStorage()) return;
  localStorage.setItem(USER_KEY, JSON.stringify(library.userEntries));
}

export function saveAutoEqUserEntry(name: string, preamp: number, bands: FilterParams[]): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const id = `user/${trimmed}`;
  const entry: AutoEqEntry = {
    id,
    manufacturer: trimmed,
    model: '',
    source: 'user',
    formFactor: 'custom',
    preamp: roundAutoEqValue(preamp, 2),
    filters: bandsToAutoEqFilters(bands),
  };
  const entries = userEntries();
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) entries.push(entry); else entries[i] = entry;
  saveUserEntries();
}

export function deleteAutoEqUserEntry(id: string): void {
  const entries = userEntries();
  const i = entries.findIndex((e) => e.id === id);
  if (i !== -1) entries.splice(i, 1);
  const f = library.favIds.indexOf(id);
  if (f !== -1) library.favIds.splice(f, 1);
  saveUserEntries();
  saveFavIds();
}

export function searchAutoEq(query: string, scope: 'all' | 'favs' | 'user'): AutoEqEntry[] {
  const q = query.trim().toLowerCase();
  const matches = (e: AutoEqEntry): boolean =>
    !q
    || e.manufacturer.toLowerCase().includes(q)
    || e.model.toLowerCase().includes(q)
    || autoEqDisplayName(e).toLowerCase().includes(q);

  const user = library.userEntries;
  if (scope === 'user') return user.filter(matches);
  if (scope === 'favs') {
    const favs = library.favIds;
    return [...user, ...dbEntries].filter((e) => favs.includes(e.id) && matches(e));
  }
  return [...user.filter(matches), ...dbEntries.filter(matches)];
}
