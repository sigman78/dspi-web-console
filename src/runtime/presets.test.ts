import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootMock } from './boot';
import {
  resetBoundary, boundary, resolveBoundary, settings, activeSession,
  makeReadySession, dispatch, notices, clearNotices, type ReadySession,
} from '@/state';
import { PresetStartupMode, parseBulkParams } from '@/protocol';
import { type PresetSlot, OutputConfigMode } from '@/domain';
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
      const r = await loadPresetSlot(sess(), 0 as any);
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
        const r = await loadPresetSlot(sess(), 0 as any);
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

  describe('deletePresetSlot', () => {
    it('clears the occupied bit', async () => {
      await fetchPresetInfo(sess());
      const prevActive = ps().active;
      if (prevActive == null) {
        await loadPresetSlot(sess(), 0 as any);
      }
      await renamePresetSlot(sess(), 5 as any, 'Test');
      const r = await deletePresetSlot(sess(), 5 as any);
      expect(r.ok).toBe(true);
      expect(ps().directory!.occupiedSlotsSet.has(5 as any)).toBe(false);
    });

    it('rejects deleting the active slot', async () => {
      await fetchPresetInfo(sess());
      const active = ps().active ?? 0 as any;
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
        await renamePresetSlot(sess(), 2 as any, 'Cinema');
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
      const r = await setStartupDefault(sess(), 4 as any);
      expect('ok' in r && r.ok).toBe(true);
      expect(ps().directory!.startupMode).toBe(PresetStartupMode.Specified);
      expect(ps().directory!.defaultSlot).toBe(4);
    });

    it('sets the startup mode without losing defaultSlot', async () => {
      await fetchPresetInfo(sess());
      await setStartupDefault(sess(), 4 as any);
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
        await loadPresetSlot(sess(), 0 as any);
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
    it('records an error message (record-only, no rethrow) when setPresetName throws', async () => {
      await fetchPresetInfo(sess());
      const d = activeSession()!.device;
      const orig = d.setPresetName.bind(d);
      (d as any).setPresetName = async () => { throw new Error('boom'); };
      try {
        const r = await renamePresetSlot(sess(), 2 as any, 'X');
        expect('ok' in r && r.ok).toBe(false);
        expect(ps().lastActionError).toContain('Rename');
        expect(ps().lastActionError).toContain('boom');
      } finally {
        (d as any).setPresetName = orig;
      }
    });

    it('renamePresetSlot returns a typed failure on wire error', async () => {
      await fetchPresetInfo(sess());
      const d = activeSession()!.device;
      const orig = d.setPresetName.bind(d);
      (d as any).setPresetName = async () => { throw new Error('wire fail'); };
      try {
        const r = await renamePresetSlot(sess(), 1 as PresetSlot, 'X');
        expect('ok' in r && r.ok).toBe(false);
        // banner still recorded:
        expect(ps().lastActionError).toContain('Rename');
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
      await renamePresetSlot(sess(), 3 as any, 'Cinema');
      expect(ps().lastActionError).toBe(null);
    });

    it('dismissPresetActionError clears the error banner state', () => {
      ps().lastActionError = 'Save: boom';
      dismissPresetActionError(sess());
      expect(ps().lastActionError).toBe(null);
    });
  });

  describe('pastePresetTo', () => {
    it('runs load(src)→getAll→load(active)→setAll→save(active) in order', async () => {
      await fetchPresetInfo(sess());
      // Pick two distinct slots; force the active slot to a known index.
      const src    = 3 as PresetSlot;
      const active = 1 as PresetSlot;
      // Make slot 1 active.
      await savePresetSlot(sess(), active);
      expect(ps().active).toBe(active);

      const sourceBlob = parseBulkParams(makeBulk({ formatVersion: 10, payloadLength: 2960 }));
      const realDevice = activeSession()!.device;
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
        const r = await pastePresetTo(sess(), src);
        expect(calls).toEqual([
          `load:${src}`,
          'getAll',
          `load:${active}`,
          'setAll',
          `save:${active}`,
        ]);
        expect(setAllArg).toBe(sourceBlob);
        expect('ok' in r && r.ok).toBe(true);
        expect(ps().active).toBe(active);
      } finally {
        (realDevice as any).loadPreset  = origLoad;
        (realDevice as any).savePreset  = origSave;
        (realDevice as any).getAllParams = origGetAll;
        (realDevice as any).setAllParams = origSetAll;
      }
    });

    it('aborts and surfaces error if loadPreset(src) fails', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 5 as PresetSlot);
      const realDevice = activeSession()!.device;
      const origLoad = realDevice.loadPreset.bind(realDevice);
      const origSave = realDevice.savePreset.bind(realDevice);
      let saveCalls = 0;
      (realDevice as any).loadPreset = async (_slot: number) => ({ ok: false, code: 0x01 as any, message: 'simulated' });
      (realDevice as any).savePreset = async (slot: number) => { saveCalls++; return origSave(slot as PresetSlot); };
      try {
        const r = await pastePresetTo(sess(), 2 as PresetSlot);
        expect(r.ok).toBe(false);
        expect(saveCalls).toBe(0);
        expect(ps().lastActionError).toMatch(/^Paste:/);
      } finally {
        (realDevice as any).loadPreset = origLoad;
        (realDevice as any).savePreset = origSave;
      }
    });

    it('rejects when src === active', async () => {
      await fetchPresetInfo(sess());
      await savePresetSlot(sess(), 3 as PresetSlot);
      expect(ps().active).toBe(3);
      const r = await pastePresetTo(sess(), 3 as PresetSlot);
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
      await fetchPresetInfo(sess());
      const active = 1 as PresetSlot;
      await savePresetSlot(sess(), active);
      expect(ps().active).toBe(active);
      const liveFmt = activeSession()!.device.capabilities.wire;
      const wrongFmt = liveFmt + 1;

      const realDevice = activeSession()!.device;
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
        const r = await pastePresetTo(sess(), 3 as PresetSlot);
        expect(r.ok).toBe(false);
        if (!r.ok && 'message' in r) {
          expect(r.message).toMatch(/Paste blocked: snapshot format/);
        }
        expect(ps().lastActionError).toMatch(/^Paste:.*Paste blocked: snapshot format/);
        expect(setAllParamsSpy).not.toHaveBeenCalled();
        expect(savePresetSpy).not.toHaveBeenCalled();
      } finally {
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
      await loadPresetSlot(sess(), 0 as PresetSlot);
      await saveActivePreset(sess());

      clearNotices();
      await setOutputConfigMode(sess(), OutputConfigMode.Independent);
      let r = await pastePresetTo(sess(), 1 as PresetSlot);
      expect('ok' in r && r.ok).toBe(true);
      expect(notices.list.some((n) => n.kind === 'info' && /not applied/i.test(n.message))).toBe(true);

      clearNotices();
      await setOutputConfigMode(sess(), OutputConfigMode.WithPreset);
      r = await pastePresetTo(sess(), 1 as PresetSlot);
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
    settings.soft.muted = false;
  });

  afterEach(() => {
    dispatch({ t: 'disconnected' });
    vi.useRealTimers();
  });

  it('waits for presetLoaded before re-reading device truth', async () => {
    vi.useFakeTimers();
    const device = {
      capabilities: { features: { notifications: true } },
      loadPreset: vi.fn(async () => ({ ok: true, value: undefined })),
      getSnapshot: vi.fn(async () => makeTestSnapshot()),
      setMasterVolume: vi.fn(async () => {}),
    };
    const s = installSessionWith(device);
    const p = loadPresetSlot(s, 2 as PresetSlot);
    // Well past the legacy 100 ms sleep: the re-read must still be gated on
    // the device's own event, not on elapsed time.
    await vi.advanceTimersByTimeAsync(150);
    expect(device.loadPreset).toHaveBeenCalled();
    expect(device.getSnapshot).not.toHaveBeenCalled();
    s.notifyWaiters.notify({ kind: 'presetLoaded', seq: 1, slot: 2 });
    const r = await p;
    expect('ok' in r && r.ok).toBe(true);
    expect(device.getSnapshot).toHaveBeenCalled();
  });

  it('falls back to the settle sleep on devices without notifications', async () => {
    vi.useFakeTimers();
    const device = {
      capabilities: { features: { notifications: false } },
      loadPreset: vi.fn(async () => ({ ok: true, value: undefined })),
      getSnapshot: vi.fn(async () => makeTestSnapshot()),
      setMasterVolume: vi.fn(async () => {}),
    };
    const s = installSessionWith(device);
    const p = loadPresetSlot(s, 2 as PresetSlot);
    await vi.advanceTimersByTimeAsync(100);        // PRESET_LOAD_SETTLE_MS
    const r = await p;
    expect('ok' in r && r.ok).toBe(true);
    expect(device.getSnapshot).toHaveBeenCalled();
  });

  it('proceeds after the timeout when the event never arrives', async () => {
    vi.useFakeTimers();
    const device = {
      capabilities: { features: { notifications: true } },
      loadPreset: vi.fn(async () => ({ ok: true, value: undefined })),
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
});
