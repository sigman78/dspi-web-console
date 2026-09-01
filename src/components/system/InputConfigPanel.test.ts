import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, I2sSlaveClockState, AdatInputLockState } from '@/domain';
import { Wire } from '@/protocol';

const stageInputSource = vi.fn();
const stageSpdifRxPin = vi.fn();
const stageSpdifRxPinExt = vi.fn();
const stageInputRate = vi.fn();
const stageI2sRxPin = vi.fn();

vi.mock('@/runtime', () => ({
  stageInputSource: (...a: unknown[]) => stageInputSource(...a),
  stageSpdifRxPin: (...a: unknown[]) => stageSpdifRxPin(...a),
  stageSpdifRxPinExt: (...a: unknown[]) => stageSpdifRxPinExt(...a),
  stageSpdifInputEnabled: vi.fn(),
  stageInputRate: (...a: unknown[]) => stageInputRate(...a),
  stageI2sRxPin: (...a: unknown[]) => stageI2sRxPin(...a),
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
  pinResetDefault?: boolean;
  spdifInputCount?: number;
} = {}) {
  return {
    device: { capabilities: { features: { i2sInput: true, i2sSlaveClock: o.i2sSlaveClock ?? false, adatInput: true, pinResetDefault: o.pinResetDefault ?? false }, spdifInputCount: o.spdifInputCount ?? 1 } },
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

describe('InputConfigPanel — S/PDIF pin pickers', () => {
  test('an unconfigured ext S/PDIF input shows UNSET, unlike the always-configured primary', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Spdif }), spdifInputCount: 2 }));
    expect(screen.getByRole('button', { name: 'S/PDIF 1 RX GPIO pin' }).textContent).toBe('GP5');
    expect(screen.getByRole('button', { name: 'S/PDIF 2 RX GPIO pin' }).textContent).toBe('UNSET');
  });

  test('ext S/PDIF pickers block re-selecting GP0 (the wire UNSET sentinel) once a real pin is assigned', () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif });
    snap.inputConfig.spdifRxPinExt = [20, 0];
    renderPanel(makeSession({ snap, spdifInputCount: 2 }));

    // Only the ext row's GP0 cell carries the sentinel reason; the primary
    // row's GP0 stays a normal free cell.
    expect((screen.getByTitle('GP0 · reserved as the UNSET sentinel') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('GP0 · free') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('InputConfigPanel — DEFAULTS chip', () => {
  test('is hidden without pin-reset firmware support', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Spdif }) }));
    expect(screen.queryByRole('button', { name: 'DEFAULTS' })).toBeNull();
  });

  test('is hidden on the USB source, which has no pin pickers', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), pinResetDefault: true }));
    expect(screen.queryByRole('button', { name: 'DEFAULTS' })).toBeNull();
  });

  test('SPDIF view stages a reset for configured pins but skips ext inputs still at the UNSET sentinel', async () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif });
    snap.inputConfig.spdifRxPinExt = [20, 0];
    renderPanel(makeSession({ snap, pinResetDefault: true, spdifInputCount: 3 }));
    await fireEvent.click(screen.getByRole('button', { name: 'DEFAULTS' }));
    expect(stageSpdifRxPin).toHaveBeenCalledWith(expect.anything(), Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageSpdifRxPinExt).toHaveBeenCalledWith(expect.anything(), 0, Wire.Const.PIN_RESET_TO_DEFAULT);
    // S/PDIF 3 is unset -- a reset would assign a GPIO with no way back to UNSET.
    expect(stageSpdifRxPinExt).not.toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
  });

  test('I2S view stages a reset for every active RX pair, and never touches S/PDIF', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }), pinResetDefault: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'DEFAULTS' }));
    expect(stageI2sRxPin).toHaveBeenCalledWith(expect.anything(), 0, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageSpdifRxPin).not.toHaveBeenCalled();
    expect(stageSpdifRxPinExt).not.toHaveBeenCalled();
  });
});
