// Per-session staging area for heavy device-config settings (input source,
// I2S/S/PDIF pins, MCK/BCK, output type) that each trigger an audible
// firmware pipeline restart. Panels stage a pending value here instead of
// writing it straight to the device; PendingChangesBar's APPLY commits every
// staged entry in order as one batch, so the device restarts once instead of
// once per control.

import type { DspSnapshot } from '@/domain';
import { pushNotice } from './notices.svelte';

export interface StagedEntry {
  key: string;
  label: string;
  from: string;
  to: string;
  value: unknown;
  order: number;
  apply: () => Promise<boolean>;
  overlay: (snap: DspSnapshot) => DspSnapshot;
}

export interface StagingState {
  readonly entries: StagedEntry[];
  readonly applying: boolean;
  has(key: string): boolean;
  get(key: string): StagedEntry | undefined;
  valueOf<T>(key: string, live: T): T;
  stage(entry: StagedEntry): void;
  discard(key: string): void;
  discardAll(): void;
  overlaySnapshot(snap: DspSnapshot): DspSnapshot;
  applyAll(): Promise<void>;
}

export function createStagingState(): StagingState {
  const state = $state<{ entries: StagedEntry[]; applying: boolean }>({
    entries: [],
    applying: false,
  });

  function get(key: string): StagedEntry | undefined {
    return state.entries.find((e) => e.key === key);
  }
  function discard(key: string): void {
    const i = state.entries.findIndex((e) => e.key === key);
    if (i !== -1) state.entries.splice(i, 1);
  }

  return {
    get entries() { return state.entries; },
    get applying() { return state.applying; },

    has(key) { return get(key) !== undefined; },
    get,
    valueOf<T>(key: string, live: T): T {
      const e = get(key);
      return e ? (e.value as T) : live;
    },
    stage(entry) {
      const i = state.entries.findIndex((e) => e.key === entry.key);
      if (i === -1) state.entries.push(entry);
      else state.entries[i] = entry;
    },
    discard,
    discardAll() { state.entries.length = 0; },
    overlaySnapshot(snap) {
      return state.entries.reduce((acc, e) => e.overlay(acc), snap);
    },
    async applyAll() {
      if (state.applying) return;
      state.applying = true;
      try {
        const ordered = state.entries.slice().sort((a, b) => a.order - b.order);
        let applied = 0;
        for (const entry of ordered) {
          const ok = await entry.apply();
          if (!ok) return;
          discard(entry.key);
          applied += 1;
        }
        if (applied >= 2) pushNotice('info', `Applied ${applied} pending changes.`);
      } finally {
        state.applying = false;
      }
    },
  };
}
