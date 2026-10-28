// Facade-level tests for DspDevice. Mock-fidelity assertions (serial,
// bulk shape, master-volume roundtrip, buffer-stats parsing) live in
// MockTransport.test.ts; this file covers the things only DspDevice
// adds on top: factory identity capture, getSystemInfo aggregation,
// per-input preamp, and the hardware-profile contract for getSystemStatus.

import { describe, it, test, expect, beforeEach, vi } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice, UnsupportedFirmware, UnsupportedDevicePacket } from './DspDevice';
import { createDevice } from '@test/fixtures/deviceHarness';
import * as Protocol from '@/protocol';
import { Codec } from '@/utils';
import * as Domain from '@/domain';
import type { PresetSlot } from '@/domain';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';

describe('DspDevice facade', () => {
  let d: DspDevice;
  beforeEach(async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    d = await createDevice(t);
  });

  it('reads device info (platform type + firmware string)', async () => {
    expect(d.info.platformType).toBe(Domain.PlatformType.RP2350);
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
        if (request === Protocol.WireCmd.GetStatus.code && value === Protocol.SystemStatusValue.SpdifStarvationsTotal) {
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

describe('DspDevice — GetPlatform response length', () => {
  it('takes full-width minor/patch from the 6-byte response (fw 1.1.6+)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 16 } });
    const d = await DspDevice.create(t);
    expect(d.info.capabilities.fwLabel).toBe('1.1.16');
  });

  it('falls back to the nibble-packed byte when only 4 bytes come back', async () => {
    const t = new MockTransport({ platform: 'rp2350', fwVersion: { major: 1, minor: 1, patch: 5 } });
    const seen: number[] = [];
    const spy: DspTransport = {
      open: () => t.open(), close: () => t.close(), isOpen: () => t.isOpen(), on: (e, l) => t.on(e, l),
      ctrlIn: async (req, val, len) => {
        const r = await t.ctrlIn(req, val, len);
        if (req === Protocol.WireCmd.GetPlatform.code) seen.push(r.length);
        return r;
      },
      ctrlOut: (req, val, data) => t.ctrlOut(req, val, data),
    };
    const d = await DspDevice.create(spy);
    expect(seen).toEqual([4]);
    expect(d.info.capabilities.fwLabel).toBe('1.1.5');
  });
});

describe('DspDevice — build stamp (GetBuildInfo 0x80, gated on features.buildStamp)', () => {
  it('info.build is the mock default on a V29 / fw 1.1.6 device', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 6 } });
    const d = await DspDevice.create(t);
    expect(d.info.build).toEqual({ describe: 'v1.1.6-mock', date: '2026-09-02' });
  });

  it('info.build is null on wire 28 and the device never sees request 0x80', async () => {
    const t = new MockTransport({ platform: 'rp2350', fwVersion: { major: 1, minor: 1, patch: 5 } });
    const seen: number[] = [];
    const spy: DspTransport = {
      open: () => t.open(), close: () => t.close(), isOpen: () => t.isOpen(), on: (e, l) => t.on(e, l),
      ctrlIn: (req, val, len) => { seen.push(req); return t.ctrlIn(req, val, len); },
      ctrlOut: (req, val, data) => t.ctrlOut(req, val, data),
    };
    const d = await DspDevice.create(spy);
    expect(d.info.build).toBeNull();
    expect(seen).not.toContain(Protocol.WireCmd.GetBuildInfo.code);
  });

  it('info.build is null and create still resolves when the 0x80 read throws', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 6 } });
    const spy: DspTransport = {
      open: () => t.open(), close: () => t.close(), isOpen: () => t.isOpen(), on: (e, l) => t.on(e, l),
      ctrlIn: (req, val, len) => {
        if (req === Protocol.WireCmd.GetBuildInfo.code) return Promise.reject(new Error('STALL'));
        return t.ctrlIn(req, val, len);
      },
      ctrlOut: (req, val, data) => t.ctrlOut(req, val, data),
    };
    const d = await DspDevice.create(spy);
    expect(d.info.build).toBeNull();
  });

  it('info.build is null when the 0x80 reply is too short to carry a describe', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 6 } });
    const spy: DspTransport = {
      open: () => t.open(), close: () => t.close(), isOpen: () => t.isOpen(), on: (e, l) => t.on(e, l),
      ctrlIn: async (req, val, len) => {
        if (req === Protocol.WireCmd.GetBuildInfo.code) return new Uint8Array(0);
        return t.ctrlIn(req, val, len);
      },
      ctrlOut: (req, val, data) => t.ctrlOut(req, val, data),
    };
    const d = await DspDevice.create(spy);
    expect(d.info.build).toBeNull();
  });
});

