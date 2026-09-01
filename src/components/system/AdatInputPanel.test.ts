import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelFamily, AudioInputSource, AdatInputLockState } from '@/domain';

const setAdatInputEnable = vi.fn();
const setAdatInputPin = vi.fn();
const setAdatInputClockMode = vi.fn();

vi.mock('@/runtime', () => ({
  setAdatInputEnable: (...a: unknown[]) => setAdatInputEnable(...a),
  setAdatInputPin: (...a: unknown[]) => setAdatInputPin(...a),
  setAdatInputClockMode: (...a: unknown[]) => setAdatInputClockMode(...a),
}));

let connected = true;
vi.mock('@/state', () => ({
  connection: { get connected() { return connected; }, get phase() { return connected ? 'ready' : 'idle'; } },
}));

import AdatInputPanel from './AdatInputPanel.svelte';

// channelModel: Unified matches every real device that can carry ADAT (V17+,
// RP2350) -- a Legacy/V10 fixture would incorrectly block GPIO 12.
function makeSnap(over: { inputConfig?: object; adat?: object; dacHwMute?: object } = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8, channelModel: ChannelFamily.Unified },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0 },
    inputConfig: {
      source: AudioInputSource.Usb,
      spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false],
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
  stagedSource?: number;
} = {}) {
  return {
    device: { capabilities: { features: { pinResetDefault: true, adatInput: true } } },
    telemetry: { adatInputStatus: o.adatInputStatus ?? null },
    mirror: { current: o.snap ?? makeSnap() },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging: {
      valueOf: (_key: string, live: unknown) => o.stagedSource ?? live,
      overlaySnapshot: (snap: unknown) => snap,
    },
  } as any;
}

function renderPanel(session: unknown) {
  return render(AdatInputPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => {
  vi.clearAllMocks();
  connected = true;
});

describe('AdatInputPanel', () => {
  test('enabling is blocked without an assigned pin, and fires once one is set', async () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap() }));
    const blocked = screen.getByRole('switch', { name: 'Enable ADAT input' });
    expect(blocked.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTitle('Assign a GPIO pin first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ADAT input GPIO pin' }).textContent).toBe('UNSET');
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputPin: 20 } }) }));
    const toggle = screen.getByRole('switch', { name: 'Enable ADAT input' });
    expect(toggle.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(toggle);
    expect(setAdatInputEnable).toHaveBeenCalledWith(expect.anything(), true);
  });

  test('disabling is blocked while ADAT is the (staged) input source', () => {
    renderPanel(makeSession({
      snap: makeSnap({ inputConfig: { adatInputEnabled: true, adatInputPin: 20 } }),
      stagedSource: AudioInputSource.Adat,
    }));
    const toggle = screen.getByRole('switch', { name: 'Disable ADAT input' });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTitle('Switch the input source away first')).toBeTruthy();
  });

  test('the CLEAR chip only appears while disabled with an assigned pin, and sends the 0xFF sentinel', async () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: true, adatInputPin: 20 } }) }));
    expect(screen.queryByRole('button', { name: 'CLEAR' })).toBeNull();
    unmount();

    const { unmount: unmount2 } = renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: false, adatInputPin: 0 } }) }));
    expect(screen.queryByRole('button', { name: 'CLEAR' })).toBeNull();
    unmount2();

    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputEnabled: false, adatInputPin: 20 } }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
    expect(setAdatInputPin).toHaveBeenCalledWith(expect.anything(), 0xFF);
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

  test('the SLAVE clock chip calls setAdatInputClockMode(1)', async () => {
    renderPanel(makeSession({ snap: makeSnap({ inputConfig: { adatInputClockMode: 0 } }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'SLAVE' }));
    expect(setAdatInputClockMode).toHaveBeenCalledWith(expect.anything(), 1);
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
