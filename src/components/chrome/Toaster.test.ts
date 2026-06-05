import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Toaster from './Toaster.svelte';
import { pushNotice, clearNotices, notices } from '@/state';

beforeEach(() => clearNotices());

describe('Toaster', () => {
  it('renders a pushed notice and dismisses it on click', async () => {
    pushNotice('warn', 'GPIO pin already in use');
    render(Toaster);
    expect(screen.getByText('GPIO pin already in use')).toBeTruthy();

    await fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(notices.list).toHaveLength(0);
    expect(screen.queryByText('GPIO pin already in use')).toBeNull();
  });
});
