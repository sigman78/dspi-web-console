// The root app-model: DspSnapshot is the assembled, UI-shaped picture of
// the device's current parameters. ChannelModel is the per-EQ-channel
// enrichment of the wire-shaped channel data. Assembled by the device-layer
// snapshot codec from a parsed wire packet + the detected hardware profile.

import type { ChannelId, OutputMode } from './channels';
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
  outputMode: OutputMode | null;
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
  // Floor sections (wire V4 / V3) — always present on a supported device (V6
  // connect floor), so non-null. Absence is only reachable below the floor,
  // which connect rejects.
  leveller: Leveller;
  i2s: I2sConfig;
  // GPIO pin per pin-output index, in hardware output order; the last entry is the PDM sub.
  outputPins: number[];
  // 1.1.4 sections — null on firmware whose packet does not carry them.
  inputConfig: InputConfig | null;
  lgSoundSync: LgSoundSync | null;
  userVolume: UserVolume | null;
  dacHwMute: DacHwMute | null;
}
