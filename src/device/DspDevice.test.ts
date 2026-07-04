// Facade-level tests for DspDevice. Mock-fidelity assertions (serial,
// bulk shape, master-volume roundtrip, buffer-stats parsing) live in
// MockTransport.test.ts; this file covers the things only DspDevice
// adds on top: factory identity capture, getSystemInfo aggregation,
// per-input preamp, and the hardware-profile contract for getSystemStatus.

import { describe, it, test, expect, beforeEach, vi } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice, UnsupportedFirmware, UnsupportedDevicePacket } from './DspDevice';
import { createDevice } from '@test/fixtures/deviceHarness';
import { PresetResult, PinConfigResult, WireCmd, SystemStatusValue, Wire, NotifyEventId } from '@/protocol';
import {
  PlatformType,
  CrossfeedPreset, LevellerSpeed, MasterVolumeMode, OutputConfigMode,
  FilterType,
  ChannelId,
  AudioInputSource,
  SpdifInputState,
  type PresetSlot,
} from '@/domain';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';

describe('DspDevice facade', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('reads device info (platform type + firmware string)', async () => {
    expect(d.info.platformType).toBe(PlatformType.RP2350);
    expect(d.info.capabilities.fwLabel.length).toBeGreaterThan(0);
  });

  it('reads system info (env scalars + counters)', async () => {
    const info = await d.getSystemInfo();
    expect(info.clockHz).toBe(125_000_000);
    expect(info.coreVoltageMv).toBe(3300);
    expect(info.sampleRateHz).toBe(48_000);
    expect(info.tempCDegC).toBe(4210);
    expect(info.pdmRingOverruns).toBe(0);
    expect(info.spdifStarvationsTotal).toBe(0);
  });

  it('returns null for fields whose ctrlIn rejected, populated for the rest', async () => {
    // Transport that rejects only the SpdifStarvationsTotal wValue and
    // delegates everything else to the inner MockTransport. Mirrors a
    // firmware that doesn't implement one counter but answers the rest.
    const inner = new MockTransport({ platform: 'rp2350' });
    await inner.open();
    const failing: DspTransport = {
      open:    () => inner.open(),
      close:   () => inner.close(),
      isOpen:  () => inner.isOpen(),
      on:      (e: TransportEvent, l: () => void) => inner.on(e, l),
      ctrlIn:  (request, value, length) => {
        if (request === WireCmd.GetStatus.code && value === SystemStatusValue.SpdifStarvationsTotal) {
          return Promise.reject(new Error('STALL'));
        }
        return inner.ctrlIn(request, value, length);
      },
      ctrlOut: (request, value, data) => inner.ctrlOut(request, value, data),
    };
    const dd = await createDevice(failing);
    const info = await dd.getSystemInfo();
    expect(info.spdifStarvationsTotal).toBeNull();
    expect(info.clockHz).toBe(125_000_000);
    expect(info.tempCDegC).toBe(4210);
    expect(info.spdifOverruns).toBe(0);
  });

  it('roundtrips per-input preamp', async () => {
    await d.setInputPreamp(0, -1.5);
    await d.setInputPreamp(1, -2.5);
    expect(await d.getInputPreamp(0)).toBeCloseTo(-1.5, 4);
    expect(await d.getInputPreamp(1)).toBeCloseTo(-2.5, 4);
  });
});

describe('DspDevice — getSystemStatus hardware profile contract', () => {
  it('uses platform-correct channel count from factory hardware profile', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);
    const s = await d.getSystemStatus();
    expect(s.peaks.length).toBe(11);
    expect(s.cpu0).toBe(25);
  });

  it('uses the RP2040 channel count when created for RP2040', async () => {
    const inner = new MockTransport({ platform: 'rp2040' });
    let statusLength = 0;
    const t: DspTransport = {
      open: () => inner.open(),
      close: () => inner.close(),
      isOpen: () => inner.isOpen(),
      on: (event, listener) => inner.on(event, listener),
      ctrlIn: (request, value, length) => {
        if (request === WireCmd.GetStatus.code) statusLength = length;
        return inner.ctrlIn(request, value, length);
      },
      ctrlOut: (request, value, data) => inner.ctrlOut(request, value, data),
    };
    const d = await createDevice(t, 'rp2040');
    expect(d.info.platformType).toBe(PlatformType.RP2040);
    expect(d.hardware.totalChannelCount).toBe(7);
    const s = await d.getSystemStatus();
    expect(statusLength).toBe(7 * 2 + 4);
    expect(s.peaks.length).toBe(11);
  });
});

