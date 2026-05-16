import { describe, it, expect, beforeEach } from 'vitest';
import { bootMock } from './session';
import { presets, resetPresets, boundary, resolveBoundary } from '../state/presets.svelte';
import { settings } from '../state/settings.svelte';
import { session } from '../state/session.svelte';
import { dsp } from '../state/dsp.svelte';
import { PresetStartupMode } from '../protocol/wireTypes';
import type { PresetSlot } from '../domain/presetLimits';
import {
  fetchPresetInfo,
  saveActivePreset,
  savePresetSlot,
  loadPresetSlot,
  deletePresetSlot,
  revertActivePreset,
  renamePresetSlot,
  setStartupDefault,
  setStartupMode,
  pastePresetTo,
} from './presets';

describe('runtime/presets', () => {
  beforeEach(async () => {
    resetPresets();
    await bootMock('rp2350');
  });

  describe('fetchPresetInfo', () => {
    it('populates directory, names, and active', async () => {
      await fetchPresetInfo();
      expect(presets.directory).not.toBe(null);
      expect(presets.names.every((n) => n !== null)).toBe(true);
      expect(presets.active === null || (presets.active! >= 0 && presets.active! < 10)).toBe(true);
    });

    it('is idempotent when cache is populated', async () => {
      await fetchPresetInfo();
      const before = presets.directory;
      await fetchPresetInfo();
      expect(presets.directory).toBe(before);
    });

    it('continues populating directory when an individual getPresetName fails', async () => {
      // Replace the device.getPresetName to fail for slot 7 only.
      const realDevice = session.device!;
      const origGetName = realDevice.getPresetName.bind(realDevice);
      (realDevice as any).getPresetName = async (slot: number) => {
        if (slot === 7) throw new Error('simulated slot-7 failure');
        return origGetName(slot as PresetSlot);
      };
      try {
        await fetchPresetInfo();
        expect(presets.directory).not.toBe(null);
        expect(presets.names[7]).toBe(''); // failed slot becomes empty
        expect(presets.lastFetchError).toBe(null); // names failures don't set the directory-level error
      } finally {
        (realDevice as any).getPresetName = origGetName;
      }
    });

    it('sets lastFetchError when directory fetch fails', async () => {
      const realDevice = session.device!;
      const origGetDir = realDevice.getPresetDirectory.bind(realDevice);
      (realDevice as any).getPresetDirectory = async () => {
        throw new Error('simulated directory failure');
      };
      try {
        // need to clear cache first since previous tests populated it
        presets.directory = null;
        presets.lastFetchError = null;
        await fetchPresetInfo();
        expect(presets.directory).toBe(null);
        expect(presets.lastFetchError).toContain('Directory fetch failed');
      } finally {
        (realDevice as any).getPresetDirectory = origGetDir;
      }
    });
  });

  describe('saveActivePreset', () => {
    it('saves to the active slot and advances the baseline', async () => {
      await fetchPresetInfo();
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
      const before = dsp.shadow?.bypass;
      const after  = dsp.live?.bypass;
      expect(before).not.toBe(after);
      const r = await saveActivePreset();
      expect(r.ok).toBe(true);
      expect(dsp.shadow?.bypass).toBe(after);
    });
  });

  describe('loadPresetSlot', () => {
    it('updates active and refreshes baseline (via fullSync)', async () => {
      await fetchPresetInfo();
      await saveActivePreset();
      const r = await loadPresetSlot(0 as any);
      expect(r.ok).toBe(true);
      expect(presets.active).toBe(0);
    });
  });

  describe('deletePresetSlot', () => {
    it('clears the occupied bit', async () => {
      await fetchPresetInfo();
      const prevActive = presets.active;
      if (prevActive == null) {
        await loadPresetSlot(0 as any);
      }
      await renamePresetSlot(5 as any, 'Test');
      const r = await deletePresetSlot(5 as any);
      expect(r.ok).toBe(true);
      expect(presets.directory!.occupiedSlotsSet.has(5 as any)).toBe(false);
    });

    it('rejects deleting the active slot', async () => {
      await fetchPresetInfo();
      const active = presets.active ?? 0 as any;
      const r = await deletePresetSlot(active);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('active');
    });
  });

  describe('revertActivePreset', () => {
    it('reloads the active slot', async () => {
      await fetchPresetInfo();
      await saveActivePreset();
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
      const r = await revertActivePreset();
      expect(r.ok).toBe(true);
    });
  });

  describe('renamePresetSlot', () => {
    it('updates the cached name', async () => {
      await fetchPresetInfo();
      await renamePresetSlot(2 as any, 'Cinema');
      expect(presets.names[2]).toBe('Cinema');
    });
  });

  describe('setStartupDefault / setStartupMode', () => {
    it('writes startup config and updates the directory cache', async () => {
      await fetchPresetInfo();
      await setStartupDefault(4 as any);
      expect(presets.directory!.startupMode).toBe(PresetStartupMode.Specified);
      expect(presets.directory!.defaultSlot).toBe(4);
    });

    it('sets the startup mode without losing defaultSlot', async () => {
      await fetchPresetInfo();
      await setStartupDefault(4 as any);
      await setStartupMode(PresetStartupMode.LastActive);
      expect(presets.directory!.startupMode).toBe(PresetStartupMode.LastActive);
      expect(presets.directory!.defaultSlot).toBe(4);
    });
  });

  describe('savePresetSlot', () => {
    it('saves current RAM into a slot and makes it active (mirrors firmware)', async () => {
      await fetchPresetInfo();
      const initialActive = presets.active;
      // Pick a slot that is not the active one
      const target = (initialActive === 5 ? 6 : 5) as PresetSlot;
      const r = await savePresetSlot(target);
      expect(r.ok).toBe(true);
      expect(presets.directory!.occupiedSlotsSet.has(target)).toBe(true);
      // Per HW-PROFILES §1b, PresetSave sets lastActive=slot. Host mirrors.
      expect(presets.active).toBe(target);
    });

    it('saving into the active slot advances the baseline', async () => {
      await fetchPresetInfo();
      // Ensure there is an active slot for the baseline check.
      if (presets.active == null) {
        await loadPresetSlot(0 as any);
      }
      const active = presets.active!;
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
      expect(dsp.shadow?.bypass).not.toBe(dsp.live?.bypass);
      const r = await savePresetSlot(active);
      expect(r.ok).toBe(true);
      expect(dsp.shadow?.bypass).toBe(dsp.live?.bypass);
    });
  });

  describe('dirty baseline survives resync', () => {
    it('shadow is not overwritten when forceResyncNow refreshes live', async () => {
      const { forceResyncNow } = await import('./resync');
      await fetchPresetInfo();
      // Sanity: bootMock+fullSync populated both live and shadow.
      expect(dsp.live).not.toBe(null);
      expect(dsp.shadow).not.toBe(null);
      const shadowLoudnessBefore = dsp.shadow!.loudness.enabled;
      // Drive a wire write on a field that lives in the bulk payload.
      // SetLoudnessEnabled mutates #mockState which is what
      // synthesizeBulkParams reads from, so the next resync's bulk packet
      // will reflect the change.
      const d = session.device!;
      await d.setLoudnessEnabled(!shadowLoudnessBefore);
      // Resync refreshes dsp.live ONLY; dsp.shadow stays pinned at the
      // last baseline (the fullSync snapshot).
      await forceResyncNow();
      expect(dsp.live!.loudness.enabled).toBe(!shadowLoudnessBefore);
      expect(dsp.shadow!.loudness.enabled).toBe(shadowLoudnessBefore);
    });
  });

  describe('action error surfacing', () => {
    it('records an error message when setPresetName throws', async () => {
      await fetchPresetInfo();
      const d = session.device!;
      const orig = d.setPresetName.bind(d);
      (d as any).setPresetName = async () => { throw new Error('boom'); };
      try {
        await expect(renamePresetSlot(2 as any, 'X')).rejects.toThrow('boom');
        expect(presets.lastActionError).toContain('Rename');
        expect(presets.lastActionError).toContain('boom');
      } finally {
        (d as any).setPresetName = orig;
      }
    });

    it('clears lastActionError at the start of a successful subsequent call', async () => {
      await fetchPresetInfo();
      presets.lastActionError = 'stale';
      await renamePresetSlot(3 as any, 'Cinema');
      expect(presets.lastActionError).toBe(null);
    });
  });

  describe('pastePresetTo', () => {
    it('runs loadPreset(src) → savePreset(active) → loadPreset(active) in order', async () => {
      await fetchPresetInfo();
      // Pick two distinct slots; force the active slot to a known index.
      const src = 2 as PresetSlot;
      const target = 5 as PresetSlot;
      // Save into the target first so it has known content, and make it active.
      await savePresetSlot(target);
      expect(presets.active).toBe(target);

      const realDevice = session.device!;
      const calls: Array<{ method: 'loadPreset' | 'savePreset'; slot: number }> = [];
      const origLoad = realDevice.loadPreset.bind(realDevice);
      const origSave = realDevice.savePreset.bind(realDevice);
      (realDevice as any).loadPreset = async (slot: number) => {
        calls.push({ method: 'loadPreset', slot });
        return origLoad(slot as PresetSlot);
      };
      (realDevice as any).savePreset = async (slot: number) => {
        calls.push({ method: 'savePreset', slot });
        return origSave(slot as PresetSlot);
      };
      try {
        const r = await pastePresetTo(src);
        expect(r.ok).toBe(true);
        expect(calls).toEqual([
          { method: 'loadPreset', slot: src },
          { method: 'savePreset', slot: target },
          { method: 'loadPreset', slot: target },
        ]);
        expect(presets.active).toBe(target);
      } finally {
        (realDevice as any).loadPreset = origLoad;
        (realDevice as any).savePreset = origSave;
      }
    });

    it('aborts and surfaces error if loadPreset(src) fails', async () => {
      await fetchPresetInfo();
      await savePresetSlot(5 as PresetSlot);
      const realDevice = session.device!;
      const origLoad = realDevice.loadPreset.bind(realDevice);
      const origSave = realDevice.savePreset.bind(realDevice);
      let saveCalls = 0;
      (realDevice as any).loadPreset = async (_slot: number) => ({ ok: false, code: 0x01 as any, message: 'simulated' });
      (realDevice as any).savePreset = async (slot: number) => { saveCalls++; return origSave(slot as PresetSlot); };
      try {
        const r = await pastePresetTo(2 as PresetSlot);
        expect(r.ok).toBe(false);
        expect(saveCalls).toBe(0);
        expect(presets.lastActionError).toMatch(/^Paste:/);
      } finally {
        (realDevice as any).loadPreset = origLoad;
        (realDevice as any).savePreset = origSave;
      }
    });

    it('rejects when src === active', async () => {
      await fetchPresetInfo();
      await savePresetSlot(3 as PresetSlot);
      expect(presets.active).toBe(3);
      const r = await pastePresetTo(3 as PresetSlot);
      expect(r.ok).toBe(false);
      if ('code' in r) expect(r.code).toBe('active');
    });
  });

  describe('loadPresetSlot dirty gating', () => {
    beforeEach(async () => {
      settings.warnOnPresetSwitchDirty = true;
    });

    it('does not call askBoundary when RAM is clean', async () => {
      await fetchPresetInfo();
      // Ensure clean: save current state to flush dirty if any.
      await saveActivePreset();
      const r = await loadPresetSlot(0 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(boundary.pending).toBe(null);
    });

    it('calls askBoundary when RAM is dirty AND warnOnPresetSwitchDirty is true; "discard" proceeds', async () => {
      await fetchPresetInfo();
      await saveActivePreset();
      // Make dirty.
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;

      const pending = loadPresetSlot(0 as PresetSlot);
      // Yield so the runtime can call askBoundary.
      await Promise.resolve();
      expect(boundary.pending).not.toBe(null);
      resolveBoundary('discard');
      const r = await pending;
      expect(r.ok).toBe(true);
      expect(boundary.pending).toBe(null);
    });

    it('skips askBoundary and proceeds when warnOnPresetSwitchDirty is false', async () => {
      settings.warnOnPresetSwitchDirty = false;
      await fetchPresetInfo();
      await saveActivePreset();
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
      const r = await loadPresetSlot(0 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(boundary.pending).toBe(null);
    });

    it('aborts (no wire load op) when boundary resolves with cancel', async () => {
      await fetchPresetInfo();
      await saveActivePreset();
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
      const realDevice = session.device!;
      const origLoad = realDevice.loadPreset.bind(realDevice);
      let loadCalls = 0;
      (realDevice as any).loadPreset = async (slot: number) => { loadCalls++; return origLoad(slot as PresetSlot); };
      try {
        const pending = loadPresetSlot(0 as PresetSlot);
        await Promise.resolve();
        resolveBoundary('cancel');
        const r = await pending;
        expect(r.ok).toBe(false);
        expect(loadCalls).toBe(0);
      } finally {
        (realDevice as any).loadPreset = origLoad;
      }
    });

    it('saves first when boundary resolves with save', async () => {
      await fetchPresetInfo();
      const activeBefore = presets.active!;
      await saveActivePreset();
      if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
      const realDevice = session.device!;
      const origLoad = realDevice.loadPreset.bind(realDevice);
      const origSave = realDevice.savePreset.bind(realDevice);
      const calls: string[] = [];
      (realDevice as any).loadPreset = async (slot: number) => { calls.push(`load(${slot})`); return origLoad(slot as PresetSlot); };
      (realDevice as any).savePreset = async (slot: number) => { calls.push(`save(${slot})`); return origSave(slot as PresetSlot); };
      try {
        const pending = loadPresetSlot(0 as PresetSlot);
        await Promise.resolve();
        resolveBoundary('save');
        const r = await pending;
        expect(r.ok).toBe(true);
        // save(active) precedes load(0).
        const saveIdx = calls.indexOf(`save(${activeBefore})`);
        const loadIdx = calls.indexOf(`load(0)`);
        expect(saveIdx).toBeGreaterThanOrEqual(0);
        expect(loadIdx).toBeGreaterThan(saveIdx);
      } finally {
        (realDevice as any).loadPreset = origLoad;
        (realDevice as any).savePreset = origSave;
      }
    });
  });
});
