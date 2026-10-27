import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelFamily } from '@/domain';

const stageAdatEnabled = vi.fn();
const stageAdatPin = vi.fn();

vi.mock('@/runtime', () => ({
  stageAdatEnabled: (...a: unknown[]) => stageAdatEnabled(...a),
  stageAdatPin: (...a: unknown[]) => stageAdatPin(...a),
  stagedCtrlPins: () => ({ uart: null, i2c: null, cs: [] }),
}));

import AdatPanel from './AdatPanel.svelte';

// channelModel: Unified matches every real device that can carry ADAT (V17+,
// RP2350) -- a Legacy/V10 fixture would incorrectly block GPIO 12 (the debug
// UART pin pre-V16) and mask the platform-default assertions below.
function makeSnap(over: { adat?: object; dacHwMute?: object; outputPins?: number[] } = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8, channelModel: ChannelFamily.Unified },
    outputPins: over.outputPins ?? [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0 },
    inputConfig: { source: 0, spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false] },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0, ...over.dacHwMute },
    adat: { enabled: false, pin: 0, ...over.adat },
  };
}

const staging = {
  has: () => false,
  overlaySnapshot: (s: unknown) => s,
};

function makeSession(o: {
  snap?: ReturnType<typeof makeSnap>;
  adatStatus?: object | null;
} = {}) {
  return {
    device: { capabilities: { features: { pinResetDefault: true } } },
    telemetry: { adatStatus: o.adatStatus ?? null },
    mirror: { current: o.snap ?? makeSnap() },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging,
  } as any;
}

function renderPanel(session: unknown) {
  return render(AdatPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdatPanel', () => {
  test('the header toggle stages the enable instead of writing it', async () => {
    const session = makeSession();
    renderPanel(session);
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable ADAT output' }));
    expect(stageAdatEnabled).toHaveBeenCalledWith(session, true);
  });

  test('the header toggle stages a disable while enabled', async () => {
    const session = makeSession({ snap: makeSnap({ adat: { enabled: true, pin: 20 } }) });
    renderPanel(session);
    await fireEvent.click(screen.getByRole('switch', { name: 'Disable ADAT output' }));
    expect(stageAdatEnabled).toHaveBeenCalledWith(session, false);
  });

  test('the pin picker is enabled only while ADAT itself is enabled', () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ adat: { enabled: false, pin: 20 } }) }));
    expect(screen.getByRole('button', { name: 'ADAT output GPIO pin' }).hasAttribute('disabled')).toBe(true);
    unmount();
    renderPanel(makeSession({ snap: makeSnap({ adat: { enabled: true, pin: 20 } }) }));
    expect(screen.getByRole('button', { name: 'ADAT output GPIO pin' }).hasAttribute('disabled')).toBe(false);
  });

  test('pin 0 (never configured) renders as GP12 selected, the resolved platform default', () => {
    renderPanel(makeSession({ snap: makeSnap({ adat: { enabled: true, pin: 0 } }) }));
    expect(screen.getByRole('button', { name: 'ADAT output GPIO pin' }).textContent).toBe('GP12');
  });

  test('the DEFAULT chip sends the 0xFF reset sentinel', async () => {
    renderPanel(makeSession({ snap: makeSnap({ adat: { enabled: true, pin: 20 } }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset ADAT output pin to default' }));
    expect(stageAdatPin).toHaveBeenCalledWith(expect.anything(), 0xFF);
  });

  test('the DEFAULT chip is absent when the device lacks pin-reset support', () => {
    const session = makeSession({ snap: makeSnap({ adat: { enabled: true, pin: 20 } }) });
    session.device.capabilities.features.pinResetDefault = false;
    renderPanel(session);
    expect(screen.queryByRole('button', { name: 'Reset ADAT output pin to default' })).toBeNull();
  });

  test('status section is absent while ADAT is disabled', () => {
    renderPanel(makeSession({ snap: makeSnap({ adat: { enabled: false, pin: 20 } }) }));
    expect(screen.queryByText('ADAT STATUS')).toBeNull();
  });

  test('status KVs render from telemetry.adatStatus once enabled and live', () => {
    renderPanel(makeSession({
      snap: makeSnap({ adat: { enabled: true, pin: 20 } }),
      adatStatus: { enabled: true, active: true, pin: 20, rateOk: true, resyncCount: 2, slipCount: 0 },
    }));
    expect(screen.getByText('ADAT STATUS')).toBeTruthy();
    expect(screen.getByText('YES')).toBeTruthy();
    expect(screen.getByText('44.1/48 OK')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  test('a parked stream (rateOk false) shows the warn presentation', () => {
    renderPanel(makeSession({
      snap: makeSnap({ adat: { enabled: true, pin: 20 } }),
      adatStatus: { enabled: true, active: false, pin: 20, rateOk: false, resyncCount: 0, slipCount: 0 },
    }));
    const rate = screen.getByText('PARKED — RATE > 48 KHZ');
    expect(rate.className).toMatch(/warn/);
  });

  test('a nonzero slip count shows the warn presentation', () => {
    renderPanel(makeSession({
      snap: makeSnap({ adat: { enabled: true, pin: 20 } }),
      adatStatus: { enabled: true, active: true, pin: 20, rateOk: true, resyncCount: 0, slipCount: 3 },
    }));
    const slip = screen.getByText('3');
    expect(slip.className).toMatch(/warn/);
  });

  test('shows a waiting hint while enabled but status has not arrived yet', () => {
    renderPanel(makeSession({ snap: makeSnap({ adat: { enabled: true, pin: 20 } }), adatStatus: null }));
    expect(screen.getByText(/Waiting for ADAT status/)).toBeTruthy();
  });
});
