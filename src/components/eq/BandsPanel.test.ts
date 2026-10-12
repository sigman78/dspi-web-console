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
};
const grouped = { grouped: true, locked: false, peerLabel: '1R', selectedShort: '1L' };

describe('BandsPanel LINK chip', () => {
  it('is absent when the channel has no partner', () => {
    render(BandsPanel, {
      props: { ...base, link: { ...grouped, grouped: false, peerLabel: '' }, onToggleLink: vi.fn() },
    });
    expect(screen.queryByRole('button', { name: /LINK/ })).toBeNull();
  });

  it('toggles the link on click when grouped', async () => {
    const onToggleLink = vi.fn();
    render(BandsPanel, { props: { ...base, link: grouped, onToggleLink } });
    await fireEvent.click(screen.getByRole('button', { name: /LINK/ }));
    expect(onToggleLink).toHaveBeenCalledOnce();
  });
});
