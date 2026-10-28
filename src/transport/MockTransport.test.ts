import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './MockTransport';
import { DspDevice } from '@/device/DspDevice';
import * as Protocol from '@/protocol';
import { Codec } from '@/utils';
import * as Domain from '@/domain';

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
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetSerial.code, 0, 16);
    const s = new TextDecoder().decode(bytes).replace(/\0+$/, '');
    expect(s.length).toBeGreaterThan(0);
  });

  it('returns a parseable bulk packet', async () => {
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, 2896);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(2832);
    expect(bytes[0]).toBeGreaterThanOrEqual(2);
  });

  it('roundtrips master volume writes', async () => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, -7.5, true);
    await t.ctrlOut(Protocol.WireCmd.SetMasterVolume.code, 0, bytes);
    const got = await t.ctrlIn(Protocol.WireCmd.GetMasterVolume.code, 0, 4);
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
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(2960);
    const p = Protocol.parseBulkParams(bytes);
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

  it('reads the pre-release ordinal from the 7-byte GetPlatform, and a shorter reply reads as a final release', async () => {
    const beta = await createDevice(new MockTransport({
      platform: 'rp2350', wireVersion: 30, fwVersion: { major: 1, minor: 1, patch: 6, beta: 3 },
    }));
    expect(beta.info.capabilities.fwLabel).toBe('1.1.6 beta 3');
    expect(beta.info.capabilities.fw.beta).toBe(3);

    // Same firmware version, but a build that predates the beta byte: the
    // reply stops at 6 B and must not read as a beta.
    const final = await createDevice(new MockTransport({
      platform: 'rp2350', wireVersion: 30, fwVersion: { major: 1, minor: 1, patch: 6 },
    }));
    expect(final.info.capabilities.fwLabel).toBe('1.1.6');
    expect(final.info.capabilities.fw.beta).toBeFalsy();
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
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(Protocol.Wire.BulkSizes.V10);
    expect(Protocol.parseBulkParams(bytes).formatVersion).toBe(10);
  });

  it('reports a sub-floor wire version so the connect-reject path is testable', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 5 });
    await t.open();
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(Protocol.parseBulkParams(bytes).formatVersion).toBe(5);
  });
});

describe('MockTransport — stereo upmixer (V25/V26)', () => {
  it('roundtrips a per-param SET/GET (0x4C/0x4D) by UPMIX_PARAM_* id', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setFloat32(0, 66, true);
    await t.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.StrengthPct, payload);
    const got = await t.ctrlIn(Protocol.WireCmd.UpmixGetParam.code, Protocol.Wire.UpmixParam.StrengthPct, 4);
    expect(new DataView(got.buffer).getFloat32(0, true)).toBeCloseTo(66, 4);
  });

  it('roundtrips the 44-byte config packet (0x4A/0x4B), scaling presence to/from Q1', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const sent = Codec.encode(Protocol.Wire.UpmixParams, {
      enabled: true, centerMode: 1, surroundMode: 2, presenceQ1: 5, // 2.5 dB
      strengthPct: 80, centerWidthPct: 30, corrThresholdPct: 40,
      attackMs: 15, releaseMs: 150, detectorHpfHz: 250,
      surroundDelayMs: 10, surroundHpfHz: 350, surroundLpfHz: 8000, decorrPct: 70,
    });
    await t.ctrlOut(Protocol.WireCmd.UpmixSetConfig.code, 0, sent);
    const got = Codec.decode(Protocol.Wire.UpmixParams, await t.ctrlIn(Protocol.WireCmd.UpmixGetConfig.code, 0, sent.byteLength));
    expect(got.enabled).toBe(true);
    expect(got.centerMode).toBe(1);
    expect(got.surroundMode).toBe(2);
    expect(got.presenceQ1).toBe(5);
    expect(got.strengthPct).toBeCloseTo(80, 4);
    expect(got.surroundLpfHz).toBeCloseTo(8000, 4);
  });

  it('centre-mode OFF (2) is accepted on V27+ and round-trips per-param', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 27, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setFloat32(0, 2, true);
    await t.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.CenterMode, payload);
    const got = await t.ctrlIn(Protocol.WireCmd.UpmixGetParam.code, Protocol.Wire.UpmixParam.CenterMode, 4);
    expect(new DataView(got.buffer).getFloat32(0, true)).toBe(2);
  });

  it('centre-mode OFF (2) clamps to Adaptive (1) below V27, mirroring firmware', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 26 });
    await t.open();
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setFloat32(0, 2, true);
    await t.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.CenterMode, payload);
    const got = await t.ctrlIn(Protocol.WireCmd.UpmixGetParam.code, Protocol.Wire.UpmixParam.CenterMode, 4);
    expect(new DataView(got.buffer).getFloat32(0, true)).toBe(1);
  });

  it('GetUpmixStatus is only active while enabled AND the live input is stereo', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const one = new Uint8Array(4);
    new DataView(one.buffer).setFloat32(0, 1, true);
    await t.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.Enabled, one);
    const active = Codec.decode(Protocol.Wire.UpmixStatus, await t.ctrlIn(Protocol.WireCmd.UpmixGetStatus.code, 0, 16));
    expect(active.active).toBe(true);
    expect(active.parkedReason).toBe(0);

    const zero = new Uint8Array(4);
    await t.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.Enabled, zero);
    const disabled = Codec.decode(Protocol.Wire.UpmixStatus, await t.ctrlIn(Protocol.WireCmd.UpmixGetStatus.code, 0, 16));
    expect(disabled.active).toBe(false);
    expect(disabled.parkedReason).toBe(1); // Disabled

    await t.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.Enabled, one);
    const t8ch = new MockTransport({ platform: 'rp2350', wireVersion: 16, i2sInputChannels: 8 });
    await t8ch.open();
    await t8ch.ctrlOut(Protocol.WireCmd.UpmixSetParam.code, Protocol.Wire.UpmixParam.Enabled, one);
    const parked = Codec.decode(Protocol.Wire.UpmixStatus, await t8ch.ctrlIn(Protocol.WireCmd.UpmixGetStatus.code, 0, 16));
    expect(parked.active).toBe(false);
    expect(parked.parkedReason).toBe(2); // NotStereoInput
  });
});

