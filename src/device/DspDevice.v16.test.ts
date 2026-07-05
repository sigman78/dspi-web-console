// V16 (fw 1.1.5, unified channel model) device-facade coverage against the
// MockTransport's V16 synthesis: connect classification, the RP2350 wire
// index shift, crossover band addressing, the wide status layout, and the
// I2S-input command surface.

import { describe, it, expect, vi } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice, UnsupportedFirmware } from './DspDevice';
import { parseNotifyPacket, WireCmd, buildBulkParams, PinConfigResult } from '@/protocol';
import { ChannelId, FilterType } from '@/domain';

const FW_115 = { major: 1, minor: 1, patch: 5 };

async function v16Device(platform: 'rp2040' | 'rp2350' = 'rp2350'): Promise<DspDevice> {
  return DspDevice.create(new MockTransport({ platform, wireVersion: 16, fwVersion: FW_115 }));
}

describe('DspDevice — V16 connect + profile', () => {
  it('classifies a V16 RP2350 as supported with the 17-channel profile', async () => {
    const d = await v16Device();
    expect(d.capabilities.support).toBe('supported');
    expect(d.capabilities.wireGen).toBe(16);
    expect(d.hardware.totalChannelCount).toBe(17);
    expect(d.hardware.inputs.length).toBe(8);
    expect(d.capabilities.features.multichannelInput).toBe(true);
  });

  it('keeps the RP2040 at the 7-channel space on V16', async () => {
    const d = await v16Device('rp2040');
    expect(d.hardware.totalChannelCount).toBe(7);
    expect(d.hardware.inputs.length).toBe(2);
    expect(d.capabilities.features.i2sInput).toBe(true);
    expect(d.capabilities.features.multichannelInput).toBe(false);
  });

  it('rejects the 11..15 in-development intermediates at connect', async () => {
    const t = new MockTransport({ platform: 'rp2350', wireVersion: 12 });
    await expect(DspDevice.create(t)).rejects.toBeInstanceOf(UnsupportedFirmware);
  });
});

describe('DspDevice — V16 wire index shift (RP2350 outputs at 8..16)', () => {
  it('routes channel names through the shifted wire index', async () => {
    const d = await v16Device();
    await d.setChannelName(ChannelId.Out1L, 'Front L');
    // The name must land on WIRE channel 8, not the domain id 2.
    const bulk = await d.getAllParams();
    expect(bulk.channelNames[8]).toBe('Front L');
    expect(bulk.channelNames[2]).toBe('');
    const snap = await d.getSnapshot();
    expect(snap.channels.find((c) => c.id === ChannelId.Out1L)?.name).toBe('Front L');
  });

  it('reads EQ through the V16 5-bit-band wValue encoding', async () => {
    const d = await v16Device();
    await d.setFilter(ChannelId.Out1L, 4, {
      type: FilterType.Peaking, bypass: false, frequency: 880, q: 1.5, gain: -2,
    });
    const f = await d.getFilter(ChannelId.Out1L, 4);
    expect(f.type).toBe(FilterType.Peaking);
    expect(f.frequency).toBeCloseTo(880, 3);
    expect(f.q).toBeCloseTo(1.5, 4);
    expect(f.gain).toBeCloseTo(-2, 4);
  });
});

describe('DspDevice — V16 crossover bands', () => {
  it('round-trips a crossover band through the 20..23 band window', async () => {
    const d = await v16Device();
    await d.setCrossoverBand(ChannelId.Out2L, 1, {
      type: FilterType.Lr4Hp, bypass: false, frequency: 2400, q: 0.707, gain: 0,
    });
    const f = await d.getCrossoverBand(ChannelId.Out2L, 1);
    expect(f.type).toBe(FilterType.Lr4Hp);
    expect(f.frequency).toBeCloseTo(2400, 3);

    const snap = await d.getSnapshot();
    const ch = snap.channels.find((c) => c.id === ChannelId.Out2L);
    expect(ch?.xoverBands[1].type).toBe(FilterType.Lr4Hp);
    expect(ch?.xoverBands).toHaveLength(4);
  });

  it('crossover bypass rides SetBandBypass at the offset band index', async () => {
    const d = await v16Device();
    await d.setCrossoverBypass(ChannelId.Out1L, 0, true);
    const snap = await d.getSnapshot();
    expect(snap.channels.find((c) => c.id === ChannelId.Out1L)?.xoverBands[0].bypass).toBe(true);
  });

  it('input channels carry no crossover bands', async () => {
    const d = await v16Device();
    const snap = await d.getSnapshot();
    expect(snap.channels.find((c) => c.id === ChannelId.In1L)?.xoverBands).toEqual([]);
    expect(snap.inputPreampDb).toHaveLength(8);
  });
});

