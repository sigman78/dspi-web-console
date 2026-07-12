// User-facing highlights for the current app version, shown in the
// Overview tab's LATEST CHANGES panel (OV.06).

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'I2S slave clock mode: sync to an external I2S master with auto-detected rate and live lock status (fw 1.1.5)',
    'Per-output loudness compensation: choose which outputs are compensated (fw 1.1.5)',
    'Multichannel crossfeed: enable per stereo output pair — headphones crossfed, speaker pairs stay untouched (fw 1.1.5)',
    'IR remote control: learn buttons from any remote and bind them to device functions (Control tab)',
    'Control Surfaces on firmware CS v2: button gestures, per-slot names, live preview with save/revert',
    'Channel-aware volume leveller: choose which inputs are measured and which are levelled (fw 1.1.5)',
    'Firmware 1.1.5 wire V16–V21 supported end-to-end — 1.1.4 devices remain fully supported',
  ],
} as const;
