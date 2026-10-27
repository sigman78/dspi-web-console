// Per-session console-local drafts for the control-surface editors. A draft is
// an edit that has not been sent to the device; it outlives the panel that
// created it, so navigating away neither loses it nor hides it from the
// unload and device-switch guards.

export type DraftFamily = 'cs' | 'macros' | 'groups' | 'ir' | 'display';

const FAMILIES: readonly DraftFamily[] = ['cs', 'macros', 'groups', 'ir', 'display'];

interface Entry {
  value: unknown;
  // Whether the draft differs from device truth. The owning panel keeps this
  // current while mounted; it is what the guards count after it unmounts.
  dirty: boolean;
}

export interface DraftFamilyView<T> {
  keys(): number[];
  draftOf(key: number): T | undefined;
  editDraft(key: number, value: T, dirty?: boolean): void;
  isDirty(key: number): boolean;
  setDirty(key: number, dirty: boolean): void;
  // Drop a draft the user abandoned, or one the device has since accepted.
  revert(key: number): void;
  remove(key: number): void;
  clear(): void;
  dirtyCount(): number;
}

export interface DraftsState {
  of<T>(family: DraftFamily): DraftFamilyView<T>;
  clearAll(): void;
  dirtyCount(family?: DraftFamily): number;
}

export function createDraftsState(): DraftsState {
  const store = $state<Record<DraftFamily, Record<number, Entry>>>({
    cs: {}, macros: {}, groups: {}, ir: {}, display: {},
  });

  function dirtyIn(family: DraftFamily): number {
    return Object.values(store[family]).filter((e) => e.dirty).length;
  }
  function removeKey(family: DraftFamily, key: number): void {
    delete store[family][key];
  }

  return {
    of<T>(family: DraftFamily): DraftFamilyView<T> {
      const rec = store[family];
      return {
        keys: () => Object.keys(rec).map(Number),
        draftOf: (key) => rec[key]?.value as T | undefined,
        editDraft(key, value, dirty = true) { rec[key] = { value, dirty }; },
        isDirty: (key) => rec[key]?.dirty === true,
        setDirty(key, dirty) {
          const e = rec[key];
          if (e && e.dirty !== dirty) e.dirty = dirty;
        },
        revert: (key) => removeKey(family, key),
        remove: (key) => removeKey(family, key),
        clear() { for (const k of Object.keys(rec)) delete rec[Number(k)]; },
        dirtyCount: () => dirtyIn(family),
      };
    },
    clearAll() {
      for (const f of FAMILIES) for (const k of Object.keys(store[f])) delete store[f][Number(k)];
    },
    dirtyCount(family) {
      return family ? dirtyIn(family) : FAMILIES.reduce((n, f) => n + dirtyIn(f), 0);
    },
  };
}
