import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { ChannelId } from '@/domain';
import ChannelRow from './ChannelRow.svelte';

const base = { name: 'Front L', channelId: ChannelId.Out1L, levelDb: -6 };

describe('ChannelRow', () => {
  test('renders the channel name as the button label', () => {
    render(ChannelRow, { props: { ...base } });
    expect(screen.getByRole('button', { name: 'Front L' })).toBeTruthy();
  });

  test('marks the selected channel with aria-pressed', () => {
    render(ChannelRow, { props: { ...base, selected: true } });
    expect(screen.getByRole('button', { name: 'Front L' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking fires onclick', async () => {
    const onclick = vi.fn();
    render(ChannelRow, { props: { ...base, onclick } });
    await fireEvent.click(screen.getByRole('button', { name: 'Front L' }));
    expect(onclick).toHaveBeenCalledOnce();
  });

  test('disabled prevents click', async () => {
    const onclick = vi.fn();
    render(ChannelRow, { props: { ...base, disabled: true, onclick } });
    await fireEvent.click(screen.getByRole('button', { name: 'Front L' }));
    expect(onclick).not.toHaveBeenCalled();
  });
});
