import { type BulkParams } from './bulkParser';
import * as domain from '@/domain';

// Opaque handle for the preset-paste device-to-device copy. Runtime holds it
// between captureState/restoreState but must never inspect it. Internally a
// BulkParams packet; the brand keeps wire shape out of runtime types.
export type DeviceState = BulkParams & { readonly __brand: 'DeviceState' };

// Wire filter.type is a u8; clamp anything outside the known FilterType
// values to Flat so a future firmware type can't slip through as a typed value.
const KNOWN_FILTER_TYPES: ReadonlySet<number> = new Set(Object.values(domain.FilterType));

function narrowFilterType(t: number): domain.FilterType {
  return KNOWN_FILTER_TYPES.has(t) ? (t as domain.FilterType) : domain.FilterType.Flat;
}

export function narrowInputSource(s: number): domain.AudioInputSource {
  switch (s) {
    case domain.AudioInputSource.Spdif:
    case domain.AudioInputSource.I2s:
      return s;
    default:
      return domain.AudioInputSource.Usb;
  }
}

function narrowPlatform(p: number): domain.PlatformType {
  return p === 1 ? domain.PlatformType.RP2350 : domain.PlatformType.RP2040;
}

function narrowCrossfeedPreset(p: number): domain.CrossfeedPreset {
  switch (p) {
    case domain.CrossfeedPreset.Preset1:
    case domain.CrossfeedPreset.Preset2:
    case domain.CrossfeedPreset.Preset3:
    case domain.CrossfeedPreset.Custom:
      return p;
    default:
      return domain.CrossfeedPreset.Preset1;
  }
}

function narrowLevellerSpeed(s: number): domain.LevellerSpeed {
  switch (s) {
    case domain.LevellerSpeed.Slow:
    case domain.LevellerSpeed.Medium:
    case domain.LevellerSpeed.Fast:
      return s;
    default:
      return domain.LevellerSpeed.Slow;
  }
}

function narrowFilter(filter: { type: number; bypass: boolean; frequency: number; q: number; gain: number }): domain.FilterParams {
  return {
    type: narrowFilterType(filter.type),
    bypass: filter.bypass,
    frequency: filter.frequency,
    q: filter.q,
    gain: filter.gain,
  };
}

export function fromBulkParams(hardware: domain.HardwareProfile, bulk: BulkParams): domain.DspSnapshot {
  const channelNames = bulk.channelNames;
  const hasCrossover = bulk.formatVersion >= 16;
  const inputSource = narrowInputSource(bulk.inputConfig.source);

  const channels = hardware.channels.map((channel) => {
    const wireChannel = domain.wireChannelFor(hardware, channel.id);
    const inputSlot = domain.inputIndexOf(channel.id);
    const defaultName = inputSlot !== null ? domain.defaultInputName(inputSource, inputSlot) : channel.name;
    const shortName = inputSlot !== null ? domain.defaultInputShortName(inputSource, inputSlot) : channel.shortName;
    return {
      id: channel.id,
      name: domain.displayNameForHardwareChannel(hardware, channel.id, channelNames, defaultName),
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

  const outputs: domain.OutputModel[] = hardware.outputs.map((channel) => {
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

  const routes: domain.RouteModel[] = [];
  for (let inputIndex = 0; inputIndex < hardware.inputs.length; inputIndex++) {
    for (const output of outputs) {
      const cp = bulk.crosspoints[inputIndex][output.wireIndex];
      routes.push({
        inputIndex: inputIndex as domain.InputSlot,
        outputId: output.id,
        outputWireIndex: output.wireIndex,
        enabled: cp.enabled,
        invert: cp.invert,
        gainDb: cp.gainDb,
      });
    }
  }

  return {
    platform: {
      type: narrowPlatform(bulk.platformId),
      name: hardware.name,
      outputCount: hardware.outputCount,
      totalChannelCount: hardware.totalChannelCount,
      pdmOutputIndex: hardware.pdmOutputIndex,
      wireGen: hardware.wireGen,
    },
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
    },
    i2s: bulk.i2s,
    outputPins: bulk.pins.slice(0, bulk.numPinOutputs),
    // V7-V10 sections -- same unconditional carry: the parser substitutes
    // factory defaults when a packet omits them (test-only under the V10 floor).
    inputConfig: {
      source: inputSource,
      spdifRxPin: bulk.inputConfig.spdifRxPin,
      i2sRxPins: [...bulk.inputConfig.i2sRxPins],
      i2sInputRateHz: domain.i2sRateDecode(bulk.inputConfig.i2sInputRateEnc),
      i2sInputChannels: bulk.inputConfig.i2sInputChannels,
    },
    lgSoundSync: { enabled: bulk.lgSoundSync.enabled, present: bulk.lgSoundSync.present, volume: bulk.lgSoundSync.volume, muted: bulk.lgSoundSync.muted },
    userVolume:  { volumeDb: bulk.userVolume.volumeDb, mute: bulk.userVolume.mute },
    dacHwMute:   { enabled: bulk.dacHwMute.enabled, activeLow: bulk.dacHwMute.activeLow, pin: bulk.dacHwMute.pin, holdMs: bulk.dacHwMute.holdMs, releaseMs: bulk.dacHwMute.releaseMs },
  };
}