describe('DspDevice — getSystemStatus hardware profile contract', () => {
  it('uses platform-correct channel count from factory hardware profile', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);
    const s = await d.getSystemStatus();
    expect(s.peaks.length).toBe(17);
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
        if (request === Protocol.WireCmd.GetStatus.code) statusLength = length;
        return inner.ctrlIn(request, value, length);
      },
      ctrlOut: (request, value, data) => inner.ctrlOut(request, value, data),
    };
    const d = await createDevice(t, 'rp2040');
    expect(d.info.platformType).toBe(Domain.PlatformType.RP2040);
    expect(d.hardware.totalChannelCount).toBe(7);
    const s = await d.getSystemStatus();
    expect(statusLength).toBe(Protocol.systemStatusSize(7));
    expect(s.peaks.length).toBe(17);
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
    expect(await (await createDevice(t)).getMasterVolumeMode()).toBe(Domain.MasterVolumeMode.WithPreset);
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
    value?: number;
  }> = [
    { name: 'setBypass(true) -> 0x46',                invoke: (d) => d.setBypass(true), opcode: 0x46, payload: bool8(true) },
    { name: 'setBypass(false) -> 0x46',               invoke: (d) => d.setBypass(false), opcode: 0x46, payload: bool8(false) },
    { name: 'setMasterVolumeMode(WithPreset) -> 0xD4', invoke: (d) => d.setMasterVolumeMode(Domain.MasterVolumeMode.WithPreset), opcode: 0xD4, payload: u8(1) },
    { name: 'setMasterVolumeMode(Independent) -> 0xD4', invoke: (d) => d.setMasterVolumeMode(Domain.MasterVolumeMode.Independent), opcode: 0xD4, payload: u8(0) },
    { name: 'setLoudnessEnabled(true) -> 0x58',       invoke: (d) => d.setLoudnessEnabled(true), opcode: 0x58, payload: bool8(true) },
    { name: 'setLoudnessRefSpl(85) -> 0x5A',          invoke: (d) => d.setLoudnessRefSpl(85), opcode: 0x5A, payload: f32(85) },
    { name: 'setLoudnessIntensity(0.6) -> 0x5C',      invoke: (d) => d.setLoudnessIntensity(0.6), opcode: 0x5C, payload: f32(0.6) },
    { name: 'setCrossfeedEnabled(true) -> 0x5E',      invoke: (d) => d.setCrossfeedEnabled(true), opcode: 0x5E, payload: bool8(true) },
    { name: 'setCrossfeedPreset(Preset3) -> 0x60',    invoke: (d) => d.setCrossfeedPreset(Domain.CrossfeedPreset.Preset3), opcode: 0x60, payload: u8(2) },
    { name: 'setCrossfeedFreq(700) -> 0x62',          invoke: (d) => d.setCrossfeedFreq(700), opcode: 0x62, payload: f32(700) },
    { name: 'setCrossfeedFeedDb(4.5) -> 0x64',        invoke: (d) => d.setCrossfeedFeedDb(4.5), opcode: 0x64, payload: f32(4.5) },
    { name: 'setCrossfeedItd(false) -> 0x66',         invoke: (d) => d.setCrossfeedItd(false), opcode: 0x66, payload: bool8(false) },
    { name: 'setLevellerEnabled(true) -> 0xB4',       invoke: (d) => d.setLevellerEnabled(true), opcode: 0xB4, payload: bool8(true) },
    { name: 'setLevellerAmount(30) -> 0xB6',          invoke: (d) => d.setLevellerAmount(30), opcode: 0xB6, payload: f32(30) },
    { name: 'setLevellerSpeed(Fast) -> 0xB8',         invoke: (d) => d.setLevellerSpeed(Domain.LevellerSpeed.Fast), opcode: 0xB8, payload: u8(2) },
    { name: 'setLevellerMaxGain(6) -> 0xBA',          invoke: (d) => d.setLevellerMaxGain(6), opcode: 0xBA, payload: f32(6) },
    { name: 'setLevellerLookahead(true) -> 0xBC',     invoke: (d) => d.setLevellerLookahead(true), opcode: 0xBC, payload: bool8(true) },
    { name: 'setLevellerGate(-40) -> 0xBE',           invoke: (d) => d.setLevellerGate(-40), opcode: 0xBE, payload: f32(-40) },
    { name: 'setPsybassEnabled(true) -> 0x30',        invoke: (d) => d.setPsybassEnabled(true), opcode: 0x30, payload: bool8(true) },
    { name: 'setPsybassCutoff(80) -> 0x32',           invoke: (d) => d.setPsybassCutoff(80), opcode: 0x32, payload: f32(80) },
    { name: 'setPsybassHarmonics(0) -> 0x34',         invoke: (d) => d.setPsybassHarmonics(0), opcode: 0x34, payload: f32(0) },
    { name: 'setPsybassDrive(6) -> 0x36',             invoke: (d) => d.setPsybassDrive(6), opcode: 0x36, payload: f32(6) },
    { name: 'setPsybassCharacter(50) -> 0x38',        invoke: (d) => d.setPsybassCharacter(50), opcode: 0x38, payload: f32(50) },
    { name: 'setPsybassOriginal(0) -> 0x3A',          invoke: (d) => d.setPsybassOriginal(0), opcode: 0x3A, payload: f32(0) },
    // Stereo upmixer: single opcode 0x4C, param id carried in wValue (not 0).
    { name: 'setUpmixEnabled(true) -> 0x4C id0',      invoke: (d) => d.setUpmixEnabled(true), opcode: 0x4C, value: 0,  payload: f32(1) },
    { name: 'setUpmixCenterMode(1) -> 0x4C id1',      invoke: (d) => d.setUpmixCenterMode(1), opcode: 0x4C, value: 1,  payload: f32(1) },
    { name: 'setUpmixSurroundMode(2) -> 0x4C id2',    invoke: (d) => d.setUpmixSurroundMode(2), opcode: 0x4C, value: 2,  payload: f32(2) },
    { name: 'setUpmixStrength(75) -> 0x4C id3',       invoke: (d) => d.setUpmixStrength(75), opcode: 0x4C, value: 3,  payload: f32(75) },
    { name: 'setUpmixCenterWidth(40) -> 0x4C id4',    invoke: (d) => d.setUpmixCenterWidth(40), opcode: 0x4C, value: 4,  payload: f32(40) },
    { name: 'setUpmixCorrThreshold(50) -> 0x4C id5',  invoke: (d) => d.setUpmixCorrThreshold(50), opcode: 0x4C, value: 5,  payload: f32(50) },
    { name: 'setUpmixAttack(20) -> 0x4C id6',         invoke: (d) => d.setUpmixAttack(20), opcode: 0x4C, value: 6,  payload: f32(20) },
    { name: 'setUpmixRelease(200) -> 0x4C id7',       invoke: (d) => d.setUpmixRelease(200), opcode: 0x4C, value: 7,  payload: f32(200) },
    { name: 'setUpmixDetectorHpf(150) -> 0x4C id8',   invoke: (d) => d.setUpmixDetectorHpf(150), opcode: 0x4C, value: 8,  payload: f32(150) },
    { name: 'setUpmixSurroundDelay(8) -> 0x4C id9',   invoke: (d) => d.setUpmixSurroundDelay(8), opcode: 0x4C, value: 9,  payload: f32(8) },
    { name: 'setUpmixSurroundHpf(400) -> 0x4C id10',  invoke: (d) => d.setUpmixSurroundHpf(400), opcode: 0x4C, value: 10, payload: f32(400) },
    { name: 'setUpmixSurroundLpf(6000) -> 0x4C id11', invoke: (d) => d.setUpmixSurroundLpf(6000), opcode: 0x4C, value: 11, payload: f32(6000) },
    { name: 'setUpmixDecorr(80) -> 0x4C id12',        invoke: (d) => d.setUpmixDecorr(80), opcode: 0x4C, value: 12, payload: f32(80) },
    { name: 'setUpmixPresence(3) -> 0x4C id13',       invoke: (d) => d.setUpmixPresence(3), opcode: 0x4C, value: 13, payload: f32(3) },
    { name: 'setSubharmEnabled(true) -> 0x10',        invoke: (d) => d.setSubharmEnabled(true), opcode: 0x10, payload: bool8(true) },
    { name: 'setSubharmLow(-6) -> 0x12',              invoke: (d) => d.setSubharmLow(-6), opcode: 0x12, payload: f32(-6) },
    { name: 'setSubharmHigh(0) -> 0x14',              invoke: (d) => d.setSubharmHigh(0), opcode: 0x14, payload: f32(0) },
    { name: 'setSubharmBoost(3) -> 0x16',             invoke: (d) => d.setSubharmBoost(3), opcode: 0x16, payload: f32(3) },
    { name: 'setSubharmTop(-3) -> 0x1B',              invoke: (d) => d.setSubharmTop(-3), opcode: 0x1B, payload: f32(-3) },
    { name: 'setSubharmSelect(1) -> 0x1D',            invoke: (d) => d.setSubharmSelect(1), opcode: 0x1D, payload: u8(1) },
    { name: 'setSubharmSolo(true) -> 0x2C',           invoke: (d) => d.setSubharmSolo(true), opcode: 0x2C, payload: bool8(true) },
    { name: 'setSubharmLink(false) -> 0x2E',          invoke: (d) => d.setSubharmLink(false), opcode: 0x2E, payload: bool8(false) },
    { name: 'setSubharmDepth(60) -> 0xA9',            invoke: (d) => d.setSubharmDepth(60), opcode: 0xA9, payload: f32(60) },
    { name: 'setSubharmHold(200) -> 0xAB',            invoke: (d) => d.setSubharmHold(200), opcode: 0xAB, payload: f32(200) },
    { name: 'setSubharmCeiling(-12) -> 0xAD',         invoke: (d) => d.setSubharmCeiling(-12), opcode: 0xAD, payload: f32(-12) },
    // Output limiter: single opcode 0x81, wValue = (output << 8) | index, float payload for every param.
    { name: 'setLimiterEnabled(2, true) -> 0x81',     invoke: (d) => d.setLimiterEnabled(2, true), opcode: 0x81, value: 0x0200, payload: f32(1) },
    { name: 'setLimiterThreshold(5, -6) -> 0x81',     invoke: (d) => d.setLimiterThreshold(5, -6), opcode: 0x81, value: 0x0501, payload: f32(-6) },
    { name: 'setLimiterRelease(0xFF, 250) -> 0x81',   invoke: (d) => d.setLimiterRelease(0xFF, 250), opcode: 0x81, value: 0xFF02, payload: f32(250) },
    { name: 'setLimiterLinkGroup(8, 3) -> 0x81',      invoke: (d) => d.setLimiterLinkGroup(8, 3), opcode: 0x81, value: 0x0803, payload: f32(3) },
  ];

  it.each(setterCases)('$name writes the expected opcode + payload', async ({ invoke, opcode, payload, value }) => {
    const { t, captured } = makeCapturingTransport();
    const d = await createDevice(t);
    await invoke(d);
    expect(captured).toHaveLength(1);
    expect(captured[0].request).toBe(opcode);
    expect(captured[0].value).toBe(value ?? 0);
    expect(captured[0].data).toEqual(payload);
  });
});

