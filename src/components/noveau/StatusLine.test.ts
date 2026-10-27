import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { createStagingState, type StagedEntry } from '@/state';
import StatusLine from './StatusLine.svelte';

function entry(key: string, over: Partial<StagedEntry> = {}): StagedEntry {
  return {
    key, label: `Label ${key}`, from: 'off', to: 'on', value: true, order: 1,
    apply: async () => true, overlay: (snap) => snap, ...over,
  };
}

function renderLine(entries: StagedEntry[]) {
  const staging = createStagingState();
  entries.forEach((e) => staging.stage(e));
  const session = {
    info: { serial: 'S', capabilities: { fwLabel: 'fw', wireLabel: 'wire' } },
    telemetry: { info: null },
    health: { degraded: false },
    writes: { busy: false },
    staging,
  } as any;
  render(StatusLine, { context: new Map([[SESSION_KEY, session]]) });
  return session;
}

describe('StatusLine staged list', () => {
  test('the change count opens a list whose per-row ✕ discards just that entry', async () => {
    const session = renderLine([entry('a'), entry('b')]);
    await fireEvent.click(screen.getByRole('button', { name: '2 changes' }));
    expect(screen.getByText('Label a')).toBeTruthy();
    expect(screen.getAllByText('off→on')).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: 'Discard Label a' }));
    expect(session.staging.has('a')).toBe(false);
    expect(session.staging.has('b')).toBe(true);
  });

  test('APPLY is a single click when nothing is disruptive', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    renderLine([entry('a', { apply })]);
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('APPLY needs a second confirming click when an entry is disruptive', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    renderLine([entry('a', { apply, disruptive: { reason: 'reboots the clock', tone: 'warn' } })]);
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(apply).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'CONFIRM' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('the disruptive reason is shown beside the count', () => {
    renderLine([entry('a', { disruptive: { reason: 'reboots the clock', tone: 'danger' } })]);
    expect(screen.getByText('reboots the clock')).toBeTruthy();
  });
});
