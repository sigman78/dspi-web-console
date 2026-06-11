// Root app-model: the assembled, UI-shaped picture of the device's current
// parameters, built by the device-layer snapshot codec from a parsed wire
// packet plus the detected hardware profile.

import type { ChannelId } from './channels';
import type { PlatformInfo, I2sConfig } from './platform';
import type { FilterParams } from './filter';
import type { Loudness, Crossfeed, Leveller } from './processing';
import type { OutputModel, RouteModel } from './mixer';
import type { InputConfig, LgSoundSync, UserVolume, DacHwMute } from './deviceSections';

export interface ChannelModel {
  id: ChannelId;
  name: string;
  defaultName: string;
  shortName: string;
  bandCount: number;
  isOutput: boolean;
  filters: FilterParams[];
}

export interface DspSnapshot {
  platform: PlatformInfo;
  bypass: boolean;
  masterPreampDb: number;
  inputPreampDb: [number, number];
  masterVolumeDb: number;
  channels: ChannelModel[];
  outputs: OutputModel[];
  routes: RouteModel[];
  loudness: Loudness;
  crossfeed: Crossfeed;
  // Non-null: floor sections always present on a supported device (connect
  // rejects firmware below the V6 floor).
  leveller: Leveller;
  i2s: I2sConfig;
  // GPIO pin per pin-output index, in hardware output order; the last entry is the PDM sub.
  outputPins: number[];
  // 1.1.4 sections -- the V10 connect floor guarantees every supported
  // device's packet carries them.
  inputConfig: InputConfig;
  lgSoundSync: LgSoundSync;
  userVolume: UserVolume;
  dacHwMute: DacHwMute;
}
