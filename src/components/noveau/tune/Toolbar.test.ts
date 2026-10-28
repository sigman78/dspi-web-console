import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { Wire } from '@/protocol';
import { ChannelId } from '@/domain';
import { bootMock } from '@/runtime/boot';
import { activeSession, resetAppState } from '@/state';
import Toolbar from './Toolbar.svelte';

afterEach(() => {
  cleanup();
  resetAppState();
});

describe('Toolbar LINK', () => {
  test('a band added while linked is written to both pair members', async () => {
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION });
    const s = activeSession()!;
    const left = s.mirror.current!.channels.find((c) => c.id === ChannelId.Out1L)!;
    const spy = vi.spyOn(s.device, 'setFilter');
    const { getByRole } = render(Toolbar, {
      props: { channel: left, libraryPreampDb: 0 },
      context: new Map([[SESSION_KEY, s]]),
    });

    const link = getByRole('button', { name: /Link/ });
    expect(link.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(link);
    expect(link.getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(getByRole('button', { name: '+ Add band' }));
    await vi.waitFor(() => {
      expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual([ChannelId.Out1L, ChannelId.Out1R].sort());
    });
  });
});
