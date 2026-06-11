import type { SnapshotChange } from './snapshotDiff';

export type ChangeClass = 'preset-content' | 'runtime-status' | 'volume' | 'output-config';

// Drives presetsDirty masking: runtime-status never dirties; volume dirties
// only in WithPreset mode and never while soft-muted; output-config (the
// physical-IO block: pins, output types, I2S clock, S/PDIF RX pin) dirties
// only when the directory's output-config mode is WithPreset -- with a legacy
// carve-out applied at the mask site (pre-1.1.4 firmware restores i2s with
// every preset, mode bit notwithstanding). Record over the kind union: a new
// kind cannot be added without classifying it.
export const CHANGE_CLASS: Record<SnapshotChange['kind'], ChangeClass> = {
  bypass:             'preset-content',
  masterPreamp:       'preset-content',
  inputPreamp:        'preset-content',
  masterVolume:       'volume',
  channelName:        'preset-content',
  band:               'preset-content',
  output:             'preset-content',
  route:              'preset-content',
  loudness:           'preset-content',
  crossfeed:          'preset-content',
  leveller:           'preset-content',
  inputConfig:        'preset-content',
  spdifRxPin:         'output-config',
  userVolume:         'preset-content',
  dacHwMute:          'preset-content',
  lgSoundSyncEnabled: 'preset-content',
  lgSoundSyncStatus:  'runtime-status',
  i2s:                'output-config',
  outputPins:         'output-config',
};
