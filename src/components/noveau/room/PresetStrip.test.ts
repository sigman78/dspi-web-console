import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DspDevice } from '@/device/DspDevice';

const loadPresetSlot = vi.fn();

vi.mock('@/runtime', () => ({
  loadPresetSlot: (...a: unknown[]) => loadPresetSlot(...a),
}));

import { makeReadySession, resetAppState } from '@/state';
import { SESSION_KEY } from '@/components/sessionContext';
import PresetStrip from './PresetStrip.svelte';

function mount(active: number, occupied: number[] = [], names: Record<number, string> = {}) {
  const device = { info: { serial: 'AAA' }, hardware: { name: 'RP2350' } } as unknown as DspDevice;
  const session = makeReadySession(device);
  session.presets.active = active as typeof session.presets.active;
  session.presets.directory = { occupiedSlotsSet: new Set(occupied) } as unknown as typeof session.presets.directory;
  for (const [slot, name] of Object.entries(names)) session.presets.names[Number(slot)] = name;
  render(PresetStrip, { context: new Map([[SESSION_KEY, session]]) });
  return session;
}

beforeEach(() => {
  resetAppState();
  vi.clearAllMocks();
});

describe('PresetStrip', () => {
  test('clicking another slot loads it', async () => {
    const session = mount(2);
    await fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(loadPresetSlot).toHaveBeenCalledWith(session, 5);
  });

  test('the active slot and a busy strip do not load', async () => {
    const session = mount(2);
    await fireEvent.click(screen.getByRole('button', { name: '2' }));
    session.presets.busy = true;
    await fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(loadPresetSlot).not.toHaveBeenCalled();
  });

  test('labels distinguish empty, named and unnamed slots', () => {
    mount(1, [1, 3], { 3: 'Late night' });
    expect(screen.getByRole('button', { name: '3 Late night' }).textContent).toContain('Late night');
    expect(screen.getByRole('button', { name: '1' }).textContent).toContain('[unnamed]');
    expect(screen.getByRole('button', { name: '7' }).textContent).toContain('empty');
  });
});
