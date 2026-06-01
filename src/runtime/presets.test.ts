import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootMock } from './session';
import type { DspDevice } from '@/device/DspDevice';
import { presets, resetPresets, boundary, resolveBoundary, settings, session, mirror, presetBaseline } from '@/state';
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
  setPresetIncludePins,
  pastePresetTo,
  dismissPresetActionError,
} from './presets';
import { forceResyncNow } from './resync';

describe('runtime/presets', () => {
  beforeEach(async () => {
    resetPresets();
    await bootMock('rp2350');
  });

  describe('fetchPresetInfo', () => {
    it('populates directory, names, active, and saved master volume', async () => {
      await fetchPresetInfo();
      expect(presets.directory).not.toBe(null);
      expect(presets.names.every((n) => n !== null)).toBe(true);
      expect(presets.active === null || (presets.active! >= 0 && presets.active! < 10)).toBe(true);
      expect(typeof presets.savedMasterVolumeDb).toBe('number');
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
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
      const before = presetBaseline.current?.bypass;
      const after  = mirror.current?.bypass;
      expect(before).not.toBe(after);
      const r = await saveActivePreset();
      expect(r.ok).toBe(true);
      expect(presetBaseline.current?.bypass).toBe(after);
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

    it('issues loadPreset on the wire and re-baselines saved from a fresh getAllParams', async () => {
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
        // Make draft diverge from saved so the post-load re-baseline is
        // observable: after success, saved must match the freshly fetched
        // device state (i.e. draft === saved per field).
        if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
        const r = await loadPresetSlot(0 as any);
        expect(r.ok).toBe(true);
        expect(loadCalls).toBe(1);
        // fetchAndApplyAsBaseline runs exactly one getAllParams after loadPreset.
        expect(getAllAfterLoad).toBe(1);
        // Saved re-baselined to device truth (draft and saved agree on bypass).
        expect(presetBaseline.current?.bypass).toBe(mirror.current?.bypass);
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
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
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
      const r = await setStartupDefault(4 as any);
      expect('ok' in r && r.ok).toBe(true);
      expect(presets.directory!.startupMode).toBe(PresetStartupMode.Specified);
      expect(presets.directory!.defaultSlot).toBe(4);
    });

    it('sets the startup mode without losing defaultSlot', async () => {
      await fetchPresetInfo();
      await setStartupDefault(4 as any);
      const r = await setStartupMode(PresetStartupMode.LastActive);
      expect('ok' in r && r.ok).toBe(true);
      expect(presets.directory!.startupMode).toBe(PresetStartupMode.LastActive);
      expect(presets.directory!.defaultSlot).toBe(4);
    });
  });

  describe('setPresetIncludePins', () => {
    it('writes the flag through to the device and mirrors it in the directory cache', async () => {
      await fetchPresetInfo();
      const r = await setPresetIncludePins(true);
      expect('ok' in r && r.ok).toBe(true);
      expect(presets.directory!.includePins).toBe(true);
      await setPresetIncludePins(false);
      expect(presets.directory!.includePins).toBe(false);
    });

    it('records an action error (record-only, no rethrow) when the device write fails', async () => {
      await fetchPresetInfo();
      const d = session.device as any;
      const orig = d.setPresetIncludePins;
      d.setPresetIncludePins = async () => { throw new Error('wire fail'); };
      try {
        const r = await setPresetIncludePins(true);
        expect('ok' in r && r.ok).toBe(false);
        expect(presets.lastActionError).toContain('Set include pins');
        expect(presets.lastActionError).toContain('wire fail');
      } finally {
        d.setPresetIncludePins = orig;
      }
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
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
      expect(presetBaseline.current?.bypass).not.toBe(mirror.current?.bypass);
      const r = await savePresetSlot(active);
      expect(r.ok).toBe(true);
      expect(presetBaseline.current?.bypass).toBe(mirror.current?.bypass);
    });
  });

  describe('dirty baseline survives resync', () => {
    it('saved is not overwritten when forceResyncNow refreshes draft', async () => {
      await fetchPresetInfo();
      // Sanity: bootMock+fullSync populated both draft and saved.
      expect(mirror.current).not.toBe(null);
      expect(presetBaseline.current).not.toBe(null);
      const savedLoudnessBefore = presetBaseline.current!.loudness.enabled;
      // Drive a wire write on a field that lives in the bulk payload.
      // SetLoudnessEnabled mutates #mockState which is what
      // synthesizeBulkParams reads from, so the next resync's bulk packet
      // will reflect the change.
      const d = session.device as DspDevice;
      await d.setLoudnessEnabled(!savedLoudnessBefore);
      // Resync refreshes mirror.current ONLY; presetBaseline.current stays pinned at the
      // last baseline (the fullSync snapshot).
      await forceResyncNow();
      expect(mirror.current!.loudness.enabled).toBe(!savedLoudnessBefore);
      expect(presetBaseline.current!.loudness.enabled).toBe(savedLoudnessBefore);
    });
  });

  describe('action error surfacing', () => {
    it('records an error message (record-only, no rethrow) when setPresetName throws', async () => {
      await fetchPresetInfo();
      const d = session.device!;
      const orig = d.setPresetName.bind(d);
      (d as any).setPresetName = async () => { throw new Error('boom'); };
      try {
        const r = await renamePresetSlot(2 as any, 'X');
        expect('ok' in r && r.ok).toBe(false);
        expect(presets.lastActionError).toContain('Rename');
        expect(presets.lastActionError).toContain('boom');
      } finally {
        (d as any).setPresetName = orig;
      }
    });

    it('renamePresetSlot returns a typed failure on wire error', async () => {
      await fetchPresetInfo();
      const d = session.device!;
      const orig = d.setPresetName.bind(d);
      (d as any).setPresetName = async () => { throw new Error('wire fail'); };
      try {
        const r = await renamePresetSlot(1 as PresetSlot, 'X');
        expect('ok' in r && r.ok).toBe(false);
        // banner still recorded:
        expect(presets.lastActionError).toContain('Rename');
      } finally {
        (d as any).setPresetName = orig;
      }
    });

    it('renamePresetSlot returns ok on success', async () => {
      await fetchPresetInfo();
      const r = await renamePresetSlot(1 as PresetSlot, 'X');
      expect('ok' in r && r.ok).toBe(true);
    });

    it('clears lastActionError at the start of a successful subsequent call', async () => {
      await fetchPresetInfo();
      presets.lastActionError = 'stale';
      await renamePresetSlot(3 as any, 'Cinema');
      expect(presets.lastActionError).toBe(null);
    });

    it('dismissPresetActionError clears the error banner state', () => {
      presets.lastActionError = 'Save: boom';
      dismissPresetActionError();
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

    it('blocks paste when sourceBlob wire is higher than the device can accept', async () => {
      // Firmware-merge write rule: a blob whose wire is HIGHER than the device's
      // wire is rejected (the firmware would refuse it). Arises mid-session after
      // a firmware update bumps the format. restoreState must not run and the
      // action must surface an error. (Lower/equal blobs merge — see the
      // acceptsWriteFormat unit matrix for that path; this runtime harness is
      // V6-only so it can't host a higher device to exercise the accept side.)
      await fetchPresetInfo();
      const active = 1 as PresetSlot;
      await savePresetSlot(active);
      expect(presets.active).toBe(active);
      const liveFmt = session.device!.capabilities.wire;
      const wrongFmt = liveFmt + 1;

      const realDevice = session.device!;
      const origLoad   = realDevice.loadPreset.bind(realDevice);
      const origSave   = realDevice.savePreset.bind(realDevice);
      const origGetAll = realDevice.getAllParams.bind(realDevice);
      const origSetAll = realDevice.setAllParams.bind(realDevice);

      const setAllParamsSpy = vi.fn(async () => {});
      const savePresetSpy = vi.fn(async (slot: PresetSlot) => origSave(slot));
      (realDevice as any).loadPreset = async (_slot: number) => ({ ok: true });
      (realDevice as any).savePreset = savePresetSpy;
      (realDevice as any).getAllParams = async () => {
        // Capture path. Return a parsed blob with an incompatible formatVersion.
        const b = parseBulkParams(makeBulk());
        return { ...b, formatVersion: wrongFmt };
      };
      (realDevice as any).setAllParams = setAllParamsSpy;

      try {
        const r = await pastePresetTo(3 as PresetSlot);
        expect(r.ok).toBe(false);
        if (!r.ok && 'message' in r) {
          expect(r.message).toMatch(/Paste blocked: snapshot format/);
        }
        expect(presets.lastActionError).toMatch(/^Paste:.*Paste blocked: snapshot format/);
        expect(setAllParamsSpy).not.toHaveBeenCalled();
        expect(savePresetSpy).not.toHaveBeenCalled();
      } finally {
        (realDevice as any).loadPreset = origLoad;
        (realDevice as any).savePreset = origSave;
        (realDevice as any).getAllParams = origGetAll;
        (realDevice as any).setAllParams = origSetAll;
      }
    });

    it('captures source RAM only after the source load has settled', async () => {
      // loadPreset is async on the wire (deferred flash→RAM copy). Capturing
      // before the settle would read the previous (active) slot's RAM, not src.
      await fetchPresetInfo();
      const src    = 3 as PresetSlot;
      const active = 1 as PresetSlot;
      await savePresetSlot(active);
      expect(presets.active).toBe(active);

      const realDevice = session.device!;
      const origLoad   = realDevice.loadPreset.bind(realDevice);
      const origSave   = realDevice.savePreset.bind(realDevice);
      const origGetAll = realDevice.getAllParams.bind(realDevice);
      const origSetAll = realDevice.setAllParams.bind(realDevice);
      const events: string[] = [];
      (realDevice as any).loadPreset = async (slot: number) => { events.push(`load:${slot}`); return { ok: true }; };
      (realDevice as any).savePreset = async (slot: number) => { events.push(`save:${slot}`); return { ok: true }; };
      (realDevice as any).setAllParams = async () => { events.push('setAll'); };
      (realDevice as any).getAllParams = async () => { events.push('capture'); return parseBulkParams(makeBulk()); };

      vi.useFakeTimers();
      try {
        const pending = pastePresetTo(src);
        // Advance to just before the 100 ms settle: load(src) has resolved (it
        // completes via microtasks) but the capture is still gated by the timer.
        await vi.advanceTimersByTimeAsync(99);
        expect(events).toEqual([`load:${src}`]);
        // Cross the first settle: capture runs, then load(active). restoreState
        // (setAll) stays gated behind the second settle.
        await vi.advanceTimersByTimeAsync(2);
        expect(events).toEqual([`load:${src}`, 'capture', `load:${active}`]);
        // Cross the second settle: only now is the source pushed into active RAM.
        await vi.advanceTimersByTimeAsync(100);
        expect(events).toContain('setAll');
        // Drain the rest of the flow so no promise/timer dangles.
        await vi.advanceTimersByTimeAsync(500);
        await pending;
      } finally {
        vi.useRealTimers();
        (realDevice as any).loadPreset = origLoad;
        (realDevice as any).savePreset = origSave;
        (realDevice as any).getAllParams = origGetAll;
        (realDevice as any).setAllParams = origSetAll;
      }
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
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;

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
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
      const r = await loadPresetSlot(0 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(boundary.pending).toBe(null);
    });

    it('aborts (no wire load op) when boundary resolves with cancel', async () => {
      await fetchPresetInfo();
      await saveActivePreset();
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
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
      if (mirror.current) mirror.current.bypass = !mirror.current.bypass;
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
