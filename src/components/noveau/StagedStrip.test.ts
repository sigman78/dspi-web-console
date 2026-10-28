import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { createStagingState, type StagedEntry } from '@/state';
import StagedStrip from './StagedStrip.svelte';

function entry(key: string, over: Partial<StagedEntry> = {}): StagedEntry {
  return {
    key, label: `Label ${key}`, from: 'off', to: 'on', value: true, order: 1,
    apply: async () => true, overlay: (snap) => snap, ...over,
  };
}

function renderStrip(entries: StagedEntry[]) {
  const staging = createStagingState();
  entries.forEach((e) => staging.stage(e));
  const session = {
    writes: { busy: false },
    staging,
  } as any;
  render(StagedStrip, { context: new Map([[SESSION_KEY, session]]) });
  return session;
}

describe('StagedStrip', () => {
  test('the change count opens a list whose per-row ✕ discards just that entry', async () => {
    const session = renderStrip([entry('a'), entry('b')]);
    await fireEvent.click(screen.getByRole('button', { name: '2 changes' }));
    expect(screen.getByText('Label a')).toBeTruthy();
    expect(screen.getAllByText('off→on')).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: 'Discard Label a' }));
    expect(session.staging.has('a')).toBe(false);
    expect(session.staging.has('b')).toBe(true);
  });

  test('APPLY is a single click when nothing is disruptive', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    renderStrip([entry('a', { apply })]);
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('APPLY needs a second confirming click when an entry is disruptive', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    renderStrip([entry('a', { apply, disruptive: { reason: 'reboots the clock', tone: 'warn' } })]);
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(apply).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'CONFIRM' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('the disruptive reason is shown beside the count', () => {
    renderStrip([entry('a', { disruptive: { reason: 'reboots the clock', tone: 'danger' } })]);
    expect(screen.getByText('reboots the clock')).toBeTruthy();
  });

  test('DISCARD needs a second confirming click', async () => {
    const session = renderStrip([entry('a')]);
    await fireEvent.click(screen.getByRole('button', { name: /^DISCARD/ }));
    expect(session.staging.has('a')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: /^DISCARD/ }));
    expect(session.staging.has('a')).toBe(false);
  });

  test('Escape closes the changes list and returns focus to the count button', async () => {
    renderStrip([entry('a')]);
    const count = screen.getByRole('button', { name: '1 change' });
    await fireEvent.click(count);
    screen.getByRole('button', { name: 'Discard Label a' }).focus();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Staged changes' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(count));
  });

  test('discarding a row moves focus to the next row, then to the page tab once the strip is gone', async () => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'true');
    document.body.append(tab);
    try {
      renderStrip([entry('a'), entry('b')]);
      await fireEvent.click(screen.getByRole('button', { name: '2 changes' }));
      const xa = screen.getByRole('button', { name: 'Discard Label a' });
      xa.focus();
      await fireEvent.click(xa);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Discard Label b' })));

      await fireEvent.click(screen.getByRole('button', { name: 'Discard Label b' }));
      await waitFor(() => expect(document.activeElement).toBe(tab));
    } finally {
      tab.remove();
    }
  });

  test('shows nothing when nothing is staged', () => {
    renderStrip([]);
    expect(screen.queryByRole('group', { name: 'Staged changes' })).toBeNull();
  });
});
