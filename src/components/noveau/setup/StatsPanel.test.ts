import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { StatusStore } from '@/state';
import StatsPanel from './StatsPanel.svelte';

vi.mock('@/runtime', () => ({ clearClips: vi.fn() }));

import { clearClips } from '@/runtime';

function renderStats() {
  const telemetry = new StatusStore();
  const session = { mirror: { current: null }, telemetry } as any;
  render(StatsPanel, { context: new Map([[SESSION_KEY, session]]) });
  return { telemetry, session };
}

describe('StatsPanel', () => {
  test('CLEAR appears only while a clip is latched and clears them', async () => {
    const { telemetry, session } = renderStats();
    expect(screen.queryByRole('button', { name: 'CLEAR' })).toBeNull();

    telemetry.clipLatched[2] = true;
    const clear = await screen.findByRole('button', { name: 'CLEAR' });
    await fireEvent.click(clear);
    expect(clearClips).toHaveBeenCalledWith(session);
  });
});