describe('DspDevice — getUpmixStatus decode', () => {
  test('decodes 0x4E response, preserving a negative Q14 correlation', async () => {
    let lastReq = 0, lastVal = 0;
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val) => {
        lastReq = req; lastVal = val;
        return Codec.encode(Protocol.Wire.UpmixStatus, {
          active: true, parkedReason: 0, corrQ14: -4096, balanceQ14: 2048,
          centerGainQ15: 23170, lsGainQ15: 20000, rsGainQ15: 20000,
        });
      },
      ctrlOut: async () => {},
    };
    const status = await (await createDevice(t)).getUpmixStatus();
    expect(lastReq).toBe(0x4E);
    expect(lastVal).toBe(0);
    expect(status).toEqual({
      active: true, parkedReason: 0, corrQ14: -4096, balanceQ14: 2048,
      centerGainQ15: 23170, lsGainQ15: 20000, rsGainQ15: 20000,
    });
  });

  test('narrows an out-of-range parkedReason byte to Disabled', async () => {
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async () => Codec.encode(Protocol.Wire.UpmixStatus, {
        active: false, parkedReason: 99, corrQ14: 0, balanceQ14: 0,
        centerGainQ15: 0, lsGainQ15: 0, rsGainQ15: 0,
      }),
      ctrlOut: async () => {},
    };
    const status = await (await createDevice(t)).getUpmixStatus();
    expect(status.parkedReason).toBe(1); // Disabled
  });
});

describe('DspDevice — subharmonic synthesizer (both platforms)', () => {
  const v29 = () => DspDevice.create(new MockTransport({ platform: 'rp2350', wireVersion: 29 }));

  test('subharm output mask round-trips and masks to u16', async () => {
    const d = await v29();
    expect(await d.getSubharmMask()).toBe(0xFFFF);
    await d.setSubharmMask(0x00F0);
    expect(await d.getSubharmMask()).toBe(0x00F0);
    // Values above a u16 are truncated.
    await d.setSubharmMask(0x1FFFF);
    expect(await d.getSubharmMask()).toBe(0xFFFF);
  });

  test('getSubharmHeadroom is 0 while disabled, positive once enabled with a band above the floor', async () => {
    const d = await v29();
    expect(await d.getSubharmHeadroom()).toBe(0);
    await d.setSubharmEnabled(true);
    await d.setSubharmLow(3);
    expect(await d.getSubharmHeadroom()).toBeGreaterThan(0);
  });
});

