// User-facing highlights for the current app version, shown in the
// Overview tab's LATEST CHANGES panel (OV.06).

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'Stereo Upmixer: derive Centre and surround channels from any stereo source — new panel in Processing, route Upmix C/Ls/Rs in the mixer (fw 1.1.5, RP2350)',
    'Psychoacoustic bass: missing-fundamental harmonics with per-output selection — new PSYBASS panel (fw 1.1.5)',
    'Pin pickers gain a DEFAULT option — the device restores its own factory pin, no guessing (fw 1.1.5)',
    'Linkwitz Transform EQ bands display in the equalizer (fw 1.1.5)',
    'I2S slave clock mode: sync to an external I2S master with auto-detected rate and live lock status (fw 1.1.5)',
    'IR remote control: learn buttons from any remote and bind them to device functions (Control tab)',
    'Firmware 1.1.5 wire V16–V26 supported end-to-end — 1.1.4 devices remain fully supported',
  ],
} as const;
