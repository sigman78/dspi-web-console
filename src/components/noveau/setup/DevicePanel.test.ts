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

async function openRename() {
  const btn = screen.getByRole('button', { name: 'RENAME' });
  btn.focus();
  await fireEvent.click(btn);
  return screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DevicePanel rename', () => {
  test('no RENAME button when the device cannot store a name', () => {
    renderPanel(false);
    expect(screen.queryByRole('button', { name: 'RENAME' })).toBeNull();
    expect(screen.getByText('Bench')).toBeTruthy();
  });

  test('Enter writes the trimmed name once and closes the popover', async () => {
    renderPanel(true);
    const field = await openRename();
    await fireEvent.input(field, { target: { value: '  Desk  ' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(setDeviceName).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'Desk');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('an emptied name is written so it clears on the device', async () => {
    renderPanel(true);
    const field = await openRename();
    await fireEvent.input(field, { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(setDeviceName).toHaveBeenCalledExactlyOnceWith(expect.anything(), '');
  });

  test('an unchanged name is not written', async () => {
    renderPanel(true);
    await openRename();
    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(setDeviceName).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('CANCEL and Escape close without writing', async () => {
    renderPanel(true);
    let field = await openRename();
    await fireEvent.input(field, { target: { value: 'Other' } });
    await fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    field = await openRename();
    await fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setDeviceName).not.toHaveBeenCalled();
  });

  test('focus returns to RENAME after Enter, and RENAME toggles the popover', async () => {
    renderPanel(true);
    const field = await openRename();
    await fireEvent.keyDown(field, { key: 'Enter' });
    const btn = screen.getByRole('button', { name: 'RENAME' });
    await waitFor(() => expect(document.activeElement).toBe(btn));

    await openRename();
    await fireEvent.pointerDown(btn);
    await fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a click outside closes without writing', async () => {
    renderPanel(true);
    const field = await openRename();
    await fireEvent.input(field, { target: { value: 'Other' } });
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setDeviceName).not.toHaveBeenCalled();
  });
});