describe('DspDevice — output limiter reads (fw V32+)', () => {
  // Transport whose 0x81 GET replies are canned, so decode is checked
  // independently of the mock's own stand-in.
  async function withReply(reply: Uint8Array) {
    const inner = new MockTransport({ platform: 'rp2350', wireVersion: 32 });
    await inner.open();
    const seen: Array<{ value: number; length: number }> = [];
    const t: DspTransport = {
      open: () => inner.open(), close: () => inner.close(), isOpen: () => inner.isOpen(),
      on: (e: TransportEvent, l: () => void) => inner.on(e, l),
      ctrlIn: (request, value, length) => {
        if (request !== Protocol.WireCmd.Limiter.code) return inner.ctrlIn(request, value, length);
        seen.push({ value, length });
        return Promise.resolve(reply);
      },
      ctrlOut: (request, value, data) => inner.ctrlOut(request, value, data),
    };
    return { d: await createDevice(t), seen };
  }

  test('getLimiterMeter reads one u16 per hardware output and converts 0.01 dB to dB', async () => {
    const raw = new Uint8Array(18);
    const dv = new DataView(raw.buffer);
    dv.setUint16(0, 350, true);
    dv.setUint16(4, 12, true);
    const { d, seen } = await withReply(raw);
    const meter = await d.getLimiterMeter();
    expect(seen).toEqual([{ value: 0x0080, length: 18 }]);
    expect(meter).toHaveLength(9);
    expect(meter[0]).toBeCloseTo(3.5, 6);
    expect(meter[1]).toBe(0);
    expect(meter[2]).toBeCloseTo(0.12, 6);
  });

  test('getLimiterMeter tolerates a short reply', async () => {
    const { d } = await withReply(new Uint8Array([100, 0, 200, 0, 7]));
    expect(await d.getLimiterMeter()).toEqual([1, 2]);
  });

  test('getLimiterStatus decodes the 4-byte block from index 0x81', async () => {
    const { d, seen } = await withReply(new Uint8Array([1, 32, 16, 9]));
    expect(await d.getLimiterStatus()).toEqual({ engaged: true, lookaheadSamples: 32, blockSamples: 16, numOutputs: 9 });
    expect(seen[0].value).toBe(0x0081);
  });

  test('getLimiterParam sends the packed wValue and decodes the float', async () => {
    const f = new Uint8Array(4);
    new DataView(f.buffer).setFloat32(0, -12.5, true);
    const { d, seen } = await withReply(f);
    expect(await d.getLimiterParam(4, Protocol.Wire.LimiterParam.ThresholdDb)).toBeCloseTo(-12.5, 4);
    expect(seen[0].value).toBe(0x0401);
  });
});

describe('DspDevice — saveMasterVolume action-IN', () => {
  test('resolves ok when status byte is 0', async () => {
    const seen: { req: number; val: number; len: number }[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val, len) => { seen.push({ req, val, len }); return new Uint8Array([0]); },
      ctrlOut: async () => {},
    };
    const r = await (await createDevice(t)).saveMasterVolume();
    expect(r.ok).toBe(true);
    expect(seen[0]).toEqual({ req: 0xD6, val: 0, len: 1 });
  });

  test('fails with the device PresetResult code on a non-zero status byte', async () => {
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async () => new Uint8Array([3]), // CrcFailure
      ctrlOut: async () => {},
    };
    const r = await (await createDevice(t)).saveMasterVolume();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Protocol.PresetResult.CrcFailure);
  });

  test('fails when response is empty', async () => {
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async () => new Uint8Array(0),
      ctrlOut: async () => {},
    };
    const r = await (await createDevice(t)).saveMasterVolume();
    expect(r.ok).toBe(false);
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
    expect(dir.outputConfigMode).toBe(Domain.OutputConfigMode.WithPreset);
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
        request === Protocol.WireCmd.PresetGetActive.code
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
    if (!r.ok) expect(r.code).toBe(Protocol.PresetResult.InvalidSlot);
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
    await d.setOutputConfigMode(Domain.OutputConfigMode.Independent);
    expect(await d.getOutputConfigMode()).toBe(Domain.OutputConfigMode.Independent);
    await d.setOutputConfigMode(Domain.OutputConfigMode.WithPreset);
    expect(await d.getOutputConfigMode()).toBe(Domain.OutputConfigMode.WithPreset);
  });

  it('reflects output-config mode in directory packet', async () => {
    await d.setOutputConfigMode(Domain.OutputConfigMode.Independent);
    const dir = await d.getPresetDirectory();
    expect(dir.outputConfigMode).toBe(Domain.OutputConfigMode.Independent);
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
      req === Protocol.WireCmd.PresetDelete.code
        ? new Uint8Array([Protocol.PresetResult.FlashWriteError])
        : orig(req, val, len);

    const r = await d.clearAllPresets({ pacingMs: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Protocol.PresetResult.FlashWriteError);
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
        if (req === Protocol.WireCmd.GetPlatform.code) {
          return new Uint8Array([1, 1, 2, 0]);
        }
        seen.push({ req, val, len });
        // Strict protocol check: channel/band bits must match expected base.
        // Done inline so a future test refactor can't accidentally lose this coverage.
        const expectedBase = (8 << 8) | (5 << 3);
        expect(val & ~0x7).toBe(expectedBase);
        return respond(val & 0x7);
      },
      ctrlOut: async () => {},
    };
    const d = await createDevice(t);
    const f = await d.getFilter(2, 5);

    expect(seen).toHaveLength(4);
    expect(seen.map(s => s.req)).toEqual([0x43, 0x43, 0x43, 0x43]);
    expect(seen.map(s => s.len)).toEqual([4, 4, 4, 4]);
    // RP2350 Out1L is wire channel 8; wValue = (channel << 8) | (band << 3) | param
    const base = (8 << 8) | (5 << 3);
    expect(seen.map(s => s.val)).toEqual([base | 0, base | 1, base | 2, base | 3]);

    expect(f.type).toBe(Domain.FilterType.Peaking);
    expect(f.frequency).toBeCloseTo(1234, 1);
    expect(f.q).toBeCloseTo(0.7, 4);
    expect(f.gain).toBeCloseTo(-3.5, 4);
  });

  test('channel-scoped operations can run immediately after factory creation', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);

    await expect(d.setFilter(2, 0, {
      type: Domain.FilterType.Peaking,
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
        if (req === Protocol.WireCmd.GetPlatform.code) {
          return new Uint8Array([0, 1, 2, 0]);
        }
        return new Uint8Array(len);
      },
      ctrlOut: async (req, val, data) => {
        seenOut.push({ req, val, data });
      },
    };
    const d = await createDevice(t, 'rp2040');
    await d.setFilter(Domain.ChannelId.Pdm, 0, { type: Domain.FilterType.Peaking, bypass: false, frequency: 80, q: 1, gain: -3 });
    await d.getFilter(Domain.ChannelId.Pdm, 1);
    await d.setChannelName(Domain.ChannelId.Pdm, 'Sub');
    await d.getChannelName(Domain.ChannelId.Pdm);

    const filterPacket = seenOut.find((call) => call.req === Protocol.WireCmd.SetEqParam.code)?.data;
    expect(filterPacket?.[0]).toBe(6);
    expect(seenIn.filter((call) => call.req === Protocol.WireCmd.GetEqParam.code).map((call) => call.val & ~0x7))
      .toEqual(Array(4).fill((6 << 8) | (1 << 3)));
    expect(seenOut.find((call) => call.req === Protocol.WireCmd.SetChannelName.code)?.val).toBe(6);
    expect(seenIn.find((call) => call.req === Protocol.WireCmd.GetChannelName.code)?.val).toBe(6);
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
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.PinInUse);
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
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.InvalidOutput);
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
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.OutputActive);
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
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.OutputActive);
  });

  test('role 0 (default) BCK pin SET/GET packs wValue as the bare pin / zero', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await DspDevice.create(t);
    const ctrlInSpy = vi.spyOn(t, 'ctrlIn');

    expect((await d.setI2sBckPin(16)).ok).toBe(true);
    const setCall = ctrlInSpy.mock.calls.find((c) => c[0] === Protocol.WireCmd.SetI2sBckPin.code);
    expect(setCall?.[1]).toBe(16);   // role 0 -> wValue === pin

    await d.getI2sBckPin();
    const getCall = ctrlInSpy.mock.calls.find((c) => c[0] === Protocol.WireCmd.GetI2sBckPin.code);
    expect(getCall?.[1]).toBe(0);    // role 0 -> wValue === 0
  });

  test('role 1 (slave) BCK pin is independent of the master (role 0) pin', async () => {
    const d = await dev();
    expect((await d.setI2sBckPin(21, 1)).ok).toBe(true);
    expect(await d.getI2sBckPin(1)).toBe(21);
    // Master pin (role 0, default) is untouched by the slave-pin SET.
    expect(await d.getI2sBckPin()).toBe(14);
  });
});

