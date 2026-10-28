// User-facing highlights for the current app version, shown in the
// LATEST CHANGES list on the ABOUT page.

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'Console v2: an icon rail with TUNE / PROGRAM / SETUP / CONTROL / ABOUT, a channel rail with presets and volume, an editable EQ graph, the processing chain laid out in firmware order, and a routing map — no tabs',
    'Firmware 1.1.5 (wire V28) is now the minimum: older devices are asked to upgrade as soon as they connect, and every 1.1.5 feature — ADAT in/out, system clock control, the stereo upmixer, psychoacoustic bass, Linkwitz Transform bands, I2S slave clock mode, IR remote learning — are no longer version-gated',
    'Per-output limiter in the TUNE output inspector: lookahead limiter with threshold, release, link groups that gang outputs together, and a live gain-reduction meter; the status line shows the added lookahead latency while it is engaged (fw 1.1.6-beta4)',
    'Wire V31–V32 support (fw 1.1.6-beta4): the bulk packet now carries the tube preamp and per-output limiter sections, read and written end-to-end so presets stay intact; their panels follow',
    'Subharmonic synthesizer module in PROGRAM: dbx-style octave divider with 24–36 Hz and 36–56 Hz sub bands, LF boost, per-output selection, and a live headroom readout with a one-click RESERVE that lowers the feeding input preamps (fw 1.1.6)',
    'Subharmonic synthesizer panel gains a third 56–80 Hz band, selectivity (mode/depth/hold), a sub ceiling, pair-linked synthesis, and a solo monitor with a live per-output meter; the sub bands now reach +12 dB on firmware that supports it (fw 1.1.6-beta3)',
    'Control surfaces for firmware 1.1.6: target GROUPS so one control drives several outputs, MACROS with a step sequencer and FIRE, and an I2C DISPLAY with 16 configurable pages',
    'CONTROL regrouped into three columns; the new CHANGES strip is the single place to SAVE or DISCARD pending control-surface edits, and the slot editors fold into accordions',
    'Indicator bindings gain on/off delays and a per-LED brightness ceiling (fw 1.1.6)',
    'Firmware 1.1.6 wire V28–V30 supported end-to-end: upmix centre OFF, a fourth S/PDIF input, first-order LP/HP EQ bands, and the subharmonic synthesizer; beta firmware now identifies itself as e.g. “1.1.6 beta 3” in SETUP › DEVICE and in issue reports',
    'Firmware version is read in the 1.1.6 full-width form so future patch numbers above 15 report correctly; older firmware keeps the legacy read; SETUP › DEVICE also shows the firmware git build stamp when the firmware reports one',
    'Control surfaces configured by a newer firmware than this console knows are left alone: an unrecognized slot is flagged rather than rewritten, so a device set up elsewhere survives a visit here intact',
    'Multi-device: connect several DSPi units at once — the DEVICES list in the channel rail switches between them, with a full state resync on every switch',
    'Also in this release line: the pin map with pop-up pin pickers showing who holds each GPIO, and telemetry, error counters, and buffer stats on SETUP › DEVICE',
  ],
} as const;
