import { Wire, type BulkParams, type WireFilter } from '@/protocol';
import {
  outputModeForChannel, type InputSlot,
  displayNameForHardwareChannel, wireChannelFor, type HardwareProfile,
  FilterType, type FilterParams,
  PlatformType, CrossfeedPreset, LevellerSpeed,
  type DspSnapshot,
  type CrossPoint, type OutputModel, type OutputState, type RouteModel,
} from '@/domain';

// Wire-side filter.type is u8 (0..255 possible). The known FilterType
// values are 0..5 (Flat..HighPass). Clamp anything else to Flat so a
// future firmware that adds a new type doesn't slip through as a typed
// FilterType the rest of the code doesn't expect.
//
// TODO: revisit if protocol/bulkParser.ts grows a type-only FilterParams
// dependency; that would drop WireFilter and this clamp.
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

function narrowPlatform(p: number): PlatformType {
  return p === 1 ? PlatformType.RP2350 : PlatformType.RP2040;
}

function narrowCrossfeedPreset(p: number): CrossfeedPreset {
  switch (p) {
    case CrossfeedPreset.Preset1:
    case CrossfeedPreset.Preset2:
    case CrossfeedPreset.Preset3:
    case CrossfeedPreset.Custom:
      return p;
    default:
      return CrossfeedPreset.Preset1;
  }
}

function narrowLevellerSpeed(s: number): LevellerSpeed {
  switch (s) {
    case LevellerSpeed.Slow:
    case LevellerSpeed.Medium:
    case LevellerSpeed.Fast:
      return s;
    default:
      return LevellerSpeed.Slow;
  }
}

export function fromBulkParams(hardware: HardwareProfile, bulk: BulkParams): DspSnapshot {
  const channelNames = bulk.channelNames.slice(0, Wire.Const.NUM_CHANNELS);
  const outputSlotTypes = bulk.formatVersion >= 3 ? bulk.i2s.outputSlotTypes : undefined;

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

  return {
    platform: {
      type: narrowPlatform(bulk.platformId),
      name: hardware.name,
      outputCount: hardware.outputCount,
      totalChannelCount: hardware.totalChannelCount,
      pdmOutputIndex: hardware.pdmOutputIndex,
    },
    formatVersion: bulk.formatVersion,
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
    leveller: bulk.formatVersion >= 4 ? {
      enabled: bulk.leveller.enabled,
      speed: narrowLevellerSpeed(bulk.leveller.speed),
      lookahead: bulk.leveller.lookahead,
      amount: bulk.leveller.amount,
      maxGainDb: bulk.leveller.maxGainDb,
      gateDb: bulk.leveller.gateDb,
    } : null,
    i2s: bulk.formatVersion >= 3 ? bulk.i2s : null,
  };
}

// Snapshot -> wire helper. Overlays snapshot-driven fields onto a
// `baseline` BulkParams (typically a recent getAllParams). Fields the
// snapshot doesn't carry (pins, raw wire indices, dimensions, channel
// names beyond hardware.totalChannelCount) come from the baseline.
// Snapshot nulls (leveller, i2s) fall back to baseline rather than
// factory defaults -- preserves device state for features the UI doesn't
// expose.
export function toBulkParams(
  hardware: HardwareProfile,
  snapshot: DspSnapshot,
  baseline: BulkParams,
): BulkParams {
  // Filters: invert wireChannelFor -- place each snapshot channel's
  // filters at its wire-channel index. Slots beyond hardware.totalChannelCount
  // keep baseline values.
  const filters: WireFilter[][] = baseline.filters.map((row) => row.map((f) => ({ ...f })));
  for (const ch of snapshot.channels) {
    const wireCh = wireChannelFor(hardware, ch.id);
    for (let b = 0; b < ch.filters.length; b++) {
      filters[wireCh][b] = {
        type: ch.filters[b].type,
        frequency: ch.filters[b].frequency,
        q: ch.filters[b].q,
        gain: ch.filters[b].gain,
      };
    }
  }

  // Outputs: map snapshot outputs onto wire slots via hardware mapping.
  const outputs: OutputState[] = baseline.outputs.map((o) => ({ ...o }));
  for (const out of snapshot.outputs) {
    outputs[out.wireIndex] = {
      enabled: out.enabled,
      muted:   out.muted,
      gainDb:  out.gainDb,
      delayMs: out.delayMs,
    };
  }

  // Crosspoints: snapshot routes carry inputIndex + outputWireIndex.
  const crosspoints: CrossPoint[][] = baseline.crosspoints.map((row) => row.map((cp) => ({ ...cp })));
  for (const r of snapshot.routes) {
    crosspoints[r.inputIndex][r.outputWireIndex] = {
      enabled: r.enabled,
      invert:  r.invert,
      gainDb:  r.gainDb,
    };
  }

  // Channel names: snapshot carries displayed names per channel id; map
  // back to wire indices. Slots beyond hardware.totalChannelCount keep
  // baseline values. Note: if the wire originally had an empty name,
  // fromBulkParams already resolved it to the channel's default (e.g.
  // "Out 1 L"), so the wire packet built here will carry that resolved
  // name -- matching what the user sees in the UI.
  const channelNames = baseline.channelNames.slice();
  for (const ch of snapshot.channels) {
    const wireCh = wireChannelFor(hardware, ch.id);
    channelNames[wireCh] = ch.name;
  }

  return {
    formatVersion: 6,
    platformId:    snapshot.platform.type,
    numCh:         hardware.totalChannelCount,
    numOut:        hardware.outputCount,
    numIn:         baseline.numIn,
    maxBands:      baseline.maxBands,

    bypass:   snapshot.bypass,
    preampDb: snapshot.masterPreampDb,

    loudness:  snapshot.loudness,
    crossfeed: snapshot.crossfeed,

    delaysMs: baseline.delaysMs.slice(),
    crosspoints,
    outputs,

    numPinOutputs: baseline.numPinOutputs,
    pins:          baseline.pins.slice(),

    filters,
    channelNames,

    i2s:        snapshot.i2s      ?? baseline.i2s,
    leveller:   snapshot.leveller ?? baseline.leveller,
    preampLDb:  snapshot.inputPreampDb[0],
    preampRDb:  snapshot.inputPreampDb[1],
    masterVolumeDb: snapshot.masterVolumeDb,
  };
}
