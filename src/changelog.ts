// User-facing highlights for the current app version, shown in the
// Overview tab's LATEST CHANGES panel (OV.06).

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'IR remote control: learn buttons from any remote and bind them to device functions (Control tab)',
    'Control Surfaces on firmware CS v2: button gestures, per-slot names, live preview with save/revert',
    'Channel-aware volume leveller: choose which inputs are measured and which are levelled (fw 1.1.5)',
    'Up to 3 selectable S/PDIF inputs on RP2350 (fw 1.1.5)',
    'Segmented LED channel VU meters with per-channel row styling',
    'Device panel shows protocol versions and why a feature panel may be gated on your firmware',
    'Firmware 1.1.5 wire V16–V18 supported end-to-end — 1.1.4 devices remain fully supported',
  ],
} as const;
