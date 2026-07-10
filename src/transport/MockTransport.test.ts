import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './MockTransport';
import { DspDevice } from '@/device/DspDevice';
import { WireCmd, Wire, parseBufferStats, parseSystemStatus, parseBulkParams, buildBulkParams, NotifyEventId, PinConfigResult } from '@/protocol';
import { Codec } from '@/utils';
import { FilterType, MasterVolumeMode, AudioInputSource, ChannelId } from '@/domain';

async function createDevice(t: MockTransport): Promise<DspDevice> {
  const openTransport = t.isOpen() ? async () => {} : () => t.open();
  return DspDevice.create(t, openTransport);
}

describe('MockTransport', () => {
  let t: MockTransport;
  beforeEach(async () => {
    t = new MockTransport({ platform: 'rp2350' });
    await t.open();
  });

  it('reports a serial string', async () => {
    const bytes = await t.ctrlIn(WireCmd.GetSerial.code, 0, 16);
    const s = new TextDecoder().decode(bytes).replace(/\0+$/, '');
    expect(s.length).toBeGreaterThan(0);
  });

  it('returns a parseable bulk packet', async () => {
    const bytes = await t.ctrlIn(WireCmd.GetAllParams.code, 0, 2896);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(2832);
    expect(bytes[0]).toBeGreaterThanOrEqual(2);
  });

  it('roundtrips master volume writes', async () => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, -7.5, true);
    await t.ctrlOut(WireCmd.SetMasterVolume.code, 0, bytes);
    const got = await t.ctrlIn(WireCmd.GetMasterVolume.code, 0, 4);
    expect(new DataView(got.buffer).getFloat32(0, true)).toBeCloseTo(-7.5, 4);
  });

  it('emits connect on open and disconnect on close', async () => {
    const t2 = new MockTransport({ platform: 'rp2040' });
    let connected = 0, disconnected = 0;
    t2.on('connect', () => connected++);
    t2.on('disconnect', () => disconnected++);
    await t2.open();
    await t2.close();
    expect(connected).toBe(1);
    expect(disconnected).toBe(1);
  });
});

describe('MockTransport — wire version knob', () => {
  it('synthesizes a bulk packet at the configured wire version (V10 = 2960 B)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    await t.open();
    const bytes = await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(2960);
    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(10);
    expect(p.payloadLength).toBe(2960);
  });

  it('connects as a supported V10 device with a coherent firmware version', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    const dev = await createDevice(t);
    expect(dev.capabilities.support).toBe('supported');
    expect(dev.capabilities.wire).toBe(10);
    expect(dev.info.capabilities.fwLabel).toBe('1.1.4');
  });

  it('merges a V6 write into a V10 device: V6 fields update, the packet stays V10', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    const dev = await createDevice(t);
    const snap = await dev.getAllParams();
    snap.masterVolumeDb = -11;
    await dev.setAllParams(snap);
    const back = await dev.getAllParams();
    expect(back.formatVersion).toBe(10);
    expect(back.masterVolumeDb).toBeCloseTo(-11);
  });

  it('defaults to V10 when no wire version is given', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const bytes = await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(Wire.BulkSizes.V10);
    expect(parseBulkParams(bytes).formatVersion).toBe(10);
  });

  it('reports a sub-floor wire version so the connect-reject path is testable', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 5 });
    await t.open();
    const bytes = await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize);
    expect(parseBulkParams(bytes).formatVersion).toBe(5);
  });
});

describe('MockTransport — status + buffer stats', () => {
  it('returns a parseable status packet', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const bytes = await t.ctrlIn(WireCmd.GetStatus.code, 9, 11 * 2 + 4);
    const s = parseSystemStatus(bytes, 11);
    expect(s.peaks.length).toBeGreaterThanOrEqual(11);
    // Levels are animated (time-driven) rather than a fixed staircase; the
    // invariant is that every reported peak is a normalized 0..1 sample.
    expect(Array.from(s.peaks).slice(0, 11).every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(s.cpu0).toBe(25);
  });

  it('returns a parseable buffer-stats packet', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const bytes = await t.ctrlIn(WireCmd.GetBufferStats.code, 0, 44);
    const p = parseBufferStats(bytes)!;
    expect(p.streaming).toBe(true);
    expect(p.pdmActive).toBe(true);
    expect(p.numSpdif).toBe(4);
  });
});

