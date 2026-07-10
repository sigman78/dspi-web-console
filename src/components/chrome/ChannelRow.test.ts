import { afterEach, describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { ChannelId } from '@/domain';
import ChannelRow from './ChannelRow.svelte';

const base = {
  name: 'Front L',
  channelId: ChannelId.Out1L,
  levelDb: -6,
  defaultName: 'Out 1 Left',
};

afterEach(() => vi.useRealTimers());

describe('ChannelRow', () => {
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

  test('double-click starts editing', async () => {
    const onStartEdit = vi.fn();
    render(ChannelRow, { props: { ...base, onStartEdit } });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Front L' }));
    expect(onStartEdit).toHaveBeenCalledOnce();
  });

  test('double-click on a disabled row does not start editing', async () => {
    const onStartEdit = vi.fn();
    render(ChannelRow, { props: { ...base, disabled: true, onStartEdit } });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Front L' }));
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  test('editing renders an input seeded with the name and no name button', () => {
    render(ChannelRow, { props: { ...base, editing: true } });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Front L');
    expect(screen.queryByRole('button', { name: 'Front L' })).toBeNull();
  });

  test('typing then Enter commits the typed value', async () => {
    const onCommitName = vi.fn();
    render(ChannelRow, { props: { ...base, editing: true, onCommitName } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Kick' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommitName).toHaveBeenCalledExactlyOnceWith('Kick');
  });

  test('Escape cancels without committing', async () => {
    const onCommitName = vi.fn();
    const onCancelEdit = vi.fn();
    render(ChannelRow, { props: { ...base, editing: true, onCommitName, onCancelEdit } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Kick' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancelEdit).toHaveBeenCalledOnce();
    expect(onCommitName).not.toHaveBeenCalled();
  });

  test('blur commits the current value', async () => {
    const onCommitName = vi.fn();
    render(ChannelRow, { props: { ...base, editing: true, onCommitName } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Snare' } });
    await fireEvent.blur(input);
    expect(onCommitName).toHaveBeenCalledExactlyOnceWith('Snare');
  });

  test('Enter then a trailing blur commits only once', async () => {
    const onCommitName = vi.fn();
    render(ChannelRow, { props: { ...base, editing: true, onCommitName } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Hat' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.blur(input);
    expect(onCommitName).toHaveBeenCalledExactlyOnceWith('Hat');
  });

  test('Escape then a trailing blur does not commit', async () => {
    const onCommitName = vi.fn();
    const onCancelEdit = vi.fn();
    render(ChannelRow, { props: { ...base, editing: true, onCommitName, onCancelEdit } });
    const input = screen.getByRole('textbox');
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.blur(input);
    expect(onCommitName).not.toHaveBeenCalled();
  });

  test('re-rendering while editing does not clobber the typed value', async () => {
    const { rerender } = render(ChannelRow, { props: { ...base, editing: true } });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Bass' } });
    // A telemetry tick (new levelDb) or an optimistic name change re-renders the row.
    await rerender({ ...base, editing: true, levelDb: -3, name: 'Front Left' });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Bass');
  });

  test('Enter returns focus to the row button on exit', async () => {
    const { rerender } = render(ChannelRow, { props: { ...base, editing: true } });
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await rerender({ ...base, editing: false });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Front L' }));
  });

  test('a click-away blur does not force focus back to the row', async () => {
    const { rerender } = render(ChannelRow, { props: { ...base, editing: true } });
    await fireEvent.blur(screen.getByRole('textbox'));
    await rerender({ ...base, editing: false });
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Front L' }));
  });

  test('holds a sustained red peak for one second after it leaves red', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(ChannelRow, { props: { ...base, levelDb: 0 } });
    const track = container.querySelector<HTMLElement>('.track')!;

    // Staying red longer than the hold duration must not expire the peak.
    await vi.advanceTimersByTimeAsync(1500);
    await rerender({ ...base, levelDb: -10 });
    expect(track.style.getPropertyValue('--vu-peak')).toBe('11');

    await vi.advanceTimersByTimeAsync(999);
    expect(track.style.getPropertyValue('--vu-peak')).toBe('11');
    await vi.advanceTimersByTimeAsync(1);
    expect(track.style.getPropertyValue('--vu-peak')).toBe('-1');
  });

  test('uses one release timer for multiple channel peaks', async () => {
    vi.useFakeTimers();
    const first = render(ChannelRow, { props: { ...base, levelDb: 0 } });
    const second = render(ChannelRow, {
      props: { ...base, channelId: ChannelId.Out1R, name: 'Front R', levelDb: 0 },
    });

    await first.rerender({ ...base, levelDb: -10 });
    await second.rerender({
      ...base,
      channelId: ChannelId.Out1R,
      name: 'Front R',
      levelDb: -10,
    });

    expect(vi.getTimerCount()).toBe(1);
  });
});
