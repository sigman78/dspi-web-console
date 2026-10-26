import { describe, test, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DspDevice } from '@/device/DspDevice';

const loadPresetSlot = vi.fn();
const revertActivePreset = vi.fn();
const saveActivePresetNamed = vi.fn();
const renamePresetSlot = vi.fn();

vi.mock('@/runtime', () => ({
  loadPresetSlot: (...a: unknown[]) => loadPresetSlot(...a),
  revertActivePreset: (...a: unknown[]) => revertActivePreset(...a),
  renamePresetSlot: (...a: unknown[]) => renamePresetSlot(...a),
}));
vi.mock('@/components/presets/saveActivePresetNamed', () => ({
  saveActivePresetNamed: (...a: unknown[]) => saveActivePresetNamed(...a),
}));

import { makeReadySession, resetAppState } from '@/state';
import { SESSION_KEY } from '@/components/sessionContext';
import SceneRow from './SceneRow.svelte';

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
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveActivePresetNamed).not.toHaveBeenCalled();
  });

  test('an unoccupied active slot offers Save but not Revert', () => {
    mount(2, [0, 1]);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revert' })).toBeNull();
  });

  describe('rename', () => {
    async function startRename(session: ReturnType<typeof mount>) {
      session.presets.names[2] = 'Old';
      await fireEvent.dblClick(screen.getByTitle('Double-click or F2 to rename'));
      return screen.getByLabelText('Preset name') as HTMLInputElement;
    }

    test('Enter commits once, even though the unmounting input blurs afterwards', async () => {
      const session = mount(2);
      const input = await startRename(session);
      await fireEvent.input(input, { target: { value: 'Living room' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await fireEvent.blur(input);
      expect(renamePresetSlot).toHaveBeenCalledTimes(1);
      expect(renamePresetSlot).toHaveBeenCalledWith(session, 2, 'Living room');
    });

    test('Escape cancels without renaming', async () => {
      const session = mount(2);
      const input = await startRename(session);
      await fireEvent.input(input, { target: { value: 'Living room' } });
      await fireEvent.keyDown(input, { key: 'Escape' });
      await fireEvent.blur(input);
      expect(renamePresetSlot).not.toHaveBeenCalled();
    });

    test('blank or unchanged names are not written', async () => {
      const session = mount(2);
      let input = await startRename(session);
      await fireEvent.input(input, { target: { value: '   ' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await tick();
      input = await startRename(session);
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(renamePresetSlot).not.toHaveBeenCalled();
    });

    test('changing the active slot mid-edit abandons the edit', async () => {
      const session = mount(2);
      const input = await startRename(session);
      await fireEvent.input(input, { target: { value: 'Living room' } });
      session.presets.active = 3 as typeof session.presets.active;
      await tick();
      expect(screen.queryByLabelText('Preset name')).toBeNull();
      await fireEvent.blur(input);
      expect(renamePresetSlot).not.toHaveBeenCalled();
    });
  });
});
