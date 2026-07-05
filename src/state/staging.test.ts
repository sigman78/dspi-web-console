import { describe, it, expect, beforeEach } from 'vitest';
import { createStagingState, type StagedEntry, type StagingState } from './staging.svelte';
import { notices, clearNotices } from './notices.svelte';
import type { DspSnapshot } from '@/domain';

function entry(overrides: Partial<StagedEntry> = {}): StagedEntry {
  return {
    key: 'k1',
    label: 'Thing',
    from: 'a',
    to: 'b',
    value: 'b',
    order: 10,
    apply: async () => true,
    overlay: (snap) => snap,
    ...overrides,
  };
}

describe('createStagingState', () => {
  let staging: StagingState;
  beforeEach(() => {
    staging = createStagingState();
    clearNotices();
  });

  it('stage() upserts by key: a second stage with the same key replaces, not duplicates', () => {
    staging.stage(entry({ key: 'k1', to: 'b' }));
    staging.stage(entry({ key: 'k1', to: 'c' }));
    expect(staging.entries).toHaveLength(1);
    expect(staging.entries[0].to).toBe('c');
  });

  it('has()/get() reflect staged keys', () => {
    expect(staging.has('k1')).toBe(false);
    staging.stage(entry({ key: 'k1' }));
    expect(staging.has('k1')).toBe(true);
    expect(staging.get('k1')?.key).toBe('k1');
  });

  it('discard() removes a staged entry (the "value equals live" path a stage helper takes)', () => {
    staging.stage(entry({ key: 'k1' }));
    staging.discard('k1');
    expect(staging.has('k1')).toBe(false);
  });

  it('discardAll() clears every entry', () => {
    staging.stage(entry({ key: 'k1' }));
    staging.stage(entry({ key: 'k2' }));
    staging.discardAll();
    expect(staging.entries).toHaveLength(0);
  });

  it('valueOf() returns the staged value when present, else the live value passed in', () => {
    expect(staging.valueOf('k1', 'live')).toBe('live');
    staging.stage(entry({ key: 'k1', value: 'staged' }));
    expect(staging.valueOf('k1', 'live')).toBe('staged');
  });

  it('overlaySnapshot() folds staged overlays over the input without mutating it', () => {
    const snap = { outputPins: [1, 2, 3] } as unknown as DspSnapshot;
    staging.stage(entry({
      key: 'k1',
      overlay: (s) => ({ ...s, outputPins: [9, ...(s as any).outputPins.slice(1)] }) as DspSnapshot,
    }));
    const result = staging.overlaySnapshot(snap);
    expect((result as any).outputPins).toEqual([9, 2, 3]);
    expect((snap as any).outputPins).toEqual([1, 2, 3]);
  });

  describe('applyAll()', () => {
    it('applies staged entries in ascending order', async () => {
      const calls: string[] = [];
      staging.stage(entry({ key: 'second', order: 20, apply: async () => { calls.push('second'); return true; } }));
      staging.stage(entry({ key: 'first', order: 10, apply: async () => { calls.push('first'); return true; } }));
      await staging.applyAll();
      expect(calls).toEqual(['first', 'second']);
    });

    it('removes every entry after a fully successful run', async () => {
      staging.stage(entry({ key: 'k1', order: 10 }));
      staging.stage(entry({ key: 'k2', order: 20 }));
      await staging.applyAll();
      expect(staging.entries).toHaveLength(0);
    });

    it('halts on the first failure, leaving the failed entry and later ones staged', async () => {
      const calls: string[] = [];
      staging.stage(entry({ key: 'ok', order: 10, apply: async () => { calls.push('ok'); return true; } }));
      staging.stage(entry({ key: 'bad', order: 20, apply: async () => { calls.push('bad'); return false; } }));
      staging.stage(entry({ key: 'later', order: 30, apply: async () => { calls.push('later'); return true; } }));
      await staging.applyAll();
      expect(calls).toEqual(['ok', 'bad']);         // 'later' never attempted
      expect(staging.has('ok')).toBe(false);        // succeeded — removed
      expect(staging.has('bad')).toBe(true);        // failed — stays staged
      expect(staging.has('later')).toBe(true);       // stays staged
    });

    it('pushes exactly one summary notice after a full success of 2+ entries', async () => {
      staging.stage(entry({ key: 'k1', order: 10 }));
      staging.stage(entry({ key: 'k2', order: 20 }));
      await staging.applyAll();
      expect(notices.list.filter((n) => n.kind === 'info')).toHaveLength(1);
    });

    it('does not push a summary notice for a single-entry apply', async () => {
      staging.stage(entry({ key: 'k1', order: 10 }));
      await staging.applyAll();
      expect(notices.list.filter((n) => n.kind === 'info')).toHaveLength(0);
    });

    it('does not push a summary notice when the run fails partway', async () => {
      staging.stage(entry({ key: 'ok', order: 10 }));
      staging.stage(entry({ key: 'bad', order: 20, apply: async () => false }));
      await staging.applyAll();
      expect(notices.list.filter((n) => n.kind === 'info')).toHaveLength(0);
    });

    it('reentry guard: a concurrent applyAll() call is a no-op while one is in flight', async () => {
      let resolveFirst!: (v: boolean) => void;
      const calls: string[] = [];
      staging.stage(entry({
        key: 'k1',
        apply: () => new Promise<boolean>((res) => { resolveFirst = res; calls.push('apply'); }),
      }));
      const first = staging.applyAll();
      const second = staging.applyAll();
      expect(staging.applying).toBe(true);
      resolveFirst(true);
      await Promise.all([first, second]);
      expect(calls).toEqual(['apply']);   // the second call never invoked apply again
    });
  });
});
