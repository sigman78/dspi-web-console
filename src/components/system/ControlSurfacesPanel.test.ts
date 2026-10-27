import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { bootMock } from '@/runtime/boot';
import { activeSession, resetAppState } from '@/state';
import { fetchControlSurfaces } from '@/runtime/deviceService';
import { resolveMockProfile } from '@/mockProfiles';
import ControlSurfacesPanel from './ControlSurfacesPanel.svelte';

afterEach(() => { activeSession()?.dispose(); resetAppState(); });

describe('ControlSurfacesPanel rename', () => {
  test('a name edit rides the slot draft: APPLY writes it, REVERT undoes it', async () => {
    const profile = resolveMockProfile('latest');
    await bootMock(profile.platform, profile.opts);
    const s = activeSession()!;
    await fetchControlSurfaces(s);
    expect(s.controlSurfaces.caps).not.toBeNull();

    render(ControlSurfacesPanel, { context: new Map([[SESSION_KEY, s]]) });
    expect(s.controlSurfaces.bindings.some((b) => b != null)).toBe(false);
    const add = screen.getByRole('combobox', { name: 'Add control' }) as HTMLSelectElement;
    await fireEvent.change(add, { target: { value: add.options[1].value } });
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await waitFor(() => expect(s.controlSurfaces.bindings.some((b) => b != null)).toBe(true));
    const slot = s.controlSurfaces.bindings.findIndex((b) => b != null);
    const before = s.controlSurfaces.names[slot];

    const field = (): HTMLInputElement => screen.getByRole('textbox', { name: `Name for control ${slot + 1}` });
    const rename = async (v: string) => {
      await fireEvent.input(field(), { target: { value: v } });
      field().focus();
      await fireEvent.keyDown(field(), { key: 'Enter' });
    };

    await rename('Renamed');
    expect(s.controlSurfaces.names[slot]).toBe(before);
    await waitFor(() => expect(s.drafts.dirtyCount('cs')).toBe(1));

    await fireEvent.click(screen.getByRole('button', { name: 'REVERT' }));
    expect(s.drafts.dirtyCount('cs')).toBe(0);
    expect(field().value).toBe(before);

    await rename(before);
    expect(s.drafts.dirtyCount('cs')).toBe(0);

    await rename('Renamed');
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await waitFor(() => expect(s.controlSurfaces.names[slot]).toBe('Renamed'));
    expect(s.drafts.dirtyCount('cs')).toBe(0);
  });
});
