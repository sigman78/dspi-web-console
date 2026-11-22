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

function renderLine(entries: StagedEntry[], degraded = false, caps: object = {}) {
  const staging = createStagingState();
  entries.forEach((e) => staging.stage(e));
  const session = {
    info: { serial: 'S', capabilities: { fwLabel: 'fw', wireLabel: 'wire', generation: 'legacy', fw: {}, ...caps } },
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

  test('a reminder with a change that names no page carries no destination', () => {
    renderLine([entry('a', { page: 'inputs' }), entry('b', { page: undefined })]);
    expect(screen.getByRole('button', { name: '2 staged' })).toBeTruthy();
  });

  test('a degraded link shows the not-sent banner', () => {
    renderLine([], true);
    expect(screen.getByRole('alert').textContent).toContain('changes not sent');
  });

  test('a paged device on pre-release firmware shows the beta badge with an explanatory tooltip', () => {
    renderLine([], false, { generation: 'paged', fw: { beta: 1 } });
    expect(screen.getByText('beta firmware').getAttribute('title')).toContain('report');
  });

  test.each([
    ['paged release firmware', { generation: 'paged', fw: {} }],
    ['legacy pre-release firmware', { generation: 'legacy', fw: { beta: 3 } }],
  ])('%s shows no beta badge', (_name, caps) => {
    renderLine([], false, caps);
    expect(screen.queryByText('beta firmware')).toBeNull();
  });
});
