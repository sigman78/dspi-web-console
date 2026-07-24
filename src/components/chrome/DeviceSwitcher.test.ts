import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DspDevice } from '@/device/DspDevice';
import DeviceSwitcher from './DeviceSwitcher.svelte';

vi.mock('../../runtime/boot', () => ({
  connectRequested: vi.fn().mockResolvedValue(undefined),
  webUsbUnsupportedReason: vi.fn(() => null),
}));

vi.mock('../../runtime/deviceService', () => ({
  activateSession: vi.fn().mockResolvedValue(undefined),
}));

import { activateSession, connectRequested, webUsbUnsupportedReason } from '@/runtime';
import {
  dispatch, mintConnId, resetAppState, makeReadySession, noteAdoptFailure, adoptFailures,
  type ConnId,
} from '@/state';

function synced(serial: string, hwName = 'RP2350'): ConnId {
  const id = mintConnId();
  const device = { info: { serial }, hardware: { name: hwName } } as unknown as DspDevice;
  dispatch({ t: 'synced', id, session: makeReadySession(device) });
  return id;
}

beforeEach(() => {
  resetAppState();
  vi.mocked(webUsbUnsupportedReason).mockReturnValue(null);
  vi.mocked(activateSession).mockClear();
  vi.mocked(connectRequested).mockClear();
});

describe('DeviceSwitcher — device chips', () => {
  test('one chip per session record, active chip carries aria-pressed true', () => {
    synced('AAA');
    synced('BBB');   // most recently synced becomes active

    render(DeviceSwitcher);

    const a = screen.getByRole('button', { name: /^AAA/ });
    const b = screen.getByRole('button', { name: /^BBB/ });
    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking a dormant chip activates that session', async () => {
    const idA = synced('AAA');
    synced('BBB');

    render(DeviceSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /^AAA/ }));

    expect(activateSession).toHaveBeenCalledTimes(1);
    expect(activateSession).toHaveBeenCalledWith(idA);
  });

  test('clicking the active chip does not call activateSession', async () => {
    synced('AAA');
    synced('BBB');

    render(DeviceSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /^BBB/ }));

    expect(activateSession).not.toHaveBeenCalled();
  });
});

describe('DeviceSwitcher — add device', () => {
  test('clicking + calls connectRequested', async () => {
    synced('AAA');
    render(DeviceSwitcher);

    await fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    expect(connectRequested).toHaveBeenCalledTimes(1);
  });

  test('hidden when WebUSB is unsupported', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('no navigator.usb');
    synced('AAA');

    render(DeviceSwitcher);

    expect(screen.queryByRole('button', { name: 'Add device' })).not.toBeInTheDocument();
  });
});

describe('DeviceSwitcher — adopt-failure badges', () => {
  test('renders a badge for a noted failure and dismisses it on click', async () => {
    synced('AAA');
    noteAdoptFailure({ serial: 'CCC', message: 'boot adoption failed', errorKind: null });

    render(DeviceSwitcher);
    const badge = screen.getByRole('button', { name: /CCC.*dismiss/i });
    await fireEvent.click(badge);

    expect(adoptFailures().has('CCC')).toBe(false);
  });
});

describe('DeviceSwitcher — empty fleet', () => {
  test('renders nothing when there are no records and no failures', () => {
    render(DeviceSwitcher);
    expect(screen.queryByRole('group', { name: 'Devices' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
