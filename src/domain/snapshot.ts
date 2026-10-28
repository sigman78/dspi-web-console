// Root app-model: the assembled, UI-shaped picture of the device's current
// parameters, built by the device-layer snapshot codec from a parsed wire
// packet plus the detected hardware profile.

import type { ChannelId } from './channels';
import type { HardwareProfile, I2sConfig, PlatformType } from './platform';
import type { FilterParams } from './filter';
import type { Loudness, Crossfeed, Leveller, Psybass, Upmix, Subharm, Tube, LimiterOutput } from './processing';
import type { OutputModel, RouteModel } from './mixer';
import type { InputConfig, LgSoundSync, UserVolume, DacHwMute, AdatOutputConfig } from './deviceSections';

export interface ChannelModel {
  id: ChannelId;
  name: string;
  defaultName: string;
  shortName: string;
  bandCount: number;
  isOutput: boolean;
  filters: FilterParams[];
  // Crossover bands (output channels only; addressed at wire band
  // indices XOVER_BAND_BASE..+3). Empty on inputs.
  xoverBands: FilterParams[];
}

// The platform identity the snapshot carries: the display/pin-rule subset of
// the device's HardwareProfile, copied in by pickSummary so the snapshot stays
// a lightweight value and doesn't drag the profile's channel/slot/pin maps
// through the mirror. Local re-declaration rather than a Pick<HardwareProfile>
// so the shape reads plainly at a glance; pickSummary keeps the two in step.
export interface PlatformSummary {
  type: PlatformType;
  name: string;
  outputCount: number;
  totalChannelCount: number;
  pdmOutputIndex: number;
}

export function pickSummary(hw: HardwareProfile): PlatformSummary {
  return {
    type: hw.type,
    name: hw.name,
    outputCount: hw.outputCount,
    totalChannelCount: hw.totalChannelCount,
    pdmOutputIndex: hw.pdmOutputIndex,
  };
}

export interface DspSnapshot {
  platform: PlatformSummary;
  bypass: boolean;
  masterPreampDb: number;
  // Per-input-slot preamp, one entry per hardware input channel (2 or 8).
  inputPreampDb: number[];
  masterVolumeDb: number;
  channels: ChannelModel[];
  outputs: OutputModel[];
  routes: RouteModel[];
  loudness: Loudness;
  crossfeed: Crossfeed;
  // Always present on a supported device.
  leveller: Leveller;
  // Psychoacoustic bass.
  psybass: Psybass;
  // Stereo upmixer.
  upmix: Upmix;
  // Subharmonic synthesizer (fw V29+); bulkParser defaults it on older
  // packets, so this is always populated.
  subharm: Subharm;
  // Tube preamp (fw V31+) and per-output limiter (fw V32+, always the full
  // 9 wire entries); bulkParser defaults both on older packets, so these are
  // always populated.
  tube: Tube;
  limiter: LimiterOutput[];
  i2s: I2sConfig;
  // GPIO pin per pin-output index, in hardware output order; the last entry is the PDM sub.
  outputPins: number[];
  inputConfig: InputConfig;
  lgSoundSync: LgSoundSync;
  userVolume: UserVolume;
  dacHwMute: DacHwMute;
  // ADAT lightpipe output config (RP2350).
  adat: AdatOutputConfig;
}
