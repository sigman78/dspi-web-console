// User-facing highlights for the current app version, shown in the
// Overview tab's LATEST CHANGES panel (OV.06).

export const LATEST_CHANGES = {
  version: '0.3.0',
  highlights: [
    'Firmware 1.1.5 / wire V16: 8-in/9-out on RP2350 — 1.1.4 devices remain fully supported',
    'I2S multichannel input (up to 8 channels), input source config now contextual',
    'Per-output crossover filters, rendered in the response plots',
    'UART / I2C external control interfaces (System tab)',
    'Heavy device config now stages — review and APPLY as one batch, one audio restart',
    'Preset copy/paste via snapshot clipboard',
  ],
} as const;
