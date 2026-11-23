// Paged commands the mock's front door serves itself, because no 1.1.6 opcode
// maps one-to-one onto them (the legacy adapter map calls these `custom`). Each
// reads or writes the mock's state through its 1.1.6 handlers and answers in the
// firmware's paged layout, with the firmware's address and value checks.

import * as proto from '@/protocol';
import { PagedCmd, VcResult } from '@/protocol/paged.gen';
import { Codec } from '@/utils';
import * as Domain from '@/domain';
import { TransportStall } from './DspTransport';

const Cmd = proto.Cmd;
const Wire = proto.Wire;

// A paged request the firmware would STALL, with its VC_ERR_* result code.
export class NativeRefusal extends Error {
  constructor(readonly vc: number) {
    super(`mock paged refusal ${vc}`);
    this.name = 'NativeRefusal';
  }
}

export interface NativeCommand {
  // False when wValue is outside the command's address space (VC_ERR_ADDRESS).
  address?(wValue: number): boolean;
  // The whole reply; the front door cuts it to the requested length.
  get?(wValue: number, length: number): Promise<Uint8Array>;
  set?(wValue: number, data: Uint8Array): Promise<void>;
}

export interface LegacyAccess {
  legacyIn(code: number, wValue: number, length: number): Promise<Uint8Array>;
  legacyOut(code: number, wValue: number, data: Uint8Array): Promise<void>;
  // The input block switches and S/PDIF count, which 1.1.6 has no handlers for.
  inputBlocks: {
    read(): proto.WireInputBlockState;
    write(patch: Partial<proto.WireInputBlockState>): void;
    // A switch to (enabled, count) would newly claim a pin another function holds.
    claimBlocked(enabled: boolean, count: number): boolean;
  };
}

const SPDIF_RX_LIMIT = Domain.SPDIF_RX_MAX_INSTANCES;
const BANDS_PEQ = 10;
const BAND_XOVER_FIRST = Domain.XOVER_BAND_BASE;
const BAND_XOVER_END = Domain.XOVER_BAND_BASE + Domain.MAX_XOVER_BANDS;