describe('MockTransport — mixer matrix round-trip', () => {
  let t: MockTransport;
  beforeEach(async () => {
    t = new MockTransport({ platform: 'rp2350' });
    await t.open();
  });

  it('matrix route writes show up in the next bulk read', async () => {
    const payload = Codec.encode(WireCmd.SetMatrixRoute.codec, {
      input: 0, output: 2,
      enabled: true, phaseInvert: false, gainDb: 1.25,
    });
    await t.ctrlOut(WireCmd.SetMatrixRoute.code, 0, payload);
    const bulk = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(bulk.crosspoints[0][2].enabled).toBe(true);
    expect(bulk.crosspoints[0][2].gainDb).toBeCloseTo(1.25, 4);
  });

  it('roundtrips per-output enable / mute / gain / delay', async () => {
    const out = 7;
    await t.ctrlOut(WireCmd.SetOutputEnable.code, out, Codec.encode(Codec.bool8, true));
    await t.ctrlOut(WireCmd.SetOutputMute.code,   out, Codec.encode(Codec.bool8, true));
    await t.ctrlOut(WireCmd.SetOutputGain.code,   out, Codec.encode(Codec.f32,  -2.5));
    await t.ctrlOut(WireCmd.SetOutputDelay.code,  out, Codec.encode(Codec.f32,   4.2));

    expect(Codec.decode(Codec.bool8, await t.ctrlIn(WireCmd.GetOutputEnable.code, out, 1))).toBe(true);
    expect(Codec.decode(Codec.bool8, await t.ctrlIn(WireCmd.GetOutputMute.code,   out, 1))).toBe(true);
    expect(Codec.decode(Codec.f32,   await t.ctrlIn(WireCmd.GetOutputGain.code,   out, 4))).toBeCloseTo(-2.5, 4);
    expect(Codec.decode(Codec.f32,   await t.ctrlIn(WireCmd.GetOutputDelay.code,  out, 4))).toBeCloseTo(4.2, 4);

    // And the bulk view reflects it too.
    const bulk = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(bulk.outputs[out].enabled).toBe(true);
    expect(bulk.outputs[out].muted).toBe(true);
    expect(bulk.outputs[out].gainDb).toBeCloseTo(-2.5, 4);
    expect(bulk.outputs[out].delayMs).toBeCloseTo(4.2, 4);
  });
});

describe('MockTransport — bypass / master volume mode / saved volume', () => {
  let t: MockTransport;
  beforeEach(async () => {
    t = new MockTransport({ platform: 'rp2350' });
    await t.open();
  });

  it('DspDevice.saveMasterVolume → getSavedMasterVolume round-trips', async () => {
    const d = await createDevice(t);
    await d.setMasterVolume(-12.5);
    expect(await d.saveMasterVolume()).toBe(true);
    expect(await d.getSavedMasterVolume()).toBeCloseTo(-12.5, 4);
  });
});

describe('MockTransport — preset round-trip', () => {
  it('restores master volume across save/load when mode=WithPreset', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);

    // Switch to with-preset mode so master volume rides the preset payload.
    await d.setMasterVolumeMode(MasterVolumeMode.WithPreset);

    await d.setMasterVolume(-12);
    expect((await d.savePreset(0)).ok).toBe(true);

    await d.setMasterVolume(0);
    expect(await d.getMasterVolume()).toBeCloseTo(0, 4);

    expect((await d.loadPreset(0)).ok).toBe(true);
    expect(await d.getMasterVolume()).toBeCloseTo(-12, 4);
  });

  it('leaves master volume untouched on load in Mode 0 (Independent)', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);

    // Mode 0 is default; master volume should not be touched by Load.
    await d.setMasterVolume(-12);
    expect((await d.savePreset(0)).ok).toBe(true);

    await d.setMasterVolume(0);
    expect((await d.loadPreset(0)).ok).toBe(true);
    expect(await d.getMasterVolume()).toBeCloseTo(0, 4); // unchanged
  });
});

