import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  autoEqDb, autoEqEntries, setAutoEqEntries, ensureAutoEqDb, hydrateAutoEqLibrary,
  isAutoEqFavorite, toggleAutoEqFavorite,
  saveAutoEqUserEntry, deleteAutoEqUserEntry,
  searchAutoEq,
} from './autoEq.svelte';
import { FilterType, defaultFilter, type FilterParams } from '@/domain';

const FAVS_KEY = 'dspi-console-web/autoeq-favs/v1';
const USER_KEY = 'dspi-console-web/autoeq-user/v1';

function resetDbState() {
  autoEqDb.status = 'idle';
  setAutoEqEntries([]);
  autoEqDb.generatedAt = null;
  autoEqDb.error = null;
}

const band = (freq: number): FilterParams => ({ type: FilterType.Peaking, bypass: false, frequency: freq, q: 1, gain: 3 });
const bands10 = (freq: number): FilterParams[] => [band(freq), ...Array.from({ length: 9 }, () => defaultFilter())];

beforeEach(() => {
  localStorage.clear();
  hydrateAutoEqLibrary();
  resetDbState();
});
afterEach(() => {
  localStorage.clear();
  resetDbState();
  vi.unstubAllGlobals();
});

describe('user entries', () => {
  it('saves a new entry, persisted to localStorage', () => {
    saveAutoEqUserEntry('My Cans', -4, bands10(1000));
    const stored = JSON.parse(localStorage.getItem(USER_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('user/My Cans');
    expect(stored[0].preamp).toBe(-4);
    expect(stored[0].filters[0]).toMatchObject({ type: 'peaking', freq: 1000 });
  });

  it('overwrites an existing entry with the same trimmed name instead of duplicating it', () => {
    saveAutoEqUserEntry('My Cans', -4, bands10(1000));
    saveAutoEqUserEntry('  My Cans  ', -2, bands10(2000));
    const results = searchAutoEq('', 'user');
    expect(results).toHaveLength(1);
    expect(results[0].preamp).toBe(-2);
    expect(results[0].filters[0]).toMatchObject({ freq: 2000 });
  });

  it('is a no-op for an empty or whitespace-only name', () => {
    saveAutoEqUserEntry('   ', -4, bands10(1000));
    expect(searchAutoEq('', 'user')).toHaveLength(0);
  });

  it('deletes an entry by id', () => {
    saveAutoEqUserEntry('Keep Me', 0, bands10(500));
    saveAutoEqUserEntry('Delete Me', 0, bands10(500));
    deleteAutoEqUserEntry('user/Delete Me');
    const results = searchAutoEq('', 'user');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('user/Keep Me');
  });

  it('deleting an entry also removes it from favorites', () => {
    saveAutoEqUserEntry('Faved', 0, bands10(500));
    toggleAutoEqFavorite('user/Faved');
    expect(isAutoEqFavorite('user/Faved')).toBe(true);
    deleteAutoEqUserEntry('user/Faved');
    expect(isAutoEqFavorite('user/Faved')).toBe(false);
  });
});

describe('favorites', () => {
  it('toggles a favorite on then off, persisting to localStorage each time', () => {
    expect(isAutoEqFavorite('crinacle/Foo Bar')).toBe(false);
    toggleAutoEqFavorite('crinacle/Foo Bar');
    expect(isAutoEqFavorite('crinacle/Foo Bar')).toBe(true);
    expect(JSON.parse(localStorage.getItem(FAVS_KEY)!)).toEqual(['crinacle/Foo Bar']);

    toggleAutoEqFavorite('crinacle/Foo Bar');
    expect(isAutoEqFavorite('crinacle/Foo Bar')).toBe(false);
    expect(JSON.parse(localStorage.getItem(FAVS_KEY)!)).toEqual([]);
  });
});

describe('searchAutoEq scoping', () => {
  beforeEach(() => {
    setAutoEqEntries([
      { id: 'oratory1990/Sony WH-1000XM4', manufacturer: 'Sony', model: 'WH-1000XM4', source: 'oratory1990', formFactor: 'over-ear', preamp: -6, filters: [] },
      { id: 'crinacle/Foo Bar', manufacturer: 'Foo', model: 'Bar', source: 'crinacle', formFactor: 'in-ear', preamp: -3, filters: [] },
    ]);
    saveAutoEqUserEntry('My Custom', -2, bands10(1000));
  });

  it('scope "all" lists user entries before db entries', () => {
    const results = searchAutoEq('', 'all');
    expect(results.map((e) => e.id)).toEqual(['user/My Custom', 'oratory1990/Sony WH-1000XM4', 'crinacle/Foo Bar']);
  });

  it('scope "user" returns only user entries', () => {
    const results = searchAutoEq('', 'user');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('user');
  });

  it('scope "favs" returns only favorited entries, from either source', () => {
    toggleAutoEqFavorite('crinacle/Foo Bar');
    toggleAutoEqFavorite('user/My Custom');
    const results = searchAutoEq('', 'favs');
    expect(results.map((e) => e.id).sort()).toEqual(['crinacle/Foo Bar', 'user/My Custom']);
  });

  it('filters by query against manufacturer/model/display name, case-insensitively', () => {
    const results = searchAutoEq('sony', 'all');
    expect(results.map((e) => e.id)).toEqual(['oratory1990/Sony WH-1000XM4']);
  });
});

describe('ensureAutoEqDb', () => {
  it('fetches and validates the database, landing in ready with its entries', async () => {
    const payload = {
      version: 1,
      generatedAt: '2026-01-18T05:41:39.649194+00:00',
      entryCount: 1,
      entries: [{ id: 'a/b', manufacturer: 'a', model: 'b', source: 'crinacle', formFactor: 'in-ear', preamp: 0, filters: [] }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
    ensureAutoEqDb();
    expect(autoEqDb.status).toBe('loading');
    await vi.waitFor(() => expect(autoEqDb.status).toBe('ready'));
    expect(autoEqEntries()).toHaveLength(1);
    expect(autoEqDb.generatedAt).toBe(payload.generatedAt);
  });

  it('is a no-op while already loading or ready', () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchFn);
    ensureAutoEqDb();
    ensureAutoEqDb();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('lands in error status on an invalid payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ notADatabase: true }) })));
    ensureAutoEqDb();
    await vi.waitFor(() => expect(autoEqDb.status).toBe('error'));
    expect(autoEqDb.error).toBeTruthy();
  });

  it('retries after a prior error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    ensureAutoEqDb();
    await vi.waitFor(() => expect(autoEqDb.status).toBe('error'));

    const payload = {
      version: 1, generatedAt: '2026-01-18T05:41:39.649194+00:00', entryCount: 0, entries: [],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
    ensureAutoEqDb();
    expect(autoEqDb.status).toBe('loading');
    await vi.waitFor(() => expect(autoEqDb.status).toBe('ready'));
  });
});