describe('DspDevice — V16 wide status', () => {
  it('parses 17 peaks, u32 clip flags, and the live input count', async () => {
    const d = await v16Device();
    const s = await d.getSystemStatus();
    expect(s.peaks.length).toBe(17);
    expect(s.peaks[16]).toBeGreaterThan(0);   // last channel's peak arrived
    expect(s.activeInputChannels).toBe(2);
  });

  it('V10 devices report no active input count', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    const s = await d.getSystemStatus();
    expect(s.activeInputChannels).toBeNull();
  });
});

describe('DspDevice — V16 I2S input surface', () => {
  it('commands the input rate and reads back {current, selected}', async () => {
    const d = await v16Device();
    await d.setInputRate(96000);
    const r = await d.getInputRate();
    expect(r.selectedHz).toBe(96000);
    expect(r.currentHz).toBeGreaterThan(0);
  });

  it('sets and reads a pair-addressed I2S RX data pin', async () => {
    const d = await v16Device();
    const res = await d.setI2sRxPin(1, 20);
    expect(res.ok).toBe(true);
    expect(await d.getI2sRxPin(1)).toBe(20);
    expect(await d.getI2sRxPin(0)).toBe(1);   // pair 0 keeps its default
  });

  it('rejects an out-of-range stereo pair', async () => {
    const d = await v16Device();
    const res = await d.setI2sRxPin(4, 20);
    expect(res.ok).toBe(false);
  });

  it('switches the I2S channel count and rejects invalid counts', async () => {
    const d = await v16Device();
    expect((await d.setI2sInputChannels(6)).ok).toBe(true);
    expect(await d.getI2sInputChannels()).toBe(6);
    expect((await d.setI2sInputChannels(3)).ok).toBe(false);
    // RP2040 has a single pair: counts above 2 must be rejected.
    const d40 = await v16Device('rp2040');
    expect((await d40.setI2sInputChannels(4)).ok).toBe(false);
  });
});

describe('DspDevice — cross-generation state conversion', () => {
  it('restores a V10-captured state onto a V16 device (up-convert at write)', async () => {
    const v10 = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    await v10.setMasterVolume(-18);
    const state = await v10.captureState();

    const v16 = await v16Device();
    await v16.restoreState(state);
    expect(await v16.getMasterVolume()).toBeCloseTo(-18, 4);
    // The mock accepted the packet, i.e. it arrived at the exact V16 size.
    const bulk = await v16.getAllParams();
    expect(bulk.formatVersion).toBe(16);
  });
});

describe('DspDevice — V16 chunked bulk-params (WinUSB 4 KB control-transfer cap)', () => {
  it('getAllParams never requests more than 4096 B per transfer and uses 0xA2', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: FW_115 });
    const ctrlInSpy = vi.spyOn(mock, 'ctrlIn');
    const d = await DspDevice.create(mock);
    ctrlInSpy.mockClear();   // drop the connect-time 16-byte header peek

    await d.getAllParams();

    const calls = ctrlInSpy.mock.calls;
    for (const c of calls) expect(c[2]).toBeLessThanOrEqual(4096);
    expect(calls.some((c) => c[0] === WireCmd.GetAllParamsChunk.code)).toBe(true);
    expect(calls.some((c) => c[0] === WireCmd.GetAllParams.code)).toBe(false);
  });

  it('setAllParams emits sequential 0xA3 chunks that concatenate to the exact V16 packet; the write round-trips', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: FW_115 });
    const d = await DspDevice.create(mock);
    const bulk = await d.getAllParams();
    bulk.masterVolumeDb = -21;

    const ctrlOutSpy = vi.spyOn(mock, 'ctrlOut');
    await d.setAllParams(bulk);

    const chunkCalls = ctrlOutSpy.mock.calls.filter((c) => c[0] === WireCmd.SetAllParamsChunk.code);
    expect(chunkCalls.length).toBeGreaterThan(1);

    let expectedOffset = 0;
    const pieces: Uint8Array[] = [];
    for (const [, value, data] of chunkCalls) {
      expect(value).toBe(expectedOffset);
      const bytes = data as Uint8Array;
      expect(bytes.length).toBeLessThanOrEqual(4096);
      pieces.push(bytes);
      expectedOffset += bytes.length;
    }
    const concatenated = new Uint8Array(expectedOffset);
    let off = 0;
    for (const p of pieces) { concatenated.set(p, off); off += p.length; }
    expect(concatenated).toEqual(buildBulkParams(bulk, 16));

    const back = await d.getAllParams();
    expect(back.masterVolumeDb).toBeCloseTo(-21, 4);
  });

  it('a V10 device stays single-shot: never issues 0xA2/0xA3', async () => {
    const mock = new MockTransport({ platform: 'rp2350', wireVersion: 10 });
    const ctrlInSpy = vi.spyOn(mock, 'ctrlIn');
    const ctrlOutSpy = vi.spyOn(mock, 'ctrlOut');
    const d = await DspDevice.create(mock);
    const bulk = await d.getAllParams();
    await d.setAllParams(bulk);

    expect(ctrlInSpy.mock.calls.some((c) => c[0] === WireCmd.GetAllParamsChunk.code)).toBe(false);
    expect(ctrlOutSpy.mock.calls.some((c) => c[0] === WireCmd.SetAllParamsChunk.code)).toBe(false);
  });
});

