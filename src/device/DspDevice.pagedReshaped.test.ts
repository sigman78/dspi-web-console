import { describe, it, expect } from 'vitest';
import { DspDevice } from './DspDevice';
import { MockTransport } from '@/transport/MockTransport';
import { resolveMockProfile } from '@/mockProfiles';
import * as Domain from '@/domain';
import * as proto from '@/protocol';
import { PagedCmd, VcResult } from '@/protocol/paged.gen';
import { UntranslatedCommand } from '@/protocol/legacyTranslate';
import { Codec } from '@/utils';
import type { DspTransport } from '@/transport/DspTransport';
import { withGenerationGuard } from '@/transport/withGenerationGuard';
import { withLegacyTranslation } from '@/transport/withLegacyTranslation';
import { withSerializedCtrl, type SerializedDspTransport } from '@/transport/withSerializedCtrl';

type Chip = 'rp2350' | 'rp2040';
const CHIPS: Chip[] = ['rp2350', 'rp2040'];

function mockFor(token: 'latest' | 'v34', chip: Chip): MockTransport {
  const profile = resolveMockProfile(token, chip);
  return new MockTransport({ platform: profile.platform, ...profile.opts });
}

async function connect(token: 'latest' | 'v34', chip: Chip): Promise<DspDevice> {
  return DspDevice.create(mockFor(token, chip));
}

// Both generations of the same chip, so a call can be compared across them.
async function pair(chip: Chip) {
  const [legacy, paged] = await Promise.all([connect('latest', chip), connect('v34', chip)]);
  return { legacy, paged };
}

interface Sent { cmd: number; value: number; data: Uint8Array }

// Records every OUT the device sends to `inner`.
function recording(inner: MockTransport): { transport: DspTransport; outs: Sent[] } {
  const outs: Sent[] = [];
  const transport: DspTransport = {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event, listener) => inner.on(event, listener),
    ctrlIn: (cmd, value, length) => inner.ctrlIn(cmd, value, length),
    ctrlOut: (cmd, value, data) => { outs.push({ cmd, value, data: data.slice() }); return inner.ctrlOut(cmd, value, data); },
  };
  return { transport, outs };
}

// Connects the way DspDevice.create does, but keeps the serialized transport reachable.
class Exposed extends DspDevice {
  static async connect(inner: DspTransport): Promise<Exposed> {
    const guarded = withGenerationGuard(inner);
    const serialized = withSerializedCtrl(withLegacyTranslation(guarded));
    return new Exposed(serialized, await Exposed.resolveInfo(serialized, guarded));
  }
  get wire(): SerializedDspTransport { return this.transport; }
}

async function refusal(p: Promise<unknown>): Promise<proto.CommandRefused> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(proto.CommandRefused);
  return err as proto.CommandRefused;
}

const EQ = (over: Partial<Domain.FilterParams> = {}): Domain.FilterParams => ({
  type: Domain.FilterType.Peaking, bypass: false, frequency: 1234, q: 2.5, gain: -4.5, ...over,
});