describe('I2S slave-clock commands', () => {
  async function dev() {
    const t = new MockTransport({ platform: 'rp2350' });
    return await DspDevice.create(t);
  }

  test('clock mode round-trips master/slave', async () => {
    const d = await dev();
    expect(await d.getI2sClockMode()).toBe(0);
    await d.setI2sClockMode(1);
    expect(await d.getI2sClockMode()).toBe(1);
  });

  test('slave status reports LOCKED only when clock mode is slave AND input source is I2S', async () => {
    const d = await dev();
    const idle = await d.getI2sSlaveStatus();
    expect(idle.state).toBe(0);   // INACTIVE: master mode, not I2S input yet

    await d.setI2sClockMode(1);
    await d.setInputSource(Domain.AudioInputSource.I2s);
    const locked = await d.getI2sSlaveStatus();
    expect(locked.state).toBe(3); // LOCKED
    expect(locked.detectedRateHz).toBe(48000);
  });

  test('clock pin mode round-trips unified/split', async () => {
    const d = await dev();
    expect(await d.getI2sClockPinMode()).toBe(0);
    expect((await d.setI2sClockPinMode(1)).ok).toBe(true);
    expect(await d.getI2sClockPinMode()).toBe(1);
  });
});

describe('ADAT lightpipe output commands (RP2350)', () => {
  async function dev() {
    const t = new MockTransport({ platform: 'rp2350' });
    return await DspDevice.create(t);
  }

  test('enable + pin round-trip', async () => {
    const d = await dev();
    expect((await d.setAdatPin(20)).ok).toBe(true);
    expect(await d.getAdatPin()).toBe(20);
    expect((await d.setAdatEnable(true)).ok).toBe(true);
    expect(await d.getAdatEnable()).toBe(true);
    expect((await d.setAdatEnable(false)).ok).toBe(true);
    expect(await d.getAdatEnable()).toBe(false);
  });

  test('getAdatStatus reports enabled/active/pin once live', async () => {
    const d = await dev();
    await d.setAdatPin(20);
    await d.setAdatEnable(true);
    const status = await d.getAdatStatus();
    expect(status.enabled).toBe(true);
    expect(status.active).toBe(true);
    expect(status.pin).toBe(20);
    expect(status.rateOk).toBe(true);
  });

  test('setAdatPin rejection: RP2040 has no ADAT hardware', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2040' }));
    const r = await d.setAdatPin(20);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.InvalidOutput);
  });
});

