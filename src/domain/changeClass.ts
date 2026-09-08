import type { SnapshotChange } from './snapshotDiff';

export type ChangeClass = 'preset-content' | 'runtime-status' | 'volume' | 'output-config';

// Drives presetsDirty masking: runtime-status never dirties; volume dirties
// only in WithPreset mode; output-config (the physical-IO block: pins, output
// types, I2S clock, S/PDIF RX pin) dirties only when the directory's
// output-config mode is WithPreset. Record over the kind union: a new kind
// cannot be added without classifying it.
export const CHANGE_CLASS: Record<SnapshotChange['kind'], ChangeClass> = {
  bypass:             'preset-content',
  masterPreamp:       'preset-content',
  inputPreamp:        'preset-content',
  masterVolume:       'volume',
  channelName:        'preset-content',
  band:               'preset-content',
  xoverBand:          'preset-content',
  output:             'preset-content',
  route:              'preset-content',
  loudness:           'preset-content',
  crossfeed:          'preset-content',
  leveller:           'preset-content',
  psybass:            'preset-content',
  upmix:              'preset-content',
  subharm:            'preset-content',
  inputConfig:        'preset-content',
  spdifRxPin:         'output-config',
  spdifExt:           'output-config',
  // Host-volume axis (mirrors the UAC1 OS slider, vendor mute bit). Firmware
  // presets DO store and re-apply volumeDb (whole-dB quantized; mute is
  // session-only) -- but the console still must not dirty the preset on a
  // console mute, an OS slider move, or a header-slider edit in USER mode
  // (same as the mac app, which excludes user volume from dirty tracking
  // entirely).
  userVolume:         'runtime-status',
  dacHwMute:          'preset-content',
  // ADAT bulk section bundles enable + pin like dacHwMute; same classification.
  adat:               'preset-content',
  lgSoundSyncEnabled: 'preset-content',
  lgSoundSyncStatus:  'runtime-status',
  i2s:                'output-config',
  outputPins:         'output-config',
};