describe('MockTransport — status + buffer stats', () => {
  it('returns a parseable status packet', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetStatus.code, 9, 11 * 2 + 4);
    const s = Protocol.parseSystemStatus(bytes, 11);
    expect(s.peaks.length).toBeGreaterThanOrEqual(11);
    // Levels are animated (time-driven) rather than a fixed staircase; the
    // invariant is that every reported peak is a normalized 0..1 sample.
    expect(Array.from(s.peaks).slice(0, 11).every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(s.cpu0).toBe(25);
  });

  it('returns a parseable buffer-stats packet', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetBufferStats.code, 0, 44);
    const p = Protocol.parseBufferStats(bytes)!;
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
    const payload = Codec.encode(Protocol.WireCmd.SetMatrixRoute.codec, {
      input: 0, output: 2,
      enabled: true, phaseInvert: false, gainDb: 1.25,
    });
    await t.ctrlOut(Protocol.WireCmd.SetMatrixRoute.code, 0, payload);
    const bulk = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(bulk.crosspoints[0][2].enabled).toBe(true);
    expect(bulk.crosspoints[0][2].gainDb).toBeCloseTo(1.25, 4);
  });

  it('roundtrips per-output enable / mute / gain / delay', async () => {
    const out = 7;
    await t.ctrlOut(Protocol.WireCmd.SetOutputEnable.code, out, Codec.encode(Codec.bool8, true));
    await t.ctrlOut(Protocol.WireCmd.SetOutputMute.code,   out, Codec.encode(Codec.bool8, true));
    await t.ctrlOut(Protocol.WireCmd.SetOutputGain.code,   out, Codec.encode(Codec.f32,  -2.5));
    await t.ctrlOut(Protocol.WireCmd.SetOutputDelay.code,  out, Codec.encode(Codec.f32,   4.2));

    expect(Codec.decode(Codec.bool8, await t.ctrlIn(Protocol.WireCmd.GetOutputEnable.code, out, 1))).toBe(true);
    expect(Codec.decode(Codec.bool8, await t.ctrlIn(Protocol.WireCmd.GetOutputMute.code,   out, 1))).toBe(true);
    expect(Codec.decode(Codec.f32,   await t.ctrlIn(Protocol.WireCmd.GetOutputGain.code,   out, 4))).toBeCloseTo(-2.5, 4);
    expect(Codec.decode(Codec.f32,   await t.ctrlIn(Protocol.WireCmd.GetOutputDelay.code,  out, 4))).toBeCloseTo(4.2, 4);

    // And the bulk view reflects it too.
    const bulk = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
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
    expect((await d.saveMasterVolume()).ok).toBe(true);
    expect(await d.getSavedMasterVolume()).toBeCloseTo(-12.5, 4);
  });
});

describe('MockTransport — preset round-trip', () => {
  it('restores master volume across save/load when mode=WithPreset', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);

    // Switch to with-preset mode so master volume rides the preset payload.
    await d.setMasterVolumeMode(Domain.MasterVolumeMode.WithPreset);

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
    await d.setMasterVolumeMode(Domain.MasterVolumeMode.WithPreset);
    await d.setMasterVolume(-9);
    expect((await d.savePreset(0)).ok).toBe(true);

    // Operator flips global mode AFTER the save.
    await d.setMasterVolumeMode(Domain.MasterVolumeMode.Independent);

    // Loading the slot must NOT bring back WithPreset — mode is owned by
    // the directory sector, not the slot payload.
    expect((await d.loadPreset(0)).ok).toBe(true);
    expect(await d.getMasterVolumeMode()).toBe(Domain.MasterVolumeMode.Independent);
  });
});

describe('MockTransport — GetEqParam multi-read', () => {
  it('setFilter → getFilter cross-validates the multi-read protocol', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    const d = await createDevice(t);
    await d.setFilter(2, 5, {
      type: Domain.FilterType.LowShelf,
      bypass: false,
      frequency: 320,
      q: 0.9,
      gain: 4.5,
    });
    const got = await d.getFilter(2, 5);
    expect(got.type).toBe(Domain.FilterType.LowShelf);
    expect(got.frequency).toBeCloseTo(320, 1);
    expect(got.q).toBeCloseTo(0.9, 4);
    expect(got.gain).toBeCloseTo(4.5, 4);
  });
});

describe('MockTransport — Linkwitz Transform qp sidecar (V22+, raw wire level)', () => {
  it('the 18-byte SetEqParam form stores qp; GetEqParam param 5 returns qp_x512', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 22, fwVersion: { major: 1, minor: 2, patch: 0 } });
    await t.open();
    const payload = Codec.encode(Protocol.Wire.SetFilterPacketQp, {
      channel: 2, band: 1, type: Domain.FilterType.LinkwitzTransform, frequency: 45, q: 0.6, gain: 90, qp: 768,
    });
    await t.ctrlOut(Protocol.WireCmd.SetEqParam.code, 0, payload);

    const wValue = (2 << 8) | (1 << 3) | 5;   // (channel<<8)|(band<<3)|param5
    const raw = await t.ctrlIn(Protocol.WireCmd.GetEqParam.code, wValue, 4);
    expect(Codec.decode(Codec.u32, raw) & 0xFFFF).toBe(768);
  });

  it('the 16-byte SetEqParam form preserves a previously-stored qp', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 22, fwVersion: { major: 1, minor: 2, patch: 0 } });
    await t.open();
    await t.ctrlOut(Protocol.WireCmd.SetEqParam.code, 0, Codec.encode(Protocol.Wire.SetFilterPacketQp, {
      channel: 2, band: 1, type: Domain.FilterType.LinkwitzTransform, frequency: 45, q: 0.6, gain: 90, qp: 768,
    }));
    // Re-send with the plain 16-byte form (frequency changes; qp omitted).
    await t.ctrlOut(Protocol.WireCmd.SetEqParam.code, 0, Codec.encode(Protocol.Wire.SetFilterPacket, {
      channel: 2, band: 1, type: Domain.FilterType.LinkwitzTransform, frequency: 50, q: 0.6, gain: 90,
    }));

    const wValue = (2 << 8) | (1 << 3) | 5;
    const raw = await t.ctrlIn(Protocol.WireCmd.GetEqParam.code, wValue, 4);
    expect(Codec.decode(Codec.u32, raw) & 0xFFFF).toBe(768);
  });

  it('latches qp from the 18-byte form even for a non-LT type (only the bulk path zeroes it)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 22, fwVersion: { major: 1, minor: 2, patch: 0 } });
    await t.open();
    await t.ctrlOut(Protocol.WireCmd.SetEqParam.code, 0, Codec.encode(Protocol.Wire.SetFilterPacketQp, {
      channel: 2, band: 1, type: Domain.FilterType.Peaking, frequency: 1000, q: 1, gain: 3, qp: 999,
    }));

    const wValue = (2 << 8) | (1 << 3) | 5;
    const raw = await t.ctrlIn(Protocol.WireCmd.GetEqParam.code, wValue, 4);
    expect(Codec.decode(Codec.u32, raw) & 0xFFFF).toBe(999);
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
    expect(first[1]).toBe(Protocol.NotifyEventId.BulkInvalidated);
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
    const chunkSize = Protocol.Wire.BulkLimits.ChunkSize;
    const full = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);

    await t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, 0, full.subarray(0, chunkSize));
    await expect(
      t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, chunkSize + 1, full.subarray(chunkSize, chunkSize * 2)),
    ).rejects.toThrow();
  });

  it('invalidates an open GET session when a non-chunk vendor request is interleaved', async () => {
    const t = await v16Mock();
    const chunkSize = Protocol.Wire.BulkLimits.ChunkSize;

    await t.ctrlIn(Protocol.WireCmd.GetAllParamsChunk.code, 0, chunkSize);
    await t.ctrlIn(Protocol.WireCmd.GetSerial.code, 0, 16);   // interleaved, non-chunk request

    // The session is gone: resuming at the offset that was valid a moment
    // ago is now out-of-order (no active session).
    await expect(
      t.ctrlIn(Protocol.WireCmd.GetAllParamsChunk.code, chunkSize, chunkSize),
    ).rejects.toThrow();
  });
});