describe('ADAT lightpipe input commands (RP2350)', () => {
  async function dev() {
    const t = new MockTransport({ platform: 'rp2350' });
    return await DspDevice.create(t);
  }

  test('pin + enable + clock-mode round-trip', async () => {
    const d = await dev();
    expect((await d.setAdatInputPin(20)).ok).toBe(true);
    expect(await d.getAdatInputPin()).toBe(20);
    expect((await d.setAdatInputEnable(true)).ok).toBe(true);
    expect(await d.getAdatInputEnable()).toBe(true);
    expect((await d.setAdatInputClockMode(1)).ok).toBe(true);
    expect(await d.getAdatInputClockMode()).toBe(1);
    expect((await d.setAdatInputEnable(false)).ok).toBe(true);
    expect(await d.getAdatInputEnable()).toBe(false);
  });

  test('enabling without a stored pin is rejected with InvalidPin', async () => {
    const d = await dev();
    const r = await d.setAdatInputEnable(true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.InvalidPin);
  });

  test('0xFF clear is refused while enabled, allowed while disabled', async () => {
    const d = await dev();
    await d.setAdatInputPin(20);
    await d.setAdatInputEnable(true);
    const clearWhileEnabled = await d.setAdatInputPin(0xFF);
    expect(clearWhileEnabled.ok).toBe(false);
    if (!clearWhileEnabled.ok) expect(clearWhileEnabled.code).toBe(Protocol.PinConfigResult.PinInUse);

    await d.setAdatInputEnable(false);
    const clearWhileDisabled = await d.setAdatInputPin(0xFF);
    expect(clearWhileDisabled.ok).toBe(true);
    expect(await d.getAdatInputPin()).toBe(0xFF);
  });

  test('disabling is refused while ADAT is the active input source', async () => {
    const d = await dev();
    await d.setAdatInputPin(20);
    await d.setAdatInputEnable(true);
    await d.setInputSource(Domain.AudioInputSource.Adat);
    const r = await d.setAdatInputEnable(false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.PinInUse);
  });

  test('loopback: sharing the live ADAT output pin is allowed, another used pin is not', async () => {
    const d = await dev();
    // Enable the output first so GPIO 12 is genuinely claimed -- the input
    // taking it then exercises the one-directional TX-pin-sharing exception.
    expect((await d.setAdatEnable(true)).ok).toBe(true);
    expect((await d.setAdatInputPin(12)).ok).toBe(true);
    const r = await d.setAdatInputPin(5);                  // S/PDIF RX's always-claimed default pin
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(Protocol.PinConfigResult.PinInUse);
  });

  test('RP2040: enable/pin SETs are rejected, GETs and clock mode still round-trip', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2040' }));
    const enableResult = await d.setAdatInputEnable(true);
    expect(enableResult.ok).toBe(false);
    if (!enableResult.ok) expect(enableResult.code).toBe(Protocol.PinConfigResult.InvalidOutput);
    const pinResult = await d.setAdatInputPin(20);
    expect(pinResult.ok).toBe(false);
    if (!pinResult.ok) expect(pinResult.code).toBe(Protocol.PinConfigResult.InvalidOutput);

    // Rejected SETs never stored anything, but the granular GETs still round
    // trip stored config on RP2040 (unlike GetAdatInputStatus, which zeroes).
    expect(await d.getAdatInputEnable()).toBe(false);
    expect(await d.getAdatInputPin()).toBe(0xFF);

    expect((await d.setAdatInputClockMode(1)).ok).toBe(true);
    expect(await d.getAdatInputClockMode()).toBe(1);
  });

  test('getAdatInputStatus decodes the synthesized packet once locked', async () => {
    const d = await dev();
    await d.setAdatInputPin(20);
    await d.setAdatInputEnable(true);
    await d.setInputSource(Domain.AudioInputSource.Adat);
    const status = await d.getAdatInputStatus();
    expect(status.state).toBe(Domain.AdatInputLockState.Locked);
    expect(status.enabled).toBe(true);
    expect(status.pin).toBe(20);
    expect(status.rateOk).toBe(true);
    expect(status.detectedRateHz).toBe(48000);
  });
});

describe('selectable system clock (fw overclock branch)', () => {
  async function dev() {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 5 } });
    return await DspDevice.create(t);
  }

  test('setSysClock round-trips to the narrowed domain shape', async () => {
    const d = await dev();
    await d.setSysClock(2, 15);
    const status = await d.getSysClock();
    expect(status.activeMode).toBe(Domain.SysClockMode.Mhz480);
    expect(status.storedMode).toBe(Domain.SysClockMode.Mhz480);
    expect(status.fallbackActive).toBe(false);
  });

  test('setSysClock with the default arg sends the 0xFF sentinel', async () => {
    const d = await dev();
    await d.setSysClock(1);
    const status = await d.getSysClock();
    expect(status.storedVregSel).toBe(0xFF);
  });
});

