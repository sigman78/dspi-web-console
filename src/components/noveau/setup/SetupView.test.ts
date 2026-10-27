import { describe, test, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { bootMock } from '@/runtime/boot';
import { activeSession, resetAppState } from '@/state';
import { stageMckEnabled } from '@/runtime/stagedActions';
import SetupView from './SetupView.svelte';

afterEach(() => { activeSession()?.dispose(); resetAppState(); });

describe('SetupView', () => {
  test('a staged change marks only the page that holds its control', async () => {
    await bootMock('rp2350');
    const s = activeSession()!;
    stageMckEnabled(s, !s.mirror.snapshot.i2s.mckEnabled);
    expect(s.staging.get('mckEnabled')?.page).toBe('outputs');

    render(SetupView, { context: new Map([[SESSION_KEY, s]]) });
    expect(screen.getByRole('button', { name: 'OUTPUTS' }).classList.contains('staged')).toBe(true);
    expect(screen.getByRole('button', { name: 'INPUTS' }).classList.contains('staged')).toBe(false);
    expect(screen.getByRole('button', { name: 'DEVICE' }).classList.contains('staged')).toBe(false);
  });
});