describe('MockTransport — bulk SET minimum size (V16+)', () => {
  const chunk = Protocol.Wire.BulkLimits.ChunkSize;

  async function v30Mock() {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 30, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    return t;
  }

  it('STALLs the first chunk of a V29-sized packet sent to a V30 device', async () => {
    const t = await v30Mock();
    const state = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    const short = Protocol.buildBulkParams(state, 29);
    expect(short.byteLength).toBe(Protocol.Wire.BULK_SIZE_V29);
    await expect(t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, 0, short.subarray(0, chunk))).rejects.toThrow();
  });

  it('applies a full-size V30 packet delivered in chunks', async () => {
    const t = await v30Mock();
    const state = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    state.subharm = { ...state.subharm, topDb: -3, linkPairs: false };
    const bytes = Protocol.buildBulkParams(state);
    for (let off = 0; off < bytes.byteLength; off += chunk) {
      await t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, off, bytes.subarray(off, Math.min(off + chunk, bytes.byteLength)));
    }
    const after = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(after.subharm.topDb).toBeCloseTo(-3, 5);
    expect(after.subharm.linkPairs).toBe(false);
  });

  it('rejects a short direct SetAllParams payload', async () => {
    const t = await v30Mock();
    const full = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    await expect(t.ctrlOut(Protocol.WireCmd.SetAllParams.code, 0, full.subarray(0, full.byteLength - 1))).rejects.toThrow();
  });
});

describe('MockTransport — V32 bulk size and tube/limiter state', () => {
  const chunk = Protocol.Wire.BulkLimits.ChunkSize;

  async function v32Mock() {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 32, fwVersion: { major: 1, minor: 1, patch: 6, beta: 4 } });
    await t.open();
    return t;
  }

  it('STALLs the first chunk of a V30-sized packet sent to a V32 device', async () => {
    const t = await v32Mock();
    const state = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    const short = Protocol.buildBulkParams(state, 30);
    expect(short.byteLength).toBe(Protocol.Wire.BULK_SIZE_V30);
    await expect(t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, 0, short.subarray(0, chunk))).rejects.toThrow();
  });

  it('serves a 6136-byte packet and round-trips tube and limiter edits delivered in chunks', async () => {
    const t = await v32Mock();
    const raw = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(raw.byteLength).toBe(Protocol.Wire.BULK_SIZE_V32);
    const state = Protocol.parseBulkParams(raw);
    state.tube = { ...state.tube, enabled: true, tubeType: 12, driveDb: 6 };
    state.limiter[2] = { enabled: true, linkGroup: 3, thresholdDb: -6, releaseMs: 250 };
    const bytes = Protocol.buildBulkParams(state);
    for (let off = 0; off < bytes.byteLength; off += chunk) {
      await t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, off, bytes.subarray(off, Math.min(off + chunk, bytes.byteLength)));
    }
    const after = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(after.tube).toMatchObject({ enabled: true, tubeType: 12, driveDb: 6 });
    expect(after.limiter[2]).toEqual({ enabled: true, linkGroup: 3, thresholdDb: -6, releaseMs: 250 });
  });

  async function readState(t: MockTransport) {
    return Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
  }
  async function writeState(t: MockTransport, state: ReturnType<typeof Protocol.parseBulkParams>) {
    const bytes = Protocol.buildBulkParams(state);
    for (let off = 0; off < bytes.byteLength; off += chunk) {
      await t.ctrlOut(Protocol.WireCmd.SetAllParamsChunk.code, off, bytes.subarray(off, Math.min(off + chunk, bytes.byteLength)));
    }
  }

  it('ignores the limiter section of a bulk SET in Independent output-config mode, like the pins', async () => {
    const t = await v32Mock();
    await t.ctrlOut(Protocol.WireCmd.SetOutputConfigMode.code, 0, Codec.encode(Codec.u8, Domain.OutputConfigMode.Independent));
    const state = await readState(t);
    state.limiter[0] = { enabled: true, linkGroup: 0, thresholdDb: -3, releaseMs: 50 };
    state.tube = { ...state.tube, enabled: true };
    await writeState(t, state);
    const after = await readState(t);
    expect(after.limiter[0]).toEqual({ enabled: false, linkGroup: 0, thresholdDb: -1, releaseMs: 100 });
    expect(after.tube.enabled).toBe(true);
  });

  it('settles a pasted limiter section the way firmware does: clamps, zeros past the output count, re-converges link groups', async () => {
    const t = new MockTransport({ platform: 'rp2040', wireVersion: 32, fwVersion: { major: 1, minor: 1, patch: 6, beta: 4 } });
    await t.open();
    const state = await readState(t);
    expect(state.numOut).toBe(5);
    state.limiter[0] = { enabled: true, linkGroup: 2, thresholdDb: -40, releaseMs: 1 };
    state.limiter[3] = { enabled: false, linkGroup: 2, thresholdDb: -12, releaseMs: 500 };
    state.limiter[4] = { enabled: true, linkGroup: 0, thresholdDb: NaN, releaseMs: 5000 };
    state.limiter[6] = { enabled: true, linkGroup: 1, thresholdDb: -6, releaseMs: 200 };
    await writeState(t, state);
    const after = await readState(t);
    // Output 0 clamps; output 3 copies its group's lowest member; output 4 takes
    // the default threshold for NaN and clamps the release; output 6 is past the
    // platform's five outputs and reads back as zeros.
    expect(after.limiter[0]).toEqual({ enabled: true, linkGroup: 2, thresholdDb: -30, releaseMs: 10 });
    expect(after.limiter[3]).toEqual({ enabled: true, linkGroup: 2, thresholdDb: -30, releaseMs: 10 });
    expect(after.limiter[4]).toEqual({ enabled: true, linkGroup: 0, thresholdDb: -1, releaseMs: 1000 });
    expect(after.limiter[6]).toEqual({ enabled: false, linkGroup: 0, thresholdDb: 0, releaseMs: 0 });
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
    await d.setChannelName(Domain.ChannelId.In2L, 'Turntable');

    await d.setInputSource(Domain.AudioInputSource.Spdif);
    const bulk = await d.getAllParams();

    expect(bulk.channelNames[0]).toBe('SPDIF L');   // untouched default -> regenerated
    expect(bulk.channelNames[1]).toBe('SPDIF R');
    expect(bulk.channelNames[2]).toBe('Turntable');  // custom name survives the switch
  });

  it('does not regenerate names on an I2S channel-count change (names key on source, not count)', async () => {
    const d = await v16Device();
    await d.setInputSource(Domain.AudioInputSource.I2s);
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
    const bytes = await mock.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(Protocol.Wire.BulkSizes.V10);
    const p = Protocol.parseBulkParams(bytes);
    expect(p.formatVersion).toBe(10);
    expect(p.dacHwMute.pin).toBe(11);
    expect(p.inputConfig.spdifRxPin).toBe(5);
  });

  it('a V10 SetAllParams round-trips the tail through the mock', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } });
    await mock.open();
    const read = await mock.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    const bulk = Protocol.parseBulkParams(read);
    bulk.userVolume = { volumeDb: -9, mute: true };
    await mock.ctrlOut(Protocol.WireCmd.SetAllParams.code, 0, Protocol.buildBulkParams(bulk));
    const back = Protocol.parseBulkParams(await mock.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(back.userVolume.mute).toBe(true);
    expect(back.userVolume.volumeDb).toBeCloseTo(-9, 4);
  });
});

