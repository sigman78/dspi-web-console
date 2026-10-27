import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { FilterType } from '@/domain';
import BandMenu from './BandMenu.svelte';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function mount(extra: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(BandMenu, {
    props: {
      x: 10, y: 10, boundsW: 400, boundsH: 300,
      type: FilterType.Peaking, bypassed: false,
      types: [FilterType.Peaking, FilterType.LowShelf],
      onType: vi.fn(), onBypass: vi.fn(), onClear: vi.fn(), onClose,
      ...extra,
    },
  });
  return { onClose };
}

describe('BandMenu keyboard', () => {
  test('opens on the first item, arrows move and wrap', async () => {
    mount();
    const items = screen.getByRole('menu').querySelectorAll('button');
    const first = items[0];
    const last = items[items.length - 1];
    expect(document.activeElement).toBe(first);
    await fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
    await fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    await fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(last);
    await fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  test('activating an item applies it and closes the menu', async () => {
    const onBypass = vi.fn();
    const { onClose } = mount({ onBypass });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Bypass' }));
    expect(onBypass).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
