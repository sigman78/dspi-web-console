import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

const verbs = vi.hoisted(() => ({
  stageOutputType: vi.fn(),
  stageOutputDataPin: vi.fn(),
}));
vi.mock('@/runtime', () => verbs);

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import OutputsPanel from './OutputsPanel.svelte';

const snap = {
  platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
  outputs: [{ wireIndex: 8, enabled: false }],
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
  mirror: { current: snap },
  presets: { directory: null },
  ctrlIfaces: { uart: null, i2c: null, status: null },
  staging,
  device: {},
} as any;

beforeEach(() => { verbs.stageOutputType.mockClear(); verbs.stageOutputDataPin.mockClear(); });

describe('OutputsPanel', () => {
  test('switching a slot type calls stageOutputType(s, slot, type)', async () => {
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    const i2s = screen.getAllByRole('radio', { name: 'I2S' })[0];
    await fireEvent.click(i2s);
    expect(verbs.stageOutputType).toHaveBeenCalledWith(session, 0, 1);
  });
});