describe('MockTransport — imaginary I2S multichannel demo mode', () => {
  it('boots a V16 mock with an I2S multichannel input', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 16, i2sInputChannels: 8 });
    await t.open();
    const p = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(p.inputConfig.source).toBe(Domain.AudioInputSource.I2s);
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
    const p = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(p.inputConfig.i2sInputChannels).toBe(4);
  });

  it('ignores the knob on a V10 mock (stays USB stereo)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10, i2sInputChannels: 8 });
    await t.open();
    const p = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(p.inputConfig.source).toBe(Domain.AudioInputSource.Usb);
  });
});

describe('MockTransport — loudness/crossfeed output masks (V19/V20)', () => {
  async function v20Mock(): Promise<MockTransport> {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 20, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    return t;
  }

  it('GetLoudnessMask/GetCrossfeedOutputs default to 0xFFFF / 0x01', async () => {
    const t = await v20Mock();
    expect(Codec.decode(Codec.u16, await t.ctrlIn(Protocol.WireCmd.GetLoudnessMask.code, 0, 2))).toBe(0xFFFF);
    expect(Codec.decode(Codec.u8, await t.ctrlIn(Protocol.WireCmd.GetCrossfeedOutputs.code, 0, 1))).toBe(0x01);
  });

  it('SetLoudnessMask/SetCrossfeedOutputs round-trip through Get', async () => {
    const t = await v20Mock();
    await t.ctrlOut(Protocol.WireCmd.SetLoudnessMask.code, 0, Codec.encode(Codec.u16, 0x00F0));
    expect(Codec.decode(Codec.u16, await t.ctrlIn(Protocol.WireCmd.GetLoudnessMask.code, 0, 2))).toBe(0x00F0);

    await t.ctrlOut(Protocol.WireCmd.SetCrossfeedOutputs.code, 0, Codec.encode(Codec.u8, 0x0D));
    expect(Codec.decode(Codec.u8, await t.ctrlIn(Protocol.WireCmd.GetCrossfeedOutputs.code, 0, 1))).toBe(0x0D);
  });

  it('carries both masks in the synthesized V20 bulk packet', async () => {
    const t = await v20Mock();
    await t.ctrlOut(Protocol.WireCmd.SetLoudnessMask.code, 0, Codec.encode(Codec.u16, 0x0F0F));
    await t.ctrlOut(Protocol.WireCmd.SetCrossfeedOutputs.code, 0, Codec.encode(Codec.u8, 0x03));

    const p = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(p.formatVersion).toBe(20);
    expect(p.payloadLength).toBe(Protocol.Wire.BULK_SIZE_V20);
    expect(p.loudness.outputMask).toBe(0x0F0F);
    expect(p.crossfeed.outputPairMask).toBe(0x03);
  });
});

describe('MockTransport — I2S slave clock (V21)', () => {
  async function v21Mock(): Promise<MockTransport> {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 21, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    return t;
  }

  it('GetI2sClockMode defaults to master (0); SetI2sClockMode round-trips to slave (1)', async () => {
    const t = await v21Mock();
    expect(Codec.decode(Codec.u8, await t.ctrlIn(Protocol.WireCmd.GetI2sClockMode.code, 0, 1))).toBe(0);
    await t.ctrlOut(Protocol.WireCmd.SetI2sClockMode.code, 0, Codec.encode(Codec.u8, 1));
    expect(Codec.decode(Codec.u8, await t.ctrlIn(Protocol.WireCmd.GetI2sClockMode.code, 0, 1))).toBe(1);
  });

  it('slave status transitions: INACTIVE by default, LOCKED once slave mode + I2S input are both set', async () => {
    const t = await v21Mock();
    const idle = Codec.decode(Protocol.Wire.I2sSlaveStatus, await t.ctrlIn(Protocol.WireCmd.GetI2sSlaveStatus.code, 0, 16));
    expect(idle.state).toBe(0);
    expect(idle.detectedRate).toBe(0);

    await t.ctrlOut(Protocol.WireCmd.SetI2sClockMode.code, 0, Codec.encode(Codec.u8, 1));
    // Slave mode alone (still USB input) stays INACTIVE.
    const stillIdle = Codec.decode(Protocol.Wire.I2sSlaveStatus, await t.ctrlIn(Protocol.WireCmd.GetI2sSlaveStatus.code, 0, 16));
    expect(stillIdle.state).toBe(0);

    await t.ctrlOut(Protocol.WireCmd.SetInputSource.code, 0, Codec.encode(Codec.u8, Domain.AudioInputSource.I2s));
    const locked = Codec.decode(Protocol.Wire.I2sSlaveStatus, await t.ctrlIn(Protocol.WireCmd.GetI2sSlaveStatus.code, 0, 16));
    expect(locked.state).toBe(3);
    expect(locked.detectedRate).toBe(48000);
    expect(locked.lockCount).toBeGreaterThan(0);
  });

  it('GetI2sClockPinMode defaults to unified (0); SetI2sClockPinMode round-trips to split (1)', async () => {
    const t = await v21Mock();
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sClockPinMode.code, 0, 1))[0]).toBe(0);
    expect((await t.ctrlIn(Protocol.WireCmd.SetI2sClockPinMode.code, 1, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sClockPinMode.code, 0, 1))[0]).toBe(1);
  });

  it('SetI2sClockPinMode rejects a value outside 0/1 with InvalidParam', async () => {
    const t = await v21Mock();
    expect((await t.ctrlIn(Protocol.WireCmd.SetI2sClockPinMode.code, 2, 1))[0]).toBe(Protocol.PinConfigResult.InvalidParam);
  });

  it('role-indexed BCK pin: role 1 (slave) is independent of role 0 (master)', async () => {
    const t = await v21Mock();
    const masterWValue = 16;                    // role 0 -> wValue === pin
    const slaveWValue = (1 << 8) | 21;           // role 1 -> wValue === (role<<8)|pin
    expect((await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, masterWValue, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, slaveWValue, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sBckPin.code, 0, 1))[0]).toBe(16);
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sBckPin.code, 1, 1))[0]).toBe(21);
  });

  it('carries the slave-clock fields in the synthesized V21 bulk packet', async () => {
    const t = await v21Mock();
    await t.ctrlOut(Protocol.WireCmd.SetI2sClockMode.code, 0, Codec.encode(Codec.u8, 1));
    await t.ctrlIn(Protocol.WireCmd.SetI2sClockPinMode.code, 1, 1);
    await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, (1 << 8) | 21, 1);

    const p = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(p.formatVersion).toBe(21);
    expect(p.payloadLength).toBe(Protocol.Wire.BULK_SIZE_V21);
    expect(p.inputConfig.i2sClockMode).toBe(1);
    expect(p.i2s.clockPinModeP1).toBe(2);   // split
    expect(p.i2s.bckPinSlave).toBe(21);
  });
});

