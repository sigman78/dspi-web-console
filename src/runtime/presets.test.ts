import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootMock } from './boot';
import {
  resetBoundary, boundary, resolveBoundary, settings, activeSession,
  makeReadySession, dispatch, notices, clearNotices, type ReadySession,
} from '@/state';
import { PresetStartupMode, parseBulkParams, Wire } from '@/protocol';
import type { DeviceState } from '@/protocol/snapshotCodec';
import { type PresetSlot, OutputConfigMode } from '@/domain';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import {
  fetchPresetInfo,
  copyActivePreset,
  saveActivePreset,
  savePresetSlot,
  loadPresetSlot,
  deletePresetSlot,
  revertActivePreset,
  renamePresetSlot,
  setStartupDefault,
  setStartupMode,
  setOutputConfigMode,
  pastePresetTo,
  dismissPresetActionError,
} from './presets';
import { forceResyncNow } from './resync';

const liveMirror = () => activeSession()!.mirror;
const sess = () => activeSession()!;
const ps = () => activeSession()!.presets;

describe('runtime/presets', () => {
  beforeEach(async () => {
    resetBoundary();
    await bootMock('rp2350');
  });

  describe('fetchPresetInfo', () => {
    it('populates directory, names, active, and saved master volume', async () => {
      await fetchPresetInfo(sess());
      expect(ps().directory).not.toBe(null);
      expect(ps().names.every((n) => n !== null)).toBe(true);
      expect(ps().active === null || (ps().active! >= 0 && ps().active! < 10)).toBe(true);
      expect(typeof ps().savedMasterVolumeDb).toBe('number');
    });

    it('is idempotent when cache is populated', async () => {
      await fetchPresetInfo(sess());
      const before = ps().directory;
      await fetchPresetInfo(sess());
      expect(ps().directory).toBe(before);
    });

    it('continues populating directory when an individual getPresetName fails', async () => {
      // Replace the device.getPresetName to fail for slot 7 only.
      const realDevice = activeSession()!.device;
      const origGetName = realDevice.getPresetName.bind(realDevice);
      (realDevice as any).getPresetName = async (slot: number) => {
        if (slot === 7) throw new Error('simulated slot-7 failure');
        return origGetName(slot as PresetSlot);
      };
      try {
        await fetchPresetInfo(sess());
        expect(ps().directory).not.toBe(null);
        expect(ps().names[7]).toBe(''); // failed slot becomes empty
        expect(ps().lastFetchError).toBe(null); // names failures don't set the directory-level error
      } finally {
        (realDevice as any).getPresetName = origGetName;
      }
    });

    it('sets lastFetchError when directory fetch fails', async () => {
      const realDevice = activeSession()!.device;
      const origGetDir = realDevice.getPresetDirectory.bind(realDevice);
      (realDevice as any).getPresetDirectory = async () => {
        throw new Error('simulated directory failure');
      };
      try {
        // need to clear cache first since previous tests populated it
        ps().directory = null;
        ps().lastFetchError = null;
        await fetchPresetInfo(sess());
        expect(ps().directory).toBe(null);
        expect(ps().lastFetchError).toContain('Directory fetch failed');
      } finally {
        (realDevice as any).getPresetDirectory = origGetDir;
      }
    });
  });

  describe('saveActivePreset', () => {
    it('saves to the active slot and advances the baseline', async () => {
      await fetchPresetInfo(sess());
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
      const before = liveMirror().baseline?.bypass;
      const after  = liveMirror().current?.bypass;
      expect(before).not.toBe(after);
      const r = await saveActivePreset(sess());
      expect(r.ok).toBe(true);
      expect(liveMirror().baseline?.bypass).toBe(after);
    });
  });

  describe('loadPresetSlot', () => {
    it('updates active and refreshes baseline (via fullSync)', async () => {
      await fetchPresetInfo(sess());
      await saveActivePreset(sess());
      const r = await loadPresetSlot(sess(), 0 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(ps().active).toBe(0);
    });

    it('issues loadPreset on the wire and re-baselines saved from a fresh getAllParams', async () => {
      settings.warnOnPresetSwitchDirty = false; // not under test here
      await fetchPresetInfo(sess());
      await saveActivePreset(sess());
      const d = activeSession()!.device;
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
        liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
        const r = await loadPresetSlot(sess(), 0 as PresetSlot);
        expect(r.ok).toBe(true);
        expect(loadCalls).toBe(1);
        // fetchAndApplyAsBaseline runs exactly one getAllParams after loadPreset.
        expect(getAllAfterLoad).toBe(1);
        // Saved re-baselined to device truth (draft and saved agree on bypass).
        expect(liveMirror().baseline?.bypass).toBe(liveMirror().current?.bypass);
      } finally {
        (d as any).loadPreset = origLoad;
        (d as any).getAllParams = origGetAll;
      }
    });
  });

  describe('load read-back verification', () => {
    // The firmware ACKs PresetLoad and emits presetLoaded BEFORE validating
    // the slot; a CRC/layout-invalid slot is silently not applied (RAM and
    // last_active untouched). The console must not trust the notify alone.
    it('surfaces an error and keeps device truth when the device silently rejects the load', async () => {
      settings.warnOnPresetSwitchDirty = false;
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 1 as PresetSlot);
      expect(ps().active).toBe(1);
      const d = activeSession()!.device as any;
      const origLoad = d.loadPreset;
      const origGetActive = d.getActivePreset;
      d.loadPreset = async (slot: number) => {
        sess().notifyWaiters.notify({ kind: 'presetLoaded', seq: 1, slot });
        return { ok: true };
      };
      d.getActivePreset = async () => 1; // device never switched
      try {
        const r = await loadPresetSlot(sess(), 3 as PresetSlot);
        expect(r.ok).toBe(false);
        expect(ps().active).toBe(1);
        expect(ps().lastActionError).toMatch(/^Load:/);
        expect(ps().lastActionError).toMatch(/rejected/i);
      } finally {
        d.loadPreset = origLoad;
        d.getActivePreset = origGetActive;
      }
    });
  });

  describe('deletePresetSlot', () => {
    it('clears the occupied bit', async () => {
      await fetchPresetInfo(sess());
      const prevActive = ps().active;
      if (prevActive == null) {
        await loadPresetSlot(sess(), 0 as PresetSlot);
      }
      await renamePresetSlot(sess(), 5 as PresetSlot, 'Test');
      const r = await deletePresetSlot(sess(), 5 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(ps().directory!.occupiedSlotsSet.has(5 as PresetSlot)).toBe(false);
    });

    it('rejects deleting the active slot', async () => {
      await fetchPresetInfo(sess());
      const active = ps().active ?? 0 as PresetSlot;
      const r = await deletePresetSlot(sess(), active);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('active');
    });
  });

  describe('revertActivePreset', () => {
    it('reloads the active slot', async () => {
      await fetchPresetInfo(sess());
      await saveActivePreset(sess());
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
      const r = await revertActivePreset(sess());
      expect(r.ok).toBe(true);
    });
  });

  describe('renamePresetSlot', () => {
    it('calls device.setPresetName with the slot/name and mirrors into the cache', async () => {
      await fetchPresetInfo(sess());
      const d = activeSession()!.device;
      const orig = d.setPresetName.bind(d);
      const calls: Array<{ slot: number; name: string }> = [];
      (d as any).setPresetName = async (slot: number, name: string) => {
        calls.push({ slot, name });
        return orig(slot as PresetSlot, name);
      };
      try {
        await renamePresetSlot(sess(), 2 as PresetSlot, 'Cinema');
        expect(calls).toEqual([{ slot: 2, name: 'Cinema' }]);
        expect(ps().names[2]).toBe('Cinema');
      } finally {
        (d as any).setPresetName = orig;
      }
    });
  });

  describe('setStartupDefault / setStartupMode', () => {
    it('writes startup config and updates the directory cache', async () => {
      await fetchPresetInfo(sess());
      const r = await setStartupDefault(sess(), 4 as PresetSlot);
      expect('ok' in r && r.ok).toBe(true);
      expect(ps().directory!.startupMode).toBe(PresetStartupMode.Specified);
      expect(ps().directory!.defaultSlot).toBe(4);
    });

    it('sets the startup mode without losing defaultSlot', async () => {
      await fetchPresetInfo(sess());
      await setStartupDefault(sess(), 4 as PresetSlot);
      const r = await setStartupMode(sess(), PresetStartupMode.LastActive);
      expect('ok' in r && r.ok).toBe(true);
      expect(ps().directory!.startupMode).toBe(PresetStartupMode.LastActive);
      expect(ps().directory!.defaultSlot).toBe(4);
    });
  });

  describe('setOutputConfigMode', () => {
    it('writes the mode through to the device and mirrors it in the directory cache', async () => {
      await fetchPresetInfo(sess());
      const r = await setOutputConfigMode(sess(), OutputConfigMode.WithPreset);
      expect('ok' in r && r.ok).toBe(true);
      expect(ps().directory!.outputConfigMode).toBe(OutputConfigMode.WithPreset);
      await setOutputConfigMode(sess(), OutputConfigMode.Independent);
      expect(ps().directory!.outputConfigMode).toBe(OutputConfigMode.Independent);
    });

    it('records an action error (record-only, no rethrow) when the device write fails', async () => {
      await fetchPresetInfo(sess());
      const d = activeSession()!.device as any;
      const orig = d.setOutputConfigMode;
      d.setOutputConfigMode = async () => { throw new Error('wire fail'); };
      try {
        const r = await setOutputConfigMode(sess(), OutputConfigMode.WithPreset);
        expect('ok' in r && r.ok).toBe(false);
        expect(ps().lastActionError).toContain('Set output config mode');
        expect(ps().lastActionError).toContain('wire fail');
      } finally {
        d.setOutputConfigMode = orig;
      }
    });
  });

  describe('savePresetSlot', () => {
    it('saves current RAM into a slot and makes it active (mirrors firmware)', async () => {
      await fetchPresetInfo(sess());
      const initialActive = ps().active;
      // Pick a slot that is not the active one
      const target = (initialActive === 5 ? 6 : 5) as PresetSlot;
      const r = await savePresetSlot(sess(), target);
      expect(r.ok).toBe(true);
      expect(ps().directory!.occupiedSlotsSet.has(target)).toBe(true);
      // Per HW-PROFILES §1b, PresetSave sets lastActive=slot. Host mirrors.
      expect(ps().active).toBe(target);
    });

    it('saving into the active slot advances the baseline', async () => {
      await fetchPresetInfo(sess());
      // Ensure there is an active slot for the baseline check.
      if (ps().active == null) {
        await loadPresetSlot(sess(), 0 as PresetSlot);
      }
      const active = ps().active!;
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
      expect(liveMirror().baseline?.bypass).not.toBe(liveMirror().current?.bypass);
      const r = await savePresetSlot(sess(), active);
      expect(r.ok).toBe(true);
      expect(liveMirror().baseline?.bypass).toBe(liveMirror().current?.bypass);
    });
  });

  describe('dirty baseline survives resync', () => {
    it('saved is not overwritten when forceResyncNow refreshes draft', async () => {
      await fetchPresetInfo(sess());
      // Sanity: bootMock+fullSync populated both draft and saved.
      expect(liveMirror().current).not.toBe(null);
      expect(liveMirror().baseline).not.toBe(null);
      const savedLoudnessBefore = liveMirror().baseline!.loudness.enabled;
      // Drive a wire write on a field that lives in the bulk payload.
      // SetLoudnessEnabled mutates #mockState which is what
      // synthesizeBulkParams reads from, so the next resync's bulk packet
      // will reflect the change.
      const d = activeSession()!.device;
      await d.setLoudnessEnabled(!savedLoudnessBefore);
      // Resync refreshes liveMirror().current ONLY; liveMirror().baseline stays pinned at the
      // last baseline (the fullSync snapshot).
      await forceResyncNow(sess());
      expect(liveMirror().current!.loudness.enabled).toBe(!savedLoudnessBefore);
      expect(liveMirror().baseline!.loudness.enabled).toBe(savedLoudnessBefore);
    });
  });

  describe('action error surfacing', () => {
    it('records an error message when setPresetName throws', async () => {
      await fetchPresetInfo(sess());
      const d = activeSession()!.device;
      const orig = d.setPresetName.bind(d);
      (d as any).setPresetName = async () => { throw new Error('boom'); };
      try {
        const r = await renamePresetSlot(sess(), 2 as PresetSlot, 'X');
        expect('ok' in r && r.ok).toBe(false);
        expect(ps().lastActionError).toContain('Rename');
        expect(ps().lastActionError).toContain('boom');
      } finally {
        (d as any).setPresetName = orig;
      }
    });

    it('renamePresetSlot returns ok on success', async () => {
      await fetchPresetInfo(sess());
      const r = await renamePresetSlot(sess(), 1 as PresetSlot, 'X');
      expect('ok' in r && r.ok).toBe(true);
    });

    it('clears lastActionError at the start of a successful subsequent call', async () => {
      await fetchPresetInfo(sess());
      ps().lastActionError = 'stale';
      await renamePresetSlot(sess(), 3 as PresetSlot, 'Cinema');
      expect(ps().lastActionError).toBe(null);
    });

    it('dismissPresetActionError clears the error banner state', () => {
      ps().lastActionError = 'Save: boom';
      dismissPresetActionError(sess());
      expect(ps().lastActionError).toBe(null);
    });
  });

  describe('copyActivePreset', () => {
    it('captures slot, name and blob at copy time', async () => {
      await fetchPresetInfo(sess());
      const active = 2 as PresetSlot;
      await savePresetSlot(sess(), active);
      await renamePresetSlot(sess(), active, 'Src');
      const r = await copyActivePreset(sess());
      expect('ok' in r && r.ok).toBe(true);
      const held = sess().copySource.held;
      expect(held).not.toBe(null);
      expect(held!.slot).toBe(active);
      expect(held!.name).toBe('Src');
      expect(held!.blob).toBeTruthy();
    });

    it('records an action error and holds nothing when capture fails', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 2 as PresetSlot);
      const d = activeSession()!.device as any;
      const orig = d.captureState;
      d.captureState = async () => { throw new Error('wire fail'); };
      try {
        const r = await copyActivePreset(sess());
        expect('ok' in r && r.ok).toBe(false);
        expect(sess().copySource.held).toBe(null);
        expect(ps().lastActionError).toMatch(/^Copy:/);
      } finally {
        d.captureState = orig;
      }
    });
  });

  describe('pastePresetTo', () => {
    it('runs setAll(blob)→save(active) only — no preset loads', async () => {
      await fetchPresetInfo(sess());
      const active = 1 as PresetSlot;
      await savePresetSlot(sess(), active);
      expect(ps().active).toBe(active);

      const sourceBlob = parseBulkParams(makeBulk({ formatVersion: 10, payloadLength: Wire.BulkSizes.V10 })) as DeviceState;
      const realDevice = activeSession()!.device;
      const calls: string[] = [];
      const origLoad   = realDevice.loadPreset.bind(realDevice);
      const origSave   = realDevice.savePreset.bind(realDevice);
      const origSetAll = realDevice.setAllParams.bind(realDevice);
      (realDevice as any).loadPreset  = async (slot: number) => { calls.push(`load:${slot}`); return { ok: true }; };
      (realDevice as any).savePreset  = async (slot: number) => { calls.push(`save:${slot}`); return { ok: true }; };
      let setAllArg: any;
      (realDevice as any).setAllParams = async (blob: any) => { calls.push('setAll'); setAllArg = blob; };
      try {
        const r = await pastePresetTo(sess(), sourceBlob);
        expect(calls).toEqual(['setAll', `save:${active}`]);
        expect(setAllArg).toBe(sourceBlob);
        expect('ok' in r && r.ok).toBe(true);
        expect(ps().active).toBe(active);
        expect(boundary.pending).toBe(null); // clean RAM: no modal
      } finally {
        (realDevice as any).loadPreset  = origLoad;
        (realDevice as any).savePreset  = origSave;
        (realDevice as any).setAllParams = origSetAll;
      }
    });

    it('asks the boundary modal when RAM is dirty; cancel aborts before any wire write', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 1 as PresetSlot);
      await copyActivePreset(sess());
      const blob = sess().copySource.held!.blob;
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;

      const d = activeSession()!.device as any;
      const origSetAll = d.setAllParams;
      let setAllCalls = 0;
      d.setAllParams = async () => { setAllCalls++; };
      try {
        const pending = pastePresetTo(sess(), blob);
        await Promise.resolve();
        expect(boundary.pending).not.toBe(null);
        resolveBoundary('cancel');
        const r = await pending;
        expect(r.ok).toBe(false);
        expect(setAllCalls).toBe(0);
      } finally {
        d.setAllParams = origSetAll;
      }
    });

    it('proceeds with the paste when the dirty modal resolves with discard', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 1 as PresetSlot);
      await copyActivePreset(sess());
      const blob = sess().copySource.held!.blob;
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;

      const pending = pastePresetTo(sess(), blob);
      await Promise.resolve();
      expect(boundary.pending).not.toBe(null);
      resolveBoundary('discard');
      const r = await pending;
      expect('ok' in r && r.ok).toBe(true);
    });

    it('records the error and rethrows when restoreState fails; no save issued', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 5 as PresetSlot);
      await copyActivePreset(sess());
      const blob = sess().copySource.held!.blob;
      const d = activeSession()!.device as any;
      const origSetAll = d.setAllParams;
      const origSave = d.savePreset;
      let saveCalls = 0;
      d.setAllParams = async () => { throw new Error('simulated'); };
      d.savePreset = async (slot: number) => { saveCalls++; return origSave.call(d, slot); };
      try {
        await expect(pastePresetTo(sess(), blob)).rejects.toThrow('simulated');
        expect(saveCalls).toBe(0);
        expect(ps().lastActionError).toMatch(/^Paste:/);
      } finally {
        d.setAllParams = origSetAll;
        d.savePreset = origSave;
      }
    });

    it('pastes a blob whose source slot was deleted while held', async () => {
      await fetchPresetInfo(sess());
      const src = 3 as PresetSlot;
      await savePresetSlot(sess(), src);
      await copyActivePreset(sess());
      const held = sess().copySource.held!;
      await loadPresetSlot(sess(), 0 as PresetSlot);
      await saveActivePreset(sess());
      await deletePresetSlot(sess(), src);
      const r = await pastePresetTo(sess(), held.blob);
      expect('ok' in r && r.ok).toBe(true);
      expect(ps().directory!.occupiedSlotsSet.has(0 as PresetSlot)).toBe(true);
    });

    it('stamps the same held blob into multiple slots', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 4 as PresetSlot);
      await copyActivePreset(sess());
      const held = sess().copySource.held!;

      await loadPresetSlot(sess(), 0 as PresetSlot);
      const r1 = await pastePresetTo(sess(), held.blob);
      expect('ok' in r1 && r1.ok).toBe(true);

      await loadPresetSlot(sess(), 1 as PresetSlot);
      const r2 = await pastePresetTo(sess(), held.blob);
      expect('ok' in r2 && r2.ok).toBe(true);
      expect(ps().directory!.occupiedSlotsSet.has(1 as PresetSlot)).toBe(true);
    });
  });

  describe('loadPresetSlot dirty gating', () => {
    beforeEach(async () => {
      settings.warnOnPresetSwitchDirty = true;
    });

    it('does not call askBoundary when RAM is clean', async () => {
      await fetchPresetInfo(sess());
      // Ensure clean: save current state to flush dirty if any.
      await saveActivePreset(sess());
      const r = await loadPresetSlot(sess(), 0 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(boundary.pending).toBe(null);
    });

    it('calls askBoundary when RAM is dirty AND warnOnPresetSwitchDirty is true; "discard" proceeds', async () => {
      await fetchPresetInfo(sess());
      await saveActivePreset(sess());
      // Make dirty.
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;

      const pending = loadPresetSlot(sess(), 0 as PresetSlot);
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
      await fetchPresetInfo(sess());
      await saveActivePreset(sess());
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
      const r = await loadPresetSlot(sess(), 0 as PresetSlot);
      expect(r.ok).toBe(true);
      expect(boundary.pending).toBe(null);
    });

    it('aborts (no wire load op) when boundary resolves with cancel', async () => {
      await fetchPresetInfo(sess());
      await saveActivePreset(sess());
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
      const realDevice = activeSession()!.device;
      const origLoad = realDevice.loadPreset.bind(realDevice);
      let loadCalls = 0;
      (realDevice as any).loadPreset = async (slot: number) => { loadCalls++; return origLoad(slot as PresetSlot); };
      try {
        const pending = loadPresetSlot(sess(), 0 as PresetSlot);
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
      await fetchPresetInfo(sess());
      const activeBefore = ps().active!;
      await saveActivePreset(sess());
      liveMirror().snapshot.bypass = !liveMirror().snapshot.bypass;
      const realDevice = activeSession()!.device;
      const origLoad = realDevice.loadPreset.bind(realDevice);
      const origSave = realDevice.savePreset.bind(realDevice);
      const calls: string[] = [];
      (realDevice as any).loadPreset = async (slot: number) => { calls.push(`load(${slot})`); return origLoad(slot as PresetSlot); };
      (realDevice as any).savePreset = async (slot: number) => { calls.push(`save(${slot})`); return origSave(slot as PresetSlot); };
      try {
        const pending = loadPresetSlot(sess(), 0 as PresetSlot);
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

  describe('paste under output-config mode (V10 device)', () => {
    it('toasts that IO config was not applied in Independent mode, stays silent in WithPreset', async () => {
      dispatch({ t: 'disconnected' });
      await bootMock('rp2350', { wireVersion: 10 });
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 1 as PresetSlot);
      await copyActivePreset(sess());
      const blob = sess().copySource.held!.blob;
      await loadPresetSlot(sess(), 0 as PresetSlot);
      await saveActivePreset(sess());

      clearNotices();
      await setOutputConfigMode(sess(), OutputConfigMode.Independent);
      let r = await pastePresetTo(sess(), blob);
      expect('ok' in r && r.ok).toBe(true);
      expect(notices.list.some((n) => n.kind === 'info' && /not applied/i.test(n.message))).toBe(true);

      clearNotices();
      await setOutputConfigMode(sess(), OutputConfigMode.WithPreset);
      r = await pastePresetTo(sess(), blob);
      expect('ok' in r && r.ok).toBe(true);
      expect(notices.list.some((n) => /not applied/i.test(n.message))).toBe(false);
    });
  });
});

// Stub-device tests for the notify-driven load settle. Independent of the
// bootMock harness above: the stub controls event delivery directly.
describe('notify-driven load settle', () => {
  function makeTestSnapshot(): unknown {
    return { channels: [], outputs: [], routes: [], masterVolumeDb: 0 };
  }

  function installSessionWith(device: unknown): ReadySession {
    const s = makeReadySession(device as never);
    dispatch({ t: 'synced', session: s });
    return s;
  }

  beforeEach(() => {
    settings.warnOnPresetSwitchDirty = false;
  });

  afterEach(() => {
    dispatch({ t: 'disconnected' });
    vi.useRealTimers();
  });

  it('waits for presetLoaded before re-reading device truth', async () => {
    vi.useFakeTimers();
    const device = {
      loadPreset: vi.fn(async () => ({ ok: true, value: undefined })),
      getActivePreset: vi.fn(async () => 2),
      getSnapshot: vi.fn(async () => makeTestSnapshot()),
      setMasterVolume: vi.fn(async () => {}),
    };
    const s = installSessionWith(device);
    const p = loadPresetSlot(s, 2 as PresetSlot);
    // Re-read must be gated on the device's own event, not on elapsed time.
    await vi.advanceTimersByTimeAsync(150);
    expect(device.loadPreset).toHaveBeenCalled();
    expect(device.getSnapshot).not.toHaveBeenCalled();
    s.notifyWaiters.notify({ kind: 'presetLoaded', seq: 1, slot: 2 });
    const r = await p;
    expect('ok' in r && r.ok).toBe(true);
    expect(device.getSnapshot).toHaveBeenCalled();
  });

  it('proceeds after the timeout when the event never arrives', async () => {
    vi.useFakeTimers();
    const device = {
      loadPreset: vi.fn(async () => ({ ok: true, value: undefined })),
      getActivePreset: vi.fn(async () => 2),
      getSnapshot: vi.fn(async () => makeTestSnapshot()),
      setMasterVolume: vi.fn(async () => {}),
    };
    const s = installSessionWith(device);
    const p = loadPresetSlot(s, 2 as PresetSlot);
    await vi.advanceTimersByTimeAsync(1000);       // PRESET_LOADED_TIMEOUT_MS
    const r = await p;
    expect('ok' in r && r.ok).toBe(true);
    expect(device.getSnapshot).toHaveBeenCalled();
  });

  it('does not mark a slot active when the post-load snapshot refresh fails', async () => {
    vi.useFakeTimers();
    const device = {
      loadPreset: vi.fn(async () => ({ ok: true, value: undefined })),
      getActivePreset: vi.fn(async () => 2),
      getSnapshot: vi.fn(async () => { throw new Error('snapshot failed'); }),
      setMasterVolume: vi.fn(async () => {}),
    };
    const s = installSessionWith(device);
    s.presets.active = 1 as PresetSlot;

    const p = loadPresetSlot(s, 2 as PresetSlot);
    await vi.advanceTimersByTimeAsync(150);
    s.notifyWaiters.notify({ kind: 'presetLoaded', seq: 1, slot: 2 });
    const r = await p;

    expect('ok' in r && r.ok).toBe(false);
    expect(s.presets.active).toBe(null);
    expect(s.presets.lastActionError).toContain('Load refresh');
    expect(s.presets.lastActionError).toContain('snapshot failed');
  });
});