describe('MockTransport — preset round-trip / global fields', () => {
  it('does not restore masterVolumeMode on LoadPreset (mode is directory-level)', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);

    // Save a preset captured while mode = WithPreset.
    await d.setMasterVolumeMode(MasterVolumeMode.WithPreset);
    await d.setMasterVolume(-9);
    expect((await d.savePreset(0)).ok).toBe(true);

    // Operator flips global mode AFTER the save.
    await d.setMasterVolumeMode(MasterVolumeMode.Independent);

    // Loading the slot must NOT bring back WithPreset — mode is owned by
    // the directory sector, not the slot payload.
    expect((await d.loadPreset(0)).ok).toBe(true);
    expect(await d.getMasterVolumeMode()).toBe(MasterVolumeMode.Independent);
  });
});

describe('MockTransport — GetEqParam multi-read', () => {
  it('setFilter → getFilter cross-validates the multi-read protocol', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);
    await d.setFilter(2, 5, {
      type: FilterType.LowShelf,
      bypass: false,
      frequency: 320,
      q: 0.9,
      gain: 4.5,
    });
    const got = await d.getFilter(2, 5);
    expect(got.type).toBe(FilterType.LowShelf);
    expect(got.frequency).toBeCloseTo(320, 1);
    expect(got.q).toBeCloseTo(0.9, 4);
    expect(got.gain).toBeCloseTo(4.5, 4);
  });
});

describe('MockTransport — notify queue', () => {
  it('returns a 1-byte idle when the notify queue is empty', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    await t.open();
    const bytes = await t.notifyIn(64);
    expect(Array.from(bytes)).toEqual([0]);
  });

  it('drains pushed packets FIFO, then returns to idle', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    await t.open();
    t.pushNotify(new Uint8Array([2, 3, 0, 1, 3, 0, 0, 0]));  // BULK_INVALIDATED
    const first = await t.notifyIn(64);
    expect(first[1]).toBe(NotifyEventId.BulkInvalidated);
    const second = await t.notifyIn(64);
    expect(Array.from(second)).toEqual([0]);  // idle again
  });
});

describe('MockTransport — chunked bulk sessions (V16)', () => {
  async function v16Mock(): Promise<MockTransport> {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    return t;
  }

  it('rejects a SET chunk whose offset does not match the bytes accumulated so far', async () => {
    const t = await v16Mock();
    const chunkSize = Wire.BulkLimits.ChunkSize;
    const full = await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize);

    await t.ctrlOut(WireCmd.SetAllParamsChunk.code, 0, full.subarray(0, chunkSize));
    await expect(
      t.ctrlOut(WireCmd.SetAllParamsChunk.code, chunkSize + 1, full.subarray(chunkSize, chunkSize * 2)),
    ).rejects.toThrow();
  });

  it('invalidates an open GET session when a non-chunk vendor request is interleaved', async () => {
    const t = await v16Mock();
    const chunkSize = Wire.BulkLimits.ChunkSize;

    await t.ctrlIn(WireCmd.GetAllParamsChunk.code, 0, chunkSize);
    await t.ctrlIn(WireCmd.GetSerial.code, 0, 16);   // interleaved, non-chunk request

    // The session is gone: resuming at the offset that was valid a moment
    // ago is now out-of-order (no active session).
    await expect(
      t.ctrlIn(WireCmd.GetAllParamsChunk.code, chunkSize, chunkSize),
    ).rejects.toThrow();
  });
});

