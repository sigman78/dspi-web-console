import { describe, test, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { ChannelId } from '@/domain';
import { bootMock } from '@/runtime/boot';
import { activeSession, resetAppState, settings } from '@/state';
import { noveauUi } from '@/components/noveau/noveauUi.svelte';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import NoveauShell from './NoveauShell.svelte';

afterEach(() => { activeSession()?.dispose(); resetAppState(); noveauUi.destination = 'tune'; });

describe('NoveauShell', () => {
  test('a channel switch drops the selected band even while TUNE is not mounted', async () => {
    await bootMock('rp2350');
    const s = activeSession()!;
    settings.selectedChannel = ChannelId.Out1L;
    noveauUi.destination = 'program';
    render(NoveauShell, { props: { session: s } });
    noveauUi.selectedBand = 2;
    await tick();
    expect(noveauUi.selectedBand).toBe(2);

    settings.selectedChannel = ChannelId.In1L;
    await tick();
    expect(noveauUi.selectedBand).toBeNull();
  });
});