describe('DspDevice — bypass + master volume mode', () => {
  test('getBypass decodes 0x47 response', async () => {
    let lastReq = 0;
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req) => { lastReq = req; return new Uint8Array([1]); },
      ctrlOut: async () => {},
    };
    expect(await (await createDevice(t)).getBypass()).toBe(true);
    expect(lastReq).toBe(0x47);
  });

  test('getMasterVolumeMode decodes 0xD5 response', async () => {
    let lastReq = 0;
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req) => { lastReq = req; return new Uint8Array([1]); },
      ctrlOut: async () => {},
    };
    expect(await (await createDevice(t)).getMasterVolumeMode()).toBe(MasterVolumeMode.WithPreset);
    expect(lastReq).toBe(0xD5);
  });
});

describe('DspDevice — saved master volume', () => {
  test('getSavedMasterVolume reads f32 from 0xD7 wValue=0', async () => {
    const seen: { req: number; val: number; len: number }[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val, len) => {
        seen.push({ req, val, len });
        const out = new Uint8Array(4);
        new DataView(out.buffer).setFloat32(0, -8.25, true);
        return out;
      },
      ctrlOut: async () => {},
    };
    expect(await (await createDevice(t)).getSavedMasterVolume()).toBeCloseTo(-8.25, 4);
    expect(seen[0]).toEqual({ req: 0xD7, val: 0, len: 4 });
  });
});

describe('DspDevice — processing module setters', () => {
  // Fake transport that captures every ctrlOut call so tests can assert
  // (code, value, data). Mirrors the on-device behavior closely enough
  // for byte-level encoding checks; the actual round-trip with state
  // mutation is exercised through MockTransport in mock-mode smoke tests.
  function makeCapturingTransport() {
    const captured: { request: number; value: number; data: Uint8Array }[] = [];
    const t: DspTransport = {
      open: async () => {},
      close: async () => {},
      isOpen: () => true,
      on: () => () => {},
      ctrlIn: async () => new Uint8Array(),
      ctrlOut: async (request, value, data) => {
        captured.push({ request, value, data: new Uint8Array(data) });
      },
    };
    return { t, captured };
  }

  const bool8 = (b: boolean) => new Uint8Array([b ? 1 : 0]);
  const u8 = (v: number) => new Uint8Array([v]);
  const f32 = (v: number) => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setFloat32(0, v, true);
    return out;
  };

  // [method, opcode, payloadBytes] — every uniform (single-value, wValue=0)
  // setter across bypass, master volume mode, loudness, crossfeed and
  // leveller. Each row asserts the exact wire opcode and payload bytes; the
  // decode-side getters and non-uniform setters (channel/band-scoped) stay
  // as dedicated tests elsewhere.
  const setterCases: Array<{
    name: string;
    invoke: (d: DspDevice) => Promise<void>;
    opcode: number;
    payload: Uint8Array;
  }> = [
    { name: 'setBypass(true) -> 0x46',                invoke: (d) => d.setBypass(true), opcode: 0x46, payload: bool8(true) },
    { name: 'setBypass(false) -> 0x46',               invoke: (d) => d.setBypass(false), opcode: 0x46, payload: bool8(false) },
    { name: 'setMasterVolumeMode(WithPreset) -> 0xD4', invoke: (d) => d.setMasterVolumeMode(MasterVolumeMode.WithPreset), opcode: 0xD4, payload: u8(1) },
    { name: 'setMasterVolumeMode(Independent) -> 0xD4', invoke: (d) => d.setMasterVolumeMode(MasterVolumeMode.Independent), opcode: 0xD4, payload: u8(0) },
    { name: 'setLoudnessEnabled(true) -> 0x58',       invoke: (d) => d.setLoudnessEnabled(true), opcode: 0x58, payload: bool8(true) },
    { name: 'setLoudnessRefSpl(85) -> 0x5A',          invoke: (d) => d.setLoudnessRefSpl(85), opcode: 0x5A, payload: f32(85) },
    { name: 'setLoudnessIntensity(0.6) -> 0x5C',      invoke: (d) => d.setLoudnessIntensity(0.6), opcode: 0x5C, payload: f32(0.6) },
    { name: 'setCrossfeedEnabled(true) -> 0x5E',      invoke: (d) => d.setCrossfeedEnabled(true), opcode: 0x5E, payload: bool8(true) },
    { name: 'setCrossfeedPreset(Preset3) -> 0x60',    invoke: (d) => d.setCrossfeedPreset(CrossfeedPreset.Preset3), opcode: 0x60, payload: u8(2) },
    { name: 'setCrossfeedFreq(700) -> 0x62',          invoke: (d) => d.setCrossfeedFreq(700), opcode: 0x62, payload: f32(700) },
    { name: 'setCrossfeedFeedDb(4.5) -> 0x64',        invoke: (d) => d.setCrossfeedFeedDb(4.5), opcode: 0x64, payload: f32(4.5) },
    { name: 'setCrossfeedItd(false) -> 0x66',         invoke: (d) => d.setCrossfeedItd(false), opcode: 0x66, payload: bool8(false) },
    { name: 'setLevellerEnabled(true) -> 0xB4',       invoke: (d) => d.setLevellerEnabled(true), opcode: 0xB4, payload: bool8(true) },
    { name: 'setLevellerAmount(30) -> 0xB6',          invoke: (d) => d.setLevellerAmount(30), opcode: 0xB6, payload: f32(30) },
    { name: 'setLevellerSpeed(Fast) -> 0xB8',         invoke: (d) => d.setLevellerSpeed(LevellerSpeed.Fast), opcode: 0xB8, payload: u8(2) },
    { name: 'setLevellerMaxGain(6) -> 0xBA',          invoke: (d) => d.setLevellerMaxGain(6), opcode: 0xBA, payload: f32(6) },
    { name: 'setLevellerLookahead(true) -> 0xBC',     invoke: (d) => d.setLevellerLookahead(true), opcode: 0xBC, payload: bool8(true) },
    { name: 'setLevellerGate(-40) -> 0xBE',           invoke: (d) => d.setLevellerGate(-40), opcode: 0xBE, payload: f32(-40) },
  ];

  it.each(setterCases)('$name writes the expected opcode + payload', async ({ invoke, opcode, payload }) => {
    const { t, captured } = makeCapturingTransport();
    const d = await createDevice(t);
    await invoke(d);
    expect(captured).toHaveLength(1);
    expect(captured[0].request).toBe(opcode);
    expect(captured[0].value).toBe(0);
    expect(captured[0].data).toEqual(payload);
  });
});

