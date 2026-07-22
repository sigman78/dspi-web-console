import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

const setUpmixEnabled = vi.fn();
const setUpmixCenterMode = vi.fn();
const setUpmixSurroundMode = vi.fn();
const setUpmixStrength = vi.fn();
const setUpmixCenterWidth = vi.fn();
const setUpmixPresence = vi.fn();
const setUpmixCorrThreshold = vi.fn();
const setUpmixAttack = vi.fn();
const setUpmixRelease = vi.fn();
const setUpmixDetectorHpf = vi.fn();
const setUpmixSurroundDelay = vi.fn();
const setUpmixSurroundHpf = vi.fn();
const setUpmixSurroundLpf = vi.fn();
const setUpmixDecorr = vi.fn();

vi.mock('@/runtime', () => ({
  setUpmixEnabled: (...a: unknown[]) => setUpmixEnabled(...a),
  setUpmixCenterMode: (...a: unknown[]) => setUpmixCenterMode(...a),
  setUpmixSurroundMode: (...a: unknown[]) => setUpmixSurroundMode(...a),
  setUpmixStrength: (...a: unknown[]) => setUpmixStrength(...a),
  setUpmixCenterWidth: (...a: unknown[]) => setUpmixCenterWidth(...a),
  setUpmixPresence: (...a: unknown[]) => setUpmixPresence(...a),
  setUpmixCorrThreshold: (...a: unknown[]) => setUpmixCorrThreshold(...a),
  setUpmixAttack: (...a: unknown[]) => setUpmixAttack(...a),
  setUpmixRelease: (...a: unknown[]) => setUpmixRelease(...a),
  setUpmixDetectorHpf: (...a: unknown[]) => setUpmixDetectorHpf(...a),
  setUpmixSurroundDelay: (...a: unknown[]) => setUpmixSurroundDelay(...a),
  setUpmixSurroundHpf: (...a: unknown[]) => setUpmixSurroundHpf(...a),
  setUpmixSurroundLpf: (...a: unknown[]) => setUpmixSurroundLpf(...a),
  setUpmixDecorr: (...a: unknown[]) => setUpmixDecorr(...a),
}));

const connectionState = vi.hoisted(() => ({ connected: true, phase: 'ready' }));
vi.mock('@/state', () => ({
  connection: connectionState,
}));

import UpmixPanel from './UpmixPanel.svelte';