describe('setAllParams', () => {
  it('mock direct getters reflect values written through setAllParams', async () => {
    const transport = new MockTransport({ platform: 'rp2350' });
    const dev = await DspDevice.create(transport);
    const bulk = await dev.getAllParams();

    bulk.masterVolumeDb = -18;
    bulk.preampDb = 2.5;
    bulk.inputPreampsDb[0] = -1.5;
    bulk.inputPreampsDb[1] = -3;
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

// A device whose connect-time identity reads report an arbitrary wire/fw, so
// sub-floor firmware can be exercised without MockTransport (which refuses to
// build below the floor). Only the reads resolveInfo makes are answered.
function identityStub(opts: { wire: number; fwMinor: number; fwPatch: number; payloadLength: number }): DspTransport {
  return {
    open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
    ctrlIn: async (request, _value, length) => {
      if (request === Protocol.WireCmd.GetSerial.code) return new Uint8Array(length);
      if (request === Protocol.WireCmd.GetPlatform.code) {
        return new Uint8Array([Domain.PlatformType.RP2350, 1, (opts.fwMinor << 4) | opts.fwPatch, 0]);
      }
      if (request === Protocol.WireCmd.GetAllParams.code) {
        const h = new Uint8Array(16);
        h[0] = opts.wire;
        h[1] = Domain.PlatformType.RP2350;
        h[2] = 17; h[3] = 9; h[4] = 8; h[5] = 10;
        h[6] = opts.payloadLength & 0xFF;
        h[7] = opts.payloadLength >> 8;
        return h;
      }
      throw new Error(`unexpected request 0x${request.toString(16)}`);
    },
    ctrlOut: async () => {},
  };
}

describe('connect-time capabilities + version gating', () => {
  it('attaches capabilities derived from the connected device', async () => {
    const dev = await createDevice(new MockTransport({ platform: 'rp2350' }), 'rp2350');
    expect(dev.capabilities.support).toBe('supported');
    expect(dev.capabilities.wire).toBe(Protocol.Wire.MIN_WIRE_VERSION);
    expect(dev.info.capabilities).toBe(dev.capabilities);
  });

  it('rejects a 1.1.4 / V10 device with UnsupportedFirmware carrying its version', async () => {
    const stub = identityStub({ wire: 10, fwMinor: 1, fwPatch: 4, payloadLength: 2960 });
    const err = await DspDevice.create(stub).catch((e) => e);
    expect(err).toBeInstanceOf(UnsupportedFirmware);
    expect((err as UnsupportedFirmware).firmwareVersion).toBe('1.1.4');
    expect((err as UnsupportedFirmware).minimum).toBe('1.1.5');
  });

  it('rejects a pre-release wire whose semver reads as a supported release', async () => {
    const stub = identityStub({ wire: 20, fwMinor: 1, fwPatch: 5, payloadLength: 5900 });
    await expect(DspDevice.create(stub)).rejects.toBeInstanceOf(UnsupportedFirmware);
  });

  it('accepts fw 1.1.6 (the gate is a floor, not a window)', async () => {
    const transport = new MockTransport({ platform: 'rp2350', wireVersion: 29, fwVersion: { major: 1, minor: 1, patch: 6 } });
    const dev = await DspDevice.create(transport);
    expect(dev.capabilities.fwLabel).toBe('1.1.6');
    expect(dev.capabilities.wire).toBe(29);
  });

  it('rejects a wire-supported device that reports a truncated payload', async () => {
    // Floor-wire device with a payload shorter than its exact size -- malformed
    // firmware. Sections are treated as guaranteed, so connect rejects it.
    const transport = new MockTransport({ platform: 'rp2350', payloadLength: Protocol.Wire.BULK_SIZE_V28 - 8 });
    await expect(DspDevice.create(transport)).rejects.toBeInstanceOf(UnsupportedDevicePacket);
  });

  // The paste path (captureState -> restoreState -> setAllParams) must not throw.
  it('captureState/restoreState round-trips on an accepted device', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    expect(dev.capabilities.support).toBe('supported');
    const state = await dev.captureState();
    await expect(dev.restoreState(state)).resolves.toBeUndefined();
  });
});

describe('readNotification', () => {
  it('reads a notify packet through the device transport', async () => {
    const transport = new MockTransport({ platform: 'rp2350' });
    const dev = await DspDevice.create(transport);
    transport.pushNotify(new Uint8Array([2, 3, 0, 5, 3, 0, 0, 0]));
    const bytes = await dev.readNotification();
    expect(bytes?.[1]).toBe(Protocol.NotifyEventId.BulkInvalidated);  // event_id = BULK_INVALIDATED
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
    expect(dev.lastRawBulk!.byteLength).toBe(Protocol.Wire.BULK_SIZE_V28);
  });

  it('retains the full image', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    await dev.getAllParams();
    expect(dev.lastRawBulk!.byteLength).toBe(Protocol.Wire.BULK_SIZE_V28);
    expect(dev.lastRawBulk![0]).toBe(Protocol.Wire.MIN_WIRE_VERSION);   // header formatVersion
  });
});

describe('DspDevice — granular surface', () => {
  const connect = () => DspDevice.create(new MockTransport({ platform: 'rp2350' }));

  test('setBandBypass/getBandBypass round-trip', async () => {
    const d = await connect();
    await d.setBandBypass(0, 2, true);
    expect(await d.getBandBypass(0, 2)).toBe(true);
    await d.setBandBypass(0, 2, false);
    expect(await d.getBandBypass(0, 2)).toBe(false);
  });

  test('setBandBypass remaps the RP2040 PDM channel (set and get agree)', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2040' }));
    await d.setBandBypass(Domain.ChannelId.Pdm, 0, true);
    expect(await d.getBandBypass(Domain.ChannelId.Pdm, 0)).toBe(true);
  });

  test('user volume + mute round-trip', async () => {
    const d = await connect();
    await d.setUserVolume(-12);
    expect(await d.getUserVolume()).toBeCloseTo(-12, 4);
    await d.setUserMute(true);
    expect(await d.getUserMute()).toBe(true);
  });

  test('input source round-trips', async () => {
    const d = await connect();
    await d.setInputSource(Domain.AudioInputSource.Spdif);
    expect(await d.getInputSource()).toBe(Domain.AudioInputSource.Spdif);
  });

  test('leveller masks round-trip in detector-then-apply order', async () => {
    const d = await connect();
    // Default is all-on.
    expect(await d.getLevellerMasks()).toEqual({ detector: 0xFF, apply: 0xFF });
    // Asymmetric values prove the byte order (detector first, apply second).
    await d.setLevellerMasks(0x03, 0x05);
    expect(await d.getLevellerMasks()).toEqual({ detector: 0x03, apply: 0x05 });
    // High bit / masking: values above a byte are truncated to u8.
    await d.setLevellerMasks(0x1FF, 0x80);
    expect(await d.getLevellerMasks()).toEqual({ detector: 0xFF, apply: 0x80 });
  });

  test('loudness output mask round-trips and masks to u16', async () => {
    const d = await connect();
    expect(await d.getLoudnessOutputMask()).toBe(0xFFFF);
    await d.setLoudnessOutputMask(0x00F0);
    expect(await d.getLoudnessOutputMask()).toBe(0x00F0);
    // Values above a u16 are truncated.
    await d.setLoudnessOutputMask(0x1FFFF);
    expect(await d.getLoudnessOutputMask()).toBe(0xFFFF);
  });

  test('crossfeed output-pair mask round-trips and masks to u8', async () => {
    const d = await connect();
    expect(await d.getCrossfeedOutputPairs()).toBe(0x01);
    await d.setCrossfeedOutputPairs(0x0D);
    expect(await d.getCrossfeedOutputPairs()).toBe(0x0D);
    // Values above a byte are truncated.
    await d.setCrossfeedOutputPairs(0x1FF);
    expect(await d.getCrossfeedOutputPairs()).toBe(0xFF);
  });

  test('psybass output mask round-trips and masks to u16', async () => {
    const d = await connect();
    expect(await d.getPsybassMask()).toBe(0xFFFF);
    await d.setPsybassMask(0x00F0);
    expect(await d.getPsybassMask()).toBe(0x00F0);
    // Values above a u16 are truncated.
    await d.setPsybassMask(0x1FFFF);
    expect(await d.getPsybassMask()).toBe(0xFFFF);
  });

  test('getSpdifRxStatus narrows state + inputSource', async () => {
    const d = await connect();
    await d.setInputSource(Domain.AudioInputSource.Spdif);
    const s = await d.getSpdifRxStatus();
    expect(s.state).toBe(Domain.SpdifInputState.Locked);
    expect(s.inputSource).toBe(Domain.AudioInputSource.Spdif);
    expect(s.sampleRate).toBe(48000);
  });

  test('getSpdifRxChStatus returns the 24-byte block', async () => {
    const d = await connect();
    expect((await d.getSpdifRxChStatus()).byteLength).toBe(24);
  });

  test('S/PDIF RX pin round-trips', async () => {
    const d = await connect();
    await d.setSpdifRxPin(15);
    expect(await d.getSpdifRxPin()).toBe(15);
  });

  test('setSpdifRxPin packs (instance<<8)|gpio; omitting instance keeps back-compat wValue===gpio', async () => {
    const seen: number[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val) => {
        if (req === Protocol.WireCmd.SetSpdifRxPin.code) seen.push(val);
        return new Uint8Array([0x00]);
      },
      ctrlOut: async () => {},
    };
    const d = await createDevice(t);

    await d.setSpdifRxPin(15);
    await d.setSpdifRxPin(9, 2);

    expect(seen).toEqual([15, (2 << 8) | 9]);
  });

  test('getSpdifRxPin sends the instance as wValue', async () => {
    const seen: number[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val) => {
        if (req === Protocol.WireCmd.GetSpdifRxPin.code) { seen.push(val); return new Uint8Array([7]); }
        return new Uint8Array([0]);
      },
      ctrlOut: async () => {},
    };
    const d = await createDevice(t);

    expect(await d.getSpdifRxPin()).toBe(7);
    expect(await d.getSpdifRxPin(2)).toBe(7);
    expect(seen).toEqual([0, 2]);
  });

  test('setSpdifInputEnabled packs (instance<<8)|enableBit', async () => {
    const seen: number[] = [];
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, val) => {
        if (req === Protocol.WireCmd.SetSpdifInputEnable.code) seen.push(val);
        return new Uint8Array([0x00]);
      },
      ctrlOut: async () => {},
    };
    const d = await createDevice(t);

    const r1 = await d.setSpdifInputEnabled(1, true);
    const r2 = await d.setSpdifInputEnabled(2, false);

    expect(seen).toEqual([(1 << 8) | 1, (2 << 8) | 0]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  test('getSpdifInputConfig decodes a full 6-byte [count, enableMask, pin0..pin3] response', async () => {
    const t: DspTransport = {
      open: async () => {}, close: async () => {}, isOpen: () => true, on: () => () => {},
      ctrlIn: async (req, _val, len) => {
        if (req === Protocol.WireCmd.GetSpdifInputConfig.code) return Uint8Array.from([4, 0b1101, 5, 16, 17, 22]);
        return new Uint8Array(len);
      },
      ctrlOut: async () => {},
    };
    const d = await createDevice(t);

    expect(await d.getSpdifInputConfig()).toEqual({ count: 4, enableMask: 0b1101, pins: [5, 16, 17, 22] });
  });

  test('LG Sound Sync enable + status round-trip', async () => {
    const d = await connect();
    await d.setLgSoundSyncEnabled(true);
    expect(await d.getLgSoundSyncEnabled()).toBe(true);
    expect((await d.getLgSoundSyncStatus()).enabled).toBe(true);
  });

  test('DAC HW mute config round-trips', async () => {
    const d = await connect();
    const cfg = { enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 };
    await d.setDacHwMute(cfg);
    expect(await d.getDacHwMute()).toEqual(cfg);
    await expect(d.testDacHwMute()).resolves.toBeUndefined();
  });

  test('saveOutputConfig returns ok', async () => {
    const d = await connect();
    const r = await d.saveOutputConfig();
    expect(r.ok).toBe(true);
  });
});