describe('DspDevice — saveMasterVolume action-IN', () => {
  test('returns true when status byte is 0', async () => {
    const seen: { req: number; val: number; len: number }[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val, len) => { seen.push({ req, val, len }); return new Uint8Array([0]); },
      ctrlOut: async () => {},
    };
    expect(await (await createDevice(t)).saveMasterVolume()).toBe(true);
    expect(seen[0]).toEqual({ req: 0xD6, val: 0, len: 1 });
  });

  test('returns false when status byte is non-zero', async () => {
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async () => new Uint8Array([3]), // CrcFailure
      ctrlOut: async () => {},
    };
    expect(await (await createDevice(t)).saveMasterVolume()).toBe(false);
  });

  test('returns false when response is empty', async () => {
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async () => new Uint8Array(0),
      ctrlOut: async () => {},
    };
    expect(await (await createDevice(t)).saveMasterVolume()).toBe(false);
  });
});

describe('DspDevice — persistence (legacy save/load/reset)', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('factoryReset returns ok on success', async () => {
    const r = await d.factoryReset();
    expect(r.ok).toBe(true);
  });
});

describe('DspDevice — telemetry actions', () => {
  function makeCapturingTransport() {
    const captured: { request: number; value: number; data: Uint8Array }[] = [];
    const t: DspTransport = {
      open: async () => {},
      close: async () => {},
      isOpen: () => true,
      on: () => () => {},
      ctrlIn: async () => new Uint8Array(),
      ctrlOut: async (request, value, data) => {
        captured.push({ request, value, data: new Uint8Array(data) });
      },
    };
    return { t, captured };
  }

  let mockT: MockTransport;
  let d: DspDevice;
  beforeEach(async () => {
    mockT = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(mockT);
  });

  it('clearClips dispatches a 0x83 OUT with wValue=0 and empty payload', async () => {
    const { t, captured } = makeCapturingTransport();
    await (await createDevice(t)).clearClips();
    expect(captured).toHaveLength(1);
    expect(captured[0].request).toBe(0x83);
    expect(captured[0].value).toBe(0);
    expect(captured[0].data.byteLength).toBe(0);
  });

  it('resetBufferStats returns true on success', async () => {
    expect(await d.resetBufferStats()).toBe(true);
  });
});

describe('DspDevice — channel names', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('roundtrips a channel name (Subwoofer on channel 3)', async () => {
    await d.setChannelName(3, 'Subwoofer');
    expect(await d.getChannelName(3)).toBe('Subwoofer');
  });

  it('preserves names independently per channel (Left on 0, Right on 1)', async () => {
    await d.setChannelName(0, 'Left');
    await d.setChannelName(1, 'Right');
    expect(await d.getChannelName(0)).toBe('Left');
    expect(await d.getChannelName(1)).toBe('Right');
  });
});

