import { describe, it, expect, beforeEach } from 'vitest';
import { bootMock } from './session';
import { presets, resetPresets, boundary, resolveBoundary, settings, session, dsp } from '@/state';
import { PresetStartupMode, parseBulkParams } from '@/protocol';
import type { PresetSlot } from '@/domain';
import { makeBulk } from '@test/fixtures/bulkFixtures';
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
import { forceResyncNow, fetchAndApplyAsBaseline } from './resync';

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

    it('issues loadPreset on the wire and re-baselines shadow from a fresh getAllParams', async () => {
      settings.warnOnPresetSwitchDirty = false; // not under test here
      await fetchPresetInfo();
      await saveActivePreset();
      const d = session.device!;
      const origLoad = d.loadPreset.bind(d);
      const origGetAll = d.getAllParams.bind(d);
      let loadCalls = 0;
      let getAllAfterLoad = 0;
      let sawLoad = false;
      (d as any).loadPreset = async (slot: number) => {
        loadCalls++;
        sawLoad = true;
        return origLoad(slot as PresetSlot);
      };
      (d as any).getAllParams = async () => {
        if (sawLoad) getAllAfterLoad++;
        return origGetAll();
      };
      try {
        // Make live diverge from shadow so the post-load re-baseline is
        // observable: after success, shadow must match the freshly fetched
        // device state (i.e. live === shadow per field).
        if (dsp.live) dsp.live.bypass = !dsp.live.bypass;
        const r = await loadPresetSlot(0 as any);
        expect(r.ok).toBe(true);
        expect(loadCalls).toBe(1);
        // fetchAndApplyAsBaseline runs exactly one getAllParams after loadPreset.
        expect(getAllAfterLoad).toBe(1);
        // Shadow re-baselined to device truth (live and shadow agree on bypass).
        expect(dsp.shadow?.bypass).toBe(dsp.live?.bypass);
      } finally {
        (d as any).loadPreset = origLoad;
        (d as any).getAllParams = origGetAll;
      }
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
    it('calls device.setPresetName with the slot/name and mirrors into the cache', async () => {
      await fetchPresetInfo();
      const d = session.device!;
      const orig = d.setPresetName.bind(d);
      const calls: Array<{ slot: number; name: string }> = [];
      (d as any).setPresetName = async (slot: number, name: string) => {
        calls.push({ slot, name });
        return orig(slot as PresetSlot, name);
      };
      try {
        await renamePresetSlot(2 as any, 'Cinema');
        expect(calls).toEqual([{ slot: 2, name: 'Cinema' }]);
        expect(presets.names[2]).toBe('Cinema');
      } finally {
        (d as any).setPresetName = orig;
      }
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

  describe('baselineBulk threading', () => {
    it('fetchAndApplyAsBaseline populates dsp.baselineBulk', async () => {
      await fetchAndApplyAsBaseline();
      expect(dsp.baselineBulk).not.toBeNull();
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
    it('runs load(src)→getAll→load(active)→setAll→save(active) in order', async () => {
      await fetchPresetInfo();
      // Pick two distinct slots; force the active slot to a known index.
      const src    = 3 as PresetSlot;
      const active = 1 as PresetSlot;
      // Make slot 1 active.
      await savePresetSlot(active);
      expect(presets.active).toBe(active);

      const sourceBlob = parseBulkParams(makeBulk());
      const realDevice = session.device!;
      const calls: string[] = [];
      const origLoad   = realDevice.loadPreset.bind(realDevice);
      const origSave   = realDevice.savePreset.bind(realDevice);
      const origGetAll = realDevice.getAllParams.bind(realDevice);
      const origSetAll = realDevice.setAllParams.bind(realDevice);
      // load/save stubs: record the call and return ok.
      (realDevice as any).loadPreset  = async (slot: number) => { calls.push(`load:${slot}`); return { ok: true }; };
      (realDevice as any).savePreset  = async (slot: number) => { calls.push(`save:${slot}`); return { ok: true }; };
      // getAllParams stub: record first call only; restore original for subsequent
      // calls (e.g. fetchAndApplyAsBaseline) so they use the real device data.
      (realDevice as any).getAllParams = async () => {
        calls.push('getAll');
        (realDevice as any).getAllParams = origGetAll;
        return sourceBlob;
      };
      // setAllParams stub: record call + capture argument; no real wire call needed.
      let setAllArg: any;
      (realDevice as any).setAllParams = async (blob: any) => { calls.push('setAll'); setAllArg = blob; };
      try {
        const r = await pastePresetTo(src);
        expect(calls).toEqual([
          `load:${src}`,
          'getAll',
          `load:${active}`,
          'setAll',
          `save:${active}`,
        ]);
        expect(setAllArg).toBe(sourceBlob);
        expect('ok' in r && r.ok).toBe(true);
        expect(presets.active).toBe(active);
      } finally {
        (realDevice as any).loadPreset  = origLoad;
        (realDevice as any).savePreset  = origSave;
        (realDevice as any).getAllParams = origGetAll;
        (realDevice as any).setAllParams = origSetAll;
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
