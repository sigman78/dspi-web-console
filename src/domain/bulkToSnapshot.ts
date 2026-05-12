import * as Wire from '../protocol/wireTypes';
import type { BulkParams } from '../protocol/bulkParser';
import type { PlatformType } from './platform';
import {
  displayNameForChannel,
  forPlatform,
  outputModeForChannel,
  outputWireIndex,
  type InputSlot,
} from './channels';
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

export function fromBulkParams(platformType: PlatformType, bulk: BulkParams): DspSnapshot {
  const layout = forPlatform(platformType);
  const channelNames = bulk.channelNames.slice(0, Wire.Const.NUM_CHANNELS);
  const outputSlotTypes = bulk.i2s?.outputSlotTypes;

  const channels = layout.channels.map((channel) => ({
    id: channel.id,
    name: displayNameForChannel(channel.id, channelNames),
    defaultName: channel.name,
    shortName: channel.shortName,
    bandCount: channel.bandCount,
    isOutput: channel.isOutput,
    outputMode: outputModeForChannel(channel.id, outputSlotTypes),
    filters: (bulk.filters[channel.id]?.slice(0, channel.bandCount) ?? []).map<FilterParams>((filter) => ({
      type: narrowFilterType(filter.type),
      frequency: filter.frequency,
      q: filter.q,
      gain: filter.gain,
    })),
  }));

  const outputs: OutputModel[] = layout.outputs.map((channel) => {
    const wireIndex = outputWireIndex(channel.id);
    if (wireIndex === null) {
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
      name: displayNameForChannel(channel.id, channelNames),
      shortName: channel.shortName,
      outputMode,
      enabled: state.enabled,
      muted: state.muted,
      gainDb: state.gainDb,
      delayMs: state.delayMs,
    };
  });

  const routes: RouteModel[] = [];
  for (let inputIndex = 0; inputIndex < layout.inputs.length; inputIndex++) {
    const input = layout.inputs[inputIndex];
    for (const output of outputs) {
      const cp = bulk.crosspoints[inputIndex][output.wireIndex];
      routes.push({
        inputIndex: inputIndex as InputSlot,
        inputName: displayNameForChannel(input.id, channelNames),
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
  // Each fullSync replaces the snapshot wholesale, and the parsed bulk goes
  // out of scope, so there's no aliasing concern.
  return {
    platform: layout.info,
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