describe('DspDevice — preset directory and active slot', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('returns the preset directory with default values', async () => {
    const dir = await d.getPresetDirectory();
    expect(dir.occupiedSlotsSet.size).toBe(0);
    expect(dir.startupMode).toBe(0);
    expect(dir.outputConfigMode).toBe(OutputConfigMode.WithPreset);
    expect(dir.masterVolumeMode).toBe(0);
    expect(dir.lastActiveSlot).toBe(0); // mock default; real firmware returns 0xFF → null until first save
  });

  it('returns active slot 0 by default (always-active model)', async () => {
    expect(await d.getActivePreset()).toBe(0);
  });

  it('reflects setMasterVolumeMode in the directory packet', async () => {
    await d.setMasterVolumeMode(1);
    const dir = await d.getPresetDirectory();
    expect(dir.masterVolumeMode).toBe(1);
  });

  it('getActivePreset returns the slot number on a valid byte', async () => {
    await d.savePreset(3);
    expect(await d.getActivePreset()).toBe(3);
  });

  it('getActivePreset returns null when firmware reports 0xFF', async () => {
    // Inline transport stub returning 0xFF for PresetGetActive — avoids
    // poking at DspDevice's private `transport` field. Mirrors the
    // pattern used by `getSystemInfo`'s failing-counter test above.
    const stub: DspTransport = {
      open:    async () => {},
      close:   async () => {},
      isOpen:  () => true,
      on:      () => () => {},
      ctrlIn:  async (request) =>
        request === WireCmd.PresetGetActive.code
          ? new Uint8Array([0xFF])
          : new Uint8Array(0),
      ctrlOut: async () => {},
    };
    const dd = await createDevice(stub);
    expect(await dd.getActivePreset()).toBe(null);
  });
});

describe('DspDevice — preset names', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('roundtrips preset names independently per slot', async () => {
    await d.setPresetName(0, 'Cinema');
    await d.setPresetName(1, 'Music');
    expect(await d.getPresetName(0)).toBe('Cinema');
    expect(await d.getPresetName(1)).toBe('Music');
  });

  it('returns empty string for an unset slot', async () => {
    expect(await d.getPresetName(7)).toBe('');
  });
});

describe('DspDevice — preset save/load/delete', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('savePreset returns ok and marks the slot occupied', async () => {
    const r = await d.savePreset(3);
    expect(r.ok).toBe(true);
    const dir = await d.getPresetDirectory();
    expect(dir.occupiedSlotsSet.has(3)).toBe(true);
  });

  it('savePreset advances the active slot', async () => {
    await d.savePreset(5);
    expect(await d.getActivePreset()).toBe(5);
  });

  it('loadPreset returns ok on empty slot and applies factory defaults', async () => {
    // Set live state to a non-default value so we can detect the reset.
    await d.setMasterVolume(-15);

    // Slot 7 has never been saved — current firmware applies factory
    // defaults rather than returning the deprecated SlotEmpty (0x02).
    const r = await d.loadPreset(7);
    expect(r.ok).toBe(true);

    // Live state reset to mock defaults.
    expect(await d.getMasterVolume()).toBeCloseTo(0, 4);
  });

  it('loadPreset returns ok for an occupied slot', async () => {
    await d.savePreset(2);
    const r = await d.loadPreset(2);
    expect(r.ok).toBe(true);
  });

  it('deletePreset clears the occupied bit', async () => {
    await d.savePreset(4);
    const before = await d.getPresetDirectory();
    expect(before.occupiedSlotsSet.has(4)).toBe(true);

    const r = await d.deletePreset(4);
    expect(r.ok).toBe(true);

    const after = await d.getPresetDirectory();
    expect(after.occupiedSlotsSet.has(4)).toBe(false);
  });

  it('savePreset returns InvalidSlot for slot ≥ 10 (wire-level guard)', async () => {
    const r = await d.savePreset(10 as PresetSlot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PresetResult.InvalidSlot);
  });

  it('deletePreset preserves the slot name (matches firmware: directory-level)', async () => {
    await d.setPresetName(4, 'Test');
    await d.savePreset(4);
    await d.deletePreset(4);
    // Per user_presets_spec.md §REQ_PRESET_DELETE: slot name lives in the
    // directory sector independently of the slot payload and persists.
    expect(await d.getPresetName(4)).toBe('Test');
  });

  it('loadPreset does not restore preset names (names are directory-level)', async () => {
    await d.setPresetName(2, 'Original');
    await d.savePreset(2);
    await d.setPresetName(2, 'Changed');
    await d.loadPreset(2);
    // Names live in the directory sector independently of slot payload.
    // LoadPreset doesn't restore them — current name persists.
    expect(await d.getPresetName(2)).toBe('Changed');
  });
});

