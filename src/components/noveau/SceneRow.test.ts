import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DspDevice } from '@/device/DspDevice';

const loadPresetSlot = vi.fn();
const revertActivePreset = vi.fn();
const saveActivePresetNamed = vi.fn();

vi.mock('@/runtime', () => ({
  loadPresetSlot: (...a: unknown[]) => loadPresetSlot(...a),
  revertActivePreset: (...a: unknown[]) => revertActivePreset(...a),
}));
vi.mock('@/components/presets/saveActivePresetNamed', () => ({
  saveActivePresetNamed: (...a: unknown[]) => saveActivePresetNamed(...a),
}));

import { makeReadySession, resetAppState } from '@/state';
import { SESSION_KEY } from '@/components/sessionContext';
import SceneRow from './SceneRow.svelte';
import { noveauUi } from './noveauUi.svelte';

function mount(active: number, occupied: number[] = []) {
  const device = { info: { serial: 'AAA' }, hardware: { name: 'RP2350' } } as unknown as DspDevice;
  const session = makeReadySession(device);
  session.presets.active = active as typeof session.presets.active;
  session.presets.directory = { occupiedSlotsSet: new Set(occupied) } as unknown as typeof session.presets.directory;
  render(SceneRow, { context: new Map([[SESSION_KEY, session]]) });
  return session;
}

beforeEach(() => {
  resetAppState();
  noveauUi.presetsOpen = false;
  vi.clearAllMocks();
});

describe('SceneRow', () => {
  test('clicking the active slot does not reload it', async () => {
    mount(2);
    await fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(loadPresetSlot).not.toHaveBeenCalled();
  });

  test('clicking another slot loads it', async () => {
    const session = mount(2);
    await fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(loadPresetSlot).toHaveBeenCalledWith(session, 5);
  });

  test('slots are inert while a preset operation is in flight', async () => {
    const session = mount(2);
    session.presets.busy = true;
    await fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(loadPresetSlot).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(saveActivePresetNamed).not.toHaveBeenCalled();
  });

  test('an unoccupied active slot offers Save but not Revert', () => {
    mount(2, [0, 1]);
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revert preset' })).toBeNull();
  });

  test('the name field toggles the presets flyout', async () => {
    mount(2);
    const f = screen.getByRole('button', { name: 'Manage presets' });
    await fireEvent.click(f);
    expect(noveauUi.presetsOpen).toBe(true);
    expect(f.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(f);
    expect(noveauUi.presetsOpen).toBe(false);
  });
});
