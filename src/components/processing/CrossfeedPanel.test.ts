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

const setCrossfeedEnabled = vi.fn();
const setCrossfeedPreset = vi.fn();
const setCrossfeedItd = vi.fn();
const setCrossfeedFreq = vi.fn();
const setCrossfeedFeedDb = vi.fn();
const toggleCrossfeedOutputPair = vi.fn();

vi.mock('@/runtime', () => ({
  setCrossfeedEnabled: (...a: unknown[]) => setCrossfeedEnabled(...a),
  setCrossfeedPreset: (...a: unknown[]) => setCrossfeedPreset(...a),
  setCrossfeedItd: (...a: unknown[]) => setCrossfeedItd(...a),
  setCrossfeedFreq: (...a: unknown[]) => setCrossfeedFreq(...a),
  setCrossfeedFeedDb: (...a: unknown[]) => setCrossfeedFeedDb(...a),
  toggleCrossfeedOutputPair: (...a: unknown[]) => toggleCrossfeedOutputPair(...a),
}));

const connectionState = vi.hoisted(() => ({ connected: true, phase: 'ready' }));
vi.mock('@/state', () => ({
  connection: connectionState,
}));

import CrossfeedPanel from './CrossfeedPanel.svelte';

// RP2350-shaped: 8 stereo outputs + PDM = 4 pairs.
const RP2350_OUTPUT_IDS = [
  ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Out3L, ChannelId.Out3R, ChannelId.Out4L, ChannelId.Out4R,
  ChannelId.Pdm,
];

// RP2040-shaped: one stereo pair + PDM = 1 pair.
const RP2040_OUTPUT_IDS = [ChannelId.Out1L, ChannelId.Out1R, ChannelId.Pdm];

function makeSession(o: {
  outputPairMask?: number;
  crossfeedPairMask?: boolean;
  outputIds?: readonly ChannelId[];
  crossfeedEnabled?: boolean;
} = {}) {
  const ids = o.outputIds ?? RP2350_OUTPUT_IDS;
  const channels = ids.map((id, i) => ({
    id, name: `Out ${i + 1}`, defaultName: `Out ${i + 1}`, shortName: `O${i + 1}`,
    bandCount: 12, isOutput: true, filters: [], xoverBands: [],
  }));
  const outputs = ids.map((id, i) => ({
    id, wireIndex: i, shortName: `O${i + 1}`, enabled: true, muted: false, gainDb: 0, delayMs: 0,
  }));
  return {
    device: { capabilities: { features: { crossfeedPairMask: o.crossfeedPairMask ?? true } } },
    mirror: {
      current: {
        channels,
        outputs,
        crossfeed: {
          enabled: o.crossfeedEnabled ?? true, preset: 0, itd: false, freq: 700, feedDb: 4.5,
          outputPairMask: o.outputPairMask ?? 0x01,
        },
      },
    },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(CrossfeedPanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('CrossfeedPanel — output-pair mask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('hides the PAIRS row on firmware without mask support (pre-V20)', () => {
    renderPanel(makeSession({ crossfeedPairMask: false }));
    expect(screen.queryByText('PAIRS')).toBeNull();
  });

  test('hides the PAIRS row on an RP2040-shaped device (one pair)', () => {
    renderPanel(makeSession({ outputIds: RP2040_OUTPUT_IDS }));
    expect(screen.queryByText('PAIRS')).toBeNull();
  });

  test('shows one chip per stereo pair on an RP2350-shaped device', () => {
    renderPanel(makeSession({}));
    expect(screen.getByText('PAIRS')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^PAIRS / }).length).toBe(4);
  });

  test('chip label numbers the two outputs in the pair', () => {
    renderPanel(makeSession({}));
    expect(screen.getByText('1·2')).toBeTruthy();
    expect(screen.getByText('3·4')).toBeTruthy();
    expect(screen.getByText('5·6')).toBeTruthy();
    expect(screen.getByText('7·8')).toBeTruthy();
  });

  test('chip pressed-state reflects the mask bit', () => {
    // outputPairMask 0b0101 -> pairs 0 and 2 are set.
    renderPanel(makeSession({ outputPairMask: 0x05 }));
    expect(screen.getByRole('button', { name: 'PAIRS Out 1 / Out 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'PAIRS Out 3 / Out 4' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'PAIRS Out 5 / Out 6' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking a pair chip toggles that pair index', async () => {
    renderPanel(makeSession({}));
    await fireEvent.click(screen.getByRole('button', { name: 'PAIRS Out 3 / Out 4' }));
    expect(toggleCrossfeedOutputPair).toHaveBeenCalledWith(expect.anything(), 1);
  });

  test('chips are disabled when crossfeed is off', async () => {
    renderPanel(makeSession({ crossfeedEnabled: false }));
    const chip = screen.getByRole('button', { name: 'PAIRS Out 1 / Out 2' });
    expect(chip).toBeDisabled();
    await fireEvent.click(chip);
    expect(toggleCrossfeedOutputPair).not.toHaveBeenCalled();
  });

  test('chips are disabled when disconnected', () => {
    connectionState.connected = false;
    try {
      renderPanel(makeSession({}));
      expect(screen.getByRole('button', { name: 'PAIRS Out 1 / Out 2' })).toBeDisabled();
    } finally {
      connectionState.connected = true;
    }
  });
});
