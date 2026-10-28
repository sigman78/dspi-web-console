import { type BulkParams } from './bulkParser';
import * as Domain from '@/domain';

// Opaque handle for the preset-paste device-to-device copy. Runtime holds it
// between captureState/restoreState but must never inspect it. Internally a
// BulkParams packet; the brand keeps wire shape out of runtime types.
export type DeviceState = BulkParams & { readonly __brand: 'DeviceState' };

// Wire filter.type is a u8; clamp anything outside the known FilterType
// values to Flat so a future firmware type can't slip through as a typed value.
const KNOWN_FILTER_TYPES: ReadonlySet<number> = new Set(Object.values(Domain.FilterType));

function narrowFilterType(t: number): Domain.FilterType {
  return KNOWN_FILTER_TYPES.has(t) ? (t as Domain.FilterType) : Domain.FilterType.Flat;
}

// Wire enum narrowing: clamp anything outside `known` to `fallback` so a
// future firmware value can't slip through as a typed value.
function narrowEnum<T extends number>(v: number, known: readonly T[], fallback: T): T {
  return known.includes(v as T) ? (v as T) : fallback;
}

export function narrowInputSource(s: number): Domain.AudioInputSource {
  return narrowEnum(
    s,
    [
      Domain.AudioInputSource.Spdif, Domain.AudioInputSource.I2s, Domain.AudioInputSource.Adat,
      Domain.AudioInputSource.Spdif2, Domain.AudioInputSource.Spdif3, Domain.AudioInputSource.Spdif4,
    ],
    Domain.AudioInputSource.Usb,
  );
}

function narrowCrossfeedPreset(p: number): Domain.CrossfeedPreset {
  return narrowEnum(
    p,
    [Domain.CrossfeedPreset.Preset1, Domain.CrossfeedPreset.Preset2, Domain.CrossfeedPreset.Preset3, Domain.CrossfeedPreset.Custom],
    Domain.CrossfeedPreset.Preset1,
  );
}

function narrowLevellerSpeed(s: number): Domain.LevellerSpeed {
  return narrowEnum(
    s,
    [Domain.LevellerSpeed.Slow, Domain.LevellerSpeed.Medium, Domain.LevellerSpeed.Fast],
    Domain.LevellerSpeed.Slow,
  );
}

