import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

vi.mock('@/runtime', () => ({
  stageI2sBckPin: vi.fn(), stageMckEnabled: vi.fn(), stageMckPin: vi.fn(), stageMckMultiplier: vi.fn(),
}));

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import I2sClockPanel from './I2sClockPanel.svelte';

const snap = {
  platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
  outputPins: [6, 7, 8, 9, 10],
  i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
  inputConfig: { source: 0, spdifRxPin: 5 },
  dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
};

const staging = {
  has: () => false,
  get: () => undefined,
  valueOf: (_key: string, live: unknown) => live,
  overlaySnapshot: (s: unknown) => s,
  entries: [],
  applying: false,
  stage: () => {},
  discard: () => {},
  discardAll: () => {},
  applyAll: async () => {},
};

const session = {
  telemetry: { info: { sampleRateHz: 96000 } },
  mirror: { current: snap },
  ctrlIfaces: { uart: null, i2c: null, status: null },
  controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
  staging,
} as any;

describe('I2sClockPanel', () => {
  test('256x multiplier option is disabled at 96 kHz', () => {
    render(I2sClockPanel, { context: new Map([[SESSION_KEY, session]]) });
    const opt256 = screen.getByRole('radio', { name: '256×' });
    expect(opt256.hasAttribute('disabled')).toBe(true);
  });

  test('LRCLK is shown as BCK + 1', () => {
    render(I2sClockPanel, { context: new Map([[SESSION_KEY, session]]) });
    expect(screen.getByText('LRCLK GP15')).toBeTruthy();
  });
});
