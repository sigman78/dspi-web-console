// Hardware platform identity and the derived per-platform profile.
// PlatformType is the firmware-pinned identity byte (RP2040=0, RP2350=1);
// HardwareProfile carries the full channel/slot/pin layout built from it.

import { ChannelId, channelLayoutById, type ChannelId as ChannelIdValue, type ChannelLayout, type OutputSlot as OutputSlotValue } from './channels';

export const PlatformType = {
  RP2040: 0,
  RP2350: 1,
} as const;
export type PlatformType = (typeof PlatformType)[keyof typeof PlatformType];

export interface PlatformInfo {
  type: PlatformType;
  name: string;
  outputCount: number;
  totalChannelCount: number;
  pdmOutputIndex: number;
  // Channel-model generation of the connected device (see ChannelFamily below).
  // Rides the snapshot so pure-domain helpers (pin rules) can follow the
  // firmware generation without reaching into protocol capabilities.
  channelModel: ChannelFamily;
}

export interface I2sConfig {
  outputSlotTypes: [number, number, number, number];
  bckPin: number;
  mckPin: number;
  mckEnabled: boolean;
  mckMultiplierEncoded: number;
}

export interface HardwareProfile extends PlatformInfo {
  inputChannels: readonly ChannelIdValue[];
  outputChannels: readonly ChannelIdValue[];
  inputs: readonly ChannelLayout[];
  outputs: readonly ChannelLayout[];
  channels: readonly ChannelLayout[];
  outputSlotByChannel: Partial<Record<ChannelIdValue, OutputSlotValue>>;
  wireChannelByUiChannel: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  uiChannelByWireChannel: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  // Default GPIO pin per output channel. Keyed on the L-anchor for stereo
  // I2S pairs (one pin drives both L and R); standalone for PDM.
  defaultPinByChannel: Partial<Record<ChannelIdValue, number>>;
}

// Channel-model family of a device: V10 = legacy 2-input fixed stereo + master
// channels; V16+ = unified 8-input multichannel with crossover. The value is
// the family's base wire version, so it feeds the version-keyed profile/pin
// helpers directly. V17/V18 share the Unified model.
// Named ChannelFamily, not ChannelModel: snapshot.ts already exports a
// ChannelModel interface (the per-channel view model), and `export *`-ing
// both from the same name out of the domain barrel would make that name
// ambiguous everywhere it's imported.
export const ChannelFamily = {
  Legacy:  10,
  Unified: 16,
} as const;
export type ChannelFamily = (typeof ChannelFamily)[keyof typeof ChannelFamily];

const STEREO_INPUT_CHANNELS = [ChannelId.In1L, ChannelId.In1R] as const;

const V16_RP2350_INPUT_CHANNELS = [
  ChannelId.In1L, ChannelId.In1R,
  ChannelId.In2L, ChannelId.In2R,
  ChannelId.In3L, ChannelId.In3R,
  ChannelId.In4L, ChannelId.In4R,
] as const;

interface HardwareProfileConfig {
  type: PlatformType;
  name: string;
  channelModel: ChannelFamily;
  inputChannels: readonly ChannelIdValue[];
  outputChannels: readonly ChannelIdValue[];
  wireChannelOverrides?: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  defaultPins: Partial<Record<ChannelIdValue, number>>;
}

function buildHardwareProfile(config: HardwareProfileConfig): HardwareProfile {
  const inputChannels = config.inputChannels;
  const outputChannels = config.outputChannels;
  const inputs = inputChannels.map(channelLayoutById);
  const outputs = outputChannels.map(channelLayoutById);
  const channels = [...inputs, ...outputs];

  const outputSlotByChannel: Partial<Record<ChannelIdValue, OutputSlotValue>> = {};
  for (let i = 0; i < outputChannels.length; i++) {
    outputSlotByChannel[outputChannels[i]] = i as OutputSlotValue;
  }

  const wireChannelByUiChannel: Partial<Record<ChannelIdValue, ChannelIdValue>> = {};
  const uiChannelByWireChannel: Partial<Record<ChannelIdValue, ChannelIdValue>> = {};
  for (const channel of [...inputChannels, ...outputChannels]) {
    const wireChannel = config.wireChannelOverrides?.[channel] ?? channel;
    wireChannelByUiChannel[channel] = wireChannel;
    uiChannelByWireChannel[wireChannel] = channel;
  }

  return {
    type: config.type,
    name: config.name,
    outputCount: outputs.length,
    totalChannelCount: channels.length,
    pdmOutputIndex: outputChannels.indexOf(ChannelId.Pdm),
    channelModel: config.channelModel,
    inputChannels,
    outputChannels,
    inputs,
    outputs,
    channels,
    outputSlotByChannel,
    wireChannelByUiChannel,
    uiChannelByWireChannel,
    defaultPinByChannel: config.defaultPins,
  };
}

const RP2040_OUTPUT_CHANNELS = [
  ChannelId.Out1L, ChannelId.Out1R,
  ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Pdm,
] as const;

