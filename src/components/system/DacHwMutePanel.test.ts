import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

vi.mock('@/runtime', () => ({
  stageDacMute: vi.fn(), stageDacMuteEnabled: vi.fn(), testDacHwMute: vi.fn(),
  stagedCtrlPins: () => ({ uart: null, i2c: null, cs: [] }),
}));

import { stageDacMute, stageDacMuteEnabled } from '@/runtime';
import DacHwMutePanel from './DacHwMutePanel.svelte';

function makeSnap(dacHwMute: object, outputPins = [6, 7, 8, 9, 10]) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins,
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 },
    inputConfig: { source: 0, spdifRxPin: 5, spdifRxPinExt: [0, 0], spdifExtEnabled: [false, false] },
    dacHwMute,
    adat: { enabled: false, pin: 0 },
  };
}

function renderPanel(snap: object) {
  const session = {
    mirror: { current: snap },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging: { has: () => false, overlaySnapshot: (s: unknown) => s },
  } as any;
  render(DacHwMutePanel, { context: new Map([[SESSION_KEY, session]]) });
  return session;
}

const rowControls = () => [
  screen.getByRole('switch', { name: 'DAC mute active low' }),
  screen.getByRole('button', { name: 'DAC HW mute GPIO pin' }),
  screen.getByRole('spinbutton', { name: 'DAC mute hold time ms' }),
  screen.getByRole('spinbutton', { name: 'DAC mute release time ms' }),
];

beforeEach(() => { vi.clearAllMocks(); });

describe('DacHwMutePanel', () => {
  test('row controls are disabled while the feature is off', () => {
    renderPanel(makeSnap({ enabled: false, activeLow: false, pin: 0, holdMs: 0, releaseMs: 0 }));
    for (const el of rowControls()) expect(el.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('switch', { name: 'Enable DAC HW mute' }).hasAttribute('disabled')).toBe(false);
  });

  test('row controls are editable while the feature is on', () => {
    renderPanel(makeSnap({ enabled: true, activeLow: true, pin: 11, holdMs: 5, releaseMs: 0 }));
    for (const el of rowControls()) expect(el.hasAttribute('disabled')).toBe(false);
  });

  test('toggling stages the enable state instead of writing it', async () => {
    const session = renderPanel(makeSnap({ enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable DAC HW mute' }));
    expect(stageDacMuteEnabled).toHaveBeenCalledWith(session, true);
  });

  test('editing a field stages that field', async () => {
    const session = renderPanel(makeSnap({ enabled: true, activeLow: false, pin: 11, holdMs: 5, releaseMs: 0 }));
    await fireEvent.click(screen.getByRole('switch', { name: 'DAC mute active low' }));
    expect(stageDacMute).toHaveBeenCalledWith(session, 'activeLow', true);
  });
});