describe('MockTransport — selectable system clock (fw overclock branch)', () => {
  async function sysClockMock(): Promise<MockTransport> {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    return t;
  }

  it('GetSysClock STALLs on a pre-V26 mock (the console\'s probe-failure path)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    await t.open();
    await expect(t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8)).rejects.toThrow();
  });

  it('SetSysClock STALLs on a pre-V26 mock', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    await t.open();
    await expect(
      t.ctrlOut(Protocol.WireCmd.SetSysClock.code, 0, Codec.encode(Protocol.Wire.SysClockRequest, { mode: 1, vregSel: 0xFF })),
    ).rejects.toThrow();
  });

  it('sysClockBoot seeds a crash-fallback boot (stored mode kept, safe mode active)', async () => {
    const t = new MockTransport({
      platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 5 },
      sysClockBoot: { storedMode: 2, fallback: true },
    });
    await t.open();
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.activeMode).toBe(0);
    expect(status.storedMode).toBe(2);
    expect(status.fallbackActive).toBe(true);
  });

  it('a fallback boot reports the safe-mode default liveVreg, not the failed stored selection', async () => {
    const t = new MockTransport({
      platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 5 },
      sysClockBoot: { storedMode: 2, storedVregSel: 17, fallback: true },
    });
    await t.open();
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.storedVregSel).toBe(17);
    expect(status.liveVreg).toBe(12);   // mode 0's default, the only thing actually running
  });

  it('a successful SET after a fallback boot clears fallbackActive', async () => {
    const t = new MockTransport({
      platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fwVersion: { major: 1, minor: 1, patch: 5 },
      sysClockBoot: { storedMode: 2, fallback: true },
    });
    await t.open();
    await t.ctrlOut(Protocol.WireCmd.SetSysClock.code, 0, Codec.encode(Protocol.Wire.SysClockRequest, { mode: 1, vregSel: 0xFF }));
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.fallbackActive).toBe(false);
    expect(status.activeMode).toBe(1);
    expect(status.storedMode).toBe(1);
  });

  it('SET mode 1 with default vreg round-trips to the mode default liveVreg', async () => {
    const t = await sysClockMock();
    await t.ctrlOut(Protocol.WireCmd.SetSysClock.code, 0, Codec.encode(Protocol.Wire.SysClockRequest, { mode: 1, vregSel: 0xFF }));
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.storedMode).toBe(1);
    expect(status.activeMode).toBe(1);
    expect(status.storedVregSel).toBe(0xFF);
    expect(status.liveVreg).toBe(13);   // VREG_VOLTAGE_1_20, mode 1's default
  });

  it('an explicit vregSel above the mode default round-trips into liveVreg', async () => {
    const t = await sysClockMock();
    await t.ctrlOut(Protocol.WireCmd.SetSysClock.code, 0, Codec.encode(Protocol.Wire.SysClockRequest, { mode: 1, vregSel: 15 }));
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.storedVregSel).toBe(15);
    expect(status.liveVreg).toBe(15);
  });

  it('rejects mode 3 (out of range) and leaves stored state unchanged', async () => {
    const t = await sysClockMock();
    await expect(
      t.ctrlOut(Protocol.WireCmd.SetSysClock.code, 0, Codec.encode(Protocol.Wire.SysClockRequest, { mode: 3, vregSel: 0xFF })),
    ).rejects.toThrow();
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.storedMode).toBe(0);
    expect(status.activeMode).toBe(0);
  });

  it('rejects an undervolted vregSel (below the mode default) and leaves stored state unchanged', async () => {
    const t = await sysClockMock();
    await expect(
      t.ctrlOut(Protocol.WireCmd.SetSysClock.code, 0, Codec.encode(Protocol.Wire.SysClockRequest, { mode: 1, vregSel: 12 })),
    ).rejects.toThrow();
    const status = Codec.decode(Protocol.Wire.SysClockStatus, await t.ctrlIn(Protocol.WireCmd.GetSysClock.code, 0, 8));
    expect(status.storedMode).toBe(0);
    expect(status.storedVregSel).toBe(0xFF);
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
    // Pre-V28 wire has no SPDIF4 slot -- the parser pads the third
    // (SPDIF4) entry to 0 even though the mock's internal state seeds a
    // real GPIO for it (it never reaches the wire below V28).
    const rp2350 = Protocol.parseBulkParams(await (await v18Mock('rp2350')).ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(rp2350.inputConfig.spdifRxPinExt).toEqual([20, 21, 0]);
    expect(rp2350.inputConfig.spdifRxEnabledExtP1).toBe(1);  // mask 0: both disabled but present

    const rp2040 = Protocol.parseBulkParams(await (await v18Mock('rp2040')).ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(rp2040.inputConfig.spdifRxPinExt).toEqual([0, 0, 0]);
    expect(rp2040.inputConfig.spdifRxEnabledExtP1).toBe(0);
  });

  it('spdifInputsEnabled pre-enables inputs 2 and 3', async () => {
    const t = await v18Mock('rp2350', 3);
    // Pre-V28: the mock answers the legacy 5-byte layout; decodePadded
    // zero-fills pin 4 the same way readCmd does in production.
    const cfg = Codec.decodePadded(Protocol.Wire.SpdifInputConfig, await t.ctrlIn(Protocol.WireCmd.GetSpdifInputConfig.code, 0, 5));
    expect(cfg.enableMask).toBe(0b111);
  });

  it('SetSpdifRxPin / GetSpdifRxPin round-trip per instance', async () => {
    const t = await v18Mock();
    for (const [index, gpio] of [[0, 15], [1, 22], [2, 26]] as const) {
      const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (index << 8) | gpio, 1);
      expect(status[0]).toBe(Protocol.PinConfigResult.Success);
      const got = await t.ctrlIn(Protocol.WireCmd.GetSpdifRxPin.code, index, 1);
      expect(got[0]).toBe(gpio);
    }
  });

  it('rejects an out-of-range instance with InvalidOutput', async () => {
    const t = await v18Mock();
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (3 << 8) | 15, 1);  // only instances 0..2 exist
    expect(status[0]).toBe(Protocol.PinConfigResult.InvalidOutput);
  });

  it('rejects the extended instances on a single-input platform (RP2040)', async () => {
    const t = await v18Mock('rp2040');
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (1 << 8) | 15, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.InvalidOutput);
  });

  it('SetSpdifInputEnable flips the enable bit; GetSpdifInputConfig reflects count/mask/pins', async () => {
    const t = await v18Mock();
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifInputEnable.code, (1 << 8) | 1, 1);  // enable input 2
    expect(status[0]).toBe(Protocol.PinConfigResult.Success);

    const cfg = Codec.decodePadded(Protocol.Wire.SpdifInputConfig, await t.ctrlIn(Protocol.WireCmd.GetSpdifInputConfig.code, 0, 5));
    expect(cfg.count).toBe(3);
    expect(cfg.enableMask).toBe(0b011);   // bit0 (input1, always set) + bit1 (input2)
    expect(cfg.pins).toEqual([5, 20, 21, 0]);
  });

  it('disabling instance 0 (the always-on input) is InvalidOutput', async () => {
    const t = await v18Mock();
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifInputEnable.code, (0 << 8) | 0, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.InvalidOutput);
  });

  it('enabling an input whose pin collides with a reserved pin is PinInUse', async () => {
    const t = await v18Mock();
    // Claim GPIO 20 (input 2's default pin) for an output pin first.
    await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (20 << 8) | 0, 1);
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifInputEnable.code, (1 << 8) | 1, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.PinInUse);
  });
});

