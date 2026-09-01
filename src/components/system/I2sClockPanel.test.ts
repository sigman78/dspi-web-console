import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, I2sSlaveClockState } from '@/domain';
import { Wire } from '@/protocol';

const stageI2sBckPin = vi.fn();
const stageMckEnabled = vi.fn();
const stageMckPin = vi.fn();
const stageMckMultiplier = vi.fn();
const stageI2sClockMode = vi.fn();
const stageI2sClockPinMode = vi.fn();
const stageI2sBckPinSlave = vi.fn();

vi.mock('@/runtime', () => ({
  stageI2sBckPin: (...a: unknown[]) => stageI2sBckPin(...a),
  stageMckEnabled: (...a: unknown[]) => stageMckEnabled(...a),
  stageMckPin: (...a: unknown[]) => stageMckPin(...a),
  stageMckMultiplier: (...a: unknown[]) => stageMckMultiplier(...a),
  stageI2sClockMode: (...a: unknown[]) => stageI2sClockMode(...a),
  stageI2sClockPinMode: (...a: unknown[]) => stageI2sClockPinMode(...a),
  stageI2sBckPinSlave: (...a: unknown[]) => stageI2sBckPinSlave(...a),
}));

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import I2sClockPanel from './I2sClockPanel.svelte';

function makeSnap(over: {
  i2s?: object;
  inputConfig?: object;
} = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0, ...over.i2s },
    inputConfig: { source: AudioInputSource.Usb, spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false], i2sClockMode: 0, ...over.inputConfig },
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

function makeSession(o: {
  snap?: ReturnType<typeof makeSnap>;
  i2sSlaveClock?: boolean;
  i2sSlaveStatus?: object | null;
  pinResetDefault?: boolean;
} = {}) {
  return {
    device: { capabilities: { features: { i2sSlaveClock: o.i2sSlaveClock ?? false, pinResetDefault: o.pinResetDefault ?? false } } },
    telemetry: { info: { sampleRateHz: 96000 }, i2sSlaveStatus: o.i2sSlaveStatus ?? null },
    mirror: { current: o.snap ?? makeSnap() },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging,
  } as any;
}