export function mockNativeCommands(legacy: LegacyAccess, rp2350: boolean): Map<number, NativeCommand> {
  const numIn = rp2350 ? 8 : 2;
  const numOut = rp2350 ? 9 : 5;
  const numCh = numIn + numOut;
  const V = proto.SystemStatusValue;
  const out = new Map<number, NativeCommand>();
  const add = (id: number, c: NativeCommand): void => { out.set(id, c); };

  const status = (selector: number, length = 4): Promise<Uint8Array> => legacy.legacyIn(Cmd.Status.legacy.get, selector, length);
  const u32 = async (selector: number): Promise<number> => Codec.decodePadded(Codec.u32, await status(selector));
  const i32 = async (selector: number): Promise<number> => Codec.decodePadded(Codec.i32, await status(selector));
  const levels = (): Promise<Uint8Array> => status(V.CombinedPeaks, proto.systemStatusSize(numCh));
  const f32Finite = (v: number): void => { if (!Number.isFinite(v)) throw new NativeRefusal(VcResult.VC_ERR_VALUE); };

  // ---- Status structs ----

  add(Cmd.SystemStatus.paged.get, {
    async get() {
      const lv = await levels();
      return Codec.encode(Cmd.SystemStatus.codec, {
        clockHz: await u32(V.ClockHz),
        sampleRateHz: await u32(V.SampleRateHz),
        coreVoltageMv: await u32(V.CoreVoltageMv),
        tempCDegC: await i32(V.TempCDegC),
        cpu0: lv[2 * numCh],
        cpu1: lv[2 * numCh + 1],
      });
    },
  });
  add(Cmd.UsbAudioStatus.paged.get, {
    async get() {
      return Codec.encode(Cmd.UsbAudioStatus.codec, {
        packets: await u32(10),
        ringOverruns: await u32(22),
        worstGapUs: await u32(V.UsbPacketGapWorstUs),
        altSetting: await u32(11),
        mounted: await u32(12),
      });
    },
  });
  add(Cmd.PipelineStats.paged.get, {
    async get() {
      return Codec.encode(Cmd.PipelineStats.codec, {
        underrunEpisodes: await u32(V.RingUnderrunEpisodes),
        blocksRefused: await u32(V.RingBlocksRefused),
        lowestFillFrames: await u32(V.RingLowestFill),
        inputGapWorstUs: await u32(V.InputGapWorstUs),
        backgroundOverBudget: await u32(V.BackgroundOverBudget),
      });
    },
  });
  add(Cmd.PdmStats.paged.get, {
    async get() {
      return Codec.encode(Cmd.PdmStats.codec, {
        ringOverruns: await u32(V.PdmRingOverruns),
        ringUnderruns: await u32(V.PdmRingUnderruns),
        dmaOverruns: await u32(V.PdmDmaOverruns),
        dmaUnderruns: await u32(V.PdmDmaUnderruns),
      });
    },
  });
  add(Cmd.SpdifTxStats.paged.get, {
    async get() {
      return Codec.encode(Cmd.SpdifTxStats.codec, {
        spdifUnderruns: await u32(V.SpdifUnderruns),
        starvationsTotal: await u32(V.SpdifStarvationsTotal),
        slotStarvations: [await u32(18), await u32(19), await u32(20), await u32(21)],
      });
    },
  });
  add(Cmd.InputStatus.paged.get, {
    async get() {
      const source = (await legacy.legacyIn(Cmd.InputSource.legacy.get, 0, 1))[0];
      return Codec.encode(Cmd.InputStatus.codec, {
        source,
        channels: await u32(V.ActiveInputChannels),
        spdifRateMhz: 0,
        clockTrimPpm100: 0,
      });
    },
  });
  add(Cmd.Levels.paged.get, { get: levels });

  // ---- Clip flags ----

  add(PagedCmd.MEAS.CLIP_FLAGS.id, {
    async get() { return (await levels()).slice(2 * numCh + 2, 2 * numCh + 6); },
  });
  add(Cmd.ClipClear.paged.set, {
    async set() { await legacy.legacyIn(Cmd.ClearClips.legacy.get, 0, 4); },
  });

  // ---- EQ band ----

  const bandAddress = (wValue: number): boolean => {
    const ch = wValue >> 8, band = wValue & 0xFF;
    if (ch >= numCh) return false;
    if (band < BANDS_PEQ) return true;
    return band >= BAND_XOVER_FIRST && band < BAND_XOVER_END && ch >= numIn;
  };
  add(Cmd.EqBand.paged.get, {
    address: bandAddress,
    async get(wValue) {
      const ch = wValue >> 8, band = wValue & 0xFF;
      const param = async (p: number) => legacy.legacyIn(Cmd.EqParamValue.legacy.get, (ch << 8) | (band << 3) | p, 4);
      const [type, freq, q, gain, bypass, qp] = await Promise.all([0, 1, 2, 3, 4, 5].map(param));
      return Codec.encode(Cmd.EqBand.codec, {
        type: Codec.decode(Codec.u32, type),
        bypass: Codec.decode(Codec.u32, bypass) === 1 ? 1 : 0,
        qp: band < BANDS_PEQ ? Codec.decode(Codec.u32, qp) & 0xFFFF : 0,
        frequency: Codec.decode(Codec.f32, freq),
        q: Codec.decode(Codec.f32, q),
        gain: Codec.decode(Codec.f32, gain),
      });
    },
    async set(wValue, data) {
      const ch = wValue >> 8, band = wValue & 0xFF;
      const b = Codec.decode(Cmd.EqBand.codec, data);
      f32Finite(b.frequency); f32Finite(b.q); f32Finite(b.gain);
      await legacy.legacyOut(Cmd.EqParam.legacy.set, 0, Codec.encode(Wire.SetFilterPacketQp, {
        channel: ch, band, type: b.type, bypass: b.bypass === 1 ? 1 : 0, frequency: b.frequency, q: b.q, gain: b.gain,
        qp: band < BANDS_PEQ ? b.qp : 0,
      }));
    },
  });

  // ---- Matrix ----

  add(Cmd.Crosspoint.paged.get, {
    address: (wValue) => (wValue >> 8) < numIn && (wValue & 0xFF) < numOut,
    async get(wValue) {
      const r = Codec.decode(Cmd.MatrixRoute.codec, await legacy.legacyIn(Cmd.MatrixRoute.legacy.get, wValue, 8));
      return Codec.encode(Cmd.Crosspoint.codec, { enabled: r.enabled, phaseInvert: r.phaseInvert, gainDb: r.gainDb });
    },
    async set(wValue, data) {
      const x = Codec.decode(Cmd.Crosspoint.codec, data);
      f32Finite(x.gainDb);
      await legacy.legacyOut(Cmd.MatrixRoute.legacy.set, 0, Codec.encode(Cmd.MatrixRoute.codec, {
        input: (wValue >> 8) as Domain.InputSlot, output: (wValue & 0xFF) as Domain.OutputSlot,
        enabled: x.enabled, phaseInvert: x.phaseInvert, gainDb: x.gainDb,
      }));
    },
  });

  // ---- Startup ----

  add(PagedCmd.STORE.STARTUP.id, {
    get: () => legacy.legacyIn(Cmd.PresetStartup.legacy.get, 0, 2),
    set: (_wValue, data) => legacy.legacyOut(Cmd.PresetStartup.legacy.set, 0, data),
  });

  // ---- I2S input rate ----

  add(Cmd.InputRate.paged.get, {
    async get() { return (await legacy.legacyIn(Cmd.InputRateStatus.legacy.get, 0, 8)).slice(4, 8); },
    async set(_wValue, data) {
      const hz = Codec.decode(Codec.u32, data);
      if (hz !== 44100 && hz !== 48000 && hz !== 96000) throw new NativeRefusal(VcResult.VC_ERR_VALUE);
      await legacy.legacyOut(Cmd.InputRate.legacy.set, 0, data);
    },
  });

  // ---- Control Surfaces display ----

  const displayCfg = (): Promise<Uint8Array> => legacy.legacyIn(Cmd.CsDisplayCfgResponse.legacy.get, 0, 16);
  add(Cmd.CsDisplayCaps.paged.get, { get: async () => (await displayCfg()).slice(0, 4) });
  add(Cmd.CsDisplayCfg.paged.get, {
    get: async () => (await displayCfg()).slice(4, 16),
    set: (_wValue, data) => legacy.legacyOut(Cmd.CsDisplayCfg.legacy.set, 0, data),
  });

  // ---- Input blocks ----

  const Source = Domain.AudioInputSource;
  const sourceNow = async (): Promise<number> => (await legacy.legacyIn(Cmd.InputSource.legacy.get, 0, 1))[0];
  // 0-based S/PDIF input of a source, or -1.
  const spdifIndex = (src: number): number => {
    switch (src) {
      case Source.Spdif:  return 0;
      case Source.Spdif2: return 1;
      case Source.Spdif3: return 2;
      case Source.Spdif4: return 3;
      default: return -1;
    }
  };
  const spdifCfg = async () => Codec.decode(Wire.SpdifInputConfig, await legacy.legacyIn(Cmd.SpdifInputConfig.legacy.get, 0, 6));
  const flag = (data: Uint8Array): boolean => {
    if (data[0] > 1) throw new NativeRefusal(VcResult.VC_ERR_VALUE);
    return data[0] === 1;
  };

  add(PagedCmd.INPUT.SOURCE.id, {
    async set(_wValue, data) {
      const src = data[0];
      const blocks = legacy.inputBlocks.read();
      const idx = spdifIndex(src);
      // The source's block must be on (and the input inside the S/PDIF count).
      if (idx >= 0 && !(blocks.spdifEnabled && idx < blocks.spdifCount)) throw new NativeRefusal(VcResult.VC_ERR_STATE);
      if (src === Source.I2s && !blocks.i2sEnabled) throw new NativeRefusal(VcResult.VC_ERR_STATE);
      await legacy.legacyOut(Cmd.InputSource.legacy.set, 0, data);
    },
  });
  add(PagedCmd.INPUT.SPDIF_RX_CONFIG.id, {
    async get() {
      const blocks = legacy.inputBlocks.read();
      return Codec.encode(Cmd.SpdifRxConfig.codec, {
        limit: SPDIF_RX_LIMIT, enabled: blocks.spdifEnabled ? 1 : 0, count: blocks.spdifCount, pins: (await spdifCfg()).pins,
      });
    },
  });
  add(Cmd.SpdifRxCount.paged.get, {
    async get() { return Uint8Array.of(legacy.inputBlocks.read().spdifCount); },
    async set(_wValue, data) {
      const want = data[0];
      if (want < 1 || want > SPDIF_RX_LIMIT) throw new NativeRefusal(VcResult.VC_ERR_VALUE);
      const blocks = legacy.inputBlocks.read();
      const idx = spdifIndex(await sourceNow());
      if (blocks.spdifEnabled && idx >= want) throw new NativeRefusal(VcResult.VC_ERR_STATE);
      if (legacy.inputBlocks.claimBlocked(blocks.spdifEnabled, want)) throw new NativeRefusal(VcResult.VC_ERR_PIN_IN_USE);
      legacy.inputBlocks.write({ spdifCount: want });
    },
  });
  add(Cmd.SpdifRxEnable.paged.get, {
    get: async () => Uint8Array.of(legacy.inputBlocks.read().spdifEnabled ? 1 : 0),
    async set(_wValue, data) {
      const on = flag(data);
      if (!on && spdifIndex(await sourceNow()) >= 0) throw new NativeRefusal(VcResult.VC_ERR_STATE);
      if (legacy.inputBlocks.claimBlocked(on, legacy.inputBlocks.read().spdifCount)) throw new NativeRefusal(VcResult.VC_ERR_PIN_IN_USE);
      legacy.inputBlocks.write({ spdifEnabled: on });
    },
  });
  add(Cmd.I2sRxEnable.paged.get, {
    get: async () => Uint8Array.of(legacy.inputBlocks.read().i2sEnabled ? 1 : 0),
    async set(_wValue, data) {
      const on = flag(data);
      if (!on && (await sourceNow()) === Source.I2s) throw new NativeRefusal(VcResult.VC_ERR_STATE);
      legacy.inputBlocks.write({ i2sEnabled: on });
    },
  });

  return out;
}

// A legacy handler STALL means the mock's 1.1.6 firmware refused it.
export function nativeVc(err: unknown): number {
  if (err instanceof NativeRefusal) return err.vc;
  if (err instanceof TransportStall) return VcResult.VC_ERR_UNSUPPORTED;
  throw err;
}
