import { describe, expect, it } from 'vitest';
import { ChannelId } from './channels';
import { createHardwareProfile, PlatformType } from './platform';

describe('hardware profiles', () => {
  it('puts PDM at compact slot 4 on RP2040 and routes it to firmware channel 6 via wire-channel override', () => {
    const hardware = createHardwareProfile(PlatformType.RP2040);
    expect(hardware.outputSlotByChannel[ChannelId.Pdm]).toBe(4);
    expect(hardware.wireChannelByUiChannel[ChannelId.Pdm]).toBe(ChannelId.Out3L);
    expect(hardware.uiChannelByWireChannel[ChannelId.Out3L]).toBe(ChannelId.Pdm);
  });

  it('puts PDM at slot 8 on RP2350 with no wire-channel override', () => {
    const hardware = createHardwareProfile(PlatformType.RP2350);
    expect(hardware.outputSlotByChannel[ChannelId.Pdm]).toBe(8);
    expect(hardware.wireChannelByUiChannel[ChannelId.Pdm]).toBe(ChannelId.Pdm);
    expect(hardware.uiChannelByWireChannel[ChannelId.Pdm]).toBe(ChannelId.Pdm);
  });
});
