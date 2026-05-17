import { ChannelId, OutputSlot, channelById, type ChannelId as ChannelIdValue, type ChannelLayout, type OutputSlot as OutputSlotValue } from './channels';
import { PlatformType, type PlatformInfo } from './platform';

export interface PinOutputDefinition {
  id: number;
  outputSlot: OutputSlotValue;
  channelId: ChannelIdValue;
  label: string;
  shortLabel: string;
  defaultPin: number;
}

export interface HardwareProfile extends PlatformInfo {
  inputChannels: readonly ChannelIdValue[];
  outputChannels: readonly ChannelIdValue[];
  inputs: readonly ChannelLayout[];
  outputs: readonly ChannelLayout[];
  channels: readonly ChannelLayout[];
  outputSlotByChannel: Partial<Record<ChannelIdValue, OutputSlotValue>>;
  channelByOutputSlot: Partial<Record<OutputSlotValue, ChannelIdValue>>;
  wireChannelByUiChannel: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  uiChannelByWireChannel: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  pinOutputs: readonly PinOutputDefinition[];
}

const INPUT_CHANNELS = [ChannelId.In1L, ChannelId.In1R] as const;

interface HardwareProfileConfig {
  type: PlatformType;
  name: string;
  outputChannels: readonly ChannelIdValue[];
  wireChannelOverrides?: Partial<Record<ChannelIdValue, ChannelIdValue>>;
  pinOutputs: readonly PinOutputDefinition[];
}

function buildHardwareProfile(config: HardwareProfileConfig): HardwareProfile {
  const inputChannels = INPUT_CHANNELS;
  const outputChannels = config.outputChannels;
  const inputs = inputChannels.map(channelById);
  const outputs = outputChannels.map(channelById);
  const channels = [...inputs, ...outputs];

  const outputSlotByChannel: Partial<Record<ChannelIdValue, OutputSlotValue>> = {};
  const channelByOutputSlot: Partial<Record<OutputSlotValue, ChannelIdValue>> = {};
  for (let i = 0; i < outputChannels.length; i++) {
    const slot = i as OutputSlotValue;
    const channel = outputChannels[i];
    outputSlotByChannel[channel] = slot;
    channelByOutputSlot[slot] = channel;
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
    channelByOutputSlot,
    wireChannelByUiChannel,
    uiChannelByWireChannel,
    pinOutputs: config.pinOutputs,
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
    pinOutputs: [
      { id: 0, outputSlot: OutputSlot.Out1L, channelId: ChannelId.Out1L, label: 'Output 1', shortLabel: 'OUT 1/2', defaultPin: 6 },
      { id: 1, outputSlot: OutputSlot.Out2L, channelId: ChannelId.Out2L, label: 'Output 2', shortLabel: 'OUT 3/4', defaultPin: 7 },
      { id: 2, outputSlot: 4 as OutputSlotValue, channelId: ChannelId.Pdm, label: 'PDM', shortLabel: 'SUB OUT', defaultPin: 10 },
    ],
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
    pinOutputs: [
      { id: 0, outputSlot: OutputSlot.Out1L, channelId: ChannelId.Out1L, label: 'Output 1', shortLabel: 'OUT 1/2', defaultPin: 6 },
      { id: 1, outputSlot: OutputSlot.Out2L, channelId: ChannelId.Out2L, label: 'Output 2', shortLabel: 'OUT 3/4', defaultPin: 7 },
      { id: 2, outputSlot: OutputSlot.Out3L, channelId: ChannelId.Out3L, label: 'Output 3', shortLabel: 'OUT 5/6', defaultPin: 8 },
      { id: 3, outputSlot: OutputSlot.Out4L, channelId: ChannelId.Out4L, label: 'Output 4', shortLabel: 'OUT 7/8', defaultPin: 9 },
      { id: 4, outputSlot: OutputSlot.Pdm, channelId: ChannelId.Pdm, label: 'PDM', shortLabel: 'SUB OUT', defaultPin: 10 },
    ],
  }),
};

export function createHardwareProfile(type: PlatformType): HardwareProfile {
  return HARDWARE_PROFILES[type];
}

export function wireChannelFor(profile: HardwareProfile, channel: ChannelIdValue): ChannelIdValue {
  return profile.wireChannelByUiChannel[channel] ?? channel;
}

export function uiChannelFor(profile: HardwareProfile, channel: ChannelIdValue): ChannelIdValue {
  return profile.uiChannelByWireChannel[channel] ?? channel;
}

export function displayNameForHardwareChannel(
  profile: HardwareProfile,
  id: ChannelIdValue,
  channelNames: readonly string[],
): string {
  const wireChannel = wireChannelFor(profile, id);
  const fromDevice = channelNames[wireChannel]?.trim();
  return fromDevice || channelById(id).name;
}
