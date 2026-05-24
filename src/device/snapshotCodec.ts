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
  const outputSlotTypes = bulk.formatVersion >= 3 ? bulk.i2s.outputSlotTypes : undefined;

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
    outputPins: [],
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
  hardware: domain.HardwareProfile,
  snapshot: domain.DspSnapshot,
  baseline: proto.BulkParams,
): proto.BulkParams {
  // Filters: invert wireChannelFor -- place each snapshot channel's
  // filters at its wire-channel index. Slots beyond hardware.totalChannelCount
  // keep baseline values.
  const filters: proto.WireFilter[][] = baseline.filters.map((row) => row.map((f) => ({ ...f })));
  for (const ch of snapshot.channels) {
    const wireCh = domain.wireChannelFor(hardware, ch.id);
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
  const outputs: domain.OutputState[] = baseline.outputs.map((o) => ({ ...o }));
  for (const out of snapshot.outputs) {
    outputs[out.wireIndex] = {
      enabled: out.enabled,
      muted:   out.muted,
      gainDb:  out.gainDb,
      delayMs: out.delayMs,
    };
  }

  // Crosspoints: snapshot routes carry inputIndex + outputWireIndex.
  const crosspoints: domain.CrossPoint[][] = baseline.crosspoints.map((row) => row.map((cp) => ({ ...cp })));
  for (const r of snapshot.routes) {
    crosspoints[r.inputIndex][r.outputWireIndex] = {
      enabled: r.enabled,
      invert:  r.invert,
      gainDb:  r.gainDb,
    };
  }

  // Channel names: map displayed names back to wire indices. An originally
  // empty wire name was already resolved to the channel default by
  // fromBulkParams, so the rebuilt packet carries that resolved name.
  const channelNames = baseline.channelNames.slice();
  for (const ch of snapshot.channels) {
    const wireCh = domain.wireChannelFor(hardware, ch.id);
    channelNames[wireCh] = ch.name;
  }

  return {
    formatVersion: 6, // TODO: source from device firmware version, not hardcoded
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
