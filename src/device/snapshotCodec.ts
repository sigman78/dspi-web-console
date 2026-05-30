import * as proto from '@/protocol';
import * as domain from '@/domain';

// Opaque handle for the preset-paste device-to-device copy. Runtime holds it
// between captureState/restoreState but must never inspect it. Internally a
// BulkParams packet; the brand keeps wire shape out of runtime types.
export type DeviceState = proto.BulkParams & { readonly __brand: 'DeviceState' };

// Wire filter.type is a u8; clamp anything outside the known FilterType
// values to Flat so a future firmware type can't slip through as a typed value.
function narrowFilterType(t: number): domain.FilterType {
  switch (t) {
    case domain.FilterType.Flat:
    case domain.FilterType.Peaking:
    case domain.FilterType.LowShelf:
    case domain.FilterType.HighShelf:
    case domain.FilterType.LowPass:
    case domain.FilterType.HighPass:
      return t;
    default:
      return domain.FilterType.Flat;
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

export function fromBulkParams(hardware: domain.HardwareProfile, bulk: proto.BulkParams): domain.DspSnapshot {
  const channelNames = bulk.channelNames.slice(0, proto.Wire.Const.NUM_CHANNELS);
  const layout = proto.Wire.bulkLayout(bulk);
  const outputSlotTypes = layout.i2s ? bulk.i2s.outputSlotTypes : undefined;

  const channels = hardware.channels.map((channel) => ({
    id: channel.id,
    name: domain.displayNameForHardwareChannel(hardware, channel.id, channelNames),
    defaultName: channel.name,
    shortName: channel.shortName,
    bandCount: channel.bandCount,
    isOutput: channel.isOutput,
    outputMode: domain.outputModeForChannel(channel.id, outputSlotTypes),
    filters: (bulk.filters[domain.wireChannelFor(hardware, channel.id)]?.slice(0, channel.bandCount) ?? []).map<domain.FilterParams>((filter) => ({
      type: narrowFilterType(filter.type),
      frequency: filter.frequency,
      q: filter.q,
      gain: filter.gain,
    })),
  }));

  const outputs: domain.OutputModel[] = hardware.outputs.map((channel) => {
    const wireIndex = hardware.outputSlotByChannel[channel.id];
    if (wireIndex == null) {
      throw new Error(`Channel ${channel.id} is not an output channel`);
    }
    const outputMode = domain.outputModeForChannel(channel.id, outputSlotTypes);
    if (outputMode === null) {
      throw new Error(`Channel ${channel.id} has no output mode`);
    }
    const state = bulk.outputs[wireIndex];
    return {
      id: channel.id,
      wireIndex,
      name: domain.displayNameForHardwareChannel(hardware, channel.id, channelNames),
      shortName: channel.shortName,
      outputMode,
      enabled: state.enabled,
      muted: state.muted,
      gainDb: state.gainDb,
      delayMs: state.delayMs,
    };
  });

  const routes: domain.RouteModel[] = [];
  for (let inputIndex = 0; inputIndex < hardware.inputs.length; inputIndex++) {
    const input = hardware.inputs[inputIndex];
    for (const output of outputs) {
      const cp = bulk.crosspoints[inputIndex][output.wireIndex];
      routes.push({
        inputIndex: inputIndex as domain.InputSlot,
        inputName: domain.displayNameForHardwareChannel(hardware, input.id, channelNames),
        outputId: output.id,
        outputWireIndex: output.wireIndex,
        outputName: output.name,
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
    },
    bypass: bulk.bypass,
    masterPreampDb: bulk.preampDb,
    inputPreampDb: [bulk.preampLDb, bulk.preampRDb],
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
    leveller: layout.leveller ? {
      enabled: bulk.leveller.enabled,
      speed: narrowLevellerSpeed(bulk.leveller.speed),
      lookahead: bulk.leveller.lookahead,
      amount: bulk.leveller.amount,
      maxGainDb: bulk.leveller.maxGainDb,
      gateDb: bulk.leveller.gateDb,
    } : null,
    i2s: layout.i2s ? bulk.i2s : null,
    outputPins: bulk.pins.slice(0, bulk.numPinOutputs),
  };
}