function renderPanel(session: unknown) {
  return render(I2sClockPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('I2sClockPanel', () => {
  test('256x multiplier option is disabled at 96 kHz', () => {
    renderPanel(makeSession());
    const opt256 = screen.getByRole('radio', { name: '256×' });
    expect(opt256.hasAttribute('disabled')).toBe(true);
  });

  test('LRCLK is shown as BCK + 1', () => {
    renderPanel(makeSession());
    expect(screen.getByText('LRCLK GP15')).toBeTruthy();
  });

  test('hides the MODE row on firmware without slave-clock support (pre-V21)', () => {
    renderPanel(makeSession({ i2sSlaveClock: false }));
    expect(screen.queryByRole('radiogroup', { name: 'I2S clock mode' })).toBeNull();
  });

  test('shows the MODE row on V21+ firmware', () => {
    renderPanel(makeSession({ i2sSlaveClock: true }));
    expect(screen.getByRole('radiogroup', { name: 'I2S clock mode' })).toBeTruthy();
  });

  test('MASTER is selected by default and switching to SLAVE stages the mode', async () => {
    renderPanel(makeSession({ i2sSlaveClock: true }));
    const slaveOpt = screen.getByRole('radio', { name: 'SLAVE' });
    expect(screen.getByRole('radio', { name: 'MASTER' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(slaveOpt);
    expect(stageI2sClockMode).toHaveBeenCalledWith(expect.anything(), 1);
  });

  test('SLAVE mode status line shows LOCKED and the detected rate once telemetry reports lock', () => {
    const snap = makeSnap({ inputConfig: { source: AudioInputSource.I2s, i2sClockMode: 1 } });
    renderPanel(makeSession({
      snap, i2sSlaveClock: true,
      i2sSlaveStatus: { state: I2sSlaveClockState.Locked, detectedRateHz: 48000, clockMode: 1, lockCount: 1, lossCount: 0, measuredHz: 48000, slipCount: 0 },
    }));
    expect(screen.getByText('LOCKED')).toBeTruthy();
    expect(screen.getByText('48.0 kHz')).toBeTruthy();
  });

  test('SLAVE mode with a non-I2S source shows a minimal hint instead of status', () => {
    const snap = makeSnap({ inputConfig: { source: AudioInputSource.Usb, i2sClockMode: 1 } });
    renderPanel(makeSession({ snap, i2sSlaveClock: true }));
    expect(screen.getByText(/Source is not I2S/)).toBeTruthy();
    expect(screen.queryByText('LOCKED')).toBeNull();
  });

  test('CLK PINS defaults to UNIFIED and hides the slave BCK pin select', () => {
    renderPanel(makeSession({ i2sSlaveClock: true }));
    expect(screen.getByRole('radio', { name: 'UNIFIED' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'I2S BCK pin (slave)' })).toBeNull();
  });

  test('SPLIT clock-pin mode reveals the slave BCK pin select and its LRCLK hint', () => {
    const snap = makeSnap({ i2s: { clockPinMode: 1, bckPinSlave: 26 } });
    renderPanel(makeSession({ snap, i2sSlaveClock: true }));
    expect(screen.getByRole('radio', { name: 'SPLIT' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'I2S BCK pin (slave)' }).textContent).toBe('GP26');
    expect(screen.getByText('LRCLK GP27')).toBeTruthy();
  });

  test('a staged BCK pin reset blanks the LRCLK hint until the device resolves the real pin', () => {
    const session = makeSession();
    session.staging = { ...staging, valueOf: (key: string, live: unknown) => (key === 'bckPin' ? Wire.Const.PIN_RESET_TO_DEFAULT : live) };
    renderPanel(session);
    expect(screen.getByRole('button', { name: 'I2S BCK pin' }).textContent).toBe('DEFAULT');
    expect(screen.getByText('LRCLK —')).toBeTruthy();
  });

  test('DEFAULTS chip is hidden without pin-reset firmware support', () => {
    renderPanel(makeSession());
    expect(screen.queryByRole('button', { name: 'Reset clock pins to defaults' })).toBeNull();
  });

  test('DEFAULTS chip stages a BCK and MCK pin reset when both are free to change', async () => {
    renderPanel(makeSession({ pinResetDefault: true, i2sSlaveClock: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset clock pins to defaults' }));
    expect(stageI2sBckPin).toHaveBeenCalledWith(expect.anything(), Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageMckPin).toHaveBeenCalledWith(expect.anything(), Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageI2sBckPinSlave).not.toHaveBeenCalled();
  });

  test('DEFAULTS chip skips the BCK reset while an output slot runs I2S', async () => {
    const snap = makeSnap({ i2s: { outputSlotTypes: [1, 0, 0, 0] } });
    renderPanel(makeSession({ snap, pinResetDefault: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset clock pins to defaults' }));
    expect(stageI2sBckPin).not.toHaveBeenCalled();
  });

  test('DEFAULTS chip skips the MCK reset while MCK is enabled', async () => {
    const snap = makeSnap({ i2s: { mckEnabled: true } });
    renderPanel(makeSession({ snap, pinResetDefault: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset clock pins to defaults' }));
    expect(stageMckPin).not.toHaveBeenCalled();
  });

  test('DEFAULTS chip also resets the slave BCK pin in SPLIT clock-pin mode', async () => {
    const snap = makeSnap({ i2s: { clockPinMode: 1 } });
    renderPanel(makeSession({ snap, pinResetDefault: true, i2sSlaveClock: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset clock pins to defaults' }));
    expect(stageI2sBckPinSlave).toHaveBeenCalledWith(expect.anything(), Wire.Const.PIN_RESET_TO_DEFAULT);
  });
});