describe('DspDevice — bulk integration', () => {
  const connect28 = () => DspDevice.create(new MockTransport({ platform: 'rp2350' }));

  test('reads a full-size packet; masks default all-on, ADAT absent', async () => {
    const d = await connect28();
    const bulk = await d.getAllParams();
    expect(bulk.formatVersion).toBe(Protocol.Wire.MIN_WIRE_VERSION);
    expect(bulk.payloadLength).toBe(Protocol.Wire.BULK_SIZE_V28);
    expect(bulk.leveller.detectorMask).toBe(0xFF);
    expect(bulk.leveller.applyMask).toBe(0xFF);
    expect(bulk.loudness.outputMask).toBe(0xFFFF);
    expect(bulk.crossfeed.outputPairMask).toBe(0x01);
    expect(bulk.adat).toEqual({ enabled: false, pin: 0 });
  });

  test('setLevellerMasks flows through the synthesized bulk into the snapshot', async () => {
    const d = await connect28();
    await d.setLevellerMasks(0x03, 0x0C);
    const snap = await d.getSnapshot();
    expect(snap.leveller.detectorMask).toBe(0x03);
    expect(snap.leveller.applyMask).toBe(0x0C);
  });

  test('setLoudnessOutputMask flows through the synthesized bulk into the snapshot', async () => {
    const d = await connect28();
    await d.setLoudnessOutputMask(0x00F0);
    const snap = await d.getSnapshot();
    expect(snap.loudness.outputMask).toBe(0x00F0);
  });

  test('setCrossfeedOutputPairs flows through the synthesized bulk into the snapshot', async () => {
    const d = await connect28();
    await d.setCrossfeedOutputPairs(0x0D);
    const snap = await d.getSnapshot();
    expect(snap.crossfeed.outputPairMask).toBe(0x0D);
  });
});
