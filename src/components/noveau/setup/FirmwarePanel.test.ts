import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { confirmState, resolveConfirm } from '@/state';

vi.mock('@/runtime', () => ({
  factoryResetDevice: vi.fn(async () => {}),
  enterBootloader: vi.fn(),
  MIN_CS_CAPS_VERSION: 2,
  MAX_KNOWN_CS_CAPS_VERSION: 20,
}));

import { factoryResetDevice } from '@/runtime';
import FirmwarePanel from './FirmwarePanel.svelte';

const session = {
  mirror: { current: null },
  controlSurfaces: { deviceCapsVersion: null, caps: null, busy: false },
  ctrlIfaces: { status: null },
  info: { serial: 'S', capabilities: { fwLabel: 'fw', wireLabel: 'wire' }, build: null },
} as any;

afterEach(() => { resolveConfirm(false); vi.clearAllMocks(); });

describe('FirmwarePanel factory reset', () => {
  test('goes through the confirm modal and only resets on confirmation', async () => {
    render(FirmwarePanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('button', { name: 'FACTORY RESET' }));
    expect(confirmState.pending?.confirmLabel).toBe('RESET DEVICE');
    expect(factoryResetDevice).not.toHaveBeenCalled();

    resolveConfirm(true);
    await vi.waitFor(() => expect(factoryResetDevice).toHaveBeenCalledOnce());
  });

  test('cancelling leaves the device alone', async () => {
    render(FirmwarePanel, { context: new Map([[SESSION_KEY, session]]) });
    await fireEvent.click(screen.getByRole('button', { name: 'FACTORY RESET' }));
    resolveConfirm(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(factoryResetDevice).not.toHaveBeenCalled();
  });
});
