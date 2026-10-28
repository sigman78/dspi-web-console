import { describe, it, expect } from 'vitest';
import { confirmState, askConfirm, resolveConfirm } from './confirm.svelte';

const prompt = { title: 't', body: 'b', confirmLabel: 'GO', tone: 'danger' as const };

describe('askConfirm', () => {
  it('resolves true on confirm and false on cancel, clearing pending', async () => {
    const yes = askConfirm(prompt);
    expect(confirmState.pending).toEqual(prompt);
    resolveConfirm(true);
    expect(await yes).toBe(true);
    expect(confirmState.pending).toBeNull();

    const no = askConfirm(prompt);
    resolveConfirm(false);
    expect(await no).toBe(false);
  });

  it('refuses a second concurrent ask without disturbing the first', async () => {
    const first = askConfirm(prompt);
    expect(await askConfirm({ ...prompt, title: 'other' })).toBe(false);
    expect(confirmState.pending?.title).toBe('t');
    resolveConfirm(true);
    expect(await first).toBe(true);
  });
});
