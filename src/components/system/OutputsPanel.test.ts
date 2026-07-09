import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

const verbs = vi.hoisted(() => ({
  stageOutputType: vi.fn(),
  stageOutputDataPin: vi.fn(),
  setOutputPairEnabled: vi.fn(),
  setOutputEnabled: vi.fn(),
}));
vi.mock('@/runtime', () => verbs);

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import OutputsPanel from './OutputsPanel.svelte';

function makeSnap(enabledSlots: number[] = []) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputs: Array.from({ length: 9 }, (_, wireIndex) => ({ wireIndex, enabled: enabledSlots.includes(wireIndex) })),
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
    inputConfig: { source: 0, spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false] },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
  };
}

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

function makeSession(snap: ReturnType<typeof makeSnap>) {
  return {
    mirror: { current: snap },
    presets: { directory: null },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging,
    device: {},
  } as any;
}

beforeEach(() => {
  verbs.stageOutputType.mockClear();
  verbs.stageOutputDataPin.mockClear();
  verbs.setOutputPairEnabled.mockClear();
  verbs.setOutputEnabled.mockClear();
});

describe('OutputsPanel', () => {
  test('switching a slot type calls stageOutputType(s, slot, type)', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    const i2s = screen.getAllByRole('radio', { name: 'I2S' })[0];
    await fireEvent.click(i2s);
    expect(verbs.stageOutputType).toHaveBeenCalledWith(session, 0, 1);
  });

  test('toggling OUT 1 calls setOutputPairEnabled(s, 0, true)', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('switch', { name: 'Out 1 enable' }));
    expect(verbs.setOutputPairEnabled).toHaveBeenCalledWith(session, 0, true);
  });

  test('toggling the PDM sub calls setOutputEnabled(s, 8, true)', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('switch', { name: 'PDM sub enable' }));
    expect(verbs.setOutputEnabled).toHaveBeenCalledWith(session, 8, true);
  });

  test('while PDM is active, OUT 2-4 toggles are locked but OUT 1 stays available', () => {
    const session = makeSession(makeSnap([8]));
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    expect(screen.getByRole('switch', { name: 'Out 1 enable' })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Out 2 enable' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Out 3 enable' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Out 4 enable' })).toBeDisabled();
  });

  test('while a Core-1 EQ output is active, the PDM toggle is locked', () => {
    const session = makeSession(makeSnap([2]));
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    expect(screen.getByRole('switch', { name: 'PDM sub enable' })).toBeDisabled();
  });

  test('with nothing active, OUT toggles and the PDM toggle are all available', () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    expect(screen.getByRole('switch', { name: 'Out 1 enable' })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Out 2 enable' })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: 'PDM sub enable' })).not.toBeDisabled();
  });
});
