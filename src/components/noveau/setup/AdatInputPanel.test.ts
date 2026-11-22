import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, AdatInputLockState } from '@/domain';

const stageAdatInputPin = vi.fn();
const stageAdatInputClockMode = vi.fn();

vi.mock('@/runtime', () => ({
  stageAdatInputPin: (...a: unknown[]) => stageAdatInputPin(...a),
  stageAdatInputClockMode: (...a: unknown[]) => stageAdatInputClockMode(...a),
  stagedCtrlPins: () => ({ uart: null, i2c: null, cs: [] }),
}));

import AdatInputPanel from './AdatInputPanel.svelte';

function makeSnap(over: { inputConfig?: object; adat?: object; dacHwMute?: object } = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0 },
    inputConfig: {
      source: AudioInputSource.Usb,
      spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifEnabled: true, spdifCount: 1, i2sEnabled: true,
      i2sRxPins: [15], i2sInputRateHz: 48000, i2sInputChannels: 2, i2sClockMode: 0,
      adatInputEnabled: false, adatInputPin: 0, adatInputClockMode: 0,
      ...over.inputConfig,
    },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0, ...over.dacHwMute },
    adat: { enabled: false, pin: 0, ...over.adat },
  };
}

function makeSession(o: {
  snap?: ReturnType<typeof makeSnap>;
  adatInputStatus?: object | null;
} = {}) {
  return {
    device: { capabilities: { features: { adatInput: true } } },
    telemetry: { adatInputStatus: o.adatInputStatus ?? null },
    mirror: { current: o.snap ?? makeSnap() },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging: {
      has: () => false,
      overlaySnapshot: (snap: any) => snap,
    },
  } as any;
}

function renderPanel(session: unknown) {
  return render(AdatInputPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdatInputPanel', () => {
  test('has no enable switch: the inputs list owns it', () => {
    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputPin: 20 } }) }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: 'ADAT input GPIO pin' })).toBeTruthy();
  });

  test('the clear-pin reset only appears while disabled with an assigned pin, and stages the 0xFF sentinel', async () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: true, adatInputPin: 20 } }) }));
    expect(screen.queryByRole('button', { name: 'Clear ADAT input pin' })).toBeNull();
    unmount();

    const { unmount: unmount2 } = renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: false, adatInputPin: 0 } }) }));
    expect(screen.queryByRole('button', { name: 'Clear ADAT input pin' })).toBeNull();
    unmount2();

    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: false, adatInputPin: 20 } }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear ADAT input pin' }));
    expect(stageAdatInputPin).toHaveBeenCalledWith(expect.anything(), 0xFF);
  });

  test('the ADAT output pin stays selectable for loopback while another claimed pin does not', () => {
    renderPanel(makeSession({
      snap: makeSnap({ adat: { enabled: true, pin: 20 }, dacHwMute: { enabled: true, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 } }),
    }));
    const opts = screen.getAllByRole('option', { hidden: true }) as HTMLButtonElement[];
    const opt20 = opts.find((o) => o.textContent?.includes('GP20'))!;
    const opt11 = opts.find((o) => o.textContent?.includes('GP11'))!;
    expect(opt20.disabled).toBe(false);
    expect(opt11.disabled).toBe(true);
  });

  test('the SLAVE clock chip stages clock mode 1', async () => {
    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputClockMode: 0 } }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'SLAVE' }));
    expect(stageAdatInputClockMode).toHaveBeenCalledWith(expect.anything(), 1);
  });

  test('a locked status renders rate and counters, with the slip warn presentation', () => {
    renderPanel(makeSession({
      snap: makeSnap({ inputConfig: { adatInputEnabled: true, adatInputPin: 20 } }),
      adatInputStatus: { state: AdatInputLockState.Locked, clockMode: 0, enabled: true, pin: 20, rateOk: true, lockCount: 5, lossCount: 0, slipCount: 2, headerErr: 0, detectedRateHz: 48000, measuredHz: 48000 },
    }));
    expect(screen.getByText('LOCKED')).toBeTruthy();
    expect(screen.getByText('48.0 kHz')).toBeTruthy();
    const slip = screen.getByText('2');
    expect(slip.className).toMatch(/warn/);
  });

  test('a master-parked status (rateOk false) shows the PARKED presentation', () => {
    renderPanel(makeSession({
      snap: makeSnap({ inputConfig: { adatInputEnabled: true, adatInputPin: 20 } }),
      adatInputStatus: { state: AdatInputLockState.Acquiring, clockMode: 0, enabled: true, pin: 20, rateOk: false, lockCount: 0, lossCount: 0, slipCount: 0, headerErr: 0, detectedRateHz: 0, measuredHz: 0 },
    }));
    const stateVal = screen.getByText('PARKED — RATE > 48 KHZ');
    expect(stateVal.className).toMatch(/warn/);
  });

  test('shows a waiting hint while enabled but status has not arrived yet', () => {
    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: true, adatInputPin: 20 } }), adatInputStatus: null }));
    expect(screen.getByText(/Waiting for ADAT input status/)).toBeTruthy();
  });
});