describe('DspDevice — preset startup + include-pins', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('roundtrips startup config', async () => {
    await d.setPresetStartup({ mode: 1, slot: 4 });
    expect(await d.getPresetStartup()).toEqual({ mode: 1, slot: 4 });
  });

  it('reflects startup config in directory packet', async () => {
    await d.setPresetStartup({ mode: 1, slot: 7 });
    const dir = await d.getPresetDirectory();
    expect(dir.startupMode).toBe(1);
    expect(dir.defaultSlot).toBe(7);
  });

  it('roundtrips output-config mode', async () => {
    await d.setOutputConfigMode(OutputConfigMode.Independent);
    expect(await d.getOutputConfigMode()).toBe(OutputConfigMode.Independent);
    await d.setOutputConfigMode(OutputConfigMode.WithPreset);
    expect(await d.getOutputConfigMode()).toBe(OutputConfigMode.WithPreset);
  });

  it('reflects output-config mode in directory packet', async () => {
    await d.setOutputConfigMode(OutputConfigMode.Independent);
    const dir = await d.getPresetDirectory();
    expect(dir.outputConfigMode).toBe(OutputConfigMode.Independent);
  });
});

describe('DspDevice — clearAllPresets', () => {
  let t: MockTransport;
  let d: DspDevice;
  beforeEach(async () => {
    t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('clears every occupied slot and returns ok', async () => {
    await d.savePreset(0);
    await d.savePreset(3);
    await d.savePreset(9);
    const before = await d.getPresetDirectory();
    expect(before.occupiedSlotsSet.size).toBeGreaterThan(0);

    const r = await d.clearAllPresets({ pacingMs: 0 });
    expect(r.ok).toBe(true);

    const after = await d.getPresetDirectory();
    expect(after.occupiedSlotsSet.size).toBe(0);
  });

  it('paces between deletes when pacingMs > 0', async () => {
    await d.savePreset(0);
    await d.savePreset(1);
    const start = Date.now();
    const r = await d.clearAllPresets({ pacingMs: 20 });
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(true);
    // 10 slots → 9 inter-delete pauses. Nominal: 9 × 20ms = 180ms.
    // We assert half-nominal (90ms) to stay flake-proof under Windows
    // 15.6ms timer resolution + CI scheduling jitter while still catching
    // the regression case (pacingMs ignored → elapsed < 10ms).
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it('treats SlotEmpty as success (empty deletes are idempotent)', async () => {
    // No slots saved — all deletes hit empty slots.
    const r = await d.clearAllPresets({ pacingMs: 0 });
    expect(r.ok).toBe(true);
  });

  it('returns the first non-recoverable failure code', async () => {
    // Stub the transport to return FlashWriteError (0x04) on PresetDelete.
    const orig = t.ctrlIn.bind(t);
    t.ctrlIn = async (req, val, len) =>
      req === WireCmd.PresetDelete.code
        ? new Uint8Array([PresetResult.FlashWriteError])
        : orig(req, val, len);

    const r = await d.clearAllPresets({ pacingMs: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PresetResult.FlashWriteError);
  });
});

describe('DspDevice — preset name truncation', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('setPresetName truncates multi-byte UTF-8 at a codepoint boundary', async () => {
    // 11 four-byte emoji = 44 bytes. Codepoint-aware crop yields 7 emoji = 28 bytes.
    const tooLong = '🎵'.repeat(11);
    await d.setPresetName(0, tooLong);
    const got = await d.getPresetName(0);
    expect(got).toBe('🎵'.repeat(7));
  });
});

describe('DspDevice — getFilter multi-read', () => {
  test('issues 4 ctrlIn calls with bit-packed wValue and reconstructs FilterParams', async () => {
    const seen: { req: number; val: number; len: number }[] = [];
    // Per-param synthesized response. param 0 = type as u32; 1..3 = f32.
    const respond = (param: number): Uint8Array => {
      const out = new Uint8Array(4);
      const v = new DataView(out.buffer);
      switch (param) {
        case 0: v.setUint32(0, 1, true); break;        // FilterType.Peaking = 1
        case 1: v.setFloat32(0, 1234, true); break;    // freq
        case 2: v.setFloat32(0, 0.7, true); break;     // q
        case 3: v.setFloat32(0, -3.5, true); break;    // gain
      }
      return out;
    };
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val, len) => {
        if (req === WireCmd.GetPlatform.code) {
          return new Uint8Array([1, 1, 2, 0]);
        }
        seen.push({ req, val, len });
        // Strict protocol check: channel/band bits must match expected base.
        // Done inline so a future test refactor can't accidentally lose this coverage.
        const expectedBase = (2 << 8) | (5 << 4);
        expect(val & ~0xF).toBe(expectedBase);
        return respond(val & 0xF);
      },
      ctrlOut: async () => {},
    };
    const d = await createDevice(t);
    const f = await d.getFilter(2, 5);

    expect(seen).toHaveLength(4);
    expect(seen.map(s => s.req)).toEqual([0x43, 0x43, 0x43, 0x43]);
    expect(seen.map(s => s.len)).toEqual([4, 4, 4, 4]);
    // wValue = (channel << 8) | (band << 4) | param
    const base = (2 << 8) | (5 << 4);
    expect(seen.map(s => s.val)).toEqual([base | 0, base | 1, base | 2, base | 3]);

    expect(f.type).toBe(FilterType.Peaking);
    expect(f.frequency).toBeCloseTo(1234, 1);
    expect(f.q).toBeCloseTo(0.7, 4);
    expect(f.gain).toBeCloseTo(-3.5, 4);
  });

  test('channel-scoped operations can run immediately after factory creation', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);

    await expect(d.setFilter(2, 0, {
      type: FilterType.Peaking,
      bypass: false,
      frequency: 1000,
      q: 1,
      gain: 0,
    })).resolves.toBeUndefined();
  });

  test('maps RP2040 PDM channel-scoped commands to firmware channel 6', async () => {
    const seenOut: Array<{ req: number; val: number; data: Uint8Array }> = [];
    const seenIn: Array<{ req: number; val: number; len: number }> = [];
    const t: DspTransport = {
      open: async () => {},
      close: async () => {},
      isOpen: () => true,
      on: () => () => {},
      ctrlIn: async (req, val, len) => {
        seenIn.push({ req, val, len });
        if (req === WireCmd.GetPlatform.code) {
          return new Uint8Array([0, 1, 2, 0]);
        }
        return new Uint8Array(len);
      },
      ctrlOut: async (req, val, data) => {
        seenOut.push({ req, val, data });
      },
    };
    const d = await createDevice(t, 'rp2040');
    await d.setFilter(ChannelId.Pdm, 0, { type: FilterType.Peaking, bypass: false, frequency: 80, q: 1, gain: -3 });
    await d.getFilter(ChannelId.Pdm, 1);
    await d.setChannelName(ChannelId.Pdm, 'Sub');
    await d.getChannelName(ChannelId.Pdm);

    const filterPacket = seenOut.find((call) => call.req === WireCmd.SetEqParam.code)?.data;
    expect(filterPacket?.[0]).toBe(6);
    expect(seenIn.filter((call) => call.req === WireCmd.GetEqParam.code).map((call) => call.val & ~0xF))
      .toEqual(Array(4).fill((6 << 8) | (1 << 4)));
    expect(seenOut.find((call) => call.req === WireCmd.SetChannelName.code)?.val).toBe(6);
    expect(seenIn.find((call) => call.req === WireCmd.GetChannelName.code)?.val).toBe(6);
  });
});