describe('MockTransport — fourth S/PDIF input (wire V28+, RP2350)', () => {
  async function v28Mock(spdifInputsEnabled?: number): Promise<MockTransport> {
    const t = new MockTransport({
      platform: 'rp2350', wireVersion: 28, fwVersion: { major: 1, minor: 1, patch: 6 },
      ...(spdifInputsEnabled != null ? { spdifInputsEnabled } : {}),
    });
    await t.open();
    return t;
  }

  it('GetSpdifInputConfig answers the full 6-byte layout with all 4 pins', async () => {
    const t = await v28Mock(4);
    const cfg = Codec.decode(Protocol.Wire.SpdifInputConfig, await t.ctrlIn(Protocol.WireCmd.GetSpdifInputConfig.code, 0, 6));
    expect(cfg.count).toBe(4);
    expect(cfg.enableMask).toBe(0b1111);
    expect(cfg.pins).toEqual([5, 20, 21, 22]);
  });

  it('SetSpdifRxPin/SetSpdifInputEnable accept instance 3 (input 4)', async () => {
    const t = await v28Mock();
    expect((await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (3 << 8) | 27, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetSpdifRxPin.code, 3, 1))[0]).toBe(27);
    expect((await t.ctrlIn(Protocol.WireCmd.SetSpdifInputEnable.code, (3 << 8) | 1, 1))[0]).toBe(Protocol.PinConfigResult.Success);

    const cfg = Codec.decode(Protocol.Wire.SpdifInputConfig, await t.ctrlIn(Protocol.WireCmd.GetSpdifInputConfig.code, 0, 6));
    expect(cfg.enableMask & 0b1000).toBe(0b1000);
  });

  it('rejects instance 4 (out of range even at V28) with InvalidOutput', async () => {
    const t = await v28Mock();
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (4 << 8) | 15, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.InvalidOutput);
  });

  it('a V27 device still exposes only 3 selectable inputs (legacy layout)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 27, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (3 << 8) | 15, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.InvalidOutput);
    const cfg = Codec.decodePadded(Protocol.Wire.SpdifInputConfig, await t.ctrlIn(Protocol.WireCmd.GetSpdifInputConfig.code, 0, 5));
    expect(cfg.count).toBe(3);
    expect(cfg.pins[3]).toBe(0);
  });
});

// Universal pin-reset escape hatch (fw config.h PIN_RESET_TO_DEFAULT = 0xFF):
// every single-pin SET accepts the sentinel to restore that target's
// platform default, index/pair/role-aware, still running the normal validation.
describe('MockTransport — pin-reset-to-default (0xFF sentinel)', () => {
  const RESET = Protocol.Wire.Const.PIN_RESET_TO_DEFAULT;

  it('SetOutputPin: move off the default, then the sentinel restores it', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (21 << 8) | 0, 1);
    expect((await t.ctrlIn(Protocol.WireCmd.GetOutputPin.code, 0, 1))[0]).toBe(21);

    const status = await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (RESET << 8) | 0, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetOutputPin.code, 0, 1))[0]).toBe(6);   // PICO_AUDIO_SPDIF_PIN
  });

  it('SetOutputPin: the RP2040 PDM slot resets to its own platform default (10), not RP2350\'s', async () => {
    const t = new MockTransport({ platform: 'rp2040' });
    await t.open();
    await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (22 << 8) | 2, 1);   // PDM is pin-output index 2 on RP2040
    const status = await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (RESET << 8) | 2, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetOutputPin.code, 2, 1))[0]).toBe(10);
  });

  it('SetI2sBckPin: role-aware default (master 14, slave 26 on RP2350)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 21, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, 19, 1);                  // role 0 -> off default
    await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, (1 << 8) | 21, 1);       // role 1 -> off default

    expect((await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, RESET, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.SetI2sBckPin.code, (1 << 8) | RESET, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sBckPin.code, 0, 1))[0]).toBe(14);
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sBckPin.code, 1, 1))[0]).toBe(26);
  });

  it('SetMckPin: platform-specific default (13 on RP2350, 21 on RP2040)', async () => {
    const rp2350 = new MockTransport({ platform: 'rp2350' });
    await rp2350.open();
    await rp2350.ctrlIn(Protocol.WireCmd.SetMckPin.code, 19, 1);
    expect((await rp2350.ctrlIn(Protocol.WireCmd.SetMckPin.code, RESET, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await rp2350.ctrlIn(Protocol.WireCmd.GetMckPin.code, 0, 1))[0]).toBe(13);

    const rp2040 = new MockTransport({ platform: 'rp2040' });
    await rp2040.open();
    await rp2040.ctrlIn(Protocol.WireCmd.SetMckPin.code, 19, 1);
    expect((await rp2040.ctrlIn(Protocol.WireCmd.SetMckPin.code, RESET, 1))[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await rp2040.ctrlIn(Protocol.WireCmd.GetMckPin.code, 0, 1))[0]).toBe(21);
  });

  it('SetSpdifRxPin: per-instance default (5 / 20 / 21)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 18, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    for (const [index, expected] of [[0, 5], [1, 20], [2, 21]] as const) {
      await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (index << 8) | 16, 1);   // off default first
      const status = await t.ctrlIn(Protocol.WireCmd.SetSpdifRxPin.code, (index << 8) | RESET, 1);
      expect(status[0]).toBe(Protocol.PinConfigResult.Success);
      expect((await t.ctrlIn(Protocol.WireCmd.GetSpdifRxPin.code, index, 1))[0]).toBe(expected);
    }
  });

  it('SetI2sRxPin: per-pair default (contiguous block from GPIO 1)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    await t.ctrlIn(Protocol.WireCmd.SetI2sRxPin.code, (2 << 8) | 19, 1);
    const status = await t.ctrlIn(Protocol.WireCmd.SetI2sRxPin.code, (2 << 8) | RESET, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetI2sRxPin.code, 2, 1))[0]).toBe(3);
  });

  it('a resolved default can still fail PinInUse if another peripheral already holds it', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();
    await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (21 << 8) | 0, 1);   // move slot 0 off its own default (6)
    await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (6 << 8) | 1, 1);    // slot 1 claims the now-free GPIO 6
    const status = await t.ctrlIn(Protocol.WireCmd.SetOutputPin.code, (RESET << 8) | 0, 1);   // slot 0 -> default collides with slot 1
    expect(status[0]).toBe(Protocol.PinConfigResult.PinInUse);
  });
});

