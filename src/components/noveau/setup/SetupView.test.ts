import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { bootMock } from '@/runtime/boot';
import { activeSession, resetAppState } from '@/state';
import { stageMckEnabled } from '@/runtime/stagedActions';
import { noveauUi } from '../noveauUi.svelte';
import SetupView from './SetupView.svelte';

afterEach(() => { activeSession()?.dispose(); resetAppState(); });

describe('SetupView', () => {
  test('a staged change marks only the page that holds its control', async () => {
    await bootMock('rp2350');
    const s = activeSession()!;
    stageMckEnabled(s, !s.mirror.snapshot.i2s.mckEnabled);
    expect(s.staging.get('mckEnabled')?.page).toBe('outputs');

    render(SetupView, { context: new Map([[SESSION_KEY, s]]) });
    expect(screen.getByRole('tab', { name: 'OUTPUTS' }).classList.contains('staged')).toBe(true);
    expect(screen.getByRole('tab', { name: 'INPUTS' }).classList.contains('staged')).toBe(false);
    expect(screen.getByRole('tab', { name: 'DEVICE' }).classList.contains('staged')).toBe(false);
  });

  test('arrow keys, Home and End move the page selection and focus', async () => {
    await bootMock('rp2350');
    const s = activeSession()!;
    noveauUi.setupPage = 'inputs';
    render(SetupView, { context: new Map([[SESSION_KEY, s]]) });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', ...tabs.slice(1).map(() => '-1')]);

    await fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(noveauUi.setupPage).toBe('outputs');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    await fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    await fireEvent.keyDown(tabs[tabs.length - 1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(noveauUi.setupPage).toBe('inputs');
  });
});
