import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, I2sSlaveClockState } from '@/domain';

const stageInputSource = vi.fn();
const stageInputRate = vi.fn();

vi.mock('@/runtime', () => ({
  stageInputSource: (...a: unknown[]) => stageInputSource(...a),
  stageSpdifRxPin: vi.fn(),
  stageSpdifRxPinExt: vi.fn(),
  stageSpdifInputEnabled: vi.fn(),
  stageInputRate: (...a: unknown[]) => stageInputRate(...a),
  stageI2sRxPin: vi.fn(),
  stageI2sInputChannels: vi.fn(),
}));

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import InputConfigPanel from './InputConfigPanel.svelte';

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

function makeSnap(over: { source?: number; i2sClockMode?: number } = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0 },
    inputConfig: {
      source: over.source ?? AudioInputSource.I2s,
      spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false],
      i2sRxPins: [15], i2sInputRateHz: 48000, i2sInputChannels: 2,
      i2sClockMode: over.i2sClockMode ?? 0,
    },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
  };
}

function makeSession(o: {
  snap?: ReturnType<typeof makeSnap>;
  i2sSlaveClock?: boolean;
  i2sSlaveStatus?: object | null;
} = {}) {
  return {
    device: { capabilities: { features: { i2sInput: true, i2sSlaveClock: o.i2sSlaveClock ?? false }, spdifInputCount: 1 } },
    telemetry: { spdifRxStatus: null, i2sSlaveStatus: o.i2sSlaveStatus ?? null, activeInputChannels: null },
    mirror: { current: o.snap ?? makeSnap() },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging,
  } as any;
}

function renderPanel(session: unknown) {
  return render(InputConfigPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('InputConfigPanel — I2S rate row', () => {
  test('pre-V21 firmware keeps the interactive rate selector regardless of i2sClockMode', () => {
    renderPanel(makeSession({ snap: makeSnap({ i2sClockMode: 1 }), i2sSlaveClock: false }));
    expect(screen.getByRole('button', { name: '48k' })).toBeTruthy();
    expect(screen.queryByText(/auto-detected/)).toBeNull();
  });

  test('MASTER clock mode on V21+ firmware keeps the interactive rate selector', () => {
    renderPanel(makeSession({ snap: makeSnap({ i2sClockMode: 0 }), i2sSlaveClock: true }));
    expect(screen.getByRole('button', { name: '48k' })).toBeTruthy();
    expect(screen.queryByText(/auto-detected/)).toBeNull();
  });

  test('SLAVE clock mode on V21+ firmware replaces the rate selector with a read-only value', () => {
    renderPanel(makeSession({ snap: makeSnap({ i2sClockMode: 1 }), i2sSlaveClock: true }));
    expect(screen.queryByRole('button', { name: '48k' })).toBeNull();
    expect(screen.getByText(/auto-detected/)).toBeTruthy();
  });

  test('SLAVE clock mode shows the detected rate once telemetry reports lock', () => {
    renderPanel(makeSession({
      snap: makeSnap({ i2sClockMode: 1 }),
      i2sSlaveClock: true,
      i2sSlaveStatus: { state: I2sSlaveClockState.Locked, detectedRateHz: 96000, clockMode: 1, lockCount: 1, lossCount: 0, measuredHz: 96000, slipCount: 0 },
    }));
    expect(screen.getByText('96.0 kHz')).toBeTruthy();
  });

  test('SLAVE clock mode shows a dash while not yet locked', () => {
    renderPanel(makeSession({
      snap: makeSnap({ i2sClockMode: 1 }),
      i2sSlaveClock: true,
      i2sSlaveStatus: { state: I2sSlaveClockState.Acquiring, detectedRateHz: 0, clockMode: 1, lockCount: 0, lossCount: 0, measuredHz: 0, slipCount: 0 },
    }));
    expect(screen.getByText('—')).toBeTruthy();
  });
});