describe('MockTransport — source-aware input channel names', () => {
  async function v16Device(): Promise<DspDevice> {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
    return createDevice(t);
  }

  it('seeds default input names for the default (USB) source at boot', async () => {
    const d = await v16Device();
    const bulk = await d.getAllParams();
    expect(bulk.channelNames.slice(0, 8)).toEqual(['USB 1', 'USB 2', 'USB 3', 'USB 4', 'USB 5', 'USB 6', 'USB 7', 'USB 8']);
  });

  it('regenerates default input names on a source switch, preserving a custom name', async () => {
    const d = await v16Device();
    // Slot 2 (In2L) gets a real custom name; it must survive the switch.
    await d.setChannelName(ChannelId.In2L, 'Turntable');

    await d.setInputSource(AudioInputSource.Spdif);
    const bulk = await d.getAllParams();

    expect(bulk.channelNames[0]).toBe('SPDIF L');   // untouched default -> regenerated
    expect(bulk.channelNames[1]).toBe('SPDIF R');
    expect(bulk.channelNames[2]).toBe('Turntable');  // custom name survives the switch
  });

  it('does not regenerate names on an I2S channel-count change (names key on source, not count)', async () => {
    const d = await v16Device();
    await d.setInputSource(AudioInputSource.I2s);
    const before = (await d.getAllParams()).channelNames.slice(0, 8);

    await d.setI2sInputChannels(4);
    const after = (await d.getAllParams()).channelNames.slice(0, 8);

    expect(after).toEqual(before);
  });
});

describe('MockTransport — V10 device fidelity', () => {
  it('GetAllParams from a V10 mock returns a 2960 B packet with a real tail', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    await mock.open();
    const bytes = await mock.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(Wire.BulkSizes.V10);
    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(10);
    expect(p.dacHwMute.pin).toBe(11);
    expect(p.inputConfig.spdifRxPin).toBe(5);
  });

  it('a V10 SetAllParams round-trips the tail through the mock', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    await mock.open();
    const read = await mock.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize);
    const bulk = parseBulkParams(read);
    bulk.userVolume = { volumeDb: -9, mute: true };
    await mock.ctrlOut(WireCmd.SetAllParams.code, 0, buildBulkParams(bulk));
    const back = parseBulkParams(await mock.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(back.userVolume.mute).toBe(true);
    expect(back.userVolume.volumeDb).toBeCloseTo(-9, 4);
  });
});

describe('MockTransport — imaginary I2S multichannel demo mode', () => {
  it('boots a V16 mock with an I2S multichannel input', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 16, i2sInputChannels: 8 });
    await t.open();
    const p = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(p.inputConfig.source).toBe(AudioInputSource.I2s);
    expect(p.inputConfig.i2sInputChannels).toBe(8);
  });

  it('reports the multichannel count via system status (what the UI reads)', async () => {
    const dev = await DspDevice.create(new MockTransport({ platform: 'rp2350', wireVersion: 16, i2sInputChannels: 6 }));
    const status = await dev.getSystemStatus();
    expect(status.activeInputChannels).toBe(6);
  });

  it('clamps an odd count down to the nearest even value', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 16, i2sInputChannels: 5 });
    await t.open();
    const p = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(p.inputConfig.i2sInputChannels).toBe(4);
  });

  it('ignores the knob on a V10 mock (stays USB stereo)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10, i2sInputChannels: 8 });
    await t.open();
    const p = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(p.inputConfig.source).toBe(AudioInputSource.Usb);
  });
});

