import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { StatusStore } from '@/state';
import StatsPanel from './StatsPanel.svelte';

vi.mock('@/runtime', () => ({ clearClips: vi.fn() }));

import { clearClips } from '@/runtime';

function renderStats(latency: { supported: boolean | null; status?: object | null } = { supported: null }) {
  const telemetry = new StatusStore();
  const session = { mirror: { current: null }, telemetry, outputLatency: { status: null, ...latency } } as any;
  render(StatsPanel, { context: new Map([[SESSION_KEY, session]]) });
  return { telemetry, session };
}

describe('StatsPanel', () => {
  test('CLEAR appears only while a clip is latched and clears them', async () => {
    const { telemetry, session } = renderStats();
    expect(screen.queryByRole('button', { name: 'CLEAR' })).toBeNull();

    telemetry.clipLatched[2] = true;
    const clear = await screen.findByRole('button', { name: 'CLEAR' });
    await fireEvent.click(clear);
    expect(clearClips).toHaveBeenCalledWith(session);
  });

  test('overrun and underrun counters share one row and warn when non-zero', async () => {
    const { telemetry } = renderStats();
    telemetry.info = { pdmRingOverruns: 0, pdmRingUnderruns: 3 } as any;
    const row = (await screen.findByText('PDM RING OVR / UNR')).parentElement!;
    await vi.waitFor(() => expect(row.textContent).toContain('0 / 3'));
    expect(row.querySelector('.val')!.classList.contains('warn')).toBe(true);
  });

  const ringHealth = {
    underrunEpisodes: 2, blocksRefused: 0, lowestFillFrames: 5,
    inputGapWorstUs: 1500, usbPacketGapWorstUs: 5000, backgroundOverBudget: 0,
  };

  test('older firmware shows the SPDIF overrun/underrun pair, latency-capable firmware the underrun alone', async () => {
    const old = renderStats({ supported: false });
    old.telemetry.info = { spdifOverruns: 2, spdifUnderruns: 0 } as any;
    const pair = (await screen.findByText('SPDIF OVR / UNR')).parentElement!;
    expect(pair.textContent).toContain('2 / 0');
    expect(pair.querySelector('.val')!.classList.contains('warn')).toBe(true);
    expect(screen.queryByText('SPDIF UNR')).toBeNull();
    cleanup();

    renderStats({ supported: true, status: { effectiveUs: 4000 } });
    expect(await screen.findByText('SPDIF UNR')).toBeTruthy();
    expect(screen.queryByText('SPDIF OVR / UNR')).toBeNull();
  });

  test('ring health rows show only on a latency-capable device', async () => {
    const off = renderStats({ supported: false });
    off.telemetry.ringHealth = ringHealth;
    await Promise.resolve();
    expect(screen.queryByText('RING UNDERRUNS')).toBeNull();
    cleanup();

    const on = renderStats({ supported: true, status: { effectiveUs: 4000 } });
    on.telemetry.ringHealth = ringHealth;
    const underruns = (await screen.findByText('RING UNDERRUNS')).parentElement!;
    expect(underruns.querySelector('.val')!.classList.contains('warn')).toBe(true);
    expect(screen.getByText('RING DROPS').parentElement!.querySelector('.val')!.classList.contains('warn')).toBe(false);
  });

  test('the worst-gap row is a plain reading, never a warning', async () => {
    const { telemetry } = renderStats({ supported: true, status: { effectiveUs: 4000 } });
    telemetry.ringHealth = ringHealth;
    const row = (await screen.findByText('WORST GAP IN / USB')).parentElement!;
    expect(row.textContent).toContain('1.5 / 5.0 ms');
    expect(row.querySelector('.val')!.classList.contains('warn')).toBe(false);
  });
});
