import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { Wire } from '@/protocol';

const verbs = vi.hoisted(() => ({
  stageOutputType: vi.fn(),
  stageOutputDataPin: vi.fn(),
  stageOutputPairEnabled: vi.fn(),
  stagePdmEnabled: vi.fn(),
  stageOutputLatency: vi.fn(),
  stagedCtrlPins: () => ({ uart: null, i2c: null, cs: [] }),
}));
vi.mock('@/runtime', () => verbs);

import OutputsPanel from './OutputsPanel.svelte';

function makeSnap(enabledSlots: number[] = []) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputs: Array.from({ length: 9 }, (_, wireIndex) => ({ wireIndex, enabled: enabledSlots.includes(wireIndex) })),
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
    inputConfig: { source: 0, spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false] },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
    adat: { enabled: false, pin: 0 },
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

const LATENCY_OPTIONS = [
  { id: 1, latencyUs: 667, batchUs: 333, effectiveUs: 2000, streamOnly: true, available: false },
  { id: 5, latencyUs: 4000, batchUs: 1000, effectiveUs: 4000, streamOnly: false, available: true },
  // 44.1 kHz: the firmware's frame round trip reads 4000 us back as 3991.
  { id: 6, latencyUs: 4000, batchUs: 1000, effectiveUs: 3991, streamOnly: false, available: true },
];

function makeSession(snap: ReturnType<typeof makeSnap>, latency: { supported: boolean | null; requestedId?: number } = { supported: null }) {
  return {
    outputLatency: {
      supported: latency.supported,
      busy: false,
      status: latency.supported ? { requestedId: latency.requestedId ?? 5 } : null,
      options: latency.supported ? LATENCY_OPTIONS : null,
    },
    mirror: { current: snap },
    presets: { directory: null },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging,
  } as any;
}

beforeEach(() => {
  verbs.stageOutputType.mockClear();
  verbs.stageOutputDataPin.mockClear();
  verbs.stageOutputPairEnabled.mockClear();
  verbs.stagePdmEnabled.mockClear();
});

describe('OutputsPanel', () => {
  test('switching a slot type calls stageOutputType(s, slot, type)', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    const i2s = screen.getAllByRole('radio', { name: 'I2S' })[0];
    await fireEvent.click(i2s);
    expect(verbs.stageOutputType).toHaveBeenCalledWith(session, 0, 1);
  });

  test('toggling OUT 1 stages the pair enable', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('switch', { name: 'Out 1 enable' }));
    expect(verbs.stageOutputPairEnabled).toHaveBeenCalledWith(session, 0, true);
  });

  test('toggling the PDM sub stages the PDM enable', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('switch', { name: 'PDM sub enable' }));
    expect(verbs.stagePdmEnabled).toHaveBeenCalledWith(session, true);
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

  test('DEFAULTS chip stages a pin reset for every SPDIF slot plus PDM when PDM is idle', async () => {
    const session = makeSession(makeSnap());
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset output pins to defaults' }));
    for (let slot = 0; slot < 4; slot++) {
      expect(verbs.stageOutputDataPin).toHaveBeenCalledWith(session, slot, Wire.Const.PIN_RESET_TO_DEFAULT);
    }
    expect(verbs.stageOutputDataPin).toHaveBeenCalledWith(session, 4, Wire.Const.PIN_RESET_TO_DEFAULT);
  });

  test('DEFAULTS chip skips the PDM pin while PDM is active', async () => {
    const session = makeSession(makeSnap([8]));
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset output pins to defaults' }));
    expect(verbs.stageOutputDataPin).not.toHaveBeenCalledWith(session, 4, Wire.Const.PIN_RESET_TO_DEFAULT);
  });

  test('the latency row is hidden until the device is known to support it', () => {
    render(OutputsPanel, { context: new Map([[SESSION_KEY, makeSession(makeSnap(), { supported: false })]]) });
    expect(screen.queryByRole('combobox', { name: 'Output latency' })).toBeNull();
  });

  test('a stream-only option on USB keeps a plain label, dims, and shows what it runs as', async () => {
    const session = makeSession(makeSnap(), { supported: true, requestedId: 1 });
    render(OutputsPanel, { context: new Map([[SESSION_KEY, session]]) });
    const select = screen.getByRole('combobox', { name: 'Output latency' }) as HTMLSelectElement;
    expect(select.value).toBe('1');
    const opt = screen.getByRole('option', { name: '0.67 ms' });
    expect(opt.classList.contains('dim')).toBe(true);
    expect(screen.getAllByRole('option', { name: '4 ms' }).some((o) => o.classList.contains('dim'))).toBe(false);
    expect(screen.getByText('runs 2 ms on USB')).toBeTruthy();

    await fireEvent.change(select, { target: { value: '5' } });
    expect(verbs.stageOutputLatency).toHaveBeenCalledWith(session, 5);
  });

  test('frame rounding of the effective time does not draw a runs note', () => {
    render(OutputsPanel, { context: new Map([[SESSION_KEY, makeSession(makeSnap(), { supported: true, requestedId: 6 })]]) });
    expect(screen.getByRole('combobox', { name: 'Output latency' })).toBeTruthy();
    expect(screen.queryByText(/^runs /)).toBeNull();
  });
});
