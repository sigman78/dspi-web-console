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
// input3, bit2 = input4 [V28+; unset on older packets]).
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
  const hasCrossover = bulk.formatVersion >= 16;
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
      xoverBands: hasCrossover && channel.isOutput
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
      // Output-pair mask comes from the V20 bulk section; the parser defaults
      // it to 0x01 (legacy stereo) on pre-V20 packets, so this is always populated.
      outputPairMask: bulk.crossfeed.outputPairMask,
    },
    // Floor sections -- bulkParser always populates these (defaults when the
    // wire omits them), so the domain carries them unconditionally.
    leveller: {
      enabled: bulk.leveller.enabled,
      speed: narrowLevellerSpeed(bulk.leveller.speed),
      lookahead: bulk.leveller.lookahead,
      amount: bulk.leveller.amount,
      maxGainDb: bulk.leveller.maxGainDb,
      gateDb: bulk.leveller.gateDb,
      // Channel masks come from the V18 bulk section; the parser defaults them
      // to all-on (0xFF) on pre-V18 packets, so this is always populated.
      detectorMask: bulk.leveller.detectorMask,
      applyMask: bulk.leveller.applyMask,
    },
    i2s: {
      outputSlotTypes: bulk.i2s.outputSlotTypes,
      bckPin: bulk.i2s.bckPin,
      mckPin: bulk.i2s.mckPin,
      mckEnabled: bulk.i2s.mckEnabled,
      mckMultiplierEncoded: bulk.i2s.mckMultiplierEncoded,
      // clockPinMode comes from the V16-gen I2S section's clockPinModeP1 byte;
      // the parser defaults it to 0 (absent) on packets that predate the
      // slave-clock feature, so this is always populated.
      clockPinMode: decodeClockPinMode(bulk.i2s.clockPinModeP1),
      bckPinSlave: bulk.i2s.bckPinSlave,
    },
    outputPins: bulk.pins.slice(0, bulk.numPinOutputs),
    // V7-V10 sections -- same unconditional carry: the parser substitutes
    // factory defaults when a packet omits them (test-only under the V10 floor).
    inputConfig: {
      source: inputSource,
      spdifRxPin: bulk.inputConfig.spdifRxPin,
      i2sRxPins: [...bulk.inputConfig.i2sRxPins],
      i2sInputRateHz: Domain.i2sRateDecode(bulk.inputConfig.i2sInputRateEnc),
      i2sInputChannels: bulk.inputConfig.i2sInputChannels,
      spdifRxPinExt: [...bulk.inputConfig.spdifRxPinExt],
      spdifExtEnabled: decodeSpdifExtEnabled(bulk.inputConfig.spdifRxEnabledExtP1),
      // I2S clock role comes from the V21 bulk section; the parser defaults
      // it to 0 (master) on pre-V21 packets, so this is always populated.
      i2sClockMode: bulk.inputConfig.i2sClockMode,
      // ADAT input comes from the V24 bulk section; the parser defaults its
      // p1-encoded fields to 0 (absent) on pre-V24 packets, decoded below.
      adatInputPin: bulk.inputConfig.adatInputPin,
      adatInputEnabled: decodeAdatInputEnabled(bulk.inputConfig.adatInputEnabledP1),
      adatInputClockMode: decodeAdatInputClockMode(bulk.inputConfig.adatInputClockModeP1),
    },
    // Psychoacoustic bass comes from the V23 bulk section; the parser
    // defaults it (disabled, all-outputs mask) on pre-V23 packets, so this is
    // always populated.
    psybass: { ...bulk.psybass },
    // Stereo upmixer comes from the V25 bulk section; the parser defaults it
    // (disabled, firmware defaults) on pre-V25 packets, and presenceDb to 0 on
    // pre-V26 packets, so this is always populated.
    upmix: { ...bulk.upmix },
    // Subharmonic synthesizer comes from the V29 bulk section; the parser
    // defaults it (disabled, all-outputs mask) on pre-V29 packets, so this is
    // always populated.
    subharm: { ...bulk.subharm },
    lgSoundSync: { enabled: bulk.lgSoundSync.enabled, present: bulk.lgSoundSync.present, volume: bulk.lgSoundSync.volume, muted: bulk.lgSoundSync.muted },
    userVolume:  { volumeDb: bulk.userVolume.volumeDb, mute: bulk.userVolume.mute },
    dacHwMute:   { enabled: bulk.dacHwMute.enabled, activeLow: bulk.dacHwMute.activeLow, pin: bulk.dacHwMute.pin, holdMs: bulk.dacHwMute.holdMs, releaseMs: bulk.dacHwMute.releaseMs },
    // ADAT lightpipe output comes from the V17 bulk section; the parser
    // defaults it (disabled, pin 0) on pre-V17 packets, so this is always
    // populated.
    adat: { enabled: bulk.adat.enabled, pin: bulk.adat.pin },
  };
}