const RP2350_OUTPUT_CHANNELS = [
  ChannelId.Out1L, ChannelId.Out1R,
  ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Out3L, ChannelId.Out3R,
  ChannelId.Out4L, ChannelId.Out4R,
  ChannelId.Pdm,
] as const;

const RP2040_DEFAULT_PINS = {
  [ChannelId.Out1L]: 6,
  [ChannelId.Out2L]: 7,
  [ChannelId.Pdm]: 10,
} as const;

const RP2350_DEFAULT_PINS = {
  [ChannelId.Out1L]: 6,
  [ChannelId.Out2L]: 7,
  [ChannelId.Out3L]: 8,
  [ChannelId.Out4L]: 9,
  [ChannelId.Pdm]: 10,
} as const;

// V16 RP2350 wire index space: inputs 0..7, outputs 8..16. Domain ids keep
// their V10 values; this table is the whole difference.
const V16_RP2350_WIRE_OVERRIDES: Partial<Record<ChannelIdValue, ChannelIdValue>> = {
  [ChannelId.In2L]: 2 as ChannelIdValue,
  [ChannelId.In2R]: 3 as ChannelIdValue,
  [ChannelId.In3L]: 4 as ChannelIdValue,
  [ChannelId.In3R]: 5 as ChannelIdValue,
  [ChannelId.In4L]: 6 as ChannelIdValue,
  [ChannelId.In4R]: 7 as ChannelIdValue,
  [ChannelId.Out1L]: 8 as ChannelIdValue,
  [ChannelId.Out1R]: 9 as ChannelIdValue,
  [ChannelId.Out2L]: 10 as ChannelIdValue,
  [ChannelId.Out2R]: 11 as ChannelIdValue,
  [ChannelId.Out3L]: 12 as ChannelIdValue,
  [ChannelId.Out3R]: 13 as ChannelIdValue,
  [ChannelId.Out4L]: 14 as ChannelIdValue,
  [ChannelId.Out4R]: 15 as ChannelIdValue,
  [ChannelId.Pdm]: 16 as ChannelIdValue,
};

// V10 profiles (fw 1.1.4). RP2040 keeps its PDM remap; RP2350 is identity.
export const HARDWARE_PROFILES: Record<PlatformType, HardwareProfile> = {
  [PlatformType.RP2040]: buildHardwareProfile({
    type: PlatformType.RP2040,
    name: 'RP2040',
    channelModel: ChannelFamily.Legacy,
    inputChannels: STEREO_INPUT_CHANNELS,
    outputChannels: RP2040_OUTPUT_CHANNELS,
    wireChannelOverrides: {
      [ChannelId.Pdm]: ChannelId.Out3L,
    },
    defaultPins: RP2040_DEFAULT_PINS,
  }),
  [PlatformType.RP2350]: buildHardwareProfile({
    type: PlatformType.RP2350,
    name: 'RP2350',
    channelModel: ChannelFamily.Legacy,
    inputChannels: STEREO_INPUT_CHANNELS,
    outputChannels: RP2350_OUTPUT_CHANNELS,
    defaultPins: RP2350_DEFAULT_PINS,
  }),
};

// V16 profiles (fw 1.1.5, unified channel model). RP2040 has the same 7-wide
// index space as V10 (2 inputs, outputs from 2, PDM at 6); RP2350 grows to
// 8 inputs with outputs shifted to 8..16.
const V16_HARDWARE_PROFILES: Record<PlatformType, HardwareProfile> = {
  [PlatformType.RP2040]: buildHardwareProfile({
    type: PlatformType.RP2040,
    name: 'RP2040',
    channelModel: ChannelFamily.Unified,
    inputChannels: STEREO_INPUT_CHANNELS,
    outputChannels: RP2040_OUTPUT_CHANNELS,
    wireChannelOverrides: {
      [ChannelId.Pdm]: ChannelId.Out3L,
    },
    defaultPins: RP2040_DEFAULT_PINS,
  }),
  [PlatformType.RP2350]: buildHardwareProfile({
    type: PlatformType.RP2350,
    name: 'RP2350',
    channelModel: ChannelFamily.Unified,
    inputChannels: V16_RP2350_INPUT_CHANNELS,
    outputChannels: RP2350_OUTPUT_CHANNELS,
    wireChannelOverrides: V16_RP2350_WIRE_OVERRIDES,
    defaultPins: RP2350_DEFAULT_PINS,
  }),
};

export function createHardwareProfile(type: PlatformType, channelModel: ChannelFamily = ChannelFamily.Legacy): HardwareProfile {
  return channelModel === ChannelFamily.Unified ? V16_HARDWARE_PROFILES[type] : HARDWARE_PROFILES[type];
}

export function wireChannelFor(profile: HardwareProfile, channel: ChannelIdValue): ChannelIdValue {
  return profile.wireChannelByUiChannel[channel] ?? channel;
}

export function displayNameForHardwareChannel(
  profile: HardwareProfile,
  id: ChannelIdValue,
  channelNames: readonly string[],
  fallbackName: string,
): string {
  const wireChannel = wireChannelFor(profile, id);
  const fromDevice = channelNames[wireChannel]?.trim();
  return fromDevice || fallbackName;
}
