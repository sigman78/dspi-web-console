import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConfirmModal from './ConfirmModal.svelte';

function setup() {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(ConfirmModal, {
    props: { title: 'Wipe it', body: 'Gone forever.', confirmLabel: 'WIPE', tone: 'danger', onConfirm, onCancel },
  });
  return { opener, onConfirm, onCancel, ...view };
}

describe('ConfirmModal', () => {
  test('focus starts on Cancel and returns to the opener on close', () => {
    const { opener, unmount } = setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'CANCEL' }));
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  test('Escape and the scrim cancel without confirming', async () => {
    const { onConfirm, onCancel } = setup();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('the confirm button confirms', async () => {
    const { onConfirm, onCancel } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'WIPE' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
