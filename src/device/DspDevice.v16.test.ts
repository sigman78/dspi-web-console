// V16 (fw 1.1.5, unified channel model) device-facade coverage against the
// MockTransport's V16 synthesis: connect classification, the RP2350 wire
// index shift, crossover band addressing, the wide status layout, and the
// I2S-input command surface.

import { describe, it, expect, vi } from 'vitest';
import { MockTransport } from '@/transport/MockTransport';
import { DspDevice, UnsupportedFirmware } from './DspDevice';
import { parseNotifyPacket, WireCmd, buildBulkParams, PinConfigResult, CsStatusCode } from '@/protocol';
import {
  ChannelId, FilterType, CsType, CsNoun, CsAction, CsEvent, EMPTY_CS_BINDING, dbToQ8, ChannelFamily,
  CsIrProto, EMPTY_CS_IR_COMMAND, CS_IR_LEARN_DONE, CS_IR_LEARN_IDLE,
} from '@/domain';

const FW_115 = { major: 1, minor: 1, patch: 5 };

async function v16Device(platform: 'rp2040' | 'rp2350' = 'rp2350'): Promise<DspDevice> {
  return DspDevice.create(new MockTransport({ platform, wireVersion: 16, fwVersion: FW_115 }));
}

describe('DspDevice — V16 connect + profile', () => {
  it('classifies a V16 RP2350 as supported with the 17-channel profile', async () => {
    const d = await v16Device();
    expect(d.capabilities.support).toBe('supported');
    expect(d.capabilities.channelModel).toBe(ChannelFamily.Unified);
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
    // Wire channel 2 is In2L (input slot 2) on V16 RP2350, not Out1L -- it
    // must keep its own USB default, not the rename.
    expect(bulk.channelNames[2]).toBe('USB 3');
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

describe('DspDevice — V16 Control Surfaces (0x84-0x87, 0x8B-0x8C, 0x9D-0x9E)', () => {
  const encoderBinding = {
    type: CsType.Encoder, noun: CsNoun.MasterVolume, action: CsAction.Step,
    flags: 0, gpio0: 21, gpio1: 22, event: CsEvent.Press, target: 0, index: 0,
    value: 0, step: dbToQ8(1), rangeMin: 0, rangeMax: 0,
  };

  it('reports the controlSurfaces feature on V16 only', async () => {
    const v16 = await v16Device();
    expect(v16.capabilities.features.controlSurfaces).toBe(true);
    const v10 = await DspDevice.create(new MockTransport({ platform: 'rp2350' }));
    expect(v10.capabilities.features.controlSurfaces).toBe(false);
  });

  it('enumerates caps v3: dynamic type/tail parsing and one descriptor per noun', async () => {
    const d = await v16Device();
    const { caps, nouns } = await d.getCsCaps();
    expect(caps.capsVersion).toBe(3);
    expect(caps.maxBindings).toBe(16);
    // type_count-driven body: 8 types (NONE..IR), each read from the tail
    // that follows the dynamically-sized type table.
    expect(caps.types).toHaveLength(8);
    expect(caps.types[CsType.Encoder].pinCount).toBe(2);
    expect(caps.types[CsType.Pot].pinClass).toBe(1);
    expect(caps.types[CsType.LedPwm].actions & (1 << CsAction.IndLevel)).toBeTruthy();
    expect(caps.maxIrCommands).toBe(8);
    expect(nouns).toHaveLength(35);
    expect(nouns[CsNoun.MasterVolume].minQ8).toBe(dbToQ8(-127));
    expect(nouns[CsNoun.Preset].enumCount).toBe(10);
    expect(nouns[CsNoun.FilterFreq].targetCount).toBe(d.hardware.totalChannelCount);
    expect(nouns[CsNoun.Preamp].targetCount).toBe(d.hardware.inputs.length);
  });

  it('applies an encoder binding through the deferred poll, dirties the live config, and round-trips it', async () => {
    const d = await v16Device();
    // GP21/22 are collision-free on the default mock layout (outputs 6-10,
    // I2S RX pair 0 on GPIO 1, clocks idle).
    const { result, status } = await d.setCsBinding(2, encoderBinding);
    expect(result.ok).toBe(true);
    expect(status.lastStatus).toBe(0x00);
    expect(status.lastSlot).toBe(2);
    expect(status.activeMask & (1 << 2)).toBeTruthy();
    expect(status.dirty).toBe(true);
    expect(await d.getCsBinding(2)).toEqual(encoderBinding);
  });

  it('rejects an action outside the type∩noun mask with INVALID_ACTION', async () => {
    const d = await v16Device();
    const { result } = await d.setCsBinding(0, {
      ...encoderBinding, noun: CsNoun.UserMute,   // bool noun takes no STEP
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CsStatusCode.InvalidAction);
    expect((await d.getCsBinding(0)).type).toBe(CsType.None);
  });

  it('rejects a bad button event with INVALID_EVENT', async () => {
    const d = await v16Device();
    const { result } = await d.setCsBinding(0, {
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle,
      flags: 0, gpio0: 20, gpio1: null, event: 3 as CsEvent, target: 0, index: 0,
      value: 0, step: 0, rangeMin: 0, rangeMax: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CsStatusCode.InvalidEvent);
  });

  it('rejects a pot on a non-ADC pin with PIN_NOT_ADC; accepts it on GP26', async () => {
    const d = await v16Device();
    const pot = {
      type: CsType.Pot, noun: CsNoun.UserVolume, action: CsAction.Adjust,
      flags: 0, gpio0: 20, gpio1: null, event: CsEvent.Press, target: 0, index: 0,
      value: 0, step: 0, rangeMin: 0, rangeMax: 0,
    };
    const bad = await d.setCsBinding(1, pot);
    expect(bad.result.ok).toBe(false);
    if (!bad.result.ok) expect(bad.result.code).toBe(CsStatusCode.PinNotAdc);

    const good = await d.setCsBinding(1, { ...pot, gpio0: 26 });
    expect(good.result.ok).toBe(true);
  });

  it('rejects a pin already claimed by an output with PIN_IN_USE', async () => {
    const d = await v16Device();
    const { result } = await d.setCsBinding(0, { ...encoderBinding, gpio0: 6 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PinConfigResult.PinInUse);
  });

  it('two button bindings share one GPIO on distinct events, but not the same event twice', async () => {
    const d = await v16Device();
    const press = {
      type: CsType.Button, noun: CsNoun.UserMute, action: CsAction.Toggle,
      flags: 0, gpio0: 20, gpio1: null, event: CsEvent.Press, target: 0, index: 0,
      value: 0, step: 0, rangeMin: 0, rangeMax: 0,
    };
    const long = { ...press, noun: CsNoun.Loudness, event: CsEvent.Long };
    expect((await d.setCsBinding(0, press)).result.ok).toBe(true);
    expect((await d.setCsBinding(1, long)).result.ok).toBe(true);

    const clash = await d.setCsBinding(2, { ...press, noun: CsNoun.Crossfeed });
    expect(clash.result.ok).toBe(false);
    if (!clash.result.ok) expect(clash.result.code).toBe(CsStatusCode.EventInUse);
  });

  it('a configured single-pin binding rides the 0xFF second-pin sentinel; clear stores the zero blob', async () => {
    const d = await v16Device();
    const led = {
      type: CsType.Led, noun: CsNoun.Loudness, action: CsAction.IndEquals,
      flags: 0, gpio0: 20, gpio1: null, event: CsEvent.Press, target: 0, index: 0,
      value: 1, step: 0, rangeMin: 0, rangeMax: 0,
    };
    await d.setCsBinding(6, led);
    // 0xFF on the wire maps back to null (unused second pin).
    expect((await d.getCsBinding(6)).gpio1).toBeNull();

    await d.clearCsBinding(6);
    // Cleared slot round-trips as the all-zero blob: gpio1 reads 0, not null.
    expect(await d.getCsBinding(6)).toEqual(EMPTY_CS_BINDING);
    expect(EMPTY_CS_BINDING.gpio1).toBe(0);
  });

  it('clearCsBinding releases the slot and its pins', async () => {
    const d = await v16Device();
    await d.setCsBinding(3, encoderBinding);
    const { result, status } = await d.clearCsBinding(3);
    expect(result.ok).toBe(true);
    expect(status.activeMask & (1 << 3)).toBe(0);
    // The freed pin is claimable by another slot again.
    const reclaim = await d.setCsBinding(4, encoderBinding);
    expect(reclaim.result.ok).toBe(true);
  });

  it('sets and reads back a slot name through the deferred poll', async () => {
    const d = await v16Device();
    expect(await d.getCsName(5)).toBe('');
    const { result, status } = await d.setCsName(5, 'Sub Level');
    expect(result.ok).toBe(true);
    expect(status.lastSlot).toBe(5);
    expect(status.dirty).toBe(true);
    expect(await d.getCsName(5)).toBe('Sub Level');
  });

  it('csSave persists the live preview (last_slot 0xFF) and clears dirty', async () => {
    const d = await v16Device();
    await d.setCsBinding(2, encoderBinding);
    const before = await d.getCsStatus();
    expect(before.dirty).toBe(true);

    const { result, status } = await d.csSave();
    expect(result.ok).toBe(true);
    expect(status.lastSlot).toBe(0xFF);
    expect(status.dirty).toBe(false);
  });

  it('csRevert restores the last-saved bindings and discards a un-saved preview', async () => {
    const d = await v16Device();
    await d.setCsBinding(2, encoderBinding);
    await d.csSave();
    await d.clearCsBinding(2);   // live-only preview: clears the slot without saving
    expect((await d.getCsBinding(2)).type).toBe(CsType.None);

    const { result, status } = await d.csRevert();
    expect(result.ok).toBe(true);
    expect(status.lastSlot).toBe(0xFF);
    expect(status.dirty).toBe(false);
    expect(await d.getCsBinding(2)).toEqual(encoderBinding);
  });

  it('surfaces a concurrent csSave as the BUSY result (firmware STALLs, not a byte)', async () => {
    const raw = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: FW_115 });
    const d = await DspDevice.create(raw);
    // Arm a pending save behind the device's back so the next csSave hits
    // the firmware's stall path instead of the poll-drained happy path.
    const first = await raw.ctrlIn(WireCmd.CsSave.code, 0, 1);
    expect(first[0]).toBe(1);
    const { result } = await d.csSave();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CsStatusCode.Busy);
  });
});

describe('DspDevice — V16 Control Surfaces IR commands (0x8D-0x8F)', () => {
  const irReceiver = {
    type: CsType.Ir, noun: CsNoun.UserVolume, action: CsAction.Adjust,
    flags: 0, gpio0: 20, gpio1: null, event: CsEvent.Press, target: 0, index: 0,
    value: 0, step: 0, rangeMin: 0, rangeMax: 0,
  };
  const necToggle = {
    noun: CsNoun.UserMute, action: CsAction.Toggle, flags: 0, target: 0, index: 0,
    protocol: CsIrProto.Nec, value: 0, step: 0, code: 0x12345678,
  };

  it('setCsIrCmd/getCsIrCmd round-trip an accepted command (last_slot 0x80|sub)', async () => {
    const d = await v16Device();
    const { result, status } = await d.setCsIrCmd(2, necToggle);
    expect(result.ok).toBe(true);
    expect(status.lastSlot).toBe(0x80 | 2);
    expect(await d.getCsIrCmd(2)).toEqual(necToggle);
  });

  it('a rejected IR command leaves the sub-slot empty and surfaces the failure status', async () => {
    const d = await v16Device();
    // ADJUST isn't in the IR button subset (INC/DEC/TOGGLE/SET/TRIGGER/MOMENTARY).
    const { result } = await d.setCsIrCmd(0, { ...necToggle, action: CsAction.Adjust });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CsStatusCode.InvalidAction);
    expect((await d.getCsIrCmd(0)).protocol).toBe(CsIrProto.None);
  });

  it('clearing a sub-slot is a SET of the all-zero command', async () => {
    const d = await v16Device();
    await d.setCsIrCmd(3, necToggle);
    const { result } = await d.setCsIrCmd(3, EMPTY_CS_IR_COMMAND);
    expect(result.ok).toBe(true);
    expect(await d.getCsIrCmd(3)).toEqual(EMPTY_CS_IR_COMMAND);
  });

  it('csIrLearnArm succeeds with a live IR receiver binding; csIrLearnResult reads back a completed learn', async () => {
    const raw = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: FW_115 });
    const d = await DspDevice.create(raw);
    await d.setCsBinding(0, irReceiver);
    const arm = await d.csIrLearnArm();
    expect(arm.ok).toBe(true);
    raw.mockCompleteIrLearn(CsIrProto.Rc5, 0xABCD);
    const result = await d.csIrLearnResult();
    expect(result).toEqual({ state: CS_IR_LEARN_DONE, protocol: CsIrProto.Rc5, code: 0xABCD });
  });

  it('csIrLearnArm fails with NO_IR when no live IR receiver exists', async () => {
    const d = await v16Device();
    const arm = await d.csIrLearnArm();
    expect(arm.ok).toBe(false);
    if (!arm.ok) expect(arm.code).toBe(CsStatusCode.NoIr);
  });

  it('csIrLearnCancel returns learn state to idle', async () => {
    const raw = new MockTransport({ platform: 'rp2350', wireVersion: 16, fwVersion: FW_115 });
    const d = await DspDevice.create(raw);
    await d.setCsBinding(0, irReceiver);
    await d.csIrLearnArm();
    await d.csIrLearnCancel();
    expect((await d.csIrLearnResult()).state).toBe(CS_IR_LEARN_IDLE);
  });

  it('a second live IR receiver binding is rejected with IR_IN_USE', async () => {
    const d = await v16Device();
    await d.setCsBinding(0, irReceiver);
    const { result } = await d.setCsBinding(1, { ...irReceiver, gpio0: 21 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CsStatusCode.IrInUse);
  });
});

describe('notify — INPUT_FORMAT (0x05)', () => {
  it('decodes the v2 input-format packet', () => {
    const e = parseNotifyPacket(new Uint8Array([2, 0x05, 0, 7, 6, 0, 0, 0]));
    expect(e).toEqual({ kind: 'inputFormat', seq: 7, channels: 6 });
  });
});

describe('notify — CS_IR_LEARN (0x0A)', () => {
  it('decodes a done packet with protocol and code', () => {
    const e = parseNotifyPacket(new Uint8Array([2, 0x0A, 0, 9, 2, 1, 0, 0, 0x78, 0x56, 0x34, 0x12]));
    expect(e).toEqual({ kind: 'csIrLearn', seq: 9, state: CS_IR_LEARN_DONE, protocol: CsIrProto.Nec, code: 0x12345678 });
  });

  it('decodes a timeout packet with protocol/code zeroed', () => {
    const e = parseNotifyPacket(new Uint8Array([2, 0x0A, 0, 10, 3, 0, 0, 0, 0, 0, 0, 0]));
    expect(e).toEqual({ kind: 'csIrLearn', seq: 10, state: 3, protocol: 0, code: 0 });
  });

  it('ignores a short packet rather than misreading it', () => {
    const e = parseNotifyPacket(new Uint8Array([2, 0x0A, 0, 9, 2, 1, 0, 0]));
    expect(e).toEqual({ kind: 'ignored' });
  });
});
