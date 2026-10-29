// User-facing highlights for the current app version, shown in the
// LATEST CHANGES list on the ABOUT page.

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'ROOM: a live spectrum of what the system is playing, read from the board’s own analyser, with the preset slots one click away (fw 1.1.6-beta4 and newer; older firmware shows a simulated spectrum)',
    'ROOM also shows VU meters: switch between spectrum, input meters and output meters on the right edge; each channel gets a segmented light pillar in its own colour with a peak marker, and a hue slider tints the scene',
    'New console layout: an icon rail with ROOM / TUNE / PROGRAM / SETUP / CONTROL / ABOUT, a channel rail with presets and volume, an editable EQ graph, the processing chain in firmware order, and a routing map',
    'Firmware 1.1.5 is now the minimum: older devices are asked to upgrade when they connect, and every 1.1.5 feature is available without version checks',
    'Output latency is selectable in SETUP › OUTPUTS and STATS shows output-buffer health (fw 1.1.6 past beta 5); Control Surfaces name every newer function, including Save Preset, and can bind the limiter release',
    'Linked EQ: pair channels so band, crossover, preamp, trim and delay edits mirror across both',
    'Per-output lookahead limiter in TUNE: threshold, release, link groups and a live gain-reduction meter (fw 1.1.6)',
  ],
} as const;