describe('MockTransport — multi-SPDIF input (fw 1.1.5+ RP2350)', () => {
  async function v18Mock(platform: 'rp2040' | 'rp2350' = 'rp2350', spdifInputsEnabled?: number): Promise<MockTransport> {
    const t = new MockTransport({
      platform, wireVersion: 18, fwVersion: { major: 1, minor: 1, patch: 5 },
      ...(spdifInputsEnabled != null ? { spdifInputsEnabled } : {}),
    });
    await t.open();
    return t;
  }

  it('seeds inputs 2/3 present-but-disabled on RP2350; stays absent on RP2040', async () => {
    const rp2350 = parseBulkParams(await (await v18Mock('rp2350')).ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(rp2350.inputConfig.spdifRxPinExt).toEqual([20, 21]);
    expect(rp2350.inputConfig.spdifRxEnabledExtP1).toBe(1);  // mask 0: both disabled but present

    const rp2040 = parseBulkParams(await (await v18Mock('rp2040')).ctrlIn(WireCmd.GetAllParams.code, 0, Wire.BulkLimits.MaxReadSize));
    expect(rp2040.inputConfig.spdifRxPinExt).toEqual([0, 0]);
    expect(rp2040.inputConfig.spdifRxEnabledExtP1).toBe(0);
  });

  it('the ?spdif=3 demo option pre-enables inputs 2 and 3', async () => {
    const t = await v18Mock('rp2350', 3);
    const cfg = Codec.decode(Wire.SpdifInputConfig, await t.ctrlIn(WireCmd.GetSpdifInputConfig.code, 0, 5));
    expect(cfg.enableMask).toBe(0b111);
  });

  it('SetSpdifRxPin / GetSpdifRxPin round-trip per instance', async () => {
    const t = await v18Mock();
    for (const [index, gpio] of [[0, 15], [1, 22], [2, 26]] as const) {
      const status = await t.ctrlIn(WireCmd.SetSpdifRxPin.code, (index << 8) | gpio, 1);
      expect(status[0]).toBe(PinConfigResult.Success);
      const got = await t.ctrlIn(WireCmd.GetSpdifRxPin.code, index, 1);
      expect(got[0]).toBe(gpio);
    }
  });

  it('rejects an out-of-range instance with InvalidOutput', async () => {
    const t = await v18Mock();
    const status = await t.ctrlIn(WireCmd.SetSpdifRxPin.code, (3 << 8) | 15, 1);  // only instances 0..2 exist
    expect(status[0]).toBe(PinConfigResult.InvalidOutput);
  });

  it('rejects the extended instances on a single-input platform (RP2040)', async () => {
    const t = await v18Mock('rp2040');
    const status = await t.ctrlIn(WireCmd.SetSpdifRxPin.code, (1 << 8) | 15, 1);
    expect(status[0]).toBe(PinConfigResult.InvalidOutput);
  });

  it('SetSpdifInputEnable flips the enable bit; GetSpdifInputConfig reflects count/mask/pins', async () => {
    const t = await v18Mock();
    const status = await t.ctrlIn(WireCmd.SetSpdifInputEnable.code, (1 << 8) | 1, 1);  // enable input 2
    expect(status[0]).toBe(PinConfigResult.Success);

    const cfg = Codec.decode(Wire.SpdifInputConfig, await t.ctrlIn(WireCmd.GetSpdifInputConfig.code, 0, 5));
    expect(cfg.count).toBe(3);
    expect(cfg.enableMask).toBe(0b011);   // bit0 (input1, always set) + bit1 (input2)
    expect(cfg.pins).toEqual([5, 20, 21]);
  });

  it('disabling instance 0 (the always-on input) is InvalidOutput', async () => {
    const t = await v18Mock();
    const status = await t.ctrlIn(WireCmd.SetSpdifInputEnable.code, (0 << 8) | 0, 1);
    expect(status[0]).toBe(PinConfigResult.InvalidOutput);
  });

  it('enabling an input whose pin collides with a reserved pin is PinInUse', async () => {
    const t = await v18Mock();
    // Claim GPIO 20 (input 2's default pin) for an output pin first.
    await t.ctrlIn(WireCmd.SetOutputPin.code, (20 << 8) | 0, 1);
    const status = await t.ctrlIn(WireCmd.SetSpdifInputEnable.code, (1 << 8) | 1, 1);
    expect(status[0]).toBe(PinConfigResult.PinInUse);
  });
});