// p1 = enable mask + 1 (0 = absent -> all off; else bit0 = input2, bit1 =
// input3, bit2 = input4).
function decodeSpdifExtEnabled(p1: number): boolean[] {
  if (p1 === 0) return [false, false, false];
  const mask = p1 - 1;
  return [(mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0];
}

// p1 = clock_pin_mode + 1 (0 = absent -> unified; else value - 1: 0 = unified, 1 = split).
function decodeClockPinMode(p1: number): number {
  return p1 === 0 ? 0 : p1 - 1;
}

// p1 = adat_input_enabled + 1 (0 = absent -> false; else value - 1: 0 = disabled, 1 = enabled).
function decodeAdatInputEnabled(p1: number): boolean {
  return p1 !== 0 && p1 - 1 === 1;
}

// p1 = adat_input_clock_mode + 1 (0 = absent -> master; else value - 1: 0 = master, 1 = slave).
function decodeAdatInputClockMode(p1: number): number {
  return p1 === 0 ? 0 : p1 - 1;
}

function narrowFilter(filter: { type: number; bypass: boolean; frequency: number; q: number; gain: number; qpRaw: number }): Domain.FilterParams {
  const type = narrowFilterType(filter.type);
  return {
    type,
    bypass: filter.bypass,
    frequency: filter.frequency,
    q: filter.q,
    gain: filter.gain,
    ...(type === Domain.FilterType.LinkwitzTransform ? { qp: Domain.decodeQp(filter.qpRaw) } : {}),
  };
}

export function fromBulkParams(hardware: Domain.HardwareProfile, bulk: BulkParams): Domain.DspSnapshot {
  const channelNames = bulk.channelNames;
  const inputSource = narrowInputSource(bulk.inputConfig.source);

  const channels = hardware.channels.map((channel) => {
    const wireChannel = Domain.wireChannelFor(hardware, channel.id);
    const inputSlot = Domain.inputIndexOf(channel.id);
    const defaultName = inputSlot !== null ? Domain.defaultInputName(inputSource, inputSlot) : channel.name;
    const shortName = inputSlot !== null ? Domain.defaultInputShortName(inputSource, inputSlot) : channel.shortName;
    return {
      id: channel.id,
      name: Domain.displayNameForHardwareChannel(hardware, channel.id, channelNames, defaultName),
      defaultName,
      shortName,
      bandCount: channel.bandCount,
      isOutput: channel.isOutput,
      filters: (bulk.filters[wireChannel]?.slice(0, channel.bandCount) ?? []).map(narrowFilter),
      xoverBands: channel.isOutput
        ? (bulk.crossover[wireChannel] ?? []).map(narrowFilter)
        : [],
    };
  });

  const outputs: Domain.OutputModel[] = hardware.outputs.map((channel) => {
    const wireIndex = hardware.outputSlotByChannel[channel.id];
    if (wireIndex == null) {
      throw new Error(`Channel ${channel.id} is not an output channel`);
    }
    const state = bulk.outputs[wireIndex];
    return {
      id: channel.id,
      wireIndex,
      shortName: channel.shortName,
      enabled: state.enabled,
      muted: state.muted,
      gainDb: state.gainDb,
      delayMs: state.delayMs,
    };
  });

  const routes: Domain.RouteModel[] = [];
  for (let inputIndex = 0; inputIndex < hardware.inputs.length; inputIndex++) {
    for (const output of outputs) {
      const cp = bulk.crosspoints[inputIndex][output.wireIndex];
      routes.push({
        inputIndex: inputIndex as Domain.InputSlot,
        outputId: output.id,
        outputWireIndex: output.wireIndex,
        enabled: cp.enabled,
        invert: cp.invert,
        gainDb: cp.gainDb,
      });
    }
  }

  return {
    platform: Domain.pickSummary(hardware),
    bypass: bulk.bypass,
    masterPreampDb: bulk.preampDb,
    inputPreampDb: bulk.inputPreampsDb.slice(0, hardware.inputs.length),
    masterVolumeDb: bulk.masterVolumeDb,
    channels,
    outputs,
    routes,
    loudness: bulk.loudness,
    crossfeed: {
      enabled: bulk.crossfeed.enabled,
      preset: narrowCrossfeedPreset(bulk.crossfeed.preset),
      itd: bulk.crossfeed.itd,
      freq: bulk.crossfeed.freq,
      feedDb: bulk.crossfeed.feedDb,
      outputPairMask: bulk.crossfeed.outputPairMask,
    },
    // Floor sections -- present on every supported packet, so the domain
    // carries them unconditionally.
    leveller: {
      enabled: bulk.leveller.enabled,
      speed: narrowLevellerSpeed(bulk.leveller.speed),
      lookahead: bulk.leveller.lookahead,
      amount: bulk.leveller.amount,
      maxGainDb: bulk.leveller.maxGainDb,
      gateDb: bulk.leveller.gateDb,
      detectorMask: bulk.leveller.detectorMask,
      applyMask: bulk.leveller.applyMask,
    },
    i2s: {
      outputSlotTypes: bulk.i2s.outputSlotTypes,
      bckPin: bulk.i2s.bckPin,
      mckPin: bulk.i2s.mckPin,
      mckEnabled: bulk.i2s.mckEnabled,
      mckMultiplierEncoded: bulk.i2s.mckMultiplierEncoded,
      clockPinMode: decodeClockPinMode(bulk.i2s.clockPinModeP1),
      bckPinSlave: bulk.i2s.bckPinSlave,
    },
    outputPins: bulk.pins.slice(0, bulk.numPinOutputs),
    inputConfig: {
      source: inputSource,
      spdifRxPin: bulk.inputConfig.spdifRxPin,
      i2sRxPins: [...bulk.inputConfig.i2sRxPins],
      i2sInputRateHz: Domain.i2sRateDecode(bulk.inputConfig.i2sInputRateEnc),
      i2sInputChannels: bulk.inputConfig.i2sInputChannels,
      spdifRxPinExt: [...bulk.inputConfig.spdifRxPinExt],
      spdifExtEnabled: decodeSpdifExtEnabled(bulk.inputConfig.spdifRxEnabledExtP1),
      i2sClockMode: bulk.inputConfig.i2sClockMode,
      // p1-encoded fields (0 = absent) are decoded below.
      adatInputPin: bulk.inputConfig.adatInputPin,
      adatInputEnabled: decodeAdatInputEnabled(bulk.inputConfig.adatInputEnabledP1),
      adatInputClockMode: decodeAdatInputClockMode(bulk.inputConfig.adatInputClockModeP1),
    },
    psybass: { ...bulk.psybass },
    upmix: { ...bulk.upmix },
    // Subharm (V29), tube (V31) and limiter (V32) come from their bulk
    // sections; the parser defaults them on older packets, so they are always
    // populated.
    subharm: { ...bulk.subharm },
    tube: { ...bulk.tube },
    limiter: bulk.limiter.map((o) => ({ ...o })),
    lgSoundSync: { enabled: bulk.lgSoundSync.enabled, present: bulk.lgSoundSync.present, volume: bulk.lgSoundSync.volume, muted: bulk.lgSoundSync.muted },
    userVolume:  { volumeDb: bulk.userVolume.volumeDb, mute: bulk.userVolume.mute },
    dacHwMute:   { enabled: bulk.dacHwMute.enabled, activeLow: bulk.dacHwMute.activeLow, pin: bulk.dacHwMute.pin, holdMs: bulk.dacHwMute.holdMs, releaseMs: bulk.dacHwMute.releaseMs },
    adat: { enabled: bulk.adat.enabled, pin: bulk.adat.pin },
  };
}

