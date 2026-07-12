import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelId } from '@/domain';

// BodePlot measures its container via bind:clientWidth (ResizeObserver);
// jsdom doesn't implement it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const setLoudnessEnabled = vi.fn();
const setLoudnessRefSpl = vi.fn();
const setLoudnessIntensityPct = vi.fn();
const toggleLoudnessOutputChannel = vi.fn();

vi.mock('@/runtime', () => ({
  setLoudnessEnabled: (...a: unknown[]) => setLoudnessEnabled(...a),
  setLoudnessRefSpl: (...a: unknown[]) => setLoudnessRefSpl(...a),
  setLoudnessIntensityPct: (...a: unknown[]) => setLoudnessIntensityPct(...a),
  toggleLoudnessOutputChannel: (...a: unknown[]) => toggleLoudnessOutputChannel(...a),
}));

const connectionState = vi.hoisted(() => ({ connected: true, phase: 'ready' }));
vi.mock('@/state', () => ({
  connection: connectionState,
}));

import LoudnessPanel from './LoudnessPanel.svelte';

// 8 output channels + PDM, RP2350-shaped (9 total, 4 stereo pairs).
const OUTPUT_IDS = [
  ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Out3L, ChannelId.Out3R, ChannelId.Out4L, ChannelId.Out4R,
  ChannelId.Pdm,
];

function makeSession(o: {
  outputMask?: number;
  loudnessOutputMask?: boolean;
  outputCount?: number;
  loudnessEnabled?: boolean;
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
    device: { capabilities: { features: { loudnessOutputMask: o.loudnessOutputMask ?? true } } },
    mirror: {
      current: {
        channels,
        outputs,
        loudness: {
          enabled: o.loudnessEnabled ?? true, refSpl: 85, intensityPct: 50,
          outputMask: o.outputMask ?? 0xFFFF,
        },
      },
    },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(LoudnessPanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('LoudnessPanel — output mask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('hides the OUTPUTS row on firmware without mask support (pre-V19)', () => {
    renderPanel(makeSession({ loudnessOutputMask: false }));
    expect(screen.queryByText('OUTPUTS')).toBeNull();
  });

  test('hides the OUTPUTS row when there is only one output channel', () => {
    renderPanel(makeSession({ outputCount: 1 }));
    expect(screen.queryByText('OUTPUTS')).toBeNull();
  });

  test('shows one chip per output channel when supported', () => {
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
    expect(toggleLoudnessOutputChannel).toHaveBeenCalledWith(expect.anything(), 2);
  });

  test('chips are disabled when loudness is off', async () => {
    renderPanel(makeSession({ loudnessEnabled: false }));
    const chip = screen.getByRole('button', { name: 'OUTPUTS Out 1' });
    expect(chip).toBeDisabled();
    await fireEvent.click(chip);
    expect(toggleLoudnessOutputChannel).not.toHaveBeenCalled();
  });

  test('chips are disabled when disconnected', () => {
    connectionState.connected = false;
    try {
      renderPanel(makeSession({}));
      expect(screen.getByRole('button', { name: 'OUTPUTS Out 1' })).toBeDisabled();
    } finally {
      connectionState.connected = true;
    }
  });
});
