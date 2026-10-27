import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import NameField from './NameField.svelte';

const base = { value: 'Kick', ariaLabel: 'Name' };
const input = () => screen.getByRole('textbox') as HTMLInputElement;

describe('NameField (persistent)', () => {
  test('Enter commits the trimmed draft', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, onCommit } });
    await fireEvent.input(input(), { target: { value: '  Snare ' } });
    input().focus();
    await fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Snare');
  });

  test('blur commits, and an unchanged name does not', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, onCommit } });
    await fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    await fireEvent.input(input(), { target: { value: 'Hat' } });
    await fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Hat');
  });

  test('an emptied field is rejected and reverts', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, onCommit } });
    await fireEvent.input(input(), { target: { value: '   ' } });
    await fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe('Kick');
  });

  test('allowEmpty commits an emptied field', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, allowEmpty: true, onCommit } });
    await fireEvent.input(input(), { target: { value: '' } });
    await fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('');
  });

  test('Escape on a dirty field reverts it and is consumed', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, onCommit } });
    input().focus();
    await fireEvent.input(input(), { target: { value: 'Hat' } });
    const notPrevented = await fireEvent.keyDown(input(), { key: 'Escape' });
    expect(notPrevented).toBe(false);
    expect(input().value).toBe('Kick');
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('Escape on a pristine field is left for the surrounding surface', async () => {
    render(NameField, { props: { ...base, onCommit: vi.fn() } });
    const notPrevented = await fireEvent.keyDown(input(), { key: 'Escape' });
    expect(notPrevented).toBe(true);
  });

  test('adopts a new value while not focused', async () => {
    const { rerender } = render(NameField, { props: { ...base, onCommit: vi.fn() } });
    await rerender({ ...base, value: 'Bass', onCommit: vi.fn() });
    expect(input().value).toBe('Bass');
  });

  test('commit() flushes a pending draft', async () => {
    const onCommit = vi.fn();
    const { component } = render(NameField, { props: { ...base, onCommit } });
    await fireEvent.input(input(), { target: { value: 'Tom' } });
    await component.commit();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Tom');
  });
});

describe('NameField (editing)', () => {
  test('mounts focused with the name seeded', () => {
    render(NameField, { props: { ...base, editing: true, onCommit: vi.fn() } });
    expect(input().value).toBe('Kick');
    expect(document.activeElement).toBe(input());
  });

  test('typing then Enter commits the typed value', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, editing: true, onCommit } });
    await fireEvent.input(input(), { target: { value: 'Snare' } });
    await fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Snare');
  });

  test('an unchanged name still ends the edit with a commit', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, editing: true, onCommit } });
    await fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Kick');
  });

  test('Escape cancels without committing, and the trailing blur stays quiet', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(NameField, { props: { ...base, editing: true, onCommit, onCancel } });
    await fireEvent.input(input(), { target: { value: 'Snare' } });
    await fireEvent.keyDown(input(), { key: 'Escape' });
    await fireEvent.blur(input());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('Enter then a trailing blur commits only once', async () => {
    const onCommit = vi.fn();
    render(NameField, { props: { ...base, editing: true, onCommit } });
    await fireEvent.input(input(), { target: { value: 'Hat' } });
    await fireEvent.keyDown(input(), { key: 'Enter' });
    await fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledOnce();
  });

  test('a rejected empty name cancels the edit', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(NameField, { props: { ...base, editing: true, onCommit, onCancel } });
    await fireEvent.input(input(), { target: { value: '' } });
    await fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('re-rendering while editing does not clobber the typed value', async () => {
    const { rerender } = render(NameField, { props: { ...base, editing: true, onCommit: vi.fn() } });
    await fireEvent.input(input(), { target: { value: 'Bass' } });
    await rerender({ ...base, editing: true, value: 'Front Left', onCommit: vi.fn() });
    expect(input().value).toBe('Bass');
  });
});
