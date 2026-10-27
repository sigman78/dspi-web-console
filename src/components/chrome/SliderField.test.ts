import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SliderField from './SliderField.svelte';

const base = { value: 0, min: -10, max: 10, step: 1, kind: 'dB-signed' as const, label: 'GAIN' };

async function drag(container: HTMLElement, values: number[]): Promise<void> {
  const range = container.querySelector('input[type="range"]')!;
  await fireEvent.pointerDown(range);
  for (const v of values) await fireEvent.input(range, { target: { value: String(v) } });
  window.dispatchEvent(new Event('pointerup'));
}

describe('SliderField lanes', () => {
  it('scrub writes on every move and does not write again at release', async () => {
    const onChange = vi.fn();
    const { container } = render(SliderField, { ...base, lane: 'scrub', onChange });
    await drag(container, [1, 2, 3]);
    expect(onChange.mock.calls).toEqual([[1], [2], [3]]);
  });

  it('gesture previews on every move and writes once at release, holding the value until the mirror moves', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const { container, rerender } = render(SliderField, { ...base, lane: 'gesture', onChange, onPreview });
    await drag(container, [1, 2, 3]);
    expect(onPreview.mock.calls).toEqual([[1], [2], [3]]);
    expect(onChange.mock.calls).toEqual([[3]]);

    const range = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(range.value).toBe('3');
    await rerender({ ...base, value: 4, lane: 'gesture', onChange, onPreview });
    expect(range.value).toBe('4');
  });

  it('gesture does not write when released where it started', async () => {
    const onChange = vi.fn();
    const { container } = render(SliderField, { ...base, lane: 'gesture', onChange });
    await drag(container, [2, 0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers a reset chip only when resetTo is given', async () => {
    const onChange = vi.fn();
    const without = render(SliderField, { ...base, value: 5, lane: 'scrub', onChange });
    expect(without.container.querySelector('.chip.icon')).toBeNull();
    without.unmount();

    const { container } = render(SliderField, { ...base, value: 5, lane: 'scrub', resetTo: 0, onChange });
    await fireEvent.click(container.querySelector('.chip.icon')!);
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
