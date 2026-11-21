import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Harness from './CodeFieldHarness.test.svelte';

function cell(n: number): HTMLInputElement {
  return screen.getByLabelText(`Code character ${n}`);
}
const value = (): string => screen.getByTestId('code').textContent ?? '';

async function type(n: number, text: string): Promise<void> {
  await fireEvent.input(cell(n), { target: { value: text } });
}

describe('CodeField', () => {
  it('uppercases what is typed and moves on to the next cell', async () => {
    render(Harness);
    await type(1, 'a');
    expect(value()).toBe('A');
    expect(cell(1).value).toBe('A');
    expect(cell(2)).toHaveFocus();
  });

  it('refuses characters outside the alphabet and shows nothing for them', async () => {
    render(Harness);
    await type(1, 'o');
    expect(value()).toBe('');
    expect(cell(1).value).toBe('');
  });

  it('backspace in an empty cell erases the previous character and steps back', async () => {
    render(Harness);
    await type(1, 'a');
    await type(2, 'b');
    cell(3).focus();
    await fireEvent.keyDown(cell(3), { key: 'Backspace' });
    expect(value()).toBe('A');
    expect(cell(2)).toHaveFocus();
  });

  it('a pasted code or invite link fills the whole field', async () => {
    render(Harness);
    await fireEvent.paste(cell(3), { clipboardData: { getData: () => 'abc-d3f' } });
    expect(value()).toBe('ABCD3F');

    await fireEvent.paste(cell(1), { clipboardData: { getData: () => 'https://x.test/?join=234-567' } });
    expect(value()).toBe('234567');
  });

  it('Enter submits', async () => {
    const onSubmit = vi.fn();
    render(Harness, { onSubmit });
    await fireEvent.keyDown(cell(1), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('CodeField deletion and caret keys', () => {
  async function filled(): Promise<void> {
    render(Harness);
    await fireEvent.paste(cell(1), { clipboardData: { getData: () => 'ABCD3F' } });
  }

  it('an input event that deletes removes that cell character', async () => {
    await filled();
    await fireEvent.input(cell(2), { target: { value: '' }, inputType: 'deleteContentBackward' });
    expect(value()).toBe('ACD3F');
  });

  it('an emptied cell with no inputType (Android, cut) is a deletion too', async () => {
    await filled();
    await fireEvent.input(cell(6), { target: { value: '' } });
    expect(value()).toBe('ABCD3');
  });

  it('typing after an existing character replaces it instead of keeping both', async () => {
    await filled();
    await type(1, 'AG');
    expect(value()).toBe('GBCD3F');
    expect(cell(2)).toHaveFocus();
  });

  it('Delete removes the character under the caret and arrows move between cells', async () => {
    await filled();
    cell(2).focus();
    await fireEvent.keyDown(cell(2), { key: 'Delete' });
    expect(value()).toBe('ACD3F');
    await fireEvent.keyDown(cell(2), { key: 'ArrowRight' });
    expect(cell(3)).toHaveFocus();
    await fireEvent.keyDown(cell(3), { key: 'ArrowLeft' });
    expect(cell(2)).toHaveFocus();
  });

  it('starts on the first empty cell', () => {
    render(Harness);
    expect(cell(1)).toHaveFocus();
  });
});
