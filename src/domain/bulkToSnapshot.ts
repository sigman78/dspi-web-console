import { Wire, type BulkParams } from '@/protocol';
import {
  outputModeForChannel,
  type InputSlot,
} from './channels';
import {
  displayNameForHardwareChannel,
  wireChannelFor,
  type HardwareProfile,
} from './hardware';
import { FilterType, type FilterParams } from './filter';
import type { DspSnapshot } from './snapshot';
import type { OutputModel, RouteModel } from './mixer';

// Wire-side filter.type is u8 (0..255 possible). The known FilterType
// values are 0..5 (Flat..HighPass). Clamp anything else to Flat so a
// future firmware that adds a new type doesn't slip through as a typed
// FilterType the rest of the code doesn't expect.
//
// TODO: revisit once we decide whether protocol/bulkParser.ts should
// accept a `FilterParams` import (one more type-only domain dep, drops
// WireFilter and this clamp). See docs/DOMAIN.md follow-up review M1.
function narrowFilterType(t: number): FilterType {
  switch (t) {
    case FilterType.Flat:
    case FilterType.Peaking:
    case FilterType.LowShelf:
    case FilterType.HighShelf:
    case FilterType.LowPass:
    case FilterType.HighPass:
      return t;
    default:
      return FilterType.Flat;
  }
}

export function fromBulkParams(hardware: HardwareProfile, bulk: BulkParams): DspSnapshot {
  const channelNames = bulk.channelNames.slice(0, Wire.Const.NUM_CHANNELS);
  const outputSlotTypes = bulk.i2s?.outputSlotTypes;

  const channels = hardware.channels.map((channel) => ({
    id: channel.id,
    name: displayNameForHardwareChannel(hardware, channel.id, channelNames),
    defaultName: channel.name,
    shortName: channel.shortName,
    bandCount: channel.bandCount,
    isOutput: channel.isOutput,
    outputMode: outputModeForChannel(channel.id, outputSlotTypes),
    filters: (bulk.filters[wireChannelFor(hardware, channel.id)]?.slice(0, channel.bandCount) ?? []).map<FilterParams>((filter) => ({
      type: narrowFilterType(filter.type),
      frequency: filter.frequency,
      q: filter.q,
      gain: filter.gain,
    })),
  }));

  const outputs: OutputModel[] = hardware.outputs.map((channel) => {
    const wireIndex = hardware.outputSlotByChannel[channel.id];
    if (wireIndex == null) {
      throw new Error(`Channel ${channel.id} is not an output channel`);
    }
    const outputMode = outputModeForChannel(channel.id, outputSlotTypes);
    if (outputMode === null) {
      throw new Error(`Channel ${channel.id} has no output mode`);
    }
    const state = bulk.outputs[wireIndex];
    return {
      id: channel.id,
      wireIndex,
      name: displayNameForHardwareChannel(hardware, channel.id, channelNames),
      shortName: channel.shortName,
      outputMode,
      enabled: state.enabled,
      muted: state.muted,
      gainDb: state.gainDb,
      delayMs: state.delayMs,
    };
  });

  const routes: RouteModel[] = [];
  for (let inputIndex = 0; inputIndex < hardware.inputs.length; inputIndex++) {
    const input = hardware.inputs[inputIndex];
    for (const output of outputs) {
      const cp = bulk.crosspoints[inputIndex][output.wireIndex];
      routes.push({
        inputIndex: inputIndex as InputSlot,
        inputName: displayNameForHardwareChannel(hardware, input.id, channelNames),
        outputId: output.id,
        outputWireIndex: output.wireIndex,
        outputName: output.name,
        enabled: cp.enabled,
        invert: cp.invert,
        gainDb: cp.gainDb,
      });
    }
  }

  // Feature shapes are shared with the parser; we adopt them by reference.
  // Connection sync and bulk resync replace the snapshot wholesale, and the
  // parsed bulk goes out of scope, so there's no aliasing concern.
  return {
    platform: {
      type: hardware.type,
      name: hardware.name,
      outputCount: hardware.outputCount,
      totalChannelCount: hardware.totalChannelCount,
      pdmOutputIndex: hardware.pdmOutputIndex,
    },
    formatVersion: bulk.formatVersion,
    bypass: bulk.bypass,
    masterPreampDb: bulk.preampDb,
    inputPreampDb: [bulk.preampLDb ?? 0, bulk.preampRDb ?? 0],
    masterVolumeDb: bulk.masterVolumeDb ?? 0,
    channels,
    outputs,
    routes,
    loudness: bulk.loudness,
    crossfeed: bulk.crossfeed,
    leveller: bulk.leveller,
    i2s: bulk.i2s,
  };
}