describe('output type & pin commands', () => {
  async function dev() {
    const t = new MockTransport({ platform: 'rp2350' });
    return await DspDevice.create(t);
  }

  test('getOutputPin reports seeded default; setOutputPin to a free pin succeeds and reads back', async () => {
    const d = await dev();
    expect(await d.getOutputPin(0)).toBe(6);
    const r = await d.setOutputPin(0, 16);
    expect(r.ok).toBe(true);
    expect(await d.getOutputPin(0)).toBe(16);
  });

  test('setOutputPin to a pin in use by another output is refused', async () => {
    const d = await dev();
    const r = await d.setOutputPin(0, 7); // 7 belongs to slot 2
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PinConfigResult.PinInUse);
  });

  test('setOutputType switches a slot and getOutputType confirms', async () => {
    const d = await dev();
    expect(await d.getOutputType(0)).toBe(0);
    const r = await d.setOutputType(0, 1);
    expect(r.ok).toBe(true);
    expect(await d.getOutputType(0)).toBe(1);
  });

  test('setOutputPin with an out-of-range index is refused with InvalidOutput', async () => {
    const d = await dev();
    const r = await d.setOutputPin(99, 16);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PinConfigResult.InvalidOutput);
  });
});

describe('I2S clock commands', () => {
  async function dev() {
    const t = new MockTransport({ platform: 'rp2350' });
    return await DspDevice.create(t);
  }

  test('BCK pin defaults to 14 and changes when no slot is I2S', async () => {
    const d = await dev();
    expect(await d.getI2sBckPin()).toBe(14);
    expect((await d.setI2sBckPin(16)).ok).toBe(true);
    expect(await d.getI2sBckPin()).toBe(16);
  });

  test('MCK enable round-trips; MCK pin cannot change while MCK enabled', async () => {
    const d = await dev();
    expect(await d.getMckEnable()).toBe(0);
    expect((await d.setMckEnable(true)).ok).toBe(true);
    expect(await d.getMckEnable()).toBe(1);
    const r = await d.setMckPin(20);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PinConfigResult.OutputActive);
  });

  test('MCK multiplier round-trips as 0/1 enum', async () => {
    const d = await dev();
    expect((await d.setMckMultiplier(1)).ok).toBe(true);
    expect(await d.getMckMultiplier()).toBe(1);
  });

  test('changing BCK while a slot is I2S is refused with OUTPUT_ACTIVE', async () => {
    const d = await dev();
    await d.setOutputType(0, 1);
    const r = await d.setI2sBckPin(16);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(PinConfigResult.OutputActive);
  });
});