describe.each(CHIPS)('reshaped reads on a paged device match a 1.1.6 device (%s)', (chip) => {
  it('getSystemStatus', async () => {
    const { legacy, paged } = await pair(chip);
    const [l, p] = await Promise.all([legacy.getSystemStatus(), paged.getSystemStatus()]);
    expect([p.cpu0, p.cpu1, p.clipFlags, p.activeInputChannels]).toEqual([l.cpu0, l.cpu1, l.clipFlags, l.activeInputChannels]);
    expect(p.peaks.length).toBe(l.peaks.length);
  });

  it('getSystemInfo', async () => {
    const { legacy, paged } = await pair(chip);
    const info = await paged.getSystemInfo();
    expect(info).toEqual(await legacy.getSystemInfo());
    expect(info.tempCDegC).toBe(4210);
  });

  it('getRingHealth', async () => {
    const { legacy, paged } = await pair(chip);
    const health = await paged.getRingHealth();
    expect(health).toEqual(await legacy.getRingHealth());
    expect(Object.values(health).every((v) => v !== null)).toBe(true);
  });

  it('getInputRate', async () => {
    const { legacy, paged } = await pair(chip);
    expect(await paged.getInputRate()).toEqual(await legacy.getInputRate());
  });

  it('getPresetStartup', async () => {
    const { legacy, paged } = await pair(chip);
    expect(await paged.getPresetStartup()).toEqual(await legacy.getPresetStartup());
  });

  it('getCsDisplayCfg', async () => {
    const { legacy, paged } = await pair(chip);
    expect(await paged.getCsDisplayCfg()).toEqual(await legacy.getCsDisplayCfg());
  });

  it('getSpdifInputConfig', async () => {
    const { legacy, paged } = await pair(chip);
    expect(await paged.getSpdifInputConfig()).toEqual(await legacy.getSpdifInputConfig());
  });

  it('getMatrixRoute on every crosspoint of the default state', async () => {
    const { legacy, paged } = await pair(chip);
    const slots = paged.hardware.inputChannels.length;
    const outs = paged.hardware.outputCount;
    for (let i = 0; i < slots; i++) {
      for (let o = 0; o < outs; o++) {
        const slot = o as Domain.OutputSlot;
        expect(await paged.getMatrixRoute(i, slot)).toEqual(await legacy.getMatrixRoute(i, slot));
      }
    }
  });

  it('getFilter on every channel, PEQ and crossover bands', async () => {
    const { legacy, paged } = await pair(chip);
    for (const ch of paged.hardware.channels.map((c) => c.id)) {
      const bands = paged.hardware.outputChannels.includes(ch) ? [0, 4, 9, 20, 23] : [0, 4, 9];
      for (const band of bands) expect(await paged.getFilter(ch, band)).toEqual(await legacy.getFilter(ch, band));
    }
  });
});

