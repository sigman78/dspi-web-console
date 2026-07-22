import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelId } from '@/domain';

const setPsybassEnabled = vi.fn();
const setPsybassCutoff = vi.fn();
const setPsybassHarmonics = vi.fn();
const setPsybassDrive = vi.fn();
const setPsybassCharacter = vi.fn();
const setPsybassOriginal = vi.fn();
const togglePsybassOutputChannel = vi.fn();

vi.mock('@/runtime', () => ({
  setPsybassEnabled: (...a: unknown[]) => setPsybassEnabled(...a),
  setPsybassCutoff: (...a: unknown[]) => setPsybassCutoff(...a),
  setPsybassHarmonics: (...a: unknown[]) => setPsybassHarmonics(...a),
  setPsybassDrive: (...a: unknown[]) => setPsybassDrive(...a),
  setPsybassCharacter: (...a: unknown[]) => setPsybassCharacter(...a),
  setPsybassOriginal: (...a: unknown[]) => setPsybassOriginal(...a),
  togglePsybassOutputChannel: (...a: unknown[]) => togglePsybassOutputChannel(...a),
}));

const connectionState = vi.hoisted(() => ({ connected: true, phase: 'ready' }));
vi.mock('@/state', () => ({
  connection: connectionState,
}));

import PsybassPanel from './PsybassPanel.svelte';

// 8 output channels + PDM, RP2350-shaped (9 total, 4 stereo pairs).
const OUTPUT_IDS = [
  ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Out3L, ChannelId.Out3R, ChannelId.Out4L, ChannelId.Out4R,
  ChannelId.Pdm,
];

function makeSession(o: {
  outputMask?: number;
  outputCount?: number;
  psybassEnabled?: boolean;
} = {}) {
  const ids = OUTPUT_IDS.slice(0, o.outputCount ?? OUTPUT_IDS.length);
  const channels = ids.map((id, i) => ({
    id, name: `Out ${i + 1}`, defaultName: `Out ${i + 1}`, shortName: `O${i + 1}`,
    bandCount: 12, isOutput: true, filters: [], xoverBands: [],
  }));
  const outputs = ids.map((id, i) => ({
    id, wireIndex: i, shortName: `O${i + 1}`, enabled: true, muted: false, gainDb: 0, delayMs: 0,
  }));
  return {
    device: { capabilities: { features: { psybass: true } } },
    mirror: {
      current: {
        channels,
        outputs,
        psybass: {
          enabled: o.psybassEnabled ?? true,
          outputMask: o.outputMask ?? 0xFFFF,
          cutoffHz: 80, harmonicsDb: 0, driveDb: 6, characterPct: 50, originalDb: 0,
        },
      },
    },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(PsybassPanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('PsybassPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders the panel with its sliders', () => {
    renderPanel(makeSession({}));
    expect(screen.getByText('CUTOFF')).toBeTruthy();
    expect(screen.getByText('HARMONICS')).toBeTruthy();
    expect(screen.getByText('DRIVE')).toBeTruthy();
    expect(screen.getByText('CHARACTER')).toBeTruthy();
    expect(screen.getByText('ORIGINAL')).toBeTruthy();
  });

  test('toggling the header switch calls setPsybassEnabled with the flipped value', async () => {
    renderPanel(makeSession({ psybassEnabled: false }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable psybass' }));
    expect(setPsybassEnabled).toHaveBeenCalledWith(expect.anything(), true);
  });

  test('sliders are disabled when psybass is off', () => {
    renderPanel(makeSession({ psybassEnabled: false }));
    expect(screen.getByRole('slider', { name: 'Psybass cutoff frequency' })).toBeDisabled();
  });

  test('sliders are disabled when disconnected', () => {
    connectionState.connected = false;
    try {
      renderPanel(makeSession({}));
      expect(screen.getByRole('slider', { name: 'Psybass cutoff frequency' })).toBeDisabled();
    } finally {
      connectionState.connected = true;
    }
  });

  test('dragging the cutoff slider calls setPsybassCutoff', async () => {
    renderPanel(makeSession({}));
    const slider = screen.getByRole('slider', { name: 'Psybass cutoff frequency' });
    await fireEvent.input(slider, { target: { value: '150' } });
    expect(setPsybassCutoff).toHaveBeenCalledWith(expect.anything(), 150);
  });

  test('hides the OUTPUTS row when there is only one output channel', () => {
    renderPanel(makeSession({ outputCount: 1 }));
    expect(screen.queryByText('OUTPUTS')).toBeNull();
  });

  test('shows one chip per output channel when there is more than one', () => {
    renderPanel(makeSession({}));
    expect(screen.getByText('OUTPUTS')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^OUTPUTS / }).length).toBe(OUTPUT_IDS.length);
  });

  test('chip pressed-state reflects the mask bit', () => {
    // outputMask 0b0101 -> output slots 0 and 2 are set.
    renderPanel(makeSession({ outputMask: 0x05 }));
    expect(screen.getByRole('button', { name: 'OUTPUTS Out 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'OUTPUTS Out 2' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'OUTPUTS Out 3' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking a chip toggles that output index', async () => {
    renderPanel(makeSession({}));
    await fireEvent.click(screen.getByRole('button', { name: 'OUTPUTS Out 3' }));
    expect(togglePsybassOutputChannel).toHaveBeenCalledWith(expect.anything(), 2);
  });

  test('chips are disabled when psybass is off', async () => {
    renderPanel(makeSession({ psybassEnabled: false }));
    const chip = screen.getByRole('button', { name: 'OUTPUTS Out 1' });
    expect(chip).toBeDisabled();
    await fireEvent.click(chip);
    expect(togglePsybassOutputChannel).not.toHaveBeenCalled();
  });
});