describe('setAllParams', () => {
  it('issues one ctrlOut with code=0xA1, wValue=0, byteLength=2960', async () => {
    const transport = new MockTransport({ platform: 'rp2350' });
    const ctrlOutSpy = vi.spyOn(transport, 'ctrlOut');
    const dev = await DspDevice.create(transport);

    const bulk = await dev.getAllParams();
    await dev.setAllParams(bulk);

    // Filter to just the SetAllParams calls (DspDevice.create / getAllParams may issue other ctrlOuts).
    const calls = ctrlOutSpy.mock.calls.filter((c) => c[0] === 0xA1);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(0);              // wValue
    expect(calls[0][2].byteLength).toBe(Wire.BulkSizes.V10); // V10 device round-trips its full tail
  });

  it('mock direct getters reflect values written through setAllParams', async () => {
    const transport = new MockTransport({ platform: 'rp2350' });
    const dev = await DspDevice.create(transport);
    const bulk = await dev.getAllParams();

    bulk.masterVolumeDb = -18;
    bulk.preampDb = 2.5;
    bulk.preampLDb = -1.5;
    bulk.preampRDb = -3;
    bulk.bypass = true;
    bulk.channelNames[0] = 'Bulk Name';

    await dev.setAllParams(bulk);

    expect(await dev.getMasterVolume()).toBeCloseTo(-18, 4);
    expect(await dev.getMasterPreamp()).toBeCloseTo(2.5, 4);
    expect(await dev.getInputPreamp(0)).toBeCloseTo(-1.5, 4);
    expect(await dev.getInputPreamp(1)).toBeCloseTo(-3, 4);
    expect(await dev.getBypass()).toBe(true);
    expect(await dev.getChannelName(0)).toBe('Bulk Name');
  });
});

describe('connect-time capabilities + version gating', () => {
  it('attaches capabilities derived from the connected device', async () => {
    const dev = await createDevice(new MockTransport({ platform: 'rp2350' }), 'rp2350');
    expect(dev.capabilities.support).toBe('supported');
    expect(dev.capabilities.wire).toBe(10);
    expect(dev.info.capabilities).toBe(dev.capabilities);
  });

  it('rejects a device older than the V10 floor with UnsupportedFirmware', async () => {
    const transport = new MockTransport({ platform: 'rp2350', wireVersion: 6, fwVersion: { major: 1, minor: 1, patch: 3 } });
    await expect(DspDevice.create(transport)).rejects.toBeInstanceOf(UnsupportedFirmware);
  });

  it('UnsupportedFirmware reports the actual firmware version', async () => {
    const transport = new MockTransport({ platform: 'rp2350', wireVersion: 6, fwVersion: { major: 1, minor: 1, patch: 3 } });
    const err = await DspDevice.create(transport).catch((e) => e);
    expect(err).toBeInstanceOf(UnsupportedFirmware);
    expect((err as UnsupportedFirmware).firmwareVersion).toBe('1.1.3');
  });

  it('rejects a wire-supported device that reports a truncated payload', async () => {
    // V10 wire (supported) but a payload shorter than the V10 floor — malformed
    // firmware. Floor sections are treated as guaranteed, so connect rejects it.
    const transport = new MockTransport({ platform: 'rp2350', wireVersion: 10, payloadLength: Wire.BulkSizes.V3 });
    await expect(DspDevice.create(transport)).rejects.toBeInstanceOf(UnsupportedDevicePacket);
  });

  // The snapshot from a V10 device carries formatVersion 10; the paste path
  // (captureState -> restoreState -> setAllParams) must not throw — the writer
  // normalizes it to a V6 packet the firmware merges.
  it('captureState/restoreState round-trips on an accepted V10 device', async () => {
    const transport = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    const dev = await DspDevice.create(transport);
    expect(dev.capabilities.support).toBe('supported');
    const state = await dev.captureState();
    await expect(dev.restoreState(state)).resolves.toBeUndefined();
  });
});

describe('getAllParams', () => {
  it('requests MaxReadSize so a newer (V10) device does not overrun the transfer', async () => {
    const transport = new MockTransport({ platform: 'rp2350' });
    const ctrlInSpy = vi.spyOn(transport, 'ctrlIn');
    const dev = await DspDevice.create(transport);

    await dev.getAllParams();

    const reads = ctrlInSpy.mock.calls.filter((c) => c[0] === WireCmd.GetAllParams.code);
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r[2]).toBe(Wire.BulkLimits.MaxReadSize);
      expect(r[2]).toBeGreaterThanOrEqual(2960);
    }
  });
});

