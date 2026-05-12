// The root app-model: DspSnapshot is the assembled, UI-shaped picture of
// the device's current parameters. ChannelModel is the per-EQ-channel
// enrichment of the wire-shaped channel data. Built by bulkToSnapshot.ts
// from a parsed BulkParams + the platform layout (see channels.ts).

import type { ChannelId, OutputMode } from './channels';
import type { PlatformInfo, I2sConfig } from './platform';
import type { FilterParams } from './filter';
import type { Loudness, Crossfeed, Leveller } from './processing';
import type { OutputModel, RouteModel } from './mixer';

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
  formatVersion: number;
  bypass: boolean;
  masterPreampDb: number;
  inputPreampDb: [number, number];
  masterVolumeDb: number;
  channels: ChannelModel[];
  outputs: OutputModel[];
  routes: RouteModel[];
  loudness: Loudness;
  crossfeed: Crossfeed;
  leveller: Leveller | null;
  i2s: I2sConfig | null;
}
