import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelId, OutputConfigMode, type LimiterOutput } from '@/domain';
import { ReactiveMirror } from '@test/fixtures/reactiveMirror.svelte';
import { StatusStore } from '@/state/telemetry.svelte';

const setLimiterAllEnabled = vi.fn();
const setLimiterEnabled = vi.fn();
const setLimiterThreshold = vi.fn();
const setLimiterRelease = vi.fn();
const setLimiterLinkGroup = vi.fn();

vi.mock('@/runtime', () => ({
  setLimiterAllEnabled: (...a: unknown[]) => setLimiterAllEnabled(...a),
  setLimiterEnabled: (...a: unknown[]) => setLimiterEnabled(...a),
  setLimiterThreshold: (...a: unknown[]) => setLimiterThreshold(...a),
  setLimiterRelease: (...a: unknown[]) => setLimiterRelease(...a),
  setLimiterLinkGroup: (...a: unknown[]) => setLimiterLinkGroup(...a),
}));

import LimiterPanel from './LimiterPanel.svelte';

const OUTPUT_IDS = [ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out2L, ChannelId.Out2R, ChannelId.Pdm];

function makeSession(o: {
  limiter?: Partial<LimiterOutput>[]; telemetry?: StatusStore; outputConfigMode?: number; channelCount?: number;
} = {}) {
  const ids = OUTPUT_IDS.slice(0, o.channelCount ?? OUTPUT_IDS.length);
  const channels = ids.map((id, i) => ({
    id, name: `Out ${i + 1}`, defaultName: `Out ${i + 1}`, shortName: `O${i + 1}`,
    bandCount: 12, isOutput: true, filters: [], xoverBands: [],
  }));
  const outputs = ids.map((id, i) => ({
    id, wireIndex: i, shortName: `O${i + 1}`, enabled: true, muted: false, gainDb: 0, delayMs: 0,
  }));
  const limiter = Array.from({ length: 9 }, (_, i) => ({
    enabled: false, linkGroup: 0, thresholdDb: -6, releaseMs: 100, ...o.limiter?.[i],
  }));
  return {
    telemetry: o.telemetry ?? new StatusStore(),
    mirror: { current: { channels, outputs, limiter } },
    presets: { directory: o.outputConfigMode === undefined ? null : { outputConfigMode: o.outputConfigMode } },
  };
}

function renderPanel(session: unknown) {
  return render(LimiterPanel, { context: new Map([[SESSION_KEY, session]]) });
}

const lookahead = () => document.querySelector('.lookahead')?.textContent?.replace(/\s+/g, ' ').trim();

