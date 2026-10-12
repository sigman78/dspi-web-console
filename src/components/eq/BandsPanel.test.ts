import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BandsPanel from './BandsPanel.svelte';
import { ChannelId } from '@/domain';

const base = {
  bands: [],
  onPatch: () => {},
  onReset: () => {},
  copySource: null,
  currentChannel: ChannelId.Out1L,
  onCopy: () => {},
  onPaste: () => {},
  onExit: () => {},
  onSyncLink: () => {},
  needsSyncConfirm: false,
};
const grouped = { grouped: true, locked: false, diverged: false, peerLabel: '1R', selectedShort: '1L' };

describe('BandsPanel LINK chip', () => {
  it('is absent when the channel has no partner', () => {
    render(BandsPanel, {
      props: { ...base, link: { ...grouped, grouped: false, peerLabel: '' }, onToggleLink: vi.fn() },
    });
    expect(screen.queryByRole('button', { name: /LINK/ })).toBeNull();
  });

  it('toggles the link on click when grouped and no sync confirm is needed', async () => {
    const onToggleLink = vi.fn();
    render(BandsPanel, { props: { ...base, link: grouped, onToggleLink } });
    await fireEvent.click(screen.getByRole('button', { name: /LINK/ }));
    expect(onToggleLink).toHaveBeenCalledOnce();
  });

  it('asks for a second click before linking when a sync confirm is needed', async () => {
    const onToggleLink = vi.fn();
    render(BandsPanel, { props: { ...base, link: grouped, onToggleLink, needsSyncConfirm: true } });
    await fireEvent.click(screen.getByRole('button', { name: /LINK/ }));
    expect(onToggleLink).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: /COPY →/ }));
    expect(onToggleLink).toHaveBeenCalledOnce();
  });

  it('offers SYNC alongside AUTOEQ when the locked group diverged', () => {
    render(BandsPanel, {
      props: { ...base, link: { ...grouped, locked: true, diverged: true }, onToggleLink: vi.fn(), onLibrary: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'SYNC' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AUTOEQ' })).toBeTruthy();
  });
});
