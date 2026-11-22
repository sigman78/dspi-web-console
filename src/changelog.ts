// User-facing highlights for the current app version, shown in the
// LATEST CHANGES list on the ABOUT page.

import { APP_VERSION } from './buildInfo';

export const LATEST_CHANGES = {
  version: APP_VERSION,
  highlights: [
    'Name your DSPi and its input sources (fw 1.1.6): rename the board in SETUP › DEVICE and the inputs with ✎ in SETUP › INPUTS; the names show in the device switcher, ROOM and Control Surfaces',
    'ROOM flares on musical hits: the back wall, floor and horizon flash on kicks and snares, in spectrum and VU modes alike',
    'ROOM hue can follow the preset: the link button above the hue slider pins the current colour to the active preset',
    'Control Surfaces can bind output latency, and input-source values cover all seven sources (fw 1.1.6)',
    'ROOM’s analyser no longer fights another client (UART, I2C or a control surface) that has set it up differently',
    'Clearer routing chips, channel marks and Control Surface lists',
    'Fixed: editing a bypassed EQ or crossover band no longer turns its bypass off on the device; reset, clear, AutoEQ and copy EQ keep it too',
    'Fixed: CLEAR CLIPS now clears the clip latch on the hardware',
  ],
} as const;
