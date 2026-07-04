import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { ChannelId } from '@/domain';
import ChannelRow from './ChannelRow.svelte';

const base = {
  name: 'Front L',
  channelId: ChannelId.Out1L,
  levelDb: -6,
  defaultName: 'Out 1 Left',
};

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
});
