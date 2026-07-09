import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelId } from '@/domain';

const setLevellerMasks = vi.fn();
const toggleLevellerDetectorChannel = vi.fn();
const toggleLevellerApplyChannel = vi.fn();

vi.mock('@/runtime', () => ({
  setLevellerEnabled: vi.fn(), setLevellerSpeed: vi.fn(), setLevellerLookahead: vi.fn(),
  setLevellerAmount: vi.fn(), setLevellerMaxGain: vi.fn(), setLevellerGate: vi.fn(),
  setLevellerMasks: (...a: unknown[]) => setLevellerMasks(...a),
  toggleLevellerDetectorChannel: (...a: unknown[]) => toggleLevellerDetectorChannel(...a),
  toggleLevellerApplyChannel: (...a: unknown[]) => toggleLevellerApplyChannel(...a),
}));

vi.mock('@/state', () => ({
  connection: { get connected() { return true; }, get phase() { return 'ready'; } },
}));

import LevellerPanel from './LevellerPanel.svelte';

const INPUT_IDS = [
  ChannelId.In1L, ChannelId.In1R, ChannelId.In2L, ChannelId.In2R,
  ChannelId.In3L, ChannelId.In3R, ChannelId.In4L, ChannelId.In4R,
];

function makeSession(o: { detectorMask?: number; applyMask?: number; activeInputChannels?: number | null; levellerMasks?: boolean } = {}) {
  const channels = INPUT_IDS.map((id, i) => ({
    id, name: `In ${i + 1}`, defaultName: `In ${i + 1}`, shortName: `I${i + 1}`,
    bandCount: 12, isOutput: false, filters: [], xoverBands: [],
  }));
  return {
    device: { capabilities: { features: { levellerMasks: o.levellerMasks ?? true } } },
    telemetry: { activeInputChannels: o.activeInputChannels ?? 8 },
    mirror: {
      current: {
        channels,
        leveller: {
          enabled: true, speed: 1, lookahead: false, amount: 50, maxGainDb: 15, gateDb: -96,
          detectorMask: o.detectorMask ?? 0xFF,
          applyMask: o.applyMask ?? 0xFF,
        },
      },
    },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(LevellerPanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('LevellerPanel — channel masks', () => {
  test('hides the CHANNELS section on firmware without mask support (pre-V18)', () => {
    // 8 live inputs but the device is V16/V17 -- masks unsupported, so the whole
    // block must stay hidden rather than offer toggles that snap back.
    renderPanel(makeSession({ activeInputChannels: 8, levellerMasks: false }));
    expect(screen.queryByText('CHANNELS')).toBeNull();
    expect(screen.queryByText('DETECTOR')).toBeNull();
  });

  test('hides the CHANNELS section when only two inputs are live', () => {
    renderPanel(makeSession({ activeInputChannels: 2 }));
    expect(screen.queryByText('CHANNELS')).toBeNull();
    expect(screen.queryByText('DETECTOR')).toBeNull();
  });

  test('shows detector + apply chip rows when more than two inputs are live', () => {
    renderPanel(makeSession({ activeInputChannels: 6 }));
    expect(screen.getByText('CHANNELS')).toBeTruthy();
    expect(screen.getByText('DETECTOR')).toBeTruthy();
    expect(screen.getByText('APPLY')).toBeTruthy();
    // One chip per live input on each row.
    expect(screen.getAllByRole('button', { name: /^DETECTOR / }).length).toBe(6);
    expect(screen.getAllByRole('button', { name: /^APPLY / }).length).toBe(6);
  });

  test('chip pressed-state reflects the mask bit', () => {
    // detectorMask 0b0101 -> input indices 0 and 2 (inputs 1 and 3) are set.
    renderPanel(makeSession({ detectorMask: 0x05, activeInputChannels: 4 }));
    expect(screen.getByRole('button', { name: 'DETECTOR In 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'DETECTOR In 2' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'DETECTOR In 3' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking a detector chip toggles that input index', async () => {
    renderPanel(makeSession({ activeInputChannels: 4 }));
    await fireEvent.click(screen.getByRole('button', { name: 'DETECTOR In 3' }));
    expect(toggleLevellerDetectorChannel).toHaveBeenCalledWith(expect.anything(), 2);
  });

  test('clicking an apply chip toggles that input index', async () => {
    renderPanel(makeSession({ activeInputChannels: 4 }));
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY In 1' }));
    expect(toggleLevellerApplyChannel).toHaveBeenCalledWith(expect.anything(), 0);
  });

  test('a preset applies both masks in one call', async () => {
    renderPanel(makeSession({ activeInputChannels: 6 }));
    await fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    expect(setLevellerMasks).toHaveBeenCalledWith(expect.anything(), 0xFF, 0xFF);
  });
});
