import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ModalHarness from './ModalHarness.test.svelte';

function setup(extra: Record<string, unknown> = {}) {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const onCancel = vi.fn();
  const view = render(ModalHarness, { props: { onCancel, ...extra } });
  return { opener, onCancel, ...view };
}

describe('Modal', () => {
  test('focuses the data-safe button on open and returns focus on close', () => {
    const { opener, unmount } = setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  test('initialFocus selects the element to focus', () => {
    setup({ initialFocus: 'input' });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  test('Escape cancels unless another handler already took it', async () => {
    const { onCancel } = setup();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    screen.getByRole('textbox').addEventListener('keydown', (e) => e.preventDefault());
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('clicking the scrim cancels, clicking the panel does not', async () => {
    const { onCancel } = setup();
    await fireEvent.click(screen.getByRole('textbox'));
    expect(onCancel).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('Tab wraps from the last control to the first and Shift+Tab the reverse', async () => {
    setup();
    const first = screen.getByRole('button', { name: 'Cancel' });
    const last = screen.getByRole('textbox');
    last.focus();
    await fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    await fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
