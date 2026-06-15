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

const INPUT_CHANNELS = [ChannelId.In1L, ChannelId.In1R] as const;

interface HardwareProfileConfig {
  type: PlatformType;
  name: string;
  outputChannels: readonly ChannelIdValue[];
  wireChannelOverrides?: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  defaultPins: Partial<Record<ChannelIdValue, number>>;
}

function buildHardwareProfile(config: HardwareProfileConfig): HardwareProfile {
  const inputChannels = INPUT_CHANNELS;
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

export const HARDWARE_PROFILES: Record<PlatformType, HardwareProfile> = {
  [PlatformType.RP2040]: buildHardwareProfile({
    type: PlatformType.RP2040,
    name: 'RP2040',
    outputChannels: [
      ChannelId.Out1L, ChannelId.Out1R,
      ChannelId.Out2L, ChannelId.Out2R,
      ChannelId.Pdm,
    ],
    wireChannelOverrides: {
      [ChannelId.Pdm]: ChannelId.Out3L,
    },
    defaultPins: {
      [ChannelId.Out1L]: 6,
      [ChannelId.Out2L]: 7,
      [ChannelId.Pdm]: 10,
    },
  }),
  [PlatformType.RP2350]: buildHardwareProfile({
    type: PlatformType.RP2350,
    name: 'RP2350',
    outputChannels: [
      ChannelId.Out1L, ChannelId.Out1R,
      ChannelId.Out2L, ChannelId.Out2R,
      ChannelId.Out3L, ChannelId.Out3R,
      ChannelId.Out4L, ChannelId.Out4R,
      ChannelId.Pdm,
    ],
    defaultPins: {
      [ChannelId.Out1L]: 6,
      [ChannelId.Out2L]: 7,
      [ChannelId.Out3L]: 8,
      [ChannelId.Out4L]: 9,
      [ChannelId.Pdm]: 10,
    },
  }),
};

export function createHardwareProfile(type: PlatformType): HardwareProfile {
  return HARDWARE_PROFILES[type];
}

export function wireChannelFor(profile: HardwareProfile, channel: ChannelIdValue): ChannelIdValue {
  return profile.wireChannelByUiChannel[channel] ?? channel;
}

export function displayNameForHardwareChannel(
  profile: HardwareProfile,
  id: ChannelIdValue,
  channelNames: readonly string[],
): string {
  const wireChannel = wireChannelFor(profile, id);
  const fromDevice = channelNames[wireChannel]?.trim();
  return fromDevice || channelLayoutById(id).name;
}
