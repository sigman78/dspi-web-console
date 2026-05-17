import { describe, expect, it } from 'vitest';
import { ChannelId } from './channels';
import { createHardwareProfile } from './hardware';
import { PlatformType } from './platform';

describe('hardware profiles', () => {
  it('defines RP2040 compact PDM wiring', () => {
    const hardware = createHardwareProfile(PlatformType.RP2040);
    const pdmPin = hardware.pinOutputs.find((output) => output.channelId === ChannelId.Pdm);

    expect(hardware.outputChannels).toEqual([
      ChannelId.Out1L, ChannelId.Out1R,
      ChannelId.Out2L, ChannelId.Out2R,
      ChannelId.Pdm,
    ]);
    expect(hardware.outputSlotByChannel[ChannelId.Pdm]).toBe(4);
    expect(hardware.wireChannelByUiChannel[ChannelId.Pdm]).toBe(6);
    expect(hardware.uiChannelByWireChannel[6]).toBe(ChannelId.Pdm);
    expect(pdmPin?.id).toBe(2);
    expect(pdmPin?.outputSlot).toBe(4);
    expect(pdmPin?.defaultPin).toBe(10);
  });

  it('defines RP2350 PDM wiring without channel translation', () => {
    const hardware = createHardwareProfile(PlatformType.RP2350);
    const pdmPin = hardware.pinOutputs.find((output) => output.channelId === ChannelId.Pdm);

    expect(hardware.outputChannels).toEqual([
      ChannelId.Out1L, ChannelId.Out1R,
      ChannelId.Out2L, ChannelId.Out2R,
      ChannelId.Out3L, ChannelId.Out3R,
      ChannelId.Out4L, ChannelId.Out4R,
      ChannelId.Pdm,
    ]);
    expect(hardware.outputSlotByChannel[ChannelId.Pdm]).toBe(8);
    expect(hardware.wireChannelByUiChannel[ChannelId.Pdm]).toBe(10);
    expect(hardware.uiChannelByWireChannel[10]).toBe(ChannelId.Pdm);
    expect(pdmPin?.id).toBe(4);
    expect(pdmPin?.outputSlot).toBe(8);
    expect(pdmPin?.defaultPin).toBe(10);
  });
});