describe('MockTransport — ADAT lightpipe output (V17+, RP2350)', () => {
  it('the 0xFF sentinel resets the pin to the platform default (GPIO 12)', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 17, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    await t.ctrlIn(Protocol.WireCmd.SetAdatPin.code, 20, 1);
    const status = await t.ctrlIn(Protocol.WireCmd.SetAdatPin.code, Protocol.Wire.Const.PIN_RESET_TO_DEFAULT, 1);
    expect(status[0]).toBe(Protocol.PinConfigResult.Success);
    expect((await t.ctrlIn(Protocol.WireCmd.GetAdatPin.code, 0, 1))[0]).toBe(12);
  });
});

describe('MockTransport — subharmonic synthesizer (V29+, both platforms)', () => {
  async function v29Mock(platform: 'rp2040' | 'rp2350' = 'rp2350'): Promise<MockTransport> {
    const t = new MockTransport({ platform, wireVersion: 29, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    return t;
  }

  it('clamps low/high to -30..+6 and boost to 0..+6, reading the clamped values back', async () => {
    const t = await v29Mock();
    await t.ctrlOut(Protocol.WireCmd.SetSubharmLow.code, 0, Codec.encode(Codec.f32, -40));
    expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmLow.code, 0, 4))).toBeCloseTo(-30, 4);

    await t.ctrlOut(Protocol.WireCmd.SetSubharmHigh.code, 0, Codec.encode(Codec.f32, 20));
    expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmHigh.code, 0, 4))).toBeCloseTo(6, 4);

    await t.ctrlOut(Protocol.WireCmd.SetSubharmBoost.code, 0, Codec.encode(Codec.f32, 9));
    expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmBoost.code, 0, 4))).toBeCloseTo(6, 4);
  });

  it('GET_ALL_PARAMS is 5960 B on a V29 mock and parses the subharm section', async () => {
    const t = await v29Mock();
    await t.ctrlOut(Protocol.WireCmd.SetSubharmEnabled.code, 0, Codec.encode(Codec.bool8, true));
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(5960);
    expect(Protocol.parseBulkParams(bytes).subharm.enabled).toBe(true);
  });

  it('a pre-V29 mock STALLs 0x11 (GetSubharmEnabled) and answers 5944 B on GET_ALL_PARAMS', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 28, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    await expect(t.ctrlIn(Protocol.WireCmd.GetSubharmEnabled.code, 0, 1)).rejects.toThrow();
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize);
    expect(bytes.byteLength).toBe(5944);
  });

  it('headroom is 0 while disabled and positive once enabled with a band above the floor, on both platforms', async () => {
    for (const platform of ['rp2350', 'rp2040'] as const) {
      const t = await v29Mock(platform);
      expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmHeadroom.code, 0, 4))).toBe(0);
      await t.ctrlOut(Protocol.WireCmd.SetSubharmEnabled.code, 0, Codec.encode(Codec.bool8, true));
      await t.ctrlOut(Protocol.WireCmd.SetSubharmLow.code, 0, Codec.encode(Codec.f32, 3));
      expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmHeadroom.code, 0, 4))).toBeGreaterThan(0);
    }
  });
});

describe('MockTransport — subharm V30 ops (0x1B-0x1F, 0x2C-0x2F, 0xA9-0xAE)', () => {
  async function v30Mock(platform: 'rp2040' | 'rp2350' = 'rp2350'): Promise<MockTransport> {
    const t = new MockTransport({ platform, wireVersion: 30, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    return t;
  }

  it('ext SETs land in the bulk tail (top/ceiling/link)', async () => {
    const t = await v30Mock();
    await t.ctrlOut(Protocol.WireCmd.SetSubharmTop.code, 0, Codec.encode(Codec.f32, -3));
    await t.ctrlOut(Protocol.WireCmd.SetSubharmCeiling.code, 0, Codec.encode(Codec.f32, -12));
    await t.ctrlOut(Protocol.WireCmd.SetSubharmLink.code, 0, Codec.encode(Codec.bool8, false));

    const bulk = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(bulk.subharm.topDb).toBeCloseTo(-3, 4);
    expect(bulk.subharm.ceilingDb).toBeCloseTo(-12, 4);
    expect(bulk.subharm.linkPairs).toBe(false);
  });

  it('solo never reaches the bulk packet, but round-trips via GET 0x2D', async () => {
    const t = await v30Mock();
    const before = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));

    await t.ctrlOut(Protocol.WireCmd.SetSubharmSolo.code, 0, Codec.encode(Codec.bool8, true));
    expect(Codec.decode(Codec.bool8, await t.ctrlIn(Protocol.WireCmd.GetSubharmSolo.code, 0, 1))).toBe(true);

    const after = Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize));
    expect(after.subharm).toEqual(before.subharm);
  });

  it('band levels clamp to +12 dB, not the V29 +6, and the boost ceiling is unmoved', async () => {
    const t = await v30Mock();
    await t.ctrlOut(Protocol.WireCmd.SetSubharmHigh.code, 0, Codec.encode(Codec.f32, 20));
    expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmHigh.code, 0, 4))).toBeCloseTo(12, 4);

    // +10 sits above the V29 ceiling and must survive untouched here.
    await t.ctrlOut(Protocol.WireCmd.SetSubharmTop.code, 0, Codec.encode(Codec.f32, 10));
    expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmTop.code, 0, 4))).toBeCloseTo(10, 4);

    await t.ctrlOut(Protocol.WireCmd.SetSubharmBoost.code, 0, Codec.encode(Codec.f32, 9));
    expect(Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.GetSubharmBoost.code, 0, 4))).toBeCloseTo(6, 4);
  });

  it('STALLs SetSubharmTop below wire 30', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 29, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    await expect(
      t.ctrlOut(Protocol.WireCmd.SetSubharmTop.code, 0, Codec.encode(Codec.f32, -3)),
    ).rejects.toThrow();
  });

  it('meter length equals the platform output count', async () => {
    for (const [platform, numOut] of [['rp2350', 9], ['rp2040', 5]] as const) {
      const t = await v30Mock(platform);
      const bytes = await t.ctrlIn(Protocol.WireCmd.GetSubharmMeter.code, 0, numOut * 2);
      expect(bytes.byteLength).toBe(numOut * 2);
    }
  });
});

