import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { createStagingState, type StagedEntry } from '@/state';
import { noveauUi } from '@/components/noveau/noveauUi.svelte';
import StatusLine from './StatusLine.svelte';

function entry(key: string, over: Partial<StagedEntry> = {}): StagedEntry {
  return {
    key, label: `Label ${key}`, from: 'off', to: 'on', value: true, order: 1,
    apply: async () => true, overlay: (snap) => snap, ...over,
  };
}

function renderLine(entries: StagedEntry[], degraded = false) {
  const staging = createStagingState();
  entries.forEach((e) => staging.stage(e));
  const session = {
    info: { serial: 'S', capabilities: { fwLabel: 'fw', wireLabel: 'wire' } },
    telemetry: { info: null },
    health: { degraded },
    writes: { busy: false },
    staging,
  } as any;
  render(StatusLine, { context: new Map([[SESSION_KEY, session]]) });
  return session;
}

describe('StatusLine', () => {
  afterEach(() => {
    noveauUi.destination = 'tune';
    noveauUi.setupPage = 'inputs';
  });

  test('the staged reminder names the destination and navigates to the change', async () => {
    renderLine([entry('a', { page: 'outputs' }), entry('b', { page: 'outputs' })]);
    await fireEvent.click(screen.getByRole('button', { name: '2 staged · SETUP' }));
    expect(noveauUi.destination).toBe('setup');
    expect(noveauUi.setupPage).toBe('outputs');
  });

  test('a reminder with changes on both destinations carries no destination', () => {
    renderLine([entry('a', { page: 'inputs' }), entry('b', { page: 'surfaces' })]);
    expect(screen.getByRole('button', { name: '2 staged' })).toBeTruthy();
  });

  test('a degraded link shows the not-sent banner', () => {
    renderLine([], true);
    expect(screen.getByRole('alert').textContent).toContain('changes not sent');
  });
});