describe.each(CHIPS)('reshaped writes on a paged device leave the state a 1.1.6 device would (%s)', (chip) => {
  const outCh = Domain.ChannelId.Out1L;

  it('setFilter: every filter type, then reads and the snapshot agree', async () => {
    const { legacy, paged } = await pair(chip);
    const types = [Domain.FilterType.Peaking, Domain.FilterType.LowShelf, Domain.FilterType.HighPass, Domain.FilterType.Notch];
    for (const [i, type] of types.entries()) {
      for (const d of [legacy, paged]) await d.setFilter(outCh, i, EQ({ type, frequency: 100 * (i + 1) }));
      expect(await paged.getFilter(outCh, i)).toEqual(await legacy.getFilter(outCh, i));
    }
    expect((await paged.getSnapshot()).channels).toEqual((await legacy.getSnapshot()).channels);
  });

  it('setFilter: a Linkwitz Transform band keeps its Qp, on the PDM channel too', async () => {
    const { legacy, paged } = await pair(chip);
    const lt = EQ({ type: Domain.FilterType.LinkwitzTransform, frequency: 55, q: 0.7, gain: 40, qp: 0.9 });
    for (const d of [legacy, paged]) await d.setFilter(Domain.ChannelId.Pdm, 2, lt);
    const read = await paged.getFilter(Domain.ChannelId.Pdm, 2);
    expect(read.qp).toBeCloseTo(0.9, 2);
    expect(read).toEqual(await legacy.getFilter(Domain.ChannelId.Pdm, 2));
  });

  it('setFilter: a crossover band', async () => {
    const { legacy, paged } = await pair(chip);
    const xo = EQ({ type: Domain.XOVER_TYPE_FIRST, frequency: 2500, q: 0.707, gain: 0 });
    for (const d of [legacy, paged]) await d.setCrossoverBand(outCh, 1, xo);
    expect(await paged.getCrossoverBand(outCh, 1)).toEqual(await legacy.getCrossoverBand(outCh, 1));
  });

  it('setBandBypass then setFilter keeps a bypassed band bypassed when the caller passes it', async () => {
    const { paged } = await pair(chip);
    await paged.setBandBypass(outCh, 3, true);
    expect((await paged.getFilter(outCh, 3)).bypass).toBe(true);
    await paged.setFilter(outCh, 3, EQ({ bypass: true, frequency: 777 }));
    expect(await paged.getFilter(outCh, 3)).toMatchObject({ bypass: true, frequency: 777 });
    await paged.setFilter(outCh, 3, EQ({ bypass: false }));
    expect((await paged.getFilter(outCh, 3)).bypass).toBe(false);
  });

  it('setMatrixRoute', async () => {
    const { legacy, paged } = await pair(chip);
    const route = { enabled: true, invert: true, gainDb: -3.5 };
    for (const d of [legacy, paged]) await d.setMatrixRoute(1, 2, route);
    expect(await paged.getMatrixRoute(1, 2)).toEqual(route);
    expect((await paged.getSnapshot()).routes).toEqual((await legacy.getSnapshot()).routes);
  });

  it('setMasterPreamp reaches every input channel', async () => {
    const { legacy, paged } = await pair(chip);
    for (const d of [legacy, paged]) await d.setMasterPreamp(-7.5);
    expect(await paged.getMasterPreamp()).toBe(-7.5);
    for (let i = 0; i < paged.hardware.inputChannels.length; i++) {
      expect(await paged.getInputPreamp(i)).toBe(await legacy.getInputPreamp(i));
    }
  });

  it('setPresetStartup', async () => {
    const { legacy, paged } = await pair(chip);
    for (const d of [legacy, paged]) await d.setPresetStartup({ mode: 1, slot: 4 });
    expect(await paged.getPresetStartup()).toEqual({ mode: 1, slot: 4 });
    expect(await paged.getPresetDirectory()).toEqual(await legacy.getPresetDirectory());
  });

  it('setInputRate', async () => {
    const { legacy, paged } = await pair(chip);
    for (const d of [legacy, paged]) await d.setInputRate(96000);
    expect(await paged.getInputRate()).toEqual(await legacy.getInputRate());
    expect((await paged.getInputRate()).selectedHz).toBe(96000);
  });

  it('clearClips', async () => {
    const { legacy, paged } = await pair(chip);
    expect((await paged.getSystemStatus()).clipFlags).not.toBe(0);
    for (const d of [legacy, paged]) await d.clearClips();
    expect((await paged.getSystemStatus()).clipFlags).toBe(0);
    expect((await legacy.getSystemStatus()).clipFlags).toBe(0);
  });
});

