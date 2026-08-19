import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, I2sSlaveClockState, AdatInputLockState } from '@/domain';

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

function makeSnap(over: { source?: number; i2sClockMode?: number; i2sInputRateHz?: number; adatInputEnabled?: boolean; adatInputPin?: number; adatInputClockMode?: number } = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0 },
    inputConfig: {
      source: over.source ?? AudioInputSource.I2s,
      spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false],
      i2sRxPins: [15], i2sInputRateHz: over.i2sInputRateHz ?? 48000, i2sInputChannels: 2,
      i2sClockMode: over.i2sClockMode ?? 0,
      adatInputEnabled: over.adatInputEnabled ?? false,
      adatInputPin: over.adatInputPin ?? 0,
      adatInputClockMode: over.adatInputClockMode ?? 0,
    },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
    adat: { enabled: false, pin: 0 },
  };
}

function makeSession(o: {
  snap?: ReturnType<typeof makeSnap>;
  i2sSlaveClock?: boolean;
  i2sSlaveStatus?: object | null;
  adatInputStatus?: object | null;
} = {}) {
  return {
    device: { capabilities: { features: { i2sInput: true, i2sSlaveClock: o.i2sSlaveClock ?? false, adatInput: true }, spdifInputCount: 1 } },
    telemetry: { spdifRxStatus: null, i2sSlaveStatus: o.i2sSlaveStatus ?? null, activeInputChannels: null, adatInputStatus: o.adatInputStatus ?? null },
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

describe('InputConfigPanel — ADAT source', () => {
  test('the ADAT chip is hidden until an input pin is assigned, then becomes stageable', async () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ adatInputEnabled: false, adatInputPin: 0 }) }));
    expect(screen.queryByRole('button', { name: 'ADAT' })).toBeNull();
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ adatInputEnabled: true, adatInputPin: 20 }) }));
    const chip = screen.getByRole('button', { name: 'ADAT' });
    await fireEvent.click(chip);
    expect(stageInputSource).toHaveBeenCalledWith(expect.anything(), AudioInputSource.Adat);
  });

  test('SLAVE clock mode renders the read-only auto-detected RATE row', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Adat, adatInputEnabled: true, adatInputPin: 20, adatInputClockMode: 1 }),
      adatInputStatus: { state: AdatInputLockState.Locked, clockMode: 1, enabled: true, pin: 20, rateOk: true, lockCount: 1, lossCount: 0, slipCount: 0, headerErr: 0, detectedRateHz: 48000, measuredHz: 48000 },
    }));
    expect(screen.getByText('48.0 kHz')).toBeTruthy();
    expect(screen.getByText(/auto-detected/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '48k' })).toBeNull();
  });

  test('MASTER clock mode disables the 96 kHz rate chip while 44.1/48 stay clickable', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Adat, adatInputEnabled: true, adatInputPin: 20, adatInputClockMode: 0, i2sInputRateHz: 44100 }),
    }));
    const chip96 = screen.getByRole('button', { name: '96k' });
    expect(chip96.hasAttribute('disabled')).toBe(true);
    expect(chip96.title).toMatch(/44\.1\/48 kHz only/);
    expect(screen.getByRole('button', { name: '48k' }).hasAttribute('disabled')).toBe(false);
  });
});
