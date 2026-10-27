import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DspDevice } from '@/device/DspDevice';
import DeviceSwitcher from './DeviceSwitcher.svelte';

vi.mock('../../runtime/boot', () => ({
  connectRequested: vi.fn().mockResolvedValue(undefined),
  webUsbUnsupportedReason: vi.fn(() => null),
}));

vi.mock('../../runtime/deviceService', () => ({
  switchSession: vi.fn().mockResolvedValue(undefined),
}));

import { switchSession, connectRequested, webUsbUnsupportedReason } from '@/runtime';
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
  vi.mocked(switchSession).mockClear();
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

    expect(switchSession).toHaveBeenCalledTimes(1);
    expect(switchSession).toHaveBeenCalledWith(idA);
  });

  test('clicking the active chip does not call switchSession', async () => {
    synced('AAA');
    synced('BBB');

    render(DeviceSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /^BBB/ }));

    expect(switchSession).not.toHaveBeenCalled();
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

describe('DeviceSwitcher — failure ordering', () => {
  test('a failure badge stays visible beside the active device with several devices', () => {
    synced('AAA');
    synced('BBB');
    synced('CCC');   // active
    noteAdoptFailure({ serial: 'ZZZ', message: 'boot adoption failed', errorKind: null });

    render(DeviceSwitcher);

    expect(screen.getByRole('button', { name: /^CCC/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /ZZZ.*dismiss/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 more devices' })).toBeInTheDocument();
  });

  test('the overflow button flags a failure hidden behind it', () => {
    synced('AAA');
    noteAdoptFailure({ serial: 'Y1', message: 'a', errorKind: null });
    noteAdoptFailure({ serial: 'Y2', message: 'b', errorKind: null });

    render(DeviceSwitcher);

    expect(screen.getByRole('button', { name: /1 more devices, including failed/ })).toBeInTheDocument();
  });
});

describe('DeviceSwitcher — empty fleet', () => {
  test('renders nothing when there are no records and no failures', () => {
    render(DeviceSwitcher);
    expect(screen.queryByRole('group', { name: 'Devices' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('DeviceSwitcher — row cap', () => {
  test('shows two rows, the rest behind a popover that switches sessions', async () => {
    synced('AAA');
    synced('BBB');
    const hiddenId = synced('CCC');
    synced('DDD');
    synced('EEE');

    render(DeviceSwitcher);
    expect(screen.getAllByRole('button', { name: /^(AAA|BBB|CCC|DDD|EEE)/ })).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: '3 more devices' }));
    const pop = screen.getByRole('dialog', { name: 'More devices' });
    expect(pop.querySelectorAll('button')).toHaveLength(3);

    await fireEvent.click(screen.getByRole('button', { name: /^CCC/ }));
    expect(switchSession).toHaveBeenCalledWith(hiddenId);
  });

  test('the active device keeps a visible row when it is past the cap', () => {
    for (const s of ['AAA', 'BBB', 'CCC']) synced(s);   // CCC is active

    render(DeviceSwitcher);
    expect(screen.getByRole('button', { name: /^CCC/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /^BBB/ })).not.toBeInTheDocument();
  });
});