describe('DspDevice — V16 external control interfaces', () => {
  it('reports the controlInterfaces feature on V16 only', async () => {
    const v16 = await v16Device();
    expect(v16.capabilities.features.controlInterfaces).toBe(true);
    const v10 = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    expect(v10.capabilities.features.controlInterfaces).toBe(false);
  });

  it('sets a valid UART config; GET reflects it and status reports it live', async () => {
    const d = await v16Device();
    // 12/13: collision-free against the mock's default output pins (6-10),
    // I2S clock (13/14) is idle (MCK disabled), and I2S RX pair 0 (GPIO 1).
    const { result, status } = await d.setUartControlConfig({
      enabled: true, txPin: 12, rxPin: 13, notifyEnabled: true, baud: 57600,
    });
    expect(result.ok).toBe(true);
    expect(status.uartLive).toBe(true);
    expect(status.uartLastStatus).toBe(0);
    const cfg = await d.getUartControlConfig();
    expect(cfg).toEqual({ enabled: true, txPin: 12, rxPin: 13, notifyEnabled: true, baud: 57600 });
  });

  it('rejects an out-of-range baud with InvalidParam and leaves the config unchanged', async () => {
    const d = await v16Device();
    const before = await d.getUartControlConfig();
    const { result, status } = await d.setUartControlConfig({
      enabled: true, txPin: 12, rxPin: 13, notifyEnabled: false, baud: 1_000_001,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PinConfigResult.InvalidParam);
    expect(status.uartLastStatus).toBe(PinConfigResult.InvalidParam);
    expect(await d.getUartControlConfig()).toEqual(before);
  });

  it('rejects an I2C pin pair with wrong parity or a cross-instance pair', async () => {
    const d = await v16Device();
    const wrongParity = await d.setI2cControlConfig({ enabled: true, sdaPin: 19, sclPin: 18, address: 0x42 });
    expect(wrongParity.result.ok).toBe(false);
    const crossInstance = await d.setI2cControlConfig({ enabled: true, sdaPin: 18, sclPin: 17, address: 0x42 });
    expect(crossInstance.result.ok).toBe(false);
  });

  it('sets a valid I2C config and reads it back via GetCtrlIfaceStatus', async () => {
    const d = await v16Device();
    const { result, status } = await d.setI2cControlConfig({ enabled: true, sdaPin: 2, sclPin: 3, address: 0x50 });
    expect(result.ok).toBe(true);
    expect(status.i2cLive).toBe(true);
    const cfg = await d.getI2cControlConfig();
    expect(cfg).toEqual({ enabled: true, sdaPin: 2, sclPin: 3, address: 0x50 });
  });

  it('reserves its pins against output-pin assignment once enabled', async () => {
    const d = await v16Device();
    const { result } = await d.setUartControlConfig({ enabled: true, txPin: 12, rxPin: 13, notifyEnabled: false, baud: 115200 });
    expect(result.ok).toBe(true);
    const clash = await d.setOutputPin(0, 12);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe(PinConfigResult.PinInUse);
  });

  it('a V10 device has no control-interface state to corrupt (feature-gated, GETs read disabled defaults)', async () => {
    const d = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    expect(d.capabilities.features.controlInterfaces).toBe(false);
    const cfg = await d.getUartControlConfig();
    expect(cfg.enabled).toBe(false);
  });
});

describe('notify — INPUT_FORMAT (0x05)', () => {
  it('decodes the v2 input-format packet', () => {
    const e = parseNotifyPacket(new Uint8Array([2, 0x05, 0, 7, 6, 0, 0, 0]));
    expect(e).toEqual({ kind: 'inputFormat', seq: 7, channels: 6 });
  });
});
