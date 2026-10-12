// Per-session EQ link lock state. Group membership is derived from the live
// snapshot; only the locked flag per group is a persisted preference.

import { SvelteSet } from 'svelte/reactivity';
import { eqLinkGroupKey, eqLinkGroupOf, type ChannelId, type EqLinkGroup } from '@/domain';

const STORAGE_KEY = 'dspi-console-web/eq-link/v1';

export interface EqLinkState {
  readonly groups: readonly EqLinkGroup[];
  groupOf(id: ChannelId): EqLinkGroup | null;
  isLocked(id: ChannelId): boolean;
  membersOf(id: ChannelId): ChannelId[];
  peersOf(id: ChannelId): ChannelId[];
  setLocked(id: ChannelId, on: boolean): void;
}

function readRecord(): Record<string, string[]> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [serial, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) out[serial] = keys.filter((k): k is string => typeof k === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

function writeRecord(record: Record<string, string[]>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable or full: the lock stays session-local.
  }
}

export function createEqLinkState(serial: string, groups: () => readonly EqLinkGroup[]): EqLinkState {
  const locked = new SvelteSet<string>(readRecord()[serial] ?? []);
  const current = $derived(groups());

  function groupOf(id: ChannelId): EqLinkGroup | null {
    return eqLinkGroupOf(current, id);
  }
  function isLocked(id: ChannelId): boolean {
    const g = groupOf(id);
    return g !== null && locked.has(eqLinkGroupKey(g));
  }
  function membersOf(id: ChannelId): ChannelId[] {
    const g = groupOf(id);
    return g !== null && locked.has(eqLinkGroupKey(g)) ? [...g] : [id];
  }

  return {
    get groups() { return current; },
    groupOf,
    isLocked,
    membersOf,
    peersOf(id) { return membersOf(id).filter((m) => m !== id); },
    setLocked(id, on) {
      const g = groupOf(id);
      if (g === null) return;
      const key = eqLinkGroupKey(g);
      if (on) locked.add(key); else locked.delete(key);
      writeRecord({ ...readRecord(), [serial]: [...locked] });
    },
  };
}
