import { describe, it, expect } from 'vitest';
import { createDraftsState } from './drafts.svelte';

describe('createDraftsState', () => {
  it('counts only drafts that differ from device truth, across families', () => {
    const drafts = createDraftsState();
    const cs = drafts.of<{ n: number }>('cs');
    cs.editDraft(0, { n: 1 });
    cs.editDraft(1, { n: 2 });
    drafts.of('macros').editDraft(0, {});
    cs.setDirty(1, false);

    expect(drafts.dirtyCount()).toBe(2);
    expect(drafts.dirtyCount('cs')).toBe(1);
    expect(cs.keys()).toEqual([0, 1]);
  });

  it('a draft survives re-reading the family view, as it does across panel remounts', () => {
    const drafts = createDraftsState();
    drafts.of<{ n: number }>('groups').editDraft(3, { n: 7 });
    expect(drafts.of<{ n: number }>('groups').draftOf(3)).toEqual({ n: 7 });
  });

  it('remove drops one draft; clearAll wipes every family', () => {
    const drafts = createDraftsState();
    drafts.of('cs').editDraft(0, {});
    drafts.of('cs').editDraft(1, {});
    drafts.of('ir').editDraft(0, {});

    drafts.of('cs').remove(0);
    expect(drafts.of('cs').keys()).toEqual([1]);

    drafts.clearAll();
    expect(drafts.dirtyCount()).toBe(0);
    expect(drafts.of('ir').keys()).toEqual([]);
  });
});