describe('the input blocks on a paged device', () => {
  const wireByte = async (d: Exposed, id: number) => (await proto.pagedGet(d.wire, id, 0, 1))[0];

  it('setSpdifInputCount is one SPDIF_RX_COUNT SET, and the bulk read carries the V34 count', async () => {
    const { transport, outs } = recording(mockFor('v34', 'rp2350'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    expect((await d.setSpdifInputCount(3)).ok).toBe(true);
    expect(outs.map((o) => [o.cmd, o.data[0]])).toEqual([[PagedCmd.INPUT.SPDIF_RX_COUNT.id, 3]]);
    expect((await d.getAllParams()).inputConfig.blocks?.spdifRxCount).toBe(3);
  });

  it('a fresh device refuses I2S as the source until its block is on', async () => {
    const d = await Exposed.connect(mockFor('v34', 'rp2350'));
    expect((await refusal(d.setInputSource(Domain.AudioInputSource.I2s))).reason).toBe('state');
    expect((await d.setI2sInputEnabled(true)).ok).toBe(true);
    expect(await wireByte(d, PagedCmd.INPUT.I2S_RX_ENABLE.id)).toBe(1);
    await d.setInputSource(Domain.AudioInputSource.I2s);
    expect(await d.getInputSource()).toBe(Domain.AudioInputSource.I2s);
  });

  it('switching a block off under its live source is refused', async () => {
    const d = await Exposed.connect(mockFor('v34', 'rp2350'));
    await d.setI2sInputEnabled(true);
    await d.setInputSource(Domain.AudioInputSource.I2s);
    await expect(d.setI2sInputEnabled(false)).resolves.toMatchObject({ ok: false });
  });

  it('a count below the live S/PDIF input is refused, and a pin refusal maps to its status', async () => {
    const mock = mockFor('v34', 'rp2350');
    const d = await DspDevice.create(mock);
    await d.setSpdifInputCount(3);
    await d.setInputSource(Domain.AudioInputSource.Spdif3);
    expect((await d.setSpdifInputCount(2)).ok).toBe(false);
    mock.injectRefusal(PagedCmd.INPUT.SPDIF_RX_COUNT.id, VcResult.VC_ERR_PIN_IN_USE);
    const r = await d.setSpdifInputCount(4);
    expect(r.ok ? null : r.code).toBe(proto.PinConfigResult.PinInUse);
  });

  it('a 1.1.6 device has no block switches', async () => {
    const legacy = await connect('latest', 'rp2350');
    await expect(legacy.setSpdifBlockEnabled(true)).rejects.toThrow('needs paged firmware');
    await expect(legacy.setI2sInputEnabled(true)).rejects.toThrow('needs paged firmware');
  });
});

describe('what the device sends', () => {
  it('writes an EQ band as 16 bytes at (wire channel << 8) | band, Qp included', async () => {
    const { transport, outs } = recording(mockFor('v34', 'rp2350'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    await d.setFilter(Domain.ChannelId.Out2L, 7, EQ({ type: Domain.FilterType.LinkwitzTransform, frequency: 50, q: 0.5, gain: 30, qp: 1 }));
    const wireCh = d.hardware.wireChannelByUiChannel[Domain.ChannelId.Out2L]!;
    expect(outs).toHaveLength(1);
    expect(outs[0].cmd).toBe(PagedCmd.FILTER.BAND.id);
    expect(outs[0].value).toBe((wireCh << 8) | 7);
    const qp = Domain.encodeQp(1);
    expect([...outs[0].data.slice(0, 4)]).toEqual([Domain.FilterType.LinkwitzTransform, 0, qp & 0xFF, qp >> 8]);
    expect(outs[0].data).toHaveLength(16);
  });

  it('sends the Qp as 0 for a band that is not a Linkwitz Transform', async () => {
    const { transport, outs } = recording(mockFor('v34', 'rp2350'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    await d.setFilter(Domain.ChannelId.Out1L, 0, EQ({ qp: 0.9 }));
    expect([...outs[0].data.slice(2, 4)]).toEqual([0, 0]);
  });

  it('sends one preamp write per input channel', async () => {
    const { transport, outs } = recording(mockFor('v34', 'rp2350'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    await d.setMasterPreamp(-2);
    expect(outs.map((o) => [o.cmd, o.value])).toEqual(
      Array.from({ length: 8 }, (_, i) => [PagedCmd.ROUTE.PREAMP.id, i]),
    );
  });

  it('clears the clip flags with one zero-length SET and no read', async () => {
    const { transport, outs } = recording(mockFor('v34', 'rp2040'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    await d.clearClips();
    expect(outs).toEqual([{ cmd: PagedCmd.MEAS.CLIP_CLEAR.id, value: 0, data: new Uint8Array(0) }]);
  });

  it('reads each status struct once for one getSystemInfo', async () => {
    const mock = mockFor('v34', 'rp2350');
    const ins: number[] = [];
    const t: DspTransport = {
      open: () => mock.open(), close: () => mock.close(), isOpen: () => mock.isOpen(), on: (e, l) => mock.on(e, l),
      ctrlIn: (c, v, l) => { ins.push(c); return mock.ctrlIn(c, v, l); },
      ctrlOut: (c, v, d) => mock.ctrlOut(c, v, d),
    };
    const d = await DspDevice.create(t);
    ins.length = 0;
    await d.getSystemInfo();
    expect(ins.sort()).toEqual([PagedCmd.SYS.SYSTEM_STATUS.id, PagedCmd.SYS.PDM_STATS.id, PagedCmd.SYS.SPDIF_TX_STATS.id].sort());
  });
});

describe('refusals surface as CommandRefused', () => {
  it.each([
    ['a band in the 10 to 19 gap', (d: DspDevice) => d.setFilter(Domain.ChannelId.Out1L, 15, EQ()), 'address'],
    ['a crossover band on an input channel', (d: DspDevice) => d.setCrossoverBand(Domain.ChannelId.In1L, 0, EQ({ type: Domain.XOVER_TYPE_FIRST })), 'address'],
    ['reading a band in the gap', (d: DspDevice) => d.getFilter(Domain.ChannelId.Out1L, 12), 'address'],
    ['a non-finite frequency', (d: DspDevice) => d.setFilter(Domain.ChannelId.Out1L, 0, EQ({ frequency: Number.NaN })), 'value'],
    ['a crosspoint past the inputs', (d: DspDevice) => d.setMatrixRoute(2, 0, { enabled: true, invert: false, gainDb: 0 }), 'address'],
    ['a crosspoint past the outputs', (d: DspDevice) => d.getMatrixRoute(0, 5), 'address'],
    ['a non-finite crosspoint gain', (d: DspDevice) => d.setMatrixRoute(0, 0, { enabled: true, invert: false, gainDb: Number.POSITIVE_INFINITY }), 'value'],
    ['an I2S rate the device does not know', (d: DspDevice) => d.setInputRate(12345), 'value'],
  ] as const)('%s', async (_what, run, reason) => {
    const d = await connect('v34', 'rp2040');
    expect((await refusal(run(d))).reason).toBe(reason);
  });

  it('a busy band write is resent until the device takes it', async () => {
    const mock = mockFor('v34', 'rp2350');
    const d = await DspDevice.create(mock);
    mock.injectRefusal(PagedCmd.FILTER.BAND.id, VcResult.VC_ERR_BUSY, 3);
    await d.setFilter(Domain.ChannelId.Out1L, 2, EQ({ frequency: 999 }));
    expect((await d.getFilter(Domain.ChannelId.Out1L, 2)).frequency).toBe(999);
  });

  it('a band write that stays busy is refused as busy', async () => {
    const mock = mockFor('v34', 'rp2350');
    const d = await DspDevice.create(mock);
    mock.injectRefusal(PagedCmd.FILTER.BAND.id, VcResult.VC_ERR_BUSY, 1000);
    expect((await refusal(d.setFilter(Domain.ChannelId.Out1L, 2, EQ()))).reason).toBe('busy');
  });
});

describe('no console call reaches an untranslated command on a paged device', () => {
  // Every DspDevice method that threw UntranslatedCommand on a paged connection before the reshaped commands.
  const CALLS: [string, (d: DspDevice) => Promise<unknown>][] = [
    ['getSystemStatus', (d) => d.getSystemStatus()],
    ['getSystemInfo', (d) => d.getSystemInfo()],
    ['getRingHealth', (d) => d.getRingHealth()],
    ['clearClips', (d) => d.clearClips()],
    ['setMasterPreamp', (d) => d.setMasterPreamp(-1)],
    ['setFilter', (d) => d.setFilter(Domain.ChannelId.Out1L, 0, EQ())],
    ['getFilter', (d) => d.getFilter(Domain.ChannelId.Out1L, 0)],
    ['setMatrixRoute', (d) => d.setMatrixRoute(0, 0, { enabled: true, invert: false, gainDb: 0 })],
    ['getMatrixRoute', (d) => d.getMatrixRoute(0, 0)],
    ['getPresetStartup', (d) => d.getPresetStartup()],
    ['setPresetStartup', (d) => d.setPresetStartup({ mode: 0, slot: 0 })],
    ['getInputRate', (d) => d.getInputRate()],
    ['setInputRate', (d) => d.setInputRate(48000)],
    ['getCsDisplayCfg', (d) => d.getCsDisplayCfg()],
    ['setSpdifInputCount', (d) => d.setSpdifInputCount(2)],
    ['setSpdifBlockEnabled', (d) => d.setSpdifBlockEnabled(true)],
    ['setI2sInputEnabled', (d) => d.setI2sInputEnabled(true)],
    ['getSpdifInputConfig', (d) => d.getSpdifInputConfig()],
  ];

  it.each(CHIPS)('%s', async (chip) => {
    const d = await connect('v34', chip);
    for (const [name, run] of CALLS) {
      const err = await run(d).then(() => null, (e: unknown) => e);
      expect(err instanceof UntranslatedCommand, name).toBe(false);
      if (err instanceof proto.CommandRefused) expect(err.reason, name).not.toBe('unsupported');
    }
  });
});

describe('the paged struct layouts', () => {
  const bytes = (...v: number[]) => Uint8Array.from(v);

  it('FILTER.BAND is type, bypass, Qp x 512, then frequency, Q and gain', () => {
    const wire = bytes(
      0x0B, 0x01, 0x00, 0x04,
      0x00, 0x00, 0x7A, 0x44,   // 1000 Hz
      0x00, 0x00, 0x80, 0x3F,   // Q 1
      0x00, 0x00, 0xC0, 0xC0,   // -6 dB
    );
    expect(Codec.decode(proto.Cmd.EqBand.codec, wire)).toEqual({ type: 11, bypass: 1, qp: 0x0400, frequency: 1000, q: 1, gain: -6 });
    expect(Codec.encode(proto.Cmd.EqBand.codec, { type: 11, bypass: 1, qp: 0x0400, frequency: 1000, q: 1, gain: -6 })).toEqual(wire);
  });

  it('ROUTE.MATRIX_ROUTE is enabled, invert, two reserved bytes, then the gain', () => {
    const wire = bytes(0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0xC1);   // -10 dB
    expect(Codec.decode(proto.Cmd.Crosspoint.codec, wire)).toEqual({ enabled: true, phaseInvert: false, gainDb: -10 });
    expect(Codec.encode(proto.Cmd.Crosspoint.codec, { enabled: true, phaseInvert: false, gainDb: -10 })).toEqual(wire);
  });

  it('SYS.SYSTEM_STATUS puts the sample rate at 4, the voltage at 8, the temperature at 10 and the loads at 12', () => {
    const wire = bytes(
      0x00, 0x20, 0xA1, 0x07,   // 128 MHz
      0x80, 0xBB, 0x00, 0x00,   // 48000 Hz
      0xE4, 0x0C,               // 3300 mV
      0x18, 0xFC,               // -1000 (centi-C)
      25, 12, 0, 0,
    );
    expect(Codec.decode(proto.Cmd.SystemStatus.codec, wire)).toEqual({
      clockHz: 128_000_000, sampleRateHz: 48_000, coreVoltageMv: 3300, tempCDegC: -1000, cpu0: 25, cpu1: 12,
    });
  });

  it('SYS.USB_AUDIO_STATUS carries the worst gap at 8 and the alt setting and mounted flag at 12 and 13', () => {
    const wire = bytes(1, 0, 0, 0, 2, 0, 0, 0, 0x10, 0x04, 0, 0, 3, 1, 0, 0);
    expect(Codec.decode(proto.Cmd.UsbAudioStatus.codec, wire)).toEqual({
      packets: 1, ringOverruns: 2, worstGapUs: 1040, altSetting: 3, mounted: 1,
    });
  });

  it('SYS.PIPELINE_STATS ends with five counters and a reserved word', () => {
    const wire = bytes(1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0);
    expect(Codec.decode(proto.Cmd.PipelineStats.codec, wire)).toEqual({
      underrunEpisodes: 1, blocksRefused: 2, lowestFillFrames: 3, inputGapWorstUs: 4, backgroundOverBudget: 5,
    });
  });

  it('SYS.SPDIF_TX_STATS is the gap count, the starvation total and four slots', () => {
    const wire = bytes(9, 0, 0, 0, 8, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0);
    expect(Codec.decode(proto.Cmd.SpdifTxStats.codec, wire)).toEqual({ spdifUnderruns: 9, starvationsTotal: 8, slotStarvations: [1, 2, 3, 4] });
  });

  it('SYS.PDM_STATS is four counters', () => {
    expect(Codec.decode(proto.Cmd.PdmStats.codec, bytes(1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0)))
      .toEqual({ ringOverruns: 1, ringUnderruns: 2, dmaOverruns: 3, dmaUnderruns: 4 });
  });

  it('INPUT.STATUS has the source, channel count, S/PDIF rate in mHz at 4 and the signed trim at 8', () => {
    const wire = bytes(2, 4, 0, 0, 0x00, 0x6C, 0xDC, 0x02, 0xF6, 0xFF, 0xFF, 0xFF);   // 48 kHz = 48_000_000 mHz
    expect(Codec.decode(proto.Cmd.InputStatus.codec, wire)).toEqual({
      source: 2, channels: 4, spdifRateMhz: 48_000_000, clockTrimPpm100: -10,
    });
  });

  it('INPUT.SPDIF_RX_CONFIG is limit, block switch, block count and four pins', () => {
    expect(Codec.decode(proto.Cmd.SpdifRxConfig.codec, bytes(4, 1, 3, 11, 12, 13, 14)))
      .toEqual({ limit: 4, enabled: 1, count: 3, pins: [11, 12, 13, 14] });
  });

  it('CS.DISPLAY_CAPS is the page count, the model count and two reserved bytes', () => {
    expect(Codec.decode(proto.Cmd.CsDisplayCaps.codec, bytes(16, 9, 0, 0))).toEqual({ maxPages: 16, modelCount: 9 });
  });
});

describe('a 1.1.6 band write carries the band bypass in byte 3', () => {
  it.each([[true, 1], [false, 0]])('plain 16-byte packet, bypass %s', async (bypass, byte) => {
    const { transport, outs } = recording(mockFor('latest', 'rp2350'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    await d.setFilter(Domain.ChannelId.Out1L, 4, EQ({ bypass }));
    expect(outs[0].cmd).toBe(proto.Cmd.EqParam.legacy.set);
    expect(outs[0].data).toHaveLength(16);
    const wireCh = d.hardware.wireChannelByUiChannel[Domain.ChannelId.Out1L]!;
    expect([...outs[0].data.slice(0, 4)]).toEqual([wireCh, 4, Domain.FilterType.Peaking, byte]);
    expect((await d.getFilter(Domain.ChannelId.Out1L, 4)).bypass).toBe(false);   // the per-param reader never reports it
    expect((await d.getSnapshot()).channels.find((c) => c.id === Domain.ChannelId.Out1L)!.filters[4].bypass).toBe(bypass);
  });

  it.each([[true, 1], [false, 0]])('18-byte Linkwitz packet, bypass %s', async (bypass, byte) => {
    const { transport, outs } = recording(mockFor('latest', 'rp2350'));
    const d = await DspDevice.create(transport);
    outs.length = 0;
    await d.setFilter(Domain.ChannelId.Out1L, 1, EQ({ type: Domain.FilterType.LinkwitzTransform, bypass, qp: 1 }));
    expect(outs[0].data).toHaveLength(18);
    const wireCh = d.hardware.wireChannelByUiChannel[Domain.ChannelId.Out1L]!;
    expect([...outs[0].data.slice(0, 4)]).toEqual([wireCh, 1, Domain.FilterType.LinkwitzTransform, byte]);
  });
});

describe('restoreState on a paged device', () => {
  it('sends the bulk as ALL_PARAMS_CHUNK SETs covering 6136 bytes from offset 0 in order, and the state follows', async () => {
    const source = await connect('v34', 'rp2350');
    const state = await source.captureState();
    const { transport, outs } = recording(mockFor('v34', 'rp2350'));
    const target = await DspDevice.create(transport);
    await target.setMasterVolume(-40);
    outs.length = 0;
    await target.restoreState(state);
    const chunks = outs.filter((o) => o.cmd === PagedCmd.STORE.ALL_PARAMS_CHUNK.id);
    expect(chunks.length).toBe(outs.length);
    let offset = 0;
    for (const c of chunks) {
      expect(c.value).toBe(offset);
      offset += c.data.length;
    }
    expect(offset).toBe(6136);
    expect((await target.getSnapshot()).masterVolumeDb).toBe((await source.getSnapshot()).masterVolumeDb);
  });
});
