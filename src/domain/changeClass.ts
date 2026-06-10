import type { SnapshotChange } from './snapshotDiff';

export type ChangeClass = 'preset-content' | 'runtime-status' | 'volume' | 'pin-config';

// Drives presetsDirty masking: runtime-status never dirties; volume dirties
// only in WithPreset mode and never while soft-muted; pin-config dirties only
// when the preset includes pins. Record over the kind union: a new kind
// cannot be added without classifying it.
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
  userVolume:         'preset-content',
  dacHwMute:          'preset-content',
  lgSoundSyncEnabled: 'preset-content',
  lgSoundSyncStatus:  'runtime-status',
  i2s:                'preset-content',
  outputPins:         'pin-config',
};