describe('LimiterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders one row per output and locks the editor while the selected output is off', () => {
    const { container } = renderPanel(makeSession());
    expect(container.querySelectorAll('.orow')).toHaveLength(OUTPUT_IDS.length);
    expect(screen.getByRole('slider', { name: 'Limiter threshold' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Limiter release' })).toBeDisabled();
  });

  test('the editor unlocks for an enabled selected output', () => {
    renderPanel(makeSession({ limiter: [{ enabled: true }] }));
    expect(screen.getByRole('slider', { name: 'Limiter threshold' })).not.toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Limiter release' })).not.toBeDisabled();
  });

  test('the header toggle enables everything from none and disables everything from some', async () => {
    const { unmount } = renderPanel(makeSession());
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable limiter' }));
    expect(setLimiterAllEnabled).toHaveBeenLastCalledWith(expect.anything(), true);
    unmount();

    renderPanel(makeSession({ limiter: [{}, {}, { enabled: true }] }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Disable limiter' }));
    expect(setLimiterAllEnabled).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  test('a row toggle flips that output only', async () => {
    renderPanel(makeSession({ limiter: [{}, { enabled: true }] }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Limiter Out 2' }));
    expect(setLimiterEnabled).toHaveBeenCalledWith(expect.anything(), 1, false);
    await fireEvent.click(screen.getByRole('switch', { name: 'Limiter Out 1' }));
    expect(setLimiterEnabled).toHaveBeenCalledWith(expect.anything(), 0, true);
  });

  test('selecting a row retargets the editor', async () => {
    renderPanel(makeSession({ limiter: [{}, {}, {}, { enabled: true }] }));
    await fireEvent.click(screen.getByRole('button', { name: /Edit limiter Out 4/ }));
    expect(screen.getByText('OUTPUT 4 · Out 4')).toBeTruthy();
    await fireEvent.input(screen.getByRole('slider', { name: 'Limiter threshold' }), { target: { value: '-12' } });
    expect(setLimiterThreshold).toHaveBeenCalledWith(expect.anything(), 3, -12);
    await fireEvent.input(screen.getByRole('slider', { name: 'Limiter release' }), { target: { value: '250' } });
    expect(setLimiterRelease).toHaveBeenCalledWith(expect.anything(), 3, 250);
  });

  test('the LINK select writes the group of the selected output even while it is off', async () => {
    const { unmount } = renderPanel(makeSession());
    expect(screen.queryByText(/share enable, threshold and release/)).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: '2' }));
    expect(setLimiterLinkGroup).toHaveBeenCalledWith(expect.anything(), 0, 2);
    unmount();

    renderPanel(makeSession({ limiter: [{ linkGroup: 2 }] }));
    expect(screen.getByText(/share enable, threshold and release/)).toBeTruthy();
    expect(screen.getByText('G2')).toBeTruthy();
  });

  test('meter bars follow the gain reduction, with dash readouts while unpolled', async () => {
    const session = makeSession();
    const { container } = renderPanel(session);
    expect(container.querySelectorAll('.bar .fill')).toHaveLength(0);
    expect(container.querySelectorAll('.gr')[0].textContent).toBe('—');

    session.telemetry.limiterMeterDb = [0, 6, 15, 45, 0, 0, 0, 0, 0];
    await tick();
    const widths = [...container.querySelectorAll<HTMLElement>('.bar .fill')].map((e) => e.style.width);
    expect(widths).toEqual(['0%', '20%', '50%', '100%', '0%']);
    expect(screen.getByText('−6.0 dB')).toBeTruthy();
    expect(container.querySelectorAll('.gr')[0].textContent).toBe('0.0 dB');
  });

  test('the selection falls back to the first output when the selected one disappears', async () => {
    const full = makeSession({ limiter: [{ enabled: true }] });
    const mirror = new ReactiveMirror(full.mirror.current);
    renderPanel({ ...full, mirror });
    await fireEvent.click(screen.getByRole('button', { name: /Edit limiter Out 5/ }));
    expect(screen.getByText('OUTPUT 5 · Out 5')).toBeTruthy();

    mirror.current = makeSession({ channelCount: 4 }).mirror.current;
    await tick();
    expect(screen.getByText('OUTPUT 1 · Out 1')).toBeTruthy();
  });

  test('independent output-config mode shows the device-global hint, with-preset does not', () => {
    const { unmount } = renderPanel(makeSession({ outputConfigMode: OutputConfigMode.Independent }));
    expect(screen.getByText(/device-global in independent mode/)).toBeTruthy();
    unmount();
    renderPanel(makeSession({ outputConfigMode: OutputConfigMode.WithPreset }));
    expect(screen.queryByText(/device-global in independent mode/)).toBeNull();
  });

  test('status line shows unknown, engaged with latency, and off', async () => {
    const session = makeSession();
    renderPanel(session);
    expect(lookahead()).toBe('—');

    session.telemetry.info = { sampleRateHz: 48000 } as typeof session.telemetry.info;
    session.telemetry.limiterStatus = { engaged: true, lookaheadSamples: 32, blockSamples: 32, numOutputs: 5 };
    await tick();
    expect(lookahead()).toBe('engaged · +32 samples (0.67 ms @ 48.0 kHz)');

    session.telemetry.limiterStatus = { engaged: false, lookaheadSamples: 32, blockSamples: 32, numOutputs: 5 };
    await tick();
    expect(lookahead()).toBe('off · no added latency');
  });

  test('mounting holds one unit of meter interest and unmounting releases it', () => {
    const telemetry = new StatusStore();
    telemetry.limiterMeterDb = [3];
    const { unmount } = renderPanel(makeSession({ telemetry }));
    expect(telemetry.limiterMeterWanted).toBe(1);
    unmount();
    expect(telemetry.limiterMeterWanted).toBe(0);
    expect(telemetry.limiterMeterDb).toBeNull();
  });
});