function makeSession(o: {
  upmixEnabled?: boolean;
  centerMode?: number;
  surroundMode?: number;
  upmixPresence?: boolean;
  activeInputChannels?: number | null;
  sampleRateHz?: number | null;
} = {}) {
  return {
    device: { capabilities: { features: { upmixPresence: o.upmixPresence ?? true } } },
    telemetry: {
      activeInputChannels: o.activeInputChannels ?? 2,
      info: { sampleRateHz: o.sampleRateHz ?? 48000 },
    },
    mirror: {
      current: {
        upmix: {
          enabled: o.upmixEnabled ?? true,
          centerMode: o.centerMode ?? 1,
          surroundMode: o.surroundMode ?? 2,
          strengthPct: 100, centerWidthPct: 25, corrThresholdPct: 30,
          attackMs: 10, releaseMs: 100, detectorHpfHz: 200,
          surroundDelayMs: 12, surroundHpfHz: 300, surroundLpfHz: 7000,
          decorrPct: 90, presenceDb: 0,
        },
      },
    },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(UpmixPanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('UpmixPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders the panel with its sliders', () => {
    renderPanel(makeSession({}));
    expect(screen.getByText('STRENGTH')).toBeTruthy();
    expect(screen.getByText('WIDTH')).toBeTruthy();
    expect(screen.getByText('THRESHOLD')).toBeTruthy();
    expect(screen.getByText('ATTACK')).toBeTruthy();
    expect(screen.getByText('RELEASE')).toBeTruthy();
    expect(screen.getByText('DET HPF')).toBeTruthy();
    expect(screen.getByText('DELAY')).toBeTruthy();
    expect(screen.getByText('HPF')).toBeTruthy();
    expect(screen.getByText('LPF')).toBeTruthy();
    expect(screen.getByText('DECORR')).toBeTruthy();
  });

  test('toggling the header switch calls setUpmixEnabled with the flipped value', async () => {
    renderPanel(makeSession({ upmixEnabled: false }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable stereo upmixer' }));
    expect(setUpmixEnabled).toHaveBeenCalledWith(expect.anything(), true);
  });

  test('sliders are disabled when upmix is off', () => {
    renderPanel(makeSession({ upmixEnabled: false }));
    expect(screen.getByRole('slider', { name: 'Upmix center strength' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix center width' })).toBeDisabled();
  });

  test('sliders are disabled when disconnected', () => {
    connectionState.connected = false;
    try {
      renderPanel(makeSession({}));
      expect(screen.getByRole('slider', { name: 'Upmix center strength' })).toBeDisabled();
    } finally {
      connectionState.connected = true;
    }
  });

  test('PASSIVE center mode greys the steering sliders but not strength/width', () => {
    renderPanel(makeSession({ centerMode: 0 }));
    expect(screen.getByRole('slider', { name: 'Upmix adaptive-steering threshold' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix adaptive-steering attack time' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix adaptive-steering release time' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix adaptive-steering detector high-pass frequency' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix center strength' })).not.toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix center width' })).not.toBeDisabled();
  });

  test('LOGIC center mode enables the steering sliders', () => {
    renderPanel(makeSession({ centerMode: 1 }));
    expect(screen.getByRole('slider', { name: 'Upmix adaptive-steering threshold' })).not.toBeDisabled();
  });

  test('surround OFF greys the surround sliders', () => {
    renderPanel(makeSession({ surroundMode: 0 }));
    expect(screen.getByRole('slider', { name: 'Upmix surround delay' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix surround high-pass frequency' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix surround low-pass frequency' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Upmix surround decorrelation' })).toBeDisabled();
  });

  test('surround PASSIVE/LOGIC enables the surround sliders', () => {
    renderPanel(makeSession({ surroundMode: 1 }));
    expect(screen.getByRole('slider', { name: 'Upmix surround delay' })).not.toBeDisabled();
  });

  test('presence row hidden when features.upmixPresence is false', () => {
    renderPanel(makeSession({ upmixPresence: false }));
    expect(screen.queryByText('PRESENCE')).toBeNull();
  });

  test('presence row shown when features.upmixPresence is true', () => {
    renderPanel(makeSession({ upmixPresence: true }));
    expect(screen.getByText('PRESENCE')).toBeTruthy();
  });

  test('center mode radio dispatches setUpmixCenterMode with the raw wire value', async () => {
    renderPanel(makeSession({ centerMode: 0 }));
    const group = screen.getByRole('radiogroup', { name: 'Upmix center mode' });
    await fireEvent.click(within(group).getByRole('radio', { name: 'LOGIC' }));
    expect(setUpmixCenterMode).toHaveBeenCalledWith(expect.anything(), 1);
  });

  test('surround mode radio dispatches setUpmixSurroundMode with the raw wire value', async () => {
    renderPanel(makeSession({ surroundMode: 2 }));
    const group = screen.getByRole('radiogroup', { name: 'Upmix surround mode' });
    await fireEvent.click(within(group).getByRole('radio', { name: 'OFF' }));
    expect(setUpmixSurroundMode).toHaveBeenCalledWith(expect.anything(), 0);
  });

  test('status line reads ACTIVE when enabled, stereo input, rate <= 48k', () => {
    renderPanel(makeSession({ upmixEnabled: true, activeInputChannels: 2, sampleRateHz: 48000 }));
    expect(screen.getByText('ACTIVE')).toBeTruthy();
  });

  test('status line reads PARKED with the disabled reason when off', () => {
    renderPanel(makeSession({ upmixEnabled: false }));
    expect(screen.getByText('PARKED — disabled')).toBeTruthy();
  });

  test('status line reads PARKED with the not-stereo reason on a multichannel input', () => {
    renderPanel(makeSession({ activeInputChannels: 6 }));
    expect(screen.getByText('PARKED — input not stereo')).toBeTruthy();
  });

  test('status line reads PARKED with the rate reason above 48 kHz', () => {
    renderPanel(makeSession({ sampleRateHz: 96000 }));
    expect(screen.getByText('PARKED — rate > 48 kHz')).toBeTruthy();
  });
});
