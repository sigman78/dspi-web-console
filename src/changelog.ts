// User-facing highlights for the current app version, shown in the
// Overview tab's LATEST CHANGES panel (OV.06).

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'Control surfaces for firmware 1.1.6: target GROUPS (CT.03) so one control drives several outputs, MACROS (CT.04) with a step sequencer and FIRE, and an I2C DISPLAY (CT.05) with 16 configurable pages',
    'CONTROL tab regrouped into three columns; the new CHANGES panel (CT.06) is the single place to SAVE or DISCARD pending control-surface edits, and the slot editors fold into accordions',
    'Indicator bindings gain on/off delays and a per-LED brightness ceiling (fw 1.1.6)',
    'Firmware 1.1.6 wire V27–V29 supported end-to-end: upmix centre OFF, a fourth S/PDIF input (SY.11), first-order LP/HP EQ bands, and the subharmonic synthesizer in bulk read/write and presets — panel to follow',
    'Firmware version is read in the 1.1.6 full-width form so future patch numbers above 15 report correctly; older firmware keeps the legacy read',
    'Pin map panel (SY.16): every GPIO at a glance — color-coded by role, reserved pins hatched, ADC-capable marked — with pop-up pin pickers that show who holds each pin and why one is unavailable',
    'SYSTEM tab decluttered: panels regrouped into device / inputs / outputs columns; telemetry, error counters, and buffer stats sit behind the DEBUG toggle (or ?debug in the URL)',
    'Multi-device: connect several DSPi units at once — the DEVICES list in the sidebar switches between them, with a full state resync on every switch',
    'Firmware 1.1.5 features remain: ADAT in/out, system clock control, stereo upmixer, psychoacoustic bass, Linkwitz Transform bands, I2S slave clock mode, IR remote learning — 1.1.4 devices stay fully supported',
  ],
} as const;
