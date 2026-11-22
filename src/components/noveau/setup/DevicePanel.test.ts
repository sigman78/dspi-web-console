import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';

const setDeviceName = vi.fn(async () => true);
vi.mock('@/runtime', () => ({ setDeviceName: (...a: unknown[]) => setDeviceName(...(a as [])) }));

import DevicePanel from './DevicePanel.svelte';

function renderPanel(deviceSupported: boolean | null) {
  const session = {
    mirror: { current: null },
    telemetry: { info: null },
    info: { serial: 'ABC' },
    names: { deviceSupported, device: 'Bench' },
  } as any;
  return render(DevicePanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DevicePanel NAME row', () => {
  test('F2 opens the editor and Enter commits the trimmed name', async () => {
    renderPanel(true);
    await fireEvent.keyDown(screen.getByTitle('Double-click or F2 to rename'), { key: 'F2' });
    const field = screen.getByRole('textbox', { name: 'Device name' }) as HTMLInputElement;
    await fireEvent.input(field, { target: { value: '  Desk  ' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(setDeviceName).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'Desk');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('double-click opens the editor and Escape cancels without writing', async () => {
    renderPanel(true);
    await fireEvent.dblClick(screen.getByTitle('Double-click or F2 to rename'));
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(setDeviceName).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('an emptied name is committed so it clears on the device', async () => {
    renderPanel(true);
    await fireEvent.dblClick(screen.getByTitle('Double-click or F2 to rename'));
    const field = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: '' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(setDeviceName).toHaveBeenCalledExactlyOnceWith(expect.anything(), '');
  });

  test('an unchanged name is not written, and focus returns to the value after a keyboard exit', async () => {
    renderPanel(true);
    const btn = () => screen.getByTitle('Double-click or F2 to rename');
    await fireEvent.keyDown(btn(), { key: 'F2' });
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(setDeviceName).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(btn()));
    await fireEvent.keyDown(btn(), { key: 'F2' });
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(btn()));
  });

  test('stays read-only when the device cannot store a name', async () => {
    renderPanel(false);
    expect(screen.queryByTitle('Double-click or F2 to rename')).toBeNull();
    expect(screen.getByText('Bench')).toBeTruthy();
  });
});
