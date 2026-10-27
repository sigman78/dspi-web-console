import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { createDraftsState } from '@/state';
import CsChangesStrip from './CsChangesStrip.svelte';

function renderStrip(o: { dirty?: boolean; drafts?: number } = {}) {
  const drafts = createDraftsState();
  for (let i = 0; i < (o.drafts ?? 0); i++) drafts.of('cs').editDraft(i, {});
  const session = {
    controlSurfaces: {
      caps: { capsVersion: 9, maxBindings: 4 },
      status: { dirty: o.dirty ?? false },
      changed: { bindings: true, groups: false, macros: false, display: false },
    },
    drafts,
  } as any;
  render(CsChangesStrip, { context: new Map([[SESSION_KEY, session]]) });
}

describe('CsChangesStrip', () => {
  test('a clean device shows no "changed" label and no unapplied count', () => {
    renderStrip();
    expect(screen.queryByText('changed')).toBeNull();
    expect(screen.queryByText(/unapplied/)).toBeNull();
  });

  test('unsaved device changes and console drafts surface separately', () => {
    renderStrip({ dirty: true, drafts: 2 });
    expect(screen.getByText('changed')).toBeTruthy();
    expect(screen.getByText('unapplied 2')).toBeTruthy();
  });
});
