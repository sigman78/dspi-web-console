import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './MockTransport';
import { DspDevice } from '@/device/DspDevice';
import { WireCmd, Wire, parseBufferStats, parseSystemStatus, parseBulkParams, buildBulkParams, NotifyEventId } from '@/protocol';
import { Codec } from '@/utils';
import { FilterType, MasterVolumeMode } from '@/domain';

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
    expect(s.peaks[10]).toBeGreaterThan(0.5);  // last channel close to 1.0
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
