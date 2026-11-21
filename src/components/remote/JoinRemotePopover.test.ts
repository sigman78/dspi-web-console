import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import * as State from '@/state';
import * as JoinRelay from '@/runtime/remote/joinRelay';
import JoinRemotePopover from './JoinRemotePopover.svelte';

vi.mock('@/runtime/remote/joinRelay', () => ({
  joinByCode: vi.fn(),
  joinWithResume: vi.fn(),
  leaveJoin: vi.fn(),
  resumeTarget: vi.fn((): string | null => null),
}));

beforeEach(() => {
  State.resetRemoteState();
  vi.clearAllMocks();
  vi.mocked(JoinRelay.resumeTarget).mockReturnValue(null);
});

describe('JoinRemotePopover', () => {
  it('shows a link code prefilled and joins with its scan key', async () => {
    render(JoinRemotePopover, { onClose: vi.fn(), seed: { code: 'ABCD3F', scanKey: 'KEY' } });
    expect(screen.getByLabelText('Code character 4')).toHaveValue('D');

    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    expect(JoinRelay.joinByCode).toHaveBeenCalledWith('ABCD3F', 'KEY');
  });

  it('drops the scan key once the code is edited', async () => {
    render(JoinRemotePopover, { onClose: vi.fn(), seed: { code: 'ABCD3F', scanKey: 'KEY' } });
    await fireEvent.keyDown(screen.getByLabelText('Code character 6'), { key: 'Backspace' });
    await fireEvent.input(screen.getByLabelText('Code character 6'), { target: { value: 'g' } });

    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    expect(JoinRelay.joinByCode).toHaveBeenCalledWith('ABCD3G', null);
  });

  it('cannot connect before the code is complete', () => {
    render(JoinRemotePopover, { onClose: vi.fn() });
    expect(screen.getByRole('button', { name: 'CONNECT' })).toBeDisabled();
  });

  it('reports progress of its own attempt only', async () => {
    State.setJoinState({ phase: 'failed', reason: 'host-gone' });
    render(JoinRemotePopover, { onClose: vi.fn(), seed: { code: 'ABCD3F', scanKey: null } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    State.setJoinState({ phase: 'waiting-allow' });
    expect(await screen.findByRole('status')).toHaveTextContent(/Waiting for Allow/);
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
  });

  it('closes itself when the join completes', async () => {
    const onClose = vi.fn();
    render(JoinRemotePopover, { onClose, seed: { code: 'ABCD3F', scanKey: null } });
    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    State.setJoinState({ phase: 'joined' });
    await vi.waitFor(() => { expect(onClose).toHaveBeenCalled(); });
  });

  it('offers to reconnect only when a resume token is stored', async () => {
    const { unmount } = render(JoinRemotePopover, { onClose: vi.fn() });
    expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument();
    unmount();

    vi.mocked(JoinRelay.resumeTarget).mockReturnValue('SER123');
    render(JoinRemotePopover, { onClose: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /Reconnect to SER123/ }));
    expect(JoinRelay.joinWithResume).toHaveBeenCalledTimes(1);
  });
});

describe('JoinRemotePopover reopened mid-attempt', () => {
  it('keeps showing the running attempt and does not start a second one', () => {
    State.setJoinState({ phase: 'waiting-allow' });
    render(JoinRemotePopover, { onClose: vi.fn(), seed: { code: 'ABCD3F', scanKey: null } });
    expect(screen.getByRole('status')).toHaveTextContent(/Waiting for Allow/);
    expect(screen.queryByRole('button', { name: 'CONNECT' })).not.toBeInTheDocument();
    expect(JoinRelay.joinByCode).not.toHaveBeenCalled();
  });
});