describe('readNotification', () => {
  it('reads a notify packet through the device transport', async () => {
    const transport = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    const dev = await DspDevice.create(transport);
    transport.pushNotify(new Uint8Array([2, 3, 0, 5, 3, 0, 0, 0]));
    const bytes = await dev.readNotification();
    expect(bytes?.[1]).toBe(NotifyEventId.BulkInvalidated);  // event_id = BULK_INVALIDATED
  });

  it('returns null when the transport has no notify endpoint', async () => {
    // Delegate every DspTransport method to a MockTransport EXCEPT notifyIn,
    // so create() succeeds but the device reports no notifications available.
    const mock = new MockTransport({ platform: 'rp2350' });
    const noNotify: DspTransport = {
      open: () => mock.open(), close: () => mock.close(), isOpen: () => mock.isOpen(),
      on: (e, l) => mock.on(e, l),
      ctrlIn: (r, v, l) => mock.ctrlIn(r, v, l),
      ctrlOut: (r, v, d) => mock.ctrlOut(r, v, d),
      // no notifyIn
    };
    const dev = await DspDevice.create(noNotify);
    expect(await dev.readNotification()).toBeNull();
  });
});

describe('lastRawBulk', () => {
  // resolveInfo's connect-time bulk read uses a raw ctrlIn (static, no instance),
  // so lastRawBulk is null until the first instance getAllParams() call.
  it('is null before the first getAllParams, then holds the read bytes', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    expect(dev.lastRawBulk).toBeNull();
    await dev.getAllParams();
    expect(dev.lastRawBulk!.byteLength).toBe(Wire.BulkSizes.V10);
  });

  it('retains the full V10 image on a 1.1.4 device', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350', wireVersion: 10 }));
    await dev.getAllParams();
    expect(dev.lastRawBulk!.byteLength).toBe(2960);   // full V10 image retained
    expect(dev.lastRawBulk![0]).toBe(10);             // header formatVersion
  });
});

describe('DspDevice — v1.1.4 granular surface', () => {
  const v10 = () => DspDevice.create(new MockTransport({ platform: 'rp2350', wireVersion: 10 }));

  test('setBandBypass/getBandBypass round-trip on a V10 device', async () => {
    const d = await v10();
    await d.setBandBypass(0, 2, true);
    expect(await d.getBandBypass(0, 2)).toBe(true);
    await d.setBandBypass(0, 2, false);
    expect(await d.getBandBypass(0, 2)).toBe(false);
  });

  test('setBandBypass remaps the RP2040 PDM channel (set and get agree)', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2040', wireVersion: 10 }));
    await d.setBandBypass(ChannelId.Pdm, 0, true);
    expect(await d.getBandBypass(ChannelId.Pdm, 0)).toBe(true);
  });

  test('user volume + mute round-trip on V10', async () => {
    const d = await v10();
    await d.setUserVolume(-12);
    expect(await d.getUserVolume()).toBeCloseTo(-12, 4);
    await d.setUserMute(true);
    expect(await d.getUserMute()).toBe(true);
  });

  test('input source round-trips on V10', async () => {
    const d = await v10();
    await d.setInputSource(AudioInputSource.Spdif);
    expect(await d.getInputSource()).toBe(AudioInputSource.Spdif);
  });

  test('getSpdifRxStatus narrows state + inputSource on V10', async () => {
    const d = await v10();
    await d.setInputSource(AudioInputSource.Spdif);
    const s = await d.getSpdifRxStatus();
    expect(s.state).toBe(SpdifInputState.Locked);
    expect(s.inputSource).toBe(AudioInputSource.Spdif);
    expect(s.sampleRate).toBe(48000);
  });

  test('getSpdifRxChStatus returns the 24-byte block on V10', async () => {
    const d = await v10();
    expect((await d.getSpdifRxChStatus()).byteLength).toBe(24);
  });

  test('S/PDIF RX pin round-trips on V10', async () => {
    const d = await v10();
    await d.setSpdifRxPin(15);
    expect(await d.getSpdifRxPin()).toBe(15);
  });

  test('LG Sound Sync enable + status round-trip on V10', async () => {
    const d = await v10();
    await d.setLgSoundSyncEnabled(true);
    expect(await d.getLgSoundSyncEnabled()).toBe(true);
    expect((await d.getLgSoundSyncStatus()).enabled).toBe(true);
  });

  test('DAC HW mute config round-trips on V10', async () => {
    const d = await v10();
    const cfg = { enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 };
    await d.setDacHwMute(cfg);
    expect(await d.getDacHwMute()).toEqual(cfg);
    await expect(d.testDacHwMute()).resolves.toBeUndefined();
  });

  test('saveOutputConfig returns ok on a V10 device', async () => {
    const d = await v10();
    const r = await d.saveOutputConfig();
    expect(r.ok).toBe(true);
  });
});
