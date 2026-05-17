import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './MockTransport';
import { DspDevice } from '../device/DspDevice';
import { WireCmd, writeCmd } from '../protocol/wireCmd';
import { parseBufferStats } from '../protocol/bufferStats';
import { parseSystemStatus } from '../protocol/systemStatus';
import { parseBulkParams } from '../protocol/bulkParser';
import { Codec } from '../utils';
import { FilterType, MasterVolumeMode } from '../domain';

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

  it('roundtrips matrix route writes via SetMatrixRoute / GetMatrixRoute', async () => {
    const payload = Codec.encode(WireCmd.SetMatrixRoute.codec, {
      input: 1, output: 4,
      enabled: true, phaseInvert: true, gainDb: -3.5,
    });
    await t.ctrlOut(WireCmd.SetMatrixRoute.code, 0, payload);
    const wValue = (1 << 8) | 4;
    const got = Codec.decode(WireCmd.GetMatrixRoute.codec,
      await t.ctrlIn(WireCmd.GetMatrixRoute.code, wValue, 8));
    expect(got.enabled).toBe(true);
    expect(got.phaseInvert).toBe(true);
    expect(got.gainDb).toBeCloseTo(-3.5, 4);
    expect(got.input).toBe(1);
    expect(got.output).toBe(4);
  });

  it('matrix route writes show up in the next bulk read', async () => {
    const payload = Codec.encode(WireCmd.SetMatrixRoute.codec, {
      input: 0, output: 2,
      enabled: true, phaseInvert: false, gainDb: 1.25,
    });
    await t.ctrlOut(WireCmd.SetMatrixRoute.code, 0, payload);
    const bulk = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, 2896));
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
    const bulk = parseBulkParams(await t.ctrlIn(WireCmd.GetAllParams.code, 0, 2896));
    expect(bulk.outputs[out].enabled).toBe(true);
    expect(bulk.outputs[out].muted).toBe(true);
    expect(bulk.outputs[out].gainDb).toBeCloseTo(-2.5, 4);
    expect(bulk.outputs[out].delayMs).toBeCloseTo(4.2, 4);
  });
});

describe('MockTransport SetEqParam round-trip', () => {
  it('a SetEqParam write is reflected in the next GetAllParams', async () => {
    const t = new MockTransport({ platform: 'rp2350' });
    await t.open();

    const target = {
      type: FilterType.Peaking,
      frequency: 1234,
      q: 1.5,
      gain: 6.0,
    };
    await writeCmd(t, WireCmd.SetEqParam, { channel: 3, band: 5, type: target.type, frequency: target.frequency, q: target.q, gain: target.gain });
    const bulk = parseBulkParams(
      await t.ctrlIn(WireCmd.GetAllParams.code, 0, 4096),
    );

    expect(bulk.filters[3][5].type).toBe(FilterType.Peaking);
    expect(bulk.filters[3][5].frequency).toBeCloseTo(1234, 3);
    expect(bulk.filters[3][5].q).toBeCloseTo(1.5, 3);
    expect(bulk.filters[3][5].gain).toBeCloseTo(6.0, 3);
  });
});

describe('MockTransport — bypass / master volume mode / saved volume', () => {
  let t: MockTransport;
  beforeEach(async () => {
    t = new MockTransport({ platform: 'rp2350' });
    await t.open();
  });

  it('roundtrips bypass', async () => {
    await t.ctrlOut(WireCmd.SetBypass.code, 0, new Uint8Array([1]));
    const on = await t.ctrlIn(WireCmd.GetBypass.code, 0, 1);
    expect(on[0]).toBe(1);

    await t.ctrlOut(WireCmd.SetBypass.code, 0, new Uint8Array([0]));
    const off = await t.ctrlIn(WireCmd.GetBypass.code, 0, 1);
    expect(off[0]).toBe(0);
  });

  it('roundtrips master volume mode', async () => {
    await t.ctrlOut(WireCmd.SetMasterVolumeMode.code, 0, new Uint8Array([1]));
    const m = await t.ctrlIn(WireCmd.GetMasterVolumeMode.code, 0, 1);
    expect(m[0]).toBe(1);

    await t.ctrlOut(WireCmd.SetMasterVolumeMode.code, 0, new Uint8Array([0]));
    const m0 = await t.ctrlIn(WireCmd.GetMasterVolumeMode.code, 0, 1);
    expect(m0[0]).toBe(0);
  });

  it('SaveMasterVolume copies live → saved and returns ok status', async () => {
    // Set live master vol to -7.5
    const liveBytes = new Uint8Array(4);
    new DataView(liveBytes.buffer).setFloat32(0, -7.5, true);
    await t.ctrlOut(WireCmd.SetMasterVolume.code, 0, liveBytes);

    // Saved should still be the default (0) before the save call.
    const before = await t.ctrlIn(WireCmd.GetSavedMasterVolume.code, 0, 4);
    expect(new DataView(before.buffer).getFloat32(0, true)).toBeCloseTo(0, 4);

    // Save: returns 1-byte ok status (0).
    const status = await t.ctrlIn(WireCmd.SaveMasterVolume.code, 0, 1);
    expect(status[0]).toBe(0);

    // Saved now reflects the live value.
    const after = await t.ctrlIn(WireCmd.GetSavedMasterVolume.code, 0, 4);
    expect(new DataView(after.buffer).getFloat32(0, true)).toBeCloseTo(-7.5, 4);
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
