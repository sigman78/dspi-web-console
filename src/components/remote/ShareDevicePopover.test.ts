import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import * as State from '@/state';
import * as Share from '@/runtime/remote/share';
import { bootMock } from '@/runtime/boot';
import ShareDevicePopover from './ShareDevicePopover.svelte';

vi.mock('@/runtime/remote/share', () => ({
  startSharing: vi.fn(async () => true),
  allow: vi.fn(),
  deny: vi.fn(),
  rotateCode: vi.fn(),
  stopSharing: vi.fn(),
}));

beforeEach(() => {
  State.resetRemoteState();
  vi.clearAllMocks();
});

function sharing(): void {
  State.setShareState('sharing');
  State.setShareRoom({ code: 'ABCD3F', scanKey: 'k', status: 'live' });
}

describe('ShareDevicePopover', () => {
  it('opens a room on its own when nothing is shared yet', () => {
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(Share.startSharing).toHaveBeenCalledTimes(1);
  });

  it('does not open a second room while one is live', () => {
    sharing();
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(Share.startSharing).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pairing code')).toHaveTextContent('ABC-D3F');
  });

  it('asks the owner and routes Allow and Deny to the runtime', async () => {
    sharing();
    State.setSharePeer({ peerId: 'p1', label: 'Win · Chrome · amber-fox', stage: 'pending' });
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(screen.getByRole('status')).toHaveTextContent('Win · Chrome · amber-fox wants control');

    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(Share.allow).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(Share.deny).toHaveBeenCalledTimes(1);
  });

  it('offers no Allow or Deny until someone asks', () => {
    sharing();
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('copies a link built from the page origin', async () => {
    sharing();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(ShareDevicePopover, { onClose: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/?join=ABCD3F');
  });

  it('keeps a subpath deployment in the link', async () => {
    sharing();
    vi.stubEnv('BASE_URL', '/dspi/');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(ShareDevicePopover, { onClose: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/dspi/?join=ABCD3F');
    vi.unstubAllEnvs();
  });

  it('marks a used code and makes a new one the obvious move', () => {
    State.setShareState('sharing');
    State.setShareRoom({ code: 'ABCD3F', scanKey: 'k', status: 'burnt' });
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(screen.getByRole('status')).toHaveTextContent(/already used/);
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New code' })).toBeEnabled();
  });

  it('cannot swap the code while someone is waiting on it', () => {
    sharing();
    State.setSharePeer({ peerId: 'p1', label: 'Win', stage: 'pending' });
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(screen.getByRole('button', { name: 'New code' })).toBeDisabled();
  });

  it('while paused for its device it says so, does not open a room, and Stop sharing works', async () => {
    State.setShareAway({ serial: 'SN-42', until: Date.now() + 60_000 });
    const onClose = vi.fn();
    render(ShareDevicePopover, { onClose });
    expect(Share.startSharing).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Waiting for SN-42 to come back/);
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: 'STOP SHARING' });
    expect(stop).toBeEnabled();
    await fireEvent.click(stop);
    expect(Share.stopSharing).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says the device is back when it is connected but not active', async () => {
    State.setShareAway({ serial: 'MOCK-RP2350-2', until: Date.now() + 60_000 });
    await bootMock('rp2350', { serial: 'MOCK-RP2350-2' });
    render(ShareDevicePopover, { onClose: vi.fn() });
    expect(screen.getByRole('status')).toHaveTextContent('MOCK-RP2350-2 is back. Switch to it to resume sharing.');
    State.resetAppState();
  });

  it('Stop sharing ends the share and closes the popover', async () => {
    sharing();
    const onClose = vi.fn();
    render(ShareDevicePopover, { onClose });
    await fireEvent.click(screen.getByRole('button', { name: 'STOP SHARING' }));
    expect(Share.stopSharing).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
