import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { bootMock } from '@/runtime/boot';
import { activeSession, resetAppState } from '@/state';
import { fetchControlSurfaces } from '@/runtime/deviceService';
import { resolveMockProfile } from '@/mockProfiles';
import ControlSurfacesPanel from './ControlSurfacesPanel.svelte';

afterEach(() => { activeSession()?.dispose(); resetAppState(); });

async function mount() {
  const profile = resolveMockProfile('latest');
  await bootMock(profile.platform, profile.opts);
  const s = activeSession()!;
  await fetchControlSurfaces(s);
  expect(s.controlSurfaces.caps).not.toBeNull();
  render(ControlSurfacesPanel, { context: new Map([[SESSION_KEY, s]]) });
  return s;
}

async function addNamed(name: string): Promise<void> {
  const add = screen.getByRole('combobox', { name: 'Add control' }) as HTMLSelectElement;
  await fireEvent.change(add, { target: { value: add.options[1].value } });
  const dlg = screen.getByRole('dialog');
  if (name) await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: name } });
  await fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
}

async function clickApply(): Promise<void> {
  const apply = screen.getByRole('button', { name: 'APPLY' });
  expect((apply as HTMLButtonElement).disabled).toBe(false);
  await fireEvent.click(apply);
}

describe('ControlSurfacesPanel naming', () => {
  test('cancelling the name popover creates no draft', async () => {
    const s = await mount();
    const add = screen.getByRole('combobox', { name: 'Add control' }) as HTMLSelectElement;
    await fireEvent.change(add, { target: { value: add.options[1].value } });
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(s.drafts.of('cs').keys().length).toBe(0);
    expect(screen.queryByRole('button', { name: 'APPLY' })).toBeNull();
  });

  test('a never-applied slot shows NEW without the draft dot; an applied slot with an edit shows it', async () => {
    const s = await mount();
    await addNamed('Vol knob');
    expect(screen.getByText('Vol knob')).toBeTruthy();
    expect(screen.getByText('NEW')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'APPLY' }) as HTMLButtonElement).disabled).toBe(false);
    const title = () => document.querySelector('.cs-stitle')!;
    expect(title().classList.contains('draft')).toBe(false);

    await clickApply();
    await waitFor(() => expect(s.controlSurfaces.bindings.some((b) => b != null)).toBe(true));
    const slot = s.controlSurfaces.bindings.findIndex((b) => b != null);
    await waitFor(() => expect(s.drafts.dirtyCount('cs')).toBe(0));
    expect(title().classList.contains('draft')).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: `Rename control ${slot + 1}` }));
    const dlg = screen.getByRole('dialog');
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: 'Renamed' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(title().classList.contains('draft')).toBe(true));

    await clickApply();
    await waitFor(() => expect(s.controlSurfaces.names[slot]).toBe('Renamed'));
    expect(s.drafts.dirtyCount('cs')).toBe(0);
  });
});
