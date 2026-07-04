// Component-level test for the WCAG 2.1.1 fix: the hand-rolled drag slider
// had aria-value* but no key handler. These lock the arrow/page/home/end
// behavior and the aria-valuenow mirror.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PreampPanel from './PreampPanel.svelte';
import { ChannelId } from '@/domain';

const base = {
  preampDb: 0,
  accentChannelId: ChannelId.Out1L,
  onReset: () => {},
};

describe('PreampPanel keyboard support', () => {
  it('ArrowUp increments by one step', async () => {
    const onChange = vi.fn();
    render(PreampPanel, { props: { ...base, onChange } });
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(0.1);
  });

  it('ArrowDown decrements by one step', async () => {
    const onChange = vi.fn();
    render(PreampPanel, { props: { ...base, onChange } });
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(-0.1);
  });

  it('PageUp/PageDown move by 5 steps', async () => {
    const onChange = vi.fn();
    render(PreampPanel, { props: { ...base, preampDb: 2, onChange } });
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'PageUp' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2.5);
    onChange.mockClear();
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'PageDown' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1.5);
  });

  it('Home/End jump to min/max', async () => {
    const onChange = vi.fn();
    render(PreampPanel, { props: { ...base, preampDb: 2, onChange } });
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(-60);
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('clamps at the max boundary', async () => {
    const onChange = vi.fn();
    render(PreampPanel, { props: { ...base, preampDb: 10, onChange } });
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(10);
  });

  it('an unrelated key is ignored', async () => {
    const onChange = vi.fn();
    render(PreampPanel, { props: { ...base, onChange } });
    await fireEvent.keyDown(screen.getByRole('slider'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('aria-valuenow mirrors the current preampDb prop', () => {
    render(PreampPanel, { props: { ...base, preampDb: -6, onChange: vi.fn() } });
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('-6');
  });
});