describe('MockTransport — GetBuildInfo (0x80, fw 1.1.6+)', () => {
  it('a fw 1.1.5 profile STALLs 0x80', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 28, fwVersion: { major: 1, minor: 1, patch: 5 } });
    await t.open();
    await expect(t.ctrlIn(Protocol.WireCmd.GetBuildInfo.code, 0, 64)).rejects.toThrow();
  });

  it('a fw 1.1.6 profile answers a 64-byte build stamp', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 29, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetBuildInfo.code, 0, 64);
    expect(bytes.byteLength).toBe(64);
    expect(Codec.decode(Protocol.Wire.BuildInfo, bytes)).toEqual({ describe: 'v1.1.6-mock', date: '2026-09-02' });
  });

  it('honors a custom buildInfo option on a fw 1.1.6 profile', async () => {
    const t = new MockTransport({
      platform: 'rp2350', wireVersion: 29, fwVersion: { major: 1, minor: 1, patch: 6 },
      buildInfo: { describe: 'v9.9.9-custom', date: '2030-01-01' },
    });
    await t.open();
    const bytes = await t.ctrlIn(Protocol.WireCmd.GetBuildInfo.code, 0, 64);
    expect(Codec.decode(Protocol.Wire.BuildInfo, bytes)).toEqual({ describe: 'v9.9.9-custom', date: '2030-01-01' });
  });
});

describe('MockTransport — output limiter (REQ_LIMITER 0x81, fw V32+)', () => {
  const wv = (output: number, index: number) => (output << 8) | index;
  const f32 = (v: number) => Codec.encode(Codec.f32, v);

  async function mock(wireVersion = 32, platform: 'rp2040' | 'rp2350' = 'rp2350') {
    const t = new MockTransport({ platform, wireVersion, fwVersion: { major: 1, minor: 1, patch: 6 } });
    await t.open();
    return t;
  }
  const get = async (t: MockTransport, output: number, index: number) =>
    Codec.decode(Codec.f32, await t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(output, index), 4));
  const bulkLimiter = async (t: MockTransport) =>
    Protocol.parseBulkParams(await t.ctrlIn(Protocol.WireCmd.GetAllParams.code, 0, Protocol.Wire.BulkLimits.MaxReadSize)).limiter;

  it('STALLs both directions below wire 32', async () => {
    const t = await mock(31);
    await expect(t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(0, 0), f32(1))).rejects.toThrow();
    await expect(t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(0, 0x81), 4)).rejects.toThrow();
  });

  it('clamps like firmware and round-trips each parameter', async () => {
    const t = await mock();
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.ThresholdDb), f32(-99));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.ReleaseMs), f32(5000));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.Enabled), f32(1));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.LinkGroup), f32(9));
    expect(await get(t, 1, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-30);
    expect(await get(t, 1, Protocol.Wire.LimiterParam.ReleaseMs)).toBe(1000);
    expect(await get(t, 1, Protocol.Wire.LimiterParam.Enabled)).toBe(1);
    expect(await get(t, 1, Protocol.Wire.LimiterParam.LinkGroup)).toBe(4);
  });

  it('output 0xFF fans out to every real output only', async () => {
    const t = await mock(32, 'rp2040');
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(0xFF, Protocol.Wire.LimiterParam.ThresholdDb), f32(-12));
    for (let k = 0; k < 5; k++) expect(await get(t, k, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-12);
    expect((await bulkLimiter(t))[5].thresholdDb).toBe(0);
  });

  it('gangs link-group members on SET, and a joiner adopts the lowest member', async () => {
    const t = await mock();
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(2, Protocol.Wire.LimiterParam.ThresholdDb), f32(-8));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(2, Protocol.Wire.LimiterParam.LinkGroup), f32(1));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(5, Protocol.Wire.LimiterParam.LinkGroup), f32(1));
    expect(await get(t, 5, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-8);

    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(5, Protocol.Wire.LimiterParam.ReleaseMs), f32(300));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(5, Protocol.Wire.LimiterParam.Enabled), f32(1));
    expect(await get(t, 2, Protocol.Wire.LimiterParam.ReleaseMs)).toBe(300);
    expect(await get(t, 2, Protocol.Wire.LimiterParam.Enabled)).toBe(1);
    expect(await get(t, 3, Protocol.Wire.LimiterParam.Enabled)).toBe(0);
  });

  it('a lower-indexed joiner adopts the existing member and leaving a group keeps the settings', async () => {
    const t = await mock();
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.LinkGroup), f32(2));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.ThresholdDb), f32(-6));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(0, Protocol.Wire.LimiterParam.ThresholdDb), f32(-20));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(0, Protocol.Wire.LimiterParam.LinkGroup), f32(2));
    expect(await get(t, 0, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-6);
    expect(await get(t, 3, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-6);

    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.LinkGroup), f32(0));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.ThresholdDb), f32(-10));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.LinkGroup), f32(0));
    expect(await get(t, 3, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-10);
    expect(await get(t, 0, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-6);
  });

  it('enable is value != 0 and a NaN SET is a silent no-op', async () => {
    const t = await mock();
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.Enabled), f32(0.25));
    expect(await get(t, 1, Protocol.Wire.LimiterParam.Enabled)).toBe(1);
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.ThresholdDb), f32(-12));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.ThresholdDb), f32(NaN));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(1, Protocol.Wire.LimiterParam.Enabled), f32(NaN));
    expect(await get(t, 1, Protocol.Wire.LimiterParam.ThresholdDb)).toBe(-12);
    expect(await get(t, 1, Protocol.Wire.LimiterParam.Enabled)).toBe(1);
  });

  it('a bad output, bad index or short payload is a silent SET no-op; a bad GET STALLs', async () => {
    const t = await mock();
    const before = await bulkLimiter(t);
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(9, Protocol.Wire.LimiterParam.Enabled), f32(1));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(0, 7), f32(1));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(0, Protocol.Wire.LimiterParam.Enabled), new Uint8Array(2));
    expect(await bulkLimiter(t)).toEqual(before);
    await expect(t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(9, 0), 4)).rejects.toThrow();
    await expect(t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(0, 7), 4)).rejects.toThrow();
  });

  it('status reports engaged only while some output is enabled; meter is 0 with nothing enabled', async () => {
    const t = await mock();
    const status = async () => Codec.decode(Protocol.Wire.LimiterStatus, await t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(0, Protocol.Wire.LIMITER_GET_STATUS), 4));
    expect(await status()).toEqual({ engaged: 0, lookaheadSamples: 32, blockSamples: 16, numOutputs: 9 });
    const idle = await t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(0, Protocol.Wire.LIMITER_GET_METER), 18);
    expect(idle).toEqual(new Uint8Array(18));

    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.Enabled), f32(1));
    await t.ctrlOut(Protocol.WireCmd.Limiter.code, wv(3, Protocol.Wire.LimiterParam.ThresholdDb), f32(-30));
    expect((await status()).engaged).toBe(1);
    // Pin the fake-peak clock to a swell so output 3 sits well above -30 dBFS.
    const now = vi.spyOn(performance, 'now').mockReturnValue(3720);
    const meter = Codec.decode(Codec.arr(Codec.u16, 9), await t.ctrlIn(Protocol.WireCmd.Limiter.code, wv(0, Protocol.Wire.LIMITER_GET_METER), 18));
    now.mockRestore();
    expect(meter[3]).toBeGreaterThan(0);
    expect(meter.filter((_, k) => k !== 3).every((v) => v === 0)).toBe(true);
  });
});
